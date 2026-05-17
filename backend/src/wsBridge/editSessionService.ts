/**
 * EditSession service (#906 / #1144 Phase-2)
 *
 * wsBridge.ts から EditSession の公開 API (#906: MCP tool + WS handler 共有契約) を分離。
 * spec docs/spec/edit-session-protocol.md §5 / §7 / §8 / §13 / §15.1 準拠。
 *
 * 本 service は以下を担当する:
 * - workspace 単位の EditSessionStore / DraftHistoryStore lazy 生成
 * - create / attachAsView / detach / setRole / transferEdit
 * - update / save / discard / list / fetchPayload
 * - listHistory / restoreFromHistory
 * - 各操作後の WS broadcast
 *
 * wsBridge / MCP handler は本 service の publicAPI 経由で呼び出す。
 * broadcast は wsBridge.broadcast への function reference として inject される。
 *
 * sessionId は workspace 解決 + actor (participant.sessionId) として使われる。
 * WS 経由は WebSocket clientId、MCP 経由は MCP sessionId をそのまま渡す
 * (workspaceContextManager は両 namespace を統一管理する、#700 R-2)。
 */
import { workspaceContextManager } from "../workspaceState.js";
import {
  EditSessionStore,
  EditSessionNotFoundError,
  EditSessionStateError,
  type DraftResourceType as EditSessionResourceType,
  type EditSession,
  type ParticipantInfo as EditSessionParticipantInfo,
  type SaveEvent as EditSessionSaveEvent,
} from "../editSessionStore.js";
import { DraftHistoryStore } from "../draftHistoryStore.js";
import {
  writeScreen,
  writePuckData,
  writeTable,
  writeProcessFlow,
  writeView,
  writeViewDefinition,
  writePageLayout,
  writeScreenItems,
  writeSequence,
  resolveRoot,
} from "../projectStorage.js";

/**
 * broadcast callback (wsBridge.broadcast を inject)。
 * wsId: null は cross-workspace、null 以外は同 path active session のみ。
 */
type BroadcastFn = (opts: { wsId: string | null; event: string; data: unknown; excludeClientId?: string }) => void;

export class EditSessionService {
  /**
   * EditSessionStore を workspace 単位で管理 (spec §15.1, Phase 2)。
   * key = wsId (workspace root path)。
   */
  private editSessionStores = new Map<string, EditSessionStore>();
  /**
   * DraftHistoryStore を workspace 単位で管理 (#893)。
   * key = wsId (workspace root path)。
   */
  private draftHistoryStores = new Map<string, DraftHistoryStore>();
  /** spec §12.4 / §18.3: 1h 周期の EditSession cleanupExpired タイマー */
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(private readonly broadcast: BroadcastFn) {}

  /**
   * wsId に対応する DraftHistoryStore を lazy 生成して返す (#893)。
   */
  getOrCreateDraftHistoryStore(wsId: string): DraftHistoryStore {
    let store = this.draftHistoryStores.get(wsId);
    if (!store) {
      store = new DraftHistoryStore(wsId);
      this.draftHistoryStores.set(wsId, store);
    }
    return store;
  }

  /**
   * wsId (workspace root path) に対応する EditSessionStore を lazy 生成して返す (Phase 2, spec §15.1)。
   * #893: DraftHistoryStore を DI して discard / transferEdit / save 時の snapshot 記録を有効化。
   */
  getOrCreateEditSessionStore(wsId: string): EditSessionStore {
    let store = this.editSessionStores.get(wsId);
    if (!store) {
      const historyStore = this.getOrCreateDraftHistoryStore(wsId);
      store = new EditSessionStore(wsId, historyStore);
      this.editSessionStores.set(wsId, store);
    }
    return store;
  }

  /**
   * workspace close 時に当該 wsId の EditSessionStore を破棄する (#899 Phase 2)。
   * 存在しない場合は no-op。
   */
  deleteStoreForWorkspace(wsId: string): void {
    this.editSessionStores.delete(wsId);
  }

  /**
   * sessionId から active workspace path (wsId) を解決する。未選択時は WorkspaceUnsetError を throw。
   * #917 review M-1: plain Error だと index.ts の catch ブロックで McpError(InvalidParams) に
   * 変換されず汎用 isError に落ちるため、他 workspace 依存 MCP tool と同じ requireActivePath を使う。
   */
  private _resolveActiveWsId(sessionId: string): string {
    return workspaceContextManager.requireActivePath(sessionId);
  }

