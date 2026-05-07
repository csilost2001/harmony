/**
 * editSessionStore.ts (#898 / meta #897 Phase 1)
 *
 * docs/spec/edit-session-protocol.md §13.2 / §15.1 に準拠した EditSession の in-memory ストア。
 *
 * 設計方針:
 * - memory の隔離単位を session → editSessionId に変更 (§1.1 根本欠陥の解消)
 * - payload は opaque envelope として扱い、server は中身を解釈しない (Forward-Compat 原則 ①)
 * - mid-edit (update) 時は FS write しない、save / discard 時のみ write (Forward-Compat 原則 ④)
 * - take-over は同一 critical section 内で atomic に実行 (§7)
 * - history FS: <workspace-root>/.edit-sessions/<editSessionId>.json
 */

import fs from "fs/promises";
import path from "path";
import { randomBytes } from "node:crypto";
import type { DraftHistoryStore } from "./draftHistoryStore.js";
// ── 公開型定義 (spec §3.2 / §10.2) ──────────────────────────────────────────

/**
 * DraftResourceType — Phase 6 (#903): draftStore.ts 削除に伴い editSessionStore.ts に移管。
 * frontend/src/types/draft.ts と同一リスト (両方を編集同期すること)。
 */
export type DraftResourceType =
  | "screen"
  | "puck-data"
  | "table"
  | "process-flow"
  | "view"
  | "view-definition"
  | "screen-item"
  | "sequence"
  | "extension"
  | "convention"
  | "flow";

export interface ParticipantInfo {
  sessionId: string;
  role: "Edit" | "View";
  joinedAt: string;
  lastActivityAt: string;
  /** AI participant の場合のみ (誰が指示した AI か) */
  parentHumanSessionId?: string;
  /** "@alice" / "Alice@AI" 等。caller が組んで渡す */
  displayLabel: string;
}

export interface SaveEvent {
  /** audit 必須: save した session ID */
  savedBy: string;
  savedAt: string;
  /** save 時点の payload sequence */
  sequence: number;
}

export interface EditSession {
  id: string;
  resourceType: DraftResourceType;
  resourceId: string;
  state: "Active" | "Discarded";
  /** key = sessionId */
  participants: Map<string, ParticipantInfo>;
  /** 編集中の最新 state (in-memory 真実点) */
  payload: unknown;
  /** monotonic counter (broadcast の reorder 検出用) */
  sequence: number;
  createdAt: string;
  /** 自動削除予定日時 (createdAt + TTL) */
  expiresAt: string;
  saveHistory: SaveEvent[];
  lastActivityAt: string;
  discardedAt?: string;
}

/** EditSession に対する cleanupExpired の操作種別 */
export interface CleanupResult {
  editSession: EditSession;
  action: "discarded" | "deleted";
}

// ── エラークラス ──────────────────────────────────────────────────────────────

export class EditSessionNotFoundError extends Error {
  constructor(editSessionId: string) {
    super(`EditSession ${editSessionId} が見つかりません`);
    this.name = "EditSessionNotFoundError";
  }
}

export class EditSessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditSessionStateError";
  }
}

export class EditSessionPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditSessionPermissionError";
  }
}

export class EditSessionParticipantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditSessionParticipantError";
  }
}

// ── ULID-like ID 生成 (spec §3.3) ─────────────────────────────────────────────

/**
 * ULID-like な ID を生成する。
 * `<time-prefix-10chars>-<random-16chars>` 形式で時刻順序保証 + ランダム性を両立。
 * 辞書順ソートで時系列順になる (時刻 prefix が同じ精度内で比較可能)。
 */
function generateEditSessionId(): string {
  const timePrefix = Date.now().toString(36).padStart(10, "0");
  const random = randomBytes(8).toString("hex"); // 16 chars hex
  return `es-${timePrefix}-${random}`;
}

// ── history FS ヘルパー (spec §13.4) ──────────────────────────────────────────

const EDIT_SESSIONS_DIR = ".edit-sessions";

function editSessionsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, EDIT_SESSIONS_DIR);
}

function editSessionFilePath(workspaceRoot: string, editSessionId: string): string {
  return path.join(editSessionsDir(workspaceRoot), `${editSessionId}.json`);
}

/**
 * EditSession を FS に atomic write する。
 * Map を object に変換して JSON シリアライズ可能にする。
 */