  /** spec §5 step 1: 新規 EditSession を作成し initial Edit participant として登録 + broadcast */
  create(
    sessionId: string,
    resourceType: EditSessionResourceType,
    resourceId: string,
    displayLabel?: string,
    parentHumanSessionId?: string,
  ): { editSession: unknown } {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    const session = store.create(
      sessionId,
      resourceType,
      resourceId,
      displayLabel ?? sessionId,
      parentHumanSessionId !== undefined ? { parentHumanSessionId } : undefined,
    );
    const serialized = serializeEditSession(session);
    this.broadcast({ wsId, event: "editSession.created", data: { editSession: serialized } });
    return { editSession: serialized };
  }

  /** spec §5 step 2: View role で attach + initial payload fetch + broadcast */
  attachAsView(
    sessionId: string,
    editSessionId: string,
    displayLabel?: string,
    parentHumanSessionId?: string,
  ): { participant: EditSessionParticipantInfo; payload: unknown; sequence: number } {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    const participant = store.attachAsView(
      editSessionId,
      sessionId,
      displayLabel ?? sessionId,
      parentHumanSessionId,
    );
    const fetchResult = store.fetchCurrentPayload(editSessionId);
    this.broadcast({
      wsId,
      event: "editSession.attached",
      data: { editSessionId, participant },
    });
    return {
      participant,
      payload: fetchResult?.payload ?? null,
      sequence: fetchResult?.sequence ?? 0,
    };
  }

  /** participant detach + broadcast (Edit role は事前に View 降格必要) */
  detach(sessionId: string, editSessionId: string): { detached: true } {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    store.detach(editSessionId, sessionId);
    this.broadcast({
      wsId,
      event: "editSession.detached",
      data: { editSessionId, sessionId },
    });
    return { detached: true };
  }

  /** participant role 変更 + broadcast (通常は transferEdit を使う) */
  setRole(
    sessionId: string,
    editSessionId: string,
    newRole: "Edit" | "View",
  ): { participant: EditSessionParticipantInfo } {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    const session = store.get(editSessionId);
    const oldRole = session?.participants.get(sessionId)?.role ?? null;
    const updatedParticipant = store.setRole(editSessionId, sessionId, newRole);
    this.broadcast({
      wsId,
      event: "editSession.roleChanged",
      data: { editSessionId, sessionId, oldRole, newRole },
    });
    return { participant: updatedParticipant };
  }

  /** spec §7: take-over (caller = new Edit holder)。fromSessionId は participants から自動検索 */
  transferEdit(
    sessionId: string,
    editSessionId: string,
  ): { from: EditSessionParticipantInfo; to: EditSessionParticipantInfo } {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    const targetSession = store.getById(editSessionId);
    if (!targetSession) {
      throw new EditSessionNotFoundError(editSessionId);
    }
    // #917 review S-2: editor 不在時に caller fallback すると "from は Edit role ではない" と
    // 不明瞭なエラーが返るため、editor 不在を明示的に検出してより正確なエラーを throw する。
    const editor = Array.from(targetSession.participants.values()).find((p) => p.role === "Edit");
    if (!editor) {
      throw new EditSessionStateError(
        `EditSession ${editSessionId} に Edit role の participant が存在しないため take-over できません`,
      );
    }
    const result = store.transferEdit(editor.sessionId, sessionId, editSessionId);
    this.broadcast({
      wsId,
      event: "editSession.roleChanged",
      data: {
        editSessionId,
        sessionId,
        oldRole: "View" as const,
        newRole: "Edit" as const,
        op: "transferred",
        transferTo: sessionId,
      },
    });
    return result;
  }

  /** spec §13.2 update: payload を更新 + broadcast (FS write なし、Forward-Compat 原則 ④) */
  update(
    sessionId: string,
    editSessionId: string,
    payload: unknown,
  ): { sequence: number } {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    const { sequence } = store.update(editSessionId, payload, sessionId);
    this.broadcast({
      wsId,
      event: "editSession.update",
      data: { editSessionId, sequence, payload, senderSessionId: sessionId },
    });
    return { sequence };
  }

  /**
   * spec §5 step 5 / §8: 確定保存。stage パラメータで 2 段階保存をサポート (#912)。
   *   - stage 未指定: conflict check + saveHistory + 本体書き込み + broadcast
   *   - stage: "checkOnly": conflict check のみ
   *   - stage: "commit": conflict check skip、saveHistory + 本体書き込み + broadcast
   * 衝突時は { ok: false, conflict } を return value で signal (throw しない)。
   */
  async save(
    sessionId: string,
    editSessionId: string,
    opts?: { force?: boolean; stage?: "checkOnly" | "commit" },
  ): Promise<
    | { ok: true; saveEvent?: EditSessionSaveEvent }
    | { ok: false; conflict: { other: { editSessionId: string; savedBy: string; savedAt: string; displayLabel: string } } }
  > {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    const force = opts?.force === true;
    const stage = opts?.stage;

    // spec §9.3 last-save-wins 衝突検出
    if (!force && stage !== "commit") {
      const targetSession = store.getById(editSessionId);
      const allSessions = store.listByResource(
        targetSession?.resourceType ?? "process-flow",
        targetSession?.resourceId ?? "",
      );
      const conflicting = allSessions.find(
        (s) => s.id !== editSessionId && s.state === "Active" && s.saveHistory.length > 0,
      );
      if (conflicting) {
        const lastSave = conflicting.saveHistory[conflicting.saveHistory.length - 1];
        const otherParticipants = Array.from(conflicting.participants.values());
        const editor = otherParticipants.find((p) => p.role === "Edit") ?? otherParticipants[0];
        return {
          ok: false,
          conflict: {
            other: {
              editSessionId: conflicting.id,
              savedBy: lastSave.savedBy,
              savedAt: lastSave.savedAt,
              displayLabel: editor?.displayLabel ?? lastSave.savedBy,
            },
          },
        };
      }
    }

    // stage: "checkOnly" は conflict check のみで終了
    if (stage === "checkOnly") {
      return { ok: true };
    }

    const saveEvent = await store.save(editSessionId, sessionId);

    // 本体 resource file へ atomic write (P1-1, #907 regression 解消)
    const session = store.getById(editSessionId);
    if (session && session.payload !== null && session.payload !== undefined) {
      const root = resolveRoot(sessionId);
      const type = session.resourceType;
      const resId = session.resourceId;
      const payload = session.payload;
      try {
        switch (type) {
          case "screen":
            await writeScreen(resId, payload, root);
            break;
          case "puck-data":
            await writePuckData(resId, payload, root);
            break;
          case "table":
            await writeTable(resId, payload, root);
            break;
          case "process-flow":
            await writeProcessFlow(resId, payload, root);
            break;
          case "view":
            await writeView(resId, payload, root);
            break;
          case "view-definition":
            await writeViewDefinition(resId, payload, root);
            break;
          case "page-layout":
            await writePageLayout(resId, payload, root);
            break;
          case "screen-item": {
            const siPayload = payload as { screenId?: string } | null;
            const siScreenId = siPayload && typeof siPayload.screenId === "string" && siPayload.screenId
              ? siPayload.screenId
              : resId;
            await writeScreenItems(siScreenId, payload, root);
            break;
          }
          case "sequence":
            await writeSequence(resId, payload, root);
            break;
          case "flow":
          case "er-layout":
          case "extension":
          case "convention":
            // flow / er-layout は frontend 側が canonical 書き込みを担う。
            // extension/convention は専用 MCP tool 経由のため skip。
            break;
          default:
            break;
        }
      } catch (writeErr) {
        console.error(`[editSession.save] resource file 書き込み失敗 (type=${type}, id=${resId}):`, writeErr);
        // 書き込み失敗でも saveHistory / broadcast は続行 (可用性優先)
      }
    }

    this.broadcast({
      wsId,
      event: "editSession.saved",
      data: {
        editSessionId,
        savedBy: saveEvent.savedBy,
        savedAt: saveEvent.savedAt,
        sequence: saveEvent.sequence,
      },
    });
    return { ok: true, saveEvent };
  }

  /** spec §5 step 6a: Active → Discarded + broadcast */
  async discard(sessionId: string, editSessionId: string): Promise<{ discarded: true }> {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    await store.discard(editSessionId, "manual");
    this.broadcast({
      wsId,
      event: "editSession.discarded",
      data: { editSessionId, reason: "manual" as const },
    });
    return { discarded: true };
  }

  /** EditSession 一覧を返す (filter なしで全件、resourceType+resourceId 指定で絞り込み) */
  list(
    sessionId: string,
    filter?: { resourceType?: EditSessionResourceType; resourceId?: string },
  ): { sessions: unknown[] } {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    const sessions = filter?.resourceType && filter?.resourceId
      ? store.listByResource(filter.resourceType, filter.resourceId)
      : store.listAll();
    return { sessions: sessions.map(serializeEditSession) };
  }

  /** spec §13.3: 現在の payload + sequence を取得 (broadcast 待ちなし) */
  fetchPayload(
    sessionId: string,
    editSessionId: string,
  ): { payload: unknown; sequence: number } {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    const result = store.fetchCurrentPayload(editSessionId);
    if (!result) {
      throw new EditSessionNotFoundError(editSessionId);
    }
    return result;
  }