async function writeEditSessionToFs(workspaceRoot: string, session: EditSession): Promise<void> {
  const dir = editSessionsDir(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });

  const filePath = editSessionFilePath(workspaceRoot, session.id);
  const rand = randomBytes(4).toString("hex");
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${rand}`;

  // Map を object に変換して JSON シリアライズ
  const serializable = {
    ...session,
    participants: Object.fromEntries(session.participants.entries()),
  };

  try {
    await fs.writeFile(tmp, JSON.stringify(serializable, null, 2), "utf-8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * EditSession の history FS ファイルを削除する。
 */
async function deleteEditSessionFromFs(workspaceRoot: string, editSessionId: string): Promise<void> {
  const filePath = editSessionFilePath(workspaceRoot, editSessionId);
  try {
    await fs.unlink(filePath);
  } catch {
    // ファイルが存在しない場合は無視
  }
}

// ── EditSessionStore ──────────────────────────────────────────────────────────

/**
 * EditSession の in-memory ストア (workspace 単位で 1 インスタンス)。
 *
 * spec §13.2 のクラス定義に準拠。
 */
export class EditSessionStore {
  /** key = editSessionId */
  private store = new Map<string, EditSession>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly draftHistoryStore?: DraftHistoryStore,
  ) {}

  // ── lifecycle ───────────────────────────────────────────────────────────────

  /**
   * 新規 EditSession を作成する (spec §5 step 1)。
   * actorSessionId は initial Edit participant として登録される。
   */
  create(
    actorSessionId: string,
    resourceType: DraftResourceType,
    resourceId: string,
    displayLabel: string,
    opts?: {
      parentHumanSessionId?: string;
      ttlDays?: number;
    },
  ): EditSession {
    const now = new Date();
    const ttlDays = opts?.ttlDays ?? 7;
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const id = generateEditSessionId();
    const nowIso = now.toISOString();

    const initialParticipant: ParticipantInfo = {
      sessionId: actorSessionId,
      role: "Edit",
      joinedAt: nowIso,
      lastActivityAt: nowIso,
      displayLabel,
      ...(opts?.parentHumanSessionId !== undefined
        ? { parentHumanSessionId: opts.parentHumanSessionId }
        : {}),
    };

    const session: EditSession = {
      id,
      resourceType,
      resourceId,
      state: "Active",
      participants: new Map([[actorSessionId, initialParticipant]]),
      payload: null,
      sequence: 0,
      createdAt: nowIso,
      expiresAt,
      saveHistory: [],
      lastActivityAt: nowIso,
    };

    this.store.set(id, session);
    return session;
  }

  /**
   * editSessionId で EditSession を取得する。
   * 存在しない場合は null を返す。
   */
  get(editSessionId: string): EditSession | null {
    return this.store.get(editSessionId) ?? null;
  }

  /**
   * EditSession を memory + history FS から完全削除する (spec §5 step 6b / completeDelete)。
   * 存在しない場合は何もしない。
   */
  delete(editSessionId: string): void {
    this.store.delete(editSessionId);
    // FS 削除は非同期で実行 (await しない — fire and forget)
    deleteEditSessionFromFs(this.workspaceRoot, editSessionId).catch((e) => {
      console.error(`[editSessionStore] delete FS error (${editSessionId}):`, e);
    });
  }

  /**
   * EditSession を memory + history FS から完全削除する (明示 delete / retention 経過)。
   * delete() の alias (spec §13.2 completeDelete 相当)。
   */
  async completeDelete(editSessionId: string): Promise<void> {
    this.store.delete(editSessionId);
    await deleteEditSessionFromFs(this.workspaceRoot, editSessionId);
  }

  // ── participant 管理 ─────────────────────────────────────────────────────────

  /**
   * View role で既存 EditSession に参加する (spec §5 step 2)。
   * 既に participants に存在する場合は lastActivityAt を更新して返す。
   */
  attachAsView(
    editSessionId: string,
    sessionId: string,
    displayLabel: string,
    parentHumanSessionId?: string,
  ): ParticipantInfo {
    const session = this._requireActive(editSessionId);
    const now = new Date().toISOString();

    const existing = session.participants.get(sessionId);
    if (existing) {
      existing.lastActivityAt = now;
      session.lastActivityAt = now;
      return existing;
    }

    const participant: ParticipantInfo = {
      sessionId,
      role: "View",
      joinedAt: now,
      lastActivityAt: now,
      displayLabel,
      ...(parentHumanSessionId !== undefined ? { parentHumanSessionId } : {}),
    };

    session.participants.set(sessionId, participant);
    session.lastActivityAt = now;
    return participant;
  }

  /**
   * participant を EditSession から離脱させる。
   * Edit role の participant は先に View に降格してから detach すること (spec §6.2)。
   * 存在しない sessionId の場合は何もしない。
   */
  detach(editSessionId: string, sessionId: string): void {
    const session = this._requireActive(editSessionId);
    const participant = session.participants.get(sessionId);
    if (!participant) return;
    if (participant.role === "Edit") {
      throw new EditSessionPermissionError(
        `Edit role の participant (${sessionId}) を直接 detach することはできません。先に View に降格してください (spec §6.2)`,
      );
    }
    session.participants.delete(sessionId);
    session.lastActivityAt = new Date().toISOString();
  }

  /**
   * participant の role を変更する。
   * 通常は take-over (transferEdit) を使う。単独の role 変更が必要な場合に使用。
   */
  setRole(editSessionId: string, sessionId: string, role: "Edit" | "View"): ParticipantInfo {
    const session = this._requireActive(editSessionId);
    const participant = session.participants.get(sessionId);
    if (!participant) {
      throw new EditSessionParticipantError(
        `participant ${sessionId} は EditSession ${editSessionId} に存在しません`,
      );
    }
    // Edit role は 1 名のみ (spec §6.3)
    if (role === "Edit") {
      for (const [sid, p] of session.participants.entries()) {
        if (sid !== sessionId && p.role === "Edit") {
          throw new EditSessionStateError(
            `EditSession ${editSessionId} には既に Edit role の participant (${sid}) が存在します。take-over (transferEdit) を使用してください`,
          );
        }
      }
    }
    participant.role = role;
    participant.lastActivityAt = new Date().toISOString();
    session.lastActivityAt = new Date().toISOString();
    return participant;
  }

  // ── edit ────────────────────────────────────────────────────────────────────

  /**
   * payload を更新する (spec §13.2 update)。
   * sequence を increment し lastActivityAt を更新する。
   * FS write はしない (Forward-Compat 原則 ④: snapshot only)。
   */
  update(
    editSessionId: string,
    payload: unknown,
    byEditorSessionId: string,
  ): { sequence: number } {
    const session = this._requireActive(editSessionId);
    const participant = session.participants.get(byEditorSessionId);
    if (!participant) {
      throw new EditSessionParticipantError(
        `participant ${byEditorSessionId} は EditSession ${editSessionId} に存在しません`,
      );
    }
    if (participant.role !== "Edit") {
      throw new EditSessionPermissionError(
        `participant ${byEditorSessionId} は Edit role ではないため payload を更新できません`,
      );
    }

    session.payload = payload;
    session.sequence += 1;
    const now = new Date().toISOString();
    participant.lastActivityAt = now;
    session.lastActivityAt = now;

    return { sequence: session.sequence };
  }

  /**
   * 現在の payload と sequence を取得する (spec §13.3 attach 時の initial fetch)。
   * 別 session が attach した直後に呼ぶことで、broadcast 待ちなしに最新 state を取得できる。
   * §1.1 根本欠陥の解消。
   */
  fetchCurrentPayload(editSessionId: string): { payload: unknown; sequence: number } | null {
    const session = this.store.get(editSessionId);
    if (!session) return null;
    return { payload: session.payload, sequence: session.sequence };
  }

  // ── save ────────────────────────────────────────────────────────────────────

  /**
   * EditSession の現時点 payload を history FS に書き込み、saveHistory に追加する。
   * (spec §5 step 5 / §8)
   *
   * 権限規則 (spec §5.2):
   * - Edit role の participant がいる場合: Edit role の participant のみ可
   * - 全員 View の場合 (editor 不在): View の誰でも可
   *
   * 本体ファイル (committed state) への書き込みは Phase 2 で wsBridge から行う想定。
   * store では saveHistory 追加 + history FS write のみ実施。
   */
  async save(editSessionId: string, bySessionId: string): Promise<SaveEvent> {
    const session = this._requireActive(editSessionId);
    const participant = session.participants.get(bySessionId);
    if (!participant) {
      throw new EditSessionParticipantError(
        `participant ${bySessionId} は EditSession ${editSessionId} に存在しません`,
      );
    }

    // 権限チェック (spec §5.2)
    const hasEditor = this._hasEditor(session);
    if (hasEditor && participant.role !== "Edit") {
      throw new EditSessionPermissionError(
        `Edit role の participant が在席中は Edit role のみ save 可能です (bySessionId: ${bySessionId})`,
      );
    }

    // draft history snapshot を保存 (#893: save 時点のスナップショット記録)
    if (this.draftHistoryStore && session.payload !== null && session.payload !== undefined) {
      const editor = Array.from(session.participants.values()).find((p) => p.role === "Edit");
      const ownerLabel = editor?.displayLabel ?? bySessionId;
      this.draftHistoryStore.saveSnapshot({
        resourceType: session.resourceType,
        resourceId: session.resourceId,
        editSessionId: session.id,
        ownerSessionId: bySessionId,
        ownerLabel,
        reason: "save",
        snapshot: session.payload,
      }).catch((e: unknown) => {
        console.error("[editSessionStore.save] draftHistoryStore.saveSnapshot error:", e);
      });
    }

    const now = new Date().toISOString();
    const event: SaveEvent = {
      savedBy: bySessionId,
      savedAt: now,
      sequence: session.sequence,
    };

    session.saveHistory.push(event);
    participant.lastActivityAt = now;
    session.lastActivityAt = now;

    // history FS に書き込む (spec §13.4)
    await writeEditSessionToFs(this.workspaceRoot, session);

    return event;
  }

  // ── take-over ────────────────────────────────────────────────────────────────

  /**
   * Edit role を fromSessionId から toSessionId に atomic に移譲する (spec §7)。
   *
   * 前提条件:
   * - fromSessionId が Edit role を持つこと
   * - toSessionId が View role の participant として既に登録されていること (step 2 経由必須)
   *
   * 操作:
   * 1. from.role: Edit → View  (降格)
   * 2. to.role: View → Edit    (昇格)
   * 両者は同一 critical section 内 (同期実行のため JS シングルスレッドで保証)
   */
  transferEdit(
    fromSessionId: string,
    toSessionId: string,
    editSessionId: string,
  ): { from: ParticipantInfo; to: ParticipantInfo } {
    const session = this._requireActive(editSessionId);

    const fromParticipant = session.participants.get(fromSessionId);
    if (!fromParticipant) {
      throw new EditSessionParticipantError(
        `from participant ${fromSessionId} は EditSession ${editSessionId} に存在しません`,
      );
    }
    if (fromParticipant.role !== "Edit") {
      throw new EditSessionPermissionError(
        `from participant ${fromSessionId} は Edit role ではないため take-over できません (current role: ${fromParticipant.role})`,
      );
    }

    const toParticipant = session.participants.get(toSessionId);
    if (!toParticipant) {
      throw new EditSessionParticipantError(
        `to participant ${toSessionId} は EditSession ${editSessionId} に View として参加していません。attachAsView を先に実行してください (spec §7.2)`,
      );
    }
    if (toParticipant.role !== "View") {
      throw new EditSessionPermissionError(
        `to participant ${toSessionId} は View role ではないため take-over できません (current role: ${toParticipant.role})`,
      );
    }

    // draft history snapshot を保存 (#893: transferEdit 前の元 owner の状態を記録)
    if (this.draftHistoryStore && session.payload !== null && session.payload !== undefined) {
      this.draftHistoryStore.saveSnapshot({
        resourceType: session.resourceType,
        resourceId: session.resourceId,
        editSessionId: session.id,
        ownerSessionId: fromSessionId,
        ownerLabel: fromParticipant.displayLabel,
        reason: "transferEdit",
        snapshot: session.payload,
      }).catch((e: unknown) => {
        console.error("[editSessionStore.transferEdit] draftHistoryStore.saveSnapshot error:", e);
      });
    }

    // atomic: JS シングルスレッドで同一 call stack 内に収まるため race なし (spec §7.3)
    const now = new Date().toISOString();
    fromParticipant.role = "View";    // 1. Edit → View (降格)
    fromParticipant.lastActivityAt = now;
    toParticipant.role = "Edit";      // 2. View → Edit (昇格)
    toParticipant.lastActivityAt = now;
    session.lastActivityAt = now;

    return { from: fromParticipant, to: toParticipant };
  }

  // ── discard / completeDelete ─────────────────────────────────────────────────

  /**
   * EditSession を Active → Discarded に遷移させる (spec §5 step 6a)。
   * history FS に Discarded 状態を書き込む。
   */
  async discard(editSessionId: string, reason: "manual" | "ttl"): Promise<void> {
    const session = this.store.get(editSessionId);
    if (!session) {
      throw new EditSessionNotFoundError(editSessionId);
    }
    if (session.state !== "Active") {
      throw new EditSessionStateError(
        `EditSession ${editSessionId} は Active 状態ではありません (current: ${session.state})`,
      );
    }

    // draft history snapshot を保存 (#893: discard 前の payload を記録)
    if (this.draftHistoryStore && session.payload !== null && session.payload !== undefined) {
      const editor = Array.from(session.participants.values()).find((p) => p.role === "Edit");
      const ownerLabel = editor?.displayLabel ?? editSessionId;
      const ownerSessionId = editor?.sessionId ?? editSessionId;
      this.draftHistoryStore.saveSnapshot({
        resourceType: session.resourceType,
        resourceId: session.resourceId,
        editSessionId: session.id,
        ownerSessionId,
        ownerLabel,
        reason: "discard",
        snapshot: session.payload,
      }).catch((e: unknown) => {
        console.error("[editSessionStore.discard] draftHistoryStore.saveSnapshot error:", e);
      });
    }

    const now = new Date().toISOString();
    session.state = "Discarded";
    session.discardedAt = now;
    session.lastActivityAt = now;

    // history FS に Discarded 状態を書き込む (spec §13.4)
    await writeEditSessionToFs(this.workspaceRoot, session);

    void reason; // broadcast は Phase 2 で wsBridge が実施
  }

  // ── cleanup ──────────────────────────────────────────────────────────────────

  /**
   * TTL 経過した EditSession を 2 段階で削除する (spec §12.2 / §12.4)。
   *
   * 1 段階目: Active + 全員 View + lastActivityAt から ttlDays 経過 → Discarded
   * 2 段階目: Discarded + discardedAt から retentionDays 経過 → 完全削除
   *
   * Edit role の participant がいる EditSession は削除しない (spec §12.2)。
   *
   * @returns 影響を受けた EditSession のリストと操作種別
   */
  async cleanupExpired(
    now: Date,
    ttlDays: number,
    retentionDays: number,
  ): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    for (const [id, session] of this.store.entries()) {
      if (session.state === "Active") {
        // Edit role の participant がいる場合は削除しない (spec §12.2)
        if (this._hasEditor(session)) continue;

        const lastActivity = new Date(session.lastActivityAt).getTime();
        if (now.getTime() - lastActivity >= ttlMs) {
          // Active → Discarded に遷移
          const nowIso = now.toISOString();
          session.state = "Discarded";
          session.discardedAt = nowIso;
          session.lastActivityAt = nowIso;
          await writeEditSessionToFs(this.workspaceRoot, session);
          results.push({ editSession: session, action: "discarded" });
        }
      } else if (session.state === "Discarded") {
        const discardedAt = session.discardedAt
          ? new Date(session.discardedAt).getTime()
          : new Date(session.lastActivityAt).getTime();
        if (now.getTime() - discardedAt >= retentionMs) {
          // Discarded → 完全削除
          await deleteEditSessionFromFs(this.workspaceRoot, id);
          this.store.delete(id);
          results.push({ editSession: session, action: "deleted" });
        }
      }
    }

    return results;
  }

  // ── 複数 EditSession 照会 ─────────────────────────────────────────────────────

  /**
   * 指定リソースの全 EditSession を返す (active + discarded)。
   */
  listByResource(resourceType: DraftResourceType, resourceId: string): EditSession[] {
    const result: EditSession[] = [];
    for (const session of this.store.values()) {
      if (session.resourceType === resourceType && session.resourceId === resourceId) {
        result.push(session);
      }
    }
    return result;
  }

  /**
   * 全 EditSession を返す (active + discarded)。filter なし。
   * editSession.list request handler の filter なし呼び出し用 (Phase 2)。
   */
  listAll(): EditSession[] {
    return Array.from(this.store.values());
  }

  /**
   * 指定 ID の EditSession を返す (active / discarded 問わず)。
   * 存在しない場合は null。spec §9.3 衝突検出の resourceType/resourceId 参照用。
   */
  getById(editSessionId: string): EditSession | null {
    return this.store.get(editSessionId) ?? null;
  }

  /**
   * テスト用: store を初期化する。
   */
  _resetForTest(): void {
    this.store.clear();
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  /** Active な EditSession を取得する。存在しない / Active でない場合はエラー */
  private _requireActive(editSessionId: string): EditSession {
    const session = this.store.get(editSessionId);
    if (!session) {
      throw new EditSessionNotFoundError(editSessionId);
    }
    if (session.state !== "Active") {
      throw new EditSessionStateError(
        `EditSession ${editSessionId} は Active 状態ではありません (current: ${session.state})`,
      );
    }
    return session;
  }

  /** Edit role の participant が 1 名以上存在するか */
  private _hasEditor(session: EditSession): boolean {
    for (const p of session.participants.values()) {
      if (p.role === "Edit") return true;
    }
    return false;
  }
}