  /** #893: DraftHistory 一覧を返す */
  async listHistory(
    sessionId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<{ history: unknown[] }> {
    const wsId = this._resolveActiveWsId(sessionId);
    const historyStore = this.getOrCreateDraftHistoryStore(wsId);
    const history = await historyStore.listHistory({ resourceType, resourceId });
    return { history };
  }

  /**
   * #893: 履歴から新規 EditSession を作成して返す。
   * DraftHistoryStore からスナップショットを読み込み、新規 EditSession を作成して
   * スナップショットを初期 payload として設定する。
   */
  async restoreFromHistory(
    sessionId: string,
    historyId: string,
    displayLabel?: string,
  ): Promise<{ editSession: unknown }> {
    const wsId = this._resolveActiveWsId(sessionId);
    const historyStore = this.getOrCreateDraftHistoryStore(wsId);
    const entry = await historyStore.restoreFromHistory({ historyId });
    if (!entry) {
      throw new Error(`historyId ${historyId} が見つかりません`);
    }

    // 新規 EditSession を作成して snapshot を初期 payload として設定
    const store = this.getOrCreateEditSessionStore(wsId);
    const session = store.create(
      sessionId,
      entry.resourceType as EditSessionResourceType,
      entry.resourceId,
      displayLabel ?? sessionId,
    );

    // snapshot を初期 payload として update (sequence = 1)
    if (entry.snapshot !== null && entry.snapshot !== undefined) {
      store.update(session.id, entry.snapshot, sessionId);
    }

    const serialized = serializeEditSession(store.get(session.id)!);
    this.broadcast({
      wsId,
      event: "editSession.created",
      data: { editSession: serialized, restoredFromHistoryId: historyId },
    });
    return { editSession: serialized };
  }

  /**
   * spec §12.4 / §18.3 準拠: 1 時間に 1 回 全 EditSessionStore に cleanupExpired を実行する。
   * Active + 全員 View + 無活動 → Discarded 遷移 / Discarded + retention 経過 → 完全削除。
   */
  startCleanupInterval(intervalMs = 60 * 60 * 1000): void {
    if (this.cleanupTimer !== null) return; // 二重起動防止
    this.cleanupTimer = setInterval(async () => {
      const now = new Date();
      for (const [wsId, store] of this.editSessionStores.entries()) {
        try {
          const results = await store.cleanupExpired(now, 2 /* ttlDays */, 7 /* retentionDays */);
          for (const { editSession, action } of results) {
            // #917 review S-1: spec §12.4 / §14.1 準拠の broadcast event 名に修正
            //   - "discarded" (TTL 経過 Active → Discarded): editSession.discarded (reason: "ttl")
            //   - "deleted" (retention 経過 Discarded → 完全削除): editSession.expired
            if (action === "discarded") {
              this.broadcast({
                wsId,
                event: "editSession.discarded",
                data: { editSessionId: editSession.id, reason: "ttl" as const },
              });
            } else if (action === "deleted") {
              this.broadcast({
                wsId,
                event: "editSession.expired",
                data: { editSessionId: editSession.id },
              });
            }
          }
        } catch (e) {
          console.error(`[WsBridge] EditSession cleanupExpired error (wsId=${wsId}):`, e);
        }
      }

      // #893: DraftHistory の 7 日 TTL cleanup を EditSession cleanup と同周期で実行
      for (const [wsId, historyStore] of this.draftHistoryStores.entries()) {
        try {
          const deleted = await historyStore.cleanupExpired({ olderThanDays: 7 });
          if (deleted.length > 0) {
            console.info(`[WsBridge] DraftHistory cleanup (wsId=${wsId}): ${deleted.length} entries deleted`);
          }
        } catch (e) {
          console.error(`[WsBridge] DraftHistory cleanupExpired error (wsId=${wsId}):`, e);
        }
      }
    }, intervalMs);
  }

  /** spec §12.4: cleanupExpired タイマーを停止する。shutdown / テスト用。 */
  stopCleanupInterval(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

/**
 * EditSession の Map<string, ParticipantInfo> を JSON シリアライズ可能な
 * Record<string, ParticipantInfo> に変換して返す。
 * spec §14.3 broadcast の wsId scoping と同様の理由で、
 * participants の Map は Object.fromEntries で変換する (editSessionStore.ts の FS write と同じ手法)。
 */
function serializeEditSession(session: EditSession): unknown {
  return {
    ...session,
    participants: Object.fromEntries(session.participants.entries()),
  };
}
