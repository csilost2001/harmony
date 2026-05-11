import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  registerEditor as presenceRegisterEditor,
  registerViewer as presenceRegisterViewer,
  unregister as presenceUnregister,
  unregisterAllForSession as presenceUnregisterAllForSession,
  heartbeat as presenceHeartbeat,
  list as presenceList,
  startCleanupInterval as presenceStartCleanupInterval,
  stopCleanupInterval as presenceStopCleanupInterval,
  type PresenceEntryWithLevel,
} from "./presenceManager.js";
import { execSync } from "child_process";
import { platform } from "node:os";
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { renameScreenItemId, checkScreenItemRefs } from "./renameScreenItem.js";
import {
  isLockdown as isWorkspaceLockdown,
  getLockdownPath as getWorkspaceLockdownPath,
  LockdownError as WorkspaceLockdownError,
  LOCKDOWN_WORKSPACE_ID,
  workspaceContextManager,
} from "./workspaceState.js";
import {
  listWorkspaces as listWorkspacesEntries,
  upsertWorkspace as upsertWorkspaceEntry,
  removeWorkspace as removeWorkspaceEntry,
  findById as findWorkspaceById,
  findByPath as findWorkspaceByPath,
  setLastActive as setLastActiveWorkspace,
} from "./recentStore.js";
import {
  inspectWorkspacePath,
  initializeWorkspace as initializeWorkspaceFolder,
} from "./workspaceInit.js";
import { getHostInfo } from "./hostInfo.js";
import {
  EditSessionStore,
  EditSessionNotFoundError,
  EditSessionStateError,
  EditSessionPermissionError,
  EditSessionParticipantError,
  type DraftResourceType as EditSessionResourceType,
  type ParticipantInfo as EditSessionParticipantInfo,
  type SaveEvent as EditSessionSaveEvent,
} from "./editSessionStore.js";
import { DraftHistoryStore } from "./draftHistoryStore.js";
import {
  readProject,
  writeProject,
  readScreen,
  writeScreen,
  readScreenEntity,
  writeScreenEntity,
  deleteScreen as deleteScreenFile,
  readCustomBlocks,
  writeCustomBlocks,
  readPuckComponents,
  writePuckComponents,
  readPuckData,
  writePuckData,
  readTable,
  writeTable,
  deleteTable as deleteTableFile,
  listAllTables,
  readErLayout,
  writeErLayout,
  readScreenFlowPositions,
  writeScreenFlowPositions,
  readProcessFlow,
  writeProcessFlow,
  deleteProcessFlow as deleteProcessFlowFile,
  listProcessFlows as listProcessFlowFiles,
  readConventions,
  writeConventions,
  readScreenItems,
  writeScreenItems,
  deleteScreenItems,
  readSequence,
  writeSequence,
  deleteSequence as deleteSequenceFile,
  readView,
  writeView,
  deleteView as deleteViewFile,
  listAllViews,
  readViewDefinition,
  writeViewDefinition,
  deleteViewDefinition as deleteViewDefinitionFile,
  listAllViewDefinitions,
  getFileMtime,
  readExtensionsBundle,
  writeExtensionsFile,
  resolveRoot,
} from "./projectStorage.js";

type Command = { id: string; method: string; params?: unknown };
type Response = { id: string; result?: unknown; error?: string };
type BrowserRequest = { type: "request"; id: string; method: string; params?: unknown };

// Port は env var で上書き可能 (テスト用に任意 port を使う想定)。未指定なら 5179 (#302)
const WS_PORT = parseInt(process.env.DESIGNER_MCP_PORT ?? "5179", 10);
const TIMEOUT_MS = 10000;

/** ポートを占有している古い backend プロセスを強制終了 (#846: WSL2/Linux/macOS 対応) */
function killStaleProcessOnPort(port: number): boolean {
  return platform() === "win32"
    ? killStaleProcessOnPortWin32(port)
    : killStaleProcessOnPortPosix(port);
}

/** Windows 経路: netstat + taskkill */
function killStaleProcessOnPortWin32(port: number): boolean {
  try {
    const output = execSync(`netstat -ano -p tcp`, { encoding: "utf8", windowsHide: true });
    const lines = output.split(/\r?\n/);
    const ownPid = process.pid;
    const pids = new Set<number>();

    for (const line of lines) {
      if (!/LISTENING/.test(line)) continue;
      // 127.0.0.1 / 0.0.0.0 / [::] いずれの bind でも検出 (#302 対応で HTTP サーバは 0.0.0.0 bind)
      const match = line.match(/(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (!match) continue;
      if (parseInt(match[1], 10) !== port) continue;
      const pid = parseInt(match[2], 10);
      if (pid !== ownPid) pids.add(pid);
    }

    if (pids.size === 0) return false;

    for (const pid of pids) {
      console.error(`[WsBridge] Killing stale process PID=${pid} on port ${port}`);
      try {
        execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: "ignore" });
      } catch (e) {
        console.error(`[WsBridge] Failed to kill PID=${pid}:`, e);
      }
    }
    return true;
  } catch (e) {
    console.error("[WsBridge] killStaleProcessOnPort error:", e);
    return false;
  }
}

/** POSIX 経路 (Linux / macOS / WSL2): lsof + kill -9 */
function killStaleProcessOnPortPosix(port: number): boolean {
  // -sTCP:LISTEN は重要: これが無いと当該 port に接続中のクライアント PID も返り、
  // 無関係なプロセス (例: HTTP MCP client) を巻き添えで kill してしまう。
  let output: string;
  try {
    output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    // execSync は shell 経由のため lsof 未導入は shell exit status 127、
    // 該当プロセス無しは lsof 自身が exit 1。前者のみ warn で可視化する。
    const status = (e as { status?: number }).status;
    if (status === 127) {
      console.warn(`[WsBridge] lsof not found; stale process kill on port ${port} skipped`);
    }
    return false;
  }

  const ownPid = process.pid;
  const pids = new Set<number>();
  for (const token of output.split(/\s+/)) {
    const pid = parseInt(token, 10);
    if (Number.isFinite(pid) && pid > 0 && pid !== ownPid) pids.add(pid);
  }

  if (pids.size === 0) return false;

  for (const pid of pids) {
    console.error(`[WsBridge] Killing stale process PID=${pid} on port ${port}`);
    try {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" });
    } catch (e) {
      console.error(`[WsBridge] Failed to kill PID=${pid}:`, e);
    }
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HTTP request handler (index.ts が MCP endpoint 等を register するために使用) */
type HttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

class WsBridge extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private httpRoutes: Array<{ pathPrefix: string; handler: HttpRequestHandler }> = [];
  /** clientId → WebSocket（登録済みクライアント） */
  private clients = new Map<string, WebSocket>();
  /** 接続順（最後が最新）。MCP コマンドの送信先選択に使用 */
  private clientOrder: string[] = [];
  /** MCP コマンドの応答待ちハンドラ */
  private pending = new Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  /** 最後に WebSocket メッセージを受信した時刻 (ms)。half-dead 検知用 (#795-A) */
  private lastMessageAt: number | null = null;
  /** プロセス起動時刻 (ms) */
  private readonly startedAt: number = Date.now();
  /**
   * EditSessionStore を workspace 単位で管理 (spec §15.1, Phase 2)。
   * key = wsId (workspace root path)。既存 lockManager / draftStore と同じ lazy 生成パターン。
   */
  private editSessionStores = new Map<string, EditSessionStore>();
  /**
   * DraftHistoryStore を workspace 単位で管理 (#893)。
   * key = wsId (workspace root path)。EditSessionStore と同じ lazy 生成パターン。
   */
  private draftHistoryStores = new Map<string, DraftHistoryStore>();
  /** spec §12.4 / §18.3: 1h 周期の EditSession cleanupExpired タイマー */
  private editSessionCleanupTimer: NodeJS.Timeout | null = null;

  get isConnected(): boolean {
    return this.clients.size > 0;
  }

  /** 指定 sessionId が接続中かつ OPEN 状態かを返す (AI 委任の owner 検証用) */
  isActiveSession(sessionId: string): boolean {
    const ws = this.clients.get(sessionId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /**
   * サーバ生存情報を返す (#795-A: half-dead 検知 + /health endpoint 用)。
   * - lastWsMessageAt: 最後に WebSocket メッセージを受信したエポック ms (null = まだ受信なし)
   * - wsConnections: 現在の接続ブラウザ数
   * - uptimeMs: プロセス起動からの経過 ms
   */
  getHealth(): { lastWsMessageAt: number | null; wsConnections: number; uptimeMs: number } {
    return {
      lastWsMessageAt: this.lastMessageAt,
      wsConnections: this.clients.size,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  /**
   * wsId に対応する DraftHistoryStore を lazy 生成して返す (#893)。
   */
  private getOrCreateDraftHistoryStore(wsId: string): DraftHistoryStore {
    let store = this.draftHistoryStores.get(wsId);
    if (!store) {
      store = new DraftHistoryStore(wsId);
      this.draftHistoryStores.set(wsId, store);
    }
    return store;
  }

  /**
   * wsId (workspace root path) に対応する EditSessionStore を lazy 生成して返す (Phase 2, spec §15.1)。
   * 既存 lockManager / draftStore の workspace 単位インスタンス化パターンと同様。
   * #893: DraftHistoryStore を DI して discard / transferEdit / save 時の snapshot 記録を有効化。
   */
  private getOrCreateEditSessionStore(wsId: string): EditSessionStore {
    let store = this.editSessionStores.get(wsId);
    if (!store) {
      const historyStore = this.getOrCreateDraftHistoryStore(wsId);
      store = new EditSessionStore(wsId, historyStore);
      this.editSessionStores.set(wsId, store);
    }
    return store;
  }

  // ── EditSession public API (#906, MCP tool + WS handler 共有) ─────────────────
  // sessionId は workspace 解決 + actor (participant.sessionId) として使われる。
  // WS 経由は WebSocket clientId、MCP 経由は MCP sessionId をそのまま渡す
  // (workspaceContextManager は両 namespace を統一管理する、#700 R-2)。

  /**
   * sessionId から active workspace path (wsId) を解決する。未選択時は WorkspaceUnsetError を throw。
   * #917 review M-1: plain Error だと index.ts の catch ブロックで McpError(InvalidParams) に
   * 変換されず汎用 isError に落ちるため、他 workspace 依存 MCP tool と同じ requireActivePath を使う。
   */
  private _resolveActiveWsId(sessionId: string): string {
    return workspaceContextManager.requireActivePath(sessionId);
  }

  /** spec §5 step 1: 新規 EditSession を作成し initial Edit participant として登録 + broadcast */
  editSessionCreate(
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
    const serialized = _serializeEditSession(session);
    this.broadcast({ wsId, event: "editSession.created", data: { editSession: serialized } });
    return { editSession: serialized };
  }

  /** spec §5 step 2: View role で attach + initial payload fetch + broadcast */
  editSessionAttachAsView(
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
  editSessionDetach(sessionId: string, editSessionId: string): { detached: true } {
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
  editSessionSetRole(
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
  editSessionTransferEdit(
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
  editSessionUpdate(
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
  async editSessionSave(
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
  async editSessionDiscard(sessionId: string, editSessionId: string): Promise<{ discarded: true }> {
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
  editSessionList(
    sessionId: string,
    filter?: { resourceType?: EditSessionResourceType; resourceId?: string },
  ): { sessions: unknown[] } {
    const wsId = this._resolveActiveWsId(sessionId);
    const store = this.getOrCreateEditSessionStore(wsId);
    const sessions = filter?.resourceType && filter?.resourceId
      ? store.listByResource(filter.resourceType, filter.resourceId)
      : store.listAll();
    return { sessions: sessions.map(_serializeEditSession) };
  }

  /** spec §13.3: 現在の payload + sequence を取得 (broadcast 待ちなし) */
  editSessionFetchPayload(
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
  async editSessionListHistory(
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
  async editSessionRestoreFromHistory(
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

    const serialized = _serializeEditSession(store.get(session.id)!);
    this.broadcast({
      wsId,
      event: "editSession.created",
      data: { editSession: serialized, restoredFromHistoryId: historyId },
    });
    return { editSession: serialized };
  }

  /** MCP コマンドを送る先: 最後に接続した有効なクライアント */
  private get activeClient(): WebSocket | null {
    for (let i = this.clientOrder.length - 1; i >= 0; i--) {
      const ws = this.clients.get(this.clientOrder[i]);
      if (ws && ws.readyState === WebSocket.OPEN) return ws;
    }
    return null;
  }

  async start(): Promise<void> {
    // workspace 切替モード対応 (#671): startup 時点で workspace 未選択のことがあるため、
    // ensureDataDir() は呼ばない。各 read/write 関数が必要時に ensureDataDir() を呼ぶ。
    if (killStaleProcessOnPort(WS_PORT)) {
      await delay(500);
    }
    await this._bind();

    // Phase 7 (#885): abandoned entry の定期 cleanup を開始
    presenceStartCleanupInterval((wsId, resourceType, resourceId, entries) => {
      this.broadcast({
        wsId,
        event: "presence:update",
        data: { resourceType, resourceId, entries },
      });
    });

    // spec §12.4 / §18.3: EditSession の 1h 周期 cleanupExpired を開始
    this._startEditSessionCleanupInterval();
  }

  /**
   * spec §12.4 / §18.3 準拠: 1 時間に 1 回 全 EditSessionStore に cleanupExpired を実行する。
   * Active + 全員 View + 無活動 → Discarded 遷移 / Discarded + retention 経過 → 完全削除。
   */
  private _startEditSessionCleanupInterval(intervalMs = 60 * 60 * 1000): void {
    if (this.editSessionCleanupTimer !== null) return; // 二重起動防止
    this.editSessionCleanupTimer = setInterval(async () => {
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
  stopEditSessionCleanup(): void {
    if (this.editSessionCleanupTimer !== null) {
      clearInterval(this.editSessionCleanupTimer);
      this.editSessionCleanupTimer = null;
    }
  }

  /** Phase 7 (#885): cleanup タイマーを停止する。shutdown hook 用。 */
  stopPresenceCleanup(): void {
    presenceStopCleanupInterval();
  }

  /** HTTP + WebSocket サーバを停止し全接続を切断する。shutdown hook 用。 */
  stop(): void {
    presenceStopCleanupInterval();
    this.stopEditSessionCleanup();
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.closeAllConnections?.();
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  private async _bind(retries = 3): Promise<void> {
    return new Promise((resolve, reject) => {
      // HTTP サーバに WS をアタッチ (同一 port で HTTP + WS を提供 — #302)
      const httpServer = createServer((req, res) => this._handleHttp(req, res));
      const wss = new WebSocketServer({ server: httpServer });

      const onError = async (err: NodeJS.ErrnoException) => {
        httpServer.off("listening", onListening);
        if (err.code === "EADDRINUSE" && retries > 0) {
          console.error(`[WsBridge] Port ${WS_PORT} busy, retrying (${retries} left)...`);
          killStaleProcessOnPort(WS_PORT);
          await delay(500);
          try {
            await this._bind(retries - 1);
            resolve();
          } catch (e) {
            reject(e);
          }
        } else {
          console.error("[WsBridge] Failed to bind:", err);
          reject(err);
        }
      };

      const onListening = () => {
        httpServer.off("error", onError);
        this.httpServer = httpServer;
        this.wss = wss;
        console.error(`[WsBridge] HTTP + WebSocket listening on 0.0.0.0:${WS_PORT} (ws:// and http://)`);
        this._attachHandlers();
        resolve();
      };

      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(WS_PORT, "0.0.0.0");
    });
  }

  /**
   * index.ts 側が特定 path prefix 用の HTTP ハンドラを登録する (#302: MCP HTTP transport)。
   * 登録順にマッチ判定、先にマッチしたものが処理。
   */
  registerHttpHandler(pathPrefix: string, handler: HttpRequestHandler): void {
    this.httpRoutes.push({ pathPrefix, handler });
  }

  private async _handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    for (const route of this.httpRoutes) {
      if (url === route.pathPrefix || url.startsWith(route.pathPrefix + "/") || url.startsWith(route.pathPrefix + "?")) {
        try {
          await route.handler(req, res);
        } catch (e) {
          console.error(`[WsBridge] HTTP handler error (${route.pathPrefix}):`, e);
          if (!res.writableEnded) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end(`Internal error: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        return;
      }
    }
    // Health check endpoint (#795-A): half-dead 検知情報を含む
    if (url === "/" || url === "/health") {
      const health = this.getHealth();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "harmony-mcp",
        port: WS_PORT,
        lastWsMessageAt: health.lastWsMessageAt,
        wsConnections: health.wsConnections,
        uptimeMs: health.uptimeMs,
      }));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }

  private _attachHandlers(): void {
    if (!this.wss) return;

    this.wss.on("connection", (ws: WebSocket) => {
      // 登録前は一時 ID で管理
      let clientId = `temp-${randomUUID()}`;
      this.clients.set(clientId, ws);
      this.clientOrder.push(clientId);
      // per-session context を作成 (#700 R-2)
      workspaceContextManager.connect(clientId);
      console.error(`[WsBridge] New connection (${clientId.substring(0, 12)}..., total: ${this.clients.size})`);
      if (this.clients.size === 1) this.emit("connected");

      ws.on("message", (data: Buffer) => {
        this.lastMessageAt = Date.now();
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch (e) {
          console.error("[WsBridge] Failed to parse message:", e);
          return;
        }

        // ── register: ブラウザが接続直後に送る登録メッセージ ──
        if (msg.type === "register") {
          const newId = msg.clientId as string;

          // 同じ clientId が既に存在する場合（再接続）は古い接続を閉じる
          const existingWs = this.clients.get(newId);
          if (existingWs && existingWs !== ws) {
            try { existingWs.close(); } catch { /* ignore */ }
            this.clients.delete(newId);
            const eIdx = this.clientOrder.indexOf(newId);
            if (eIdx >= 0) this.clientOrder.splice(eIdx, 1);
            // 再接続: 古い context は削除せず reconnect 扱い (activePath 維持)
          }

          // 一時 ID → 実 ID に置き換え: context も付け替え (#700 R-2)
          const prevCtxActivePath = workspaceContextManager.getActivePath(clientId);
          workspaceContextManager.disconnect(clientId);
          this.clients.delete(clientId);
          const tIdx = this.clientOrder.indexOf(clientId);
          if (tIdx >= 0) this.clientOrder[tIdx] = newId;
          clientId = newId;
          this.clients.set(clientId, ws);
          // 実 ID で context を登録 (既存なら reconnect で activePath 維持)
          workspaceContextManager.connect(clientId, prevCtxActivePath);
          console.error(`[WsBridge] Client registered: ${clientId.substring(0, 8)}... (total: ${this.clients.size})`);
          return;
        }

        // ── request: ブラウザからのファイル操作リクエスト ──
        if (msg.type === "request") {
          const req = msg as unknown as BrowserRequest;
          this._handleBrowserRequest(ws, clientId, req).catch((e) => {
            console.error("[WsBridge] Browser request error:", e);
            try {
              ws.send(JSON.stringify({ type: "response", id: req.id, error: String(e) }));
            } catch { /* ignore */ }
          });
          return;
        }

        // ── それ以外: MCP コマンドへの応答 ──
        const response = msg as unknown as Response;
        const handler = this.pending.get(response.id);
        if (handler) {
          clearTimeout(handler.timer);
          this.pending.delete(response.id);
          if (response.error) {
            handler.reject(new Error(response.error));
          } else {
            handler.resolve(response.result);
          }
        }
      });

      ws.on("close", () => {
        if (this.clients.get(clientId) === ws) {
          this.clients.delete(clientId);
          const idx = this.clientOrder.indexOf(clientId);
          if (idx >= 0) this.clientOrder.splice(idx, 1);
          // #980-A: presence 切断時 cleanup — clientId に紐づく全エントリを削除して
          // presence:update を broadcast する。これがないと cleanupAbandoned (idleThresholdSec
          // 経過 + 定期実行) まで SessionBadge が残り続ける。
          const removedPresence = presenceUnregisterAllForSession(clientId);
          for (const { wsId: rWsId, resourceType: rType, resourceId: rId } of removedPresence) {
            const entries = presenceList(rWsId, rType, rId);
            this.broadcast({
              wsId: rWsId,
              event: "presence:update",
              data: { resourceType: rType, resourceId: rId, entries },
            });
          }
          // per-session context を削除 (#700 R-2)
          workspaceContextManager.disconnect(clientId);
          console.error(`[WsBridge] Client disconnected: ${clientId.substring(0, 8)}... (remaining: ${this.clients.size})`);
          if (this.clients.size === 0) {
            this.emit("disconnected");
            this._clearPending(new Error("デザイナーが切断されました"));
          }
        }
      });

      ws.on("error", (err) => {
        console.error("[WsBridge] WebSocket error:", err);
      });
    });

    this.wss.on("error", (err: NodeJS.ErrnoException) => {
      console.error("[WsBridge] Server runtime error:", err);
    });
  }

  /** 特定クライアントへイベントを送信 */
  sendToClient(clientId: string, event: string, data: unknown): void {
    const ws = this.clients.get(clientId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "broadcast", event, data }));
    } catch { /* ignore */ }
  }

  /**
   * ブロードキャスト (#700 R-2 D-4 — 旧シグネチャ完全削除)
   *
   * 新シグネチャ: `broadcast({ wsId, event, data, excludeClientId? })`
   * - wsId が指定された場合: 該当 wsId の active workspace を持つ session のみに配信
   * - wsId が null の場合: 全 session に配信 (MCP tool からの一斉通知)
   *
   * LEGACY の文字列直渡し `broadcast(event, data)` は #700 R-2 で完全削除。
   */
  broadcast(opts: { wsId: string | null; event: string; data: unknown; excludeClientId?: string }): void {
    const { event, data, excludeClientId, wsId } = opts;
    const msg = JSON.stringify({ type: "broadcast", event, data });

    // wsId が指定された場合: 同 path の active session のみに配信 (#703 R-5 A-3)
    let targetClientIds: Iterable<string>;
    if (wsId === null) {
      // null = 全 session に配信 (extensions.changed 等ワークスペース横断の通知)
      targetClientIds = this.clients.keys();
    } else {
      // wsId(path) 指定 = 同 path を active として持つ session のみ
      targetClientIds = workspaceContextManager.getClientIdsByPath(wsId);
    }

    for (const id of targetClientIds) {
      if (id === excludeClientId) continue;
      const ws = this.clients.get(id);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }

  /** ブラウザからのファイル操作リクエストを処理 */
  private async _handleBrowserRequest(
    ws: WebSocket,
    clientId: string,
    req: BrowserRequest,
  ): Promise<void> {
    const { id, method, params } = req;

    const respond = (result: unknown): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "response", id, result }));
      }
    };
    const respondError = (error: string): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "response", id, error }));
      }
    };

    // per-session root の lazy getter (#700 R-2)
    // workspace 操作系メソッド (workspace.open 等) は root 不要なので早期解決しない。
    // storage 関数を呼ぶ箇所でのみ root() を呼ぶ。WorkspaceUnsetError は最外層 catch でハンドル。
    const root = (): string => resolveRoot(clientId);
    // per-session broadcast wsId getter (#703 R-5 A-1)
    // 各 broadcast は actor の active path を wsId として渡す (同 workspace の session のみ受信)。
    // workspace 操作中に active が変わる可能性を避けるため lazy 評価する。
    const wsId = (): string | null => workspaceContextManager.getActivePath(clientId);

    try {
      switch (method) {
        case "loadProject": {
          const project = await readProject(root());
          respond(project);
          break;
        }
        case "saveProject": {
          const { project } = (params ?? {}) as { project: unknown };
          await writeProject(project, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "projectChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadScreen": {
          const { screenId } = (params ?? {}) as { screenId: string };
          const data = await readScreen(screenId, root());
          respond(data);
          break;
        }
        case "saveScreen": {
          const { screenId, data } = (params ?? {}) as { screenId: string; data: unknown };
          await writeScreen(screenId, data, root());
          // 初回デザイン保存時に project の hasDesign フラグを更新
          try {
            const project = await readProject(root()) as { screens?: Array<{ id: string; hasDesign?: boolean; updatedAt?: string }>; updatedAt?: string } | null;
            if (project?.screens) {
              const screen = project.screens.find((s) => s.id === screenId);
              if (screen && !screen.hasDesign) {
                screen.hasDesign = true;
                screen.updatedAt = new Date().toISOString();
                project.updatedAt = new Date().toISOString();
                await writeProject(project, root());
                this.broadcast({ wsId: wsId(), event: "projectChanged", data: {}, excludeClientId: clientId });
              }
            }
          } catch (e) {
            console.error("[WsBridge] Failed to update hasDesign:", e);
          }
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId }, excludeClientId: clientId });
          break;
        }
        case "loadScreenEntity": {
          const { screenId } = (params ?? {}) as { screenId: string };
          const data = await readScreenEntity(screenId, root());
          respond(data);
          break;
        }
        case "saveScreenEntity": {
          const { screenId, data } = (params ?? {}) as { screenId: string; data: unknown };
          await writeScreenEntity(screenId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenEntityChanged", data: { screenId }, excludeClientId: clientId });
          this.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId }, excludeClientId: clientId });
          break;
        }
        case "deleteScreen": {
          const { screenId } = (params ?? {}) as { screenId: string };
          await deleteScreenFile(screenId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "loadCustomBlocks": {
          const blocks = await readCustomBlocks(root());
          respond(blocks);
          break;
        }
        case "saveCustomBlocks": {
          const { blocks } = (params ?? {}) as { blocks: unknown[] };
          await writeCustomBlocks(blocks, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "customBlocksChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadPuckComponents": {
          const components = await readPuckComponents(root());
          respond(components);
          break;
        }
        case "savePuckComponents": {
          const { components } = (params ?? {}) as { components: unknown[] };
          await writePuckComponents(components, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "puckComponentsChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadPuckData": {
          // #806: Puck Data を screens/<id>/puck-data.json から読み込み
          const { screenId } = (params ?? {}) as { screenId: string };
          const puckData = await readPuckData(screenId, root());
          respond(puckData);
          break;
        }
        case "savePuckData": {
          // #806: Puck Data を screens/<id>/puck-data.json に書き込み
          const { screenId, data: puckDataPayload } = (params ?? {}) as { screenId: string; data: unknown };
          await writePuckData(screenId, puckDataPayload, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "puckDataChanged", data: { screenId }, excludeClientId: clientId });
          break;
        }
        case "loadTable": {
          const { tableId } = (params ?? {}) as { tableId: string };
          const tableData = await readTable(tableId, root());
          respond(tableData);
          break;
        }
        case "saveTable": {
          const { tableId, data } = (params ?? {}) as { tableId: string; data: unknown };
          await writeTable(tableId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "tableChanged", data: { tableId }, excludeClientId: clientId });
          break;
        }
        case "deleteTable": {
          const { tableId } = (params ?? {}) as { tableId: string };
          await deleteTableFile(tableId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "tableChanged", data: { tableId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "listAllTables": {
          const tablesData = await listAllTables(root());
          respond(tablesData);
          break;
        }
        case "loadErLayout": {
          const layoutData = await readErLayout(root());
          respond(layoutData);
          break;
        }
        case "saveErLayout": {
          const { data } = (params ?? {}) as { data: unknown };
          await writeErLayout(data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "erLayoutChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadScreenFlowPositions":
        case "loadScreenLayout": {
          const layoutData = await readScreenFlowPositions(root());
          respond(layoutData);
          break;
        }
        case "saveScreenFlowPositions":
        case "saveScreenLayout": {
          const { data } = (params ?? {}) as { data: unknown };
          await writeScreenFlowPositions(data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenFlowPositionsChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadProcessFlow": {
          const { id: agId } = (params ?? {}) as { id: string };
          const agData = await readProcessFlow(agId, root());
          respond(agData);
          break;
        }
        case "saveProcessFlow": {
          const { id: agId, data: agData } = (params ?? {}) as { id: string; data: unknown };
          await writeProcessFlow(agId, agData, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "processFlowChanged", data: { id: agId }, excludeClientId: clientId });
          break;
        }
        case "deleteProcessFlow": {
          const { id: agId } = (params ?? {}) as { id: string };
          await deleteProcessFlowFile(agId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "processFlowChanged", data: { id: agId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "listProcessFlows": {
          const agList = await listProcessFlowFiles(root());
          const metas = (agList as Array<{ id: string; name: string; type: string; screenId?: string; actions?: unknown[]; updatedAt: string }>).map((ag) => ({
            id: ag.id,
            name: ag.name,
            type: ag.type,
            screenId: ag.screenId,
            actionCount: ag.actions?.length ?? 0,
            updatedAt: ag.updatedAt,
          }));
          respond(metas);
          break;
        }
        case "listAllViews": {
          const viewsData = await listAllViews(root());
          respond(viewsData);
          break;
        }
        case "listAllViewDefinitions": {
          const viewDefinitionsData = await listAllViewDefinitions(root());
          respond(viewDefinitionsData);
          break;
        }
        case "loadConventions": {
          const catalog = await readConventions(root());
          respond(catalog);
          break;
        }
        case "saveConventions": {
          const { catalog } = (params ?? {}) as { catalog: unknown };
          await writeConventions(catalog, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "conventionsChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadScreenItems": {
          const { screenId } = (params ?? {}) as { screenId: string };
          const items = await readScreenItems(screenId, root());
          respond(items);
          break;
        }
        case "saveScreenItems": {
          const { screenId, data } = (params ?? {}) as { screenId: string; data: unknown };
          await writeScreenItems(screenId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId }, excludeClientId: clientId });
          break;
        }
        case "deleteScreenItems": {
          const { screenId } = (params ?? {}) as { screenId: string };
          await deleteScreenItems(screenId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "loadSequence": {
          const { sequenceId } = (params ?? {}) as { sequenceId: string };
          const seqData = await readSequence(sequenceId, root());
          respond(seqData);
          break;
        }
        case "saveSequence": {
          const { sequenceId, data } = (params ?? {}) as { sequenceId: string; data: unknown };
          await writeSequence(sequenceId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "sequenceChanged", data: { sequenceId }, excludeClientId: clientId });
          break;
        }
        case "deleteSequence": {
          const { sequenceId } = (params ?? {}) as { sequenceId: string };
          await deleteSequenceFile(sequenceId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "sequenceChanged", data: { sequenceId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "loadView": {
          const { viewId } = (params ?? {}) as { viewId: string };
          const data = await readView(viewId, root());
          respond(data);
          break;
        }
        case "saveView": {
          const { viewId, data } = (params ?? {}) as { viewId: string; data: unknown };
          await writeView(viewId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "viewChanged", data: { viewId }, excludeClientId: clientId });
          break;
        }
        case "deleteView": {
          const { viewId } = (params ?? {}) as { viewId: string };
          await deleteViewFile(viewId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "viewChanged", data: { viewId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "loadViewDefinition": {
          const { viewDefinitionId } = (params ?? {}) as { viewDefinitionId: string };
          const data = await readViewDefinition(viewDefinitionId, root());
          respond(data);
          break;
        }
        case "saveViewDefinition": {
          const { viewDefinitionId, data } = (params ?? {}) as { viewDefinitionId: string; data: unknown };
          await writeViewDefinition(viewDefinitionId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "viewDefinitionChanged", data: { viewDefinitionId }, excludeClientId: clientId });
          break;
        }
        case "deleteViewDefinition": {
          const { viewDefinitionId } = (params ?? {}) as { viewDefinitionId: string };
          await deleteViewDefinitionFile(viewDefinitionId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "viewDefinitionChanged", data: { viewDefinitionId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "getFileMtime": {
          const { kind, id: fid } = (params ?? {}) as { kind: string; id?: string };
          const mtime = await getFileMtime(kind, root(), fid);
          respond({ mtime });
          break;
        }
        case "getExtensions": {
          const bundle = await readExtensionsBundle(root());
          respond(bundle);
          break;
        }
        case "saveExtensionPackage": {
          const { type, content } = (params ?? {}) as { type: string; content: unknown };
          if (!["steps", "fieldTypes", "triggers", "dbOperations", "responseTypes"].includes(type)) {
            respondError(`不明な拡張種別です: ${type}`);
            break;
          }
          try {
            await writeExtensionsFile(
              type as "steps" | "fieldTypes" | "triggers" | "dbOperations" | "responseTypes",
              content,
              root(),
              { onAfterWrite: () => this.broadcast({ wsId: root(), event: "extensionsChanged", data: { type }, excludeClientId: clientId }) },
            );
            respond({ success: true });
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }
        case "renameScreenItem": {
          const { screenId, oldId, newId } = (params ?? {}) as {
            screenId: string; oldId: string; newId: string;
          };
          const result = await renameScreenItemId(screenId, oldId, newId, root());
          respond(result);
          this.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId }, excludeClientId: clientId });
          for (const agId of result.processFlowsUpdated) {
            this.broadcast({ wsId: wsId(), event: "processFlowChanged", data: { id: agId }, excludeClientId: clientId });
          }
          if (result.screenHtmlUpdated) {
            this.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId }, excludeClientId: clientId });
          }
          break;
        }
        case "checkScreenItemRefs": {
          const { screenId, itemId } = (params ?? {}) as { screenId: string; itemId: string };
          const result = await checkScreenItemRefs(screenId, itemId, root());
          respond(result);
          break;
        }

        // ── ワークスペース管理 (#671/#672/#673) ─────────────────────────
        case "workspace.list": {
          const lockdown = isWorkspaceLockdown();
          const { workspaces, lastActiveId } = lockdown
            ? { workspaces: [], lastActiveId: null }
            : await listWorkspacesEntries();
          const activePath = workspaceContextManager.getActivePath(clientId);
          const activeEntry = activePath ? await findWorkspaceByPath(activePath) : null;
          respond({
            workspaces,
            lastActiveId,
            active: activePath
              ? { id: lockdown ? LOCKDOWN_WORKSPACE_ID : activeEntry?.id ?? null, path: activePath, name: activeEntry?.name ?? null }
              : null,
            lockdown,
            lockdownPath: getWorkspaceLockdownPath(),
          });
          break;
        }
        case "workspace.status": {
          // per-session active path (#700 R-2)
          const activePath = workspaceContextManager.getActivePath(clientId);
          let activeName: string | null = null;
          if (activePath) {
            const entry = await findWorkspaceByPath(activePath);
            activeName = entry?.name ?? null;
          }
          respond({
            active: activePath ? { path: activePath, name: activeName } : null,
            lockdown: isWorkspaceLockdown(),
            lockdownPath: getWorkspaceLockdownPath(),
          });
          break;
        }
        case "workspace.inspect": {
          const { path: targetPath } = (params ?? {}) as { path?: string };
          if (typeof targetPath !== "string") {
            respondError("path は必須です");
            break;
          }
          const r = await inspectWorkspacePath(targetPath);
          respond(r);
          break;
        }
        case "workspace.hostInfo": {
          const info = await getHostInfo();
          respond(info);
          break;
        }
        case "workspace.open": {
          const { path: targetPath, id, init, dataDir: initDataDir } = (params ?? {}) as { path?: string; id?: string; init?: boolean; dataDir?: string };
          if (typeof targetPath !== "string" && typeof id !== "string") {
            respondError("path または id のいずれかが必要です");
            break;
          }
          const initFlag = init === true;
          if (initFlag && typeof targetPath !== "string") {
            respondError("init=true の場合は path が必須です");
            break;
          }
          let resolved = typeof targetPath === "string" ? targetPath : null;
          if (!resolved && typeof id === "string") {
            const entry = await findWorkspaceById(id);
            if (!entry) { respondError(`id ${id} のワークスペースが見つかりません`); break; }
            resolved = entry.path;
          }
          if (!resolved) { respondError("path 解決に失敗しました"); break; }
          let initName: string | null = null;
          if (initFlag) {
            if (isWorkspaceLockdown()) { respondError("lockdown モード中は新規ワークスペース初期化はできません"); break; }
            try {
              // dataDir は省略時 "harmony" がデフォルト (#852 R-3 D-5)
              const initOpts = typeof initDataDir === "string" ? { dataDir: initDataDir } : undefined;
              const initRes = await initializeWorkspaceFolder(resolved, initOpts);
              initName = initRes.name;
              resolved = initRes.path;
            } catch (e) {
              respondError(`ワークスペース初期化失敗: ${e instanceof Error ? e.message : String(e)}`);
              break;
            }
          } else {
            // init=false 時: stale recent エントリ / typo パスを active 化して fs を破壊しないよう、
            // open 前に inspect で ready 状態を確認する (見つからない / harmony.json 無しは reject)
            const inspect = await inspectWorkspacePath(resolved);
            if (inspect.status !== "ready") {
              respondError(
                inspect.status === "notFound"
                  ? `フォルダが見つかりません: ${resolved}`
                  : inspect.status === "invalid"
                    ? `ワークスペースの harmony.json が不正です: ${(inspect as { reason?: string }).reason ?? ""}`
                    : `ワークスペースが初期化されていません (harmony.json が見つかりません): ${resolved}。init=true で初期化してください。`,
              );
              break;
            }
          }
          try {
            // per-session context を更新 (#700 R-2)
            workspaceContextManager.setActivePath(clientId, resolved);
          } catch (e) {
            if (e instanceof WorkspaceLockdownError) { respondError(e.message); break; }
            throw e;
          }
          let name = initName ?? resolved.split(/[\\/]/).pop() ?? "";
          try {
            const proj = await readProject(resolved);
            if (proj && typeof proj === "object" && proj !== null) {
              const meta = (proj as Record<string, unknown>).meta;
              if (meta && typeof meta === "object" && meta !== null) {
                const n = (meta as Record<string, unknown>).name;
                if (typeof n === "string" && n.trim().length > 0) name = n;
              }
            }
          } catch { /* fallback */ }
          const entry = await upsertWorkspaceEntry(resolved, name);
          await setLastActiveWorkspace(entry.id);
          respond({ active: { id: entry.id, path: entry.path, name: entry.name } });
          // workspace.open broadcast: 同 path を active にしている session のみ受信 (#703 R-5 A-2)
          this.broadcast({ wsId: entry.path, event: "workspace.changed", data: {
            activeId: entry.id,
            path: entry.path,
            name: entry.name,
            lockdown: isWorkspaceLockdown(),
          }, excludeClientId: clientId });
          break;
        }
        case "workspace.close": {
          // close 前に現在の path をキャプチャしておく (close 後は getActivePath が null になるため)
          const closingPath = workspaceContextManager.getActivePath(clientId);
          try {
            // per-session context を更新 (#700 R-2)
            workspaceContextManager.clearActive(clientId);
          } catch (e) {
            if (e instanceof WorkspaceLockdownError) { respondError(e.message); break; }
            throw e;
          }
          await setLastActiveWorkspace(null);
          // workspace close 時に EditSessionStore も cleanup (#899 Phase 2)
          if (closingPath && this.editSessionStores.has(closingPath)) {
            this.editSessionStores.delete(closingPath);
          }
          respond({ success: true });
          // workspace.close broadcast: close 前のパスを持つ session のみ受信 (#703 R-5 A-2)
          this.broadcast({ wsId: closingPath, event: "workspace.changed", data: {
            activeId: null, path: null, name: null, lockdown: isWorkspaceLockdown(),
          }, excludeClientId: clientId });
          break;
        }
        case "workspace.remove": {
          if (isWorkspaceLockdown()) { respondError("lockdown モード中はワークスペースを除外できません"); break; }
          const { id } = (params ?? {}) as { id?: string };
          if (typeof id !== "string") { respondError("id は必須です"); break; }
          const removed = await removeWorkspaceEntry(id);
          respond({ removed });
          break;
        }

        // ── presence 管理 (#878 Phase 1) ──────────────────────────────────
        case "presence.heartbeat": {
          const {
            resourceType: phrt,
            resourceId: phrid,
            kind: phkind,
          } = (params ?? {}) as { resourceType: EditSessionResourceType; resourceId: string; kind: "activity" | "edit" };
          const phWsId = wsId();
          if (!phWsId) {
            respondError("ワークスペースが選択されていません");
            break;
          }
          const { levelChanged, entry, level } = presenceHeartbeat(phWsId, clientId, phrt, phrid, phkind);
          respond({ entry, level });
          // Phase 7 (#885): levelChanged が true の時のみ broadcast (broadcast 効率化)
          if (levelChanged) {
            const entries = presenceList(phWsId, phrt, phrid);
            this.broadcast({
              wsId: phWsId,
              event: "presence:update",
              data: { resourceType: phrt, resourceId: phrid, entries },
            });
          }
          break;
        }
        case "presence.list": {
          const { resourceType: plrt, resourceId: plrid } = (params ?? {}) as { resourceType: EditSessionResourceType; resourceId: string };
          const plWsId = wsId();
          if (!plWsId) {
            respondError("ワークスペースが選択されていません");
            break;
          }
          const entries = presenceList(plWsId, plrt, plrid);
          respond({ entries });
          break;
        }
        case "presence.register": {
          // Phase 1 では editor/viewer 手動登録 API を提供 (viewer role は Phase 2 で本格利用)
          const {
            resourceType: prrt,
            resourceId: prrid,
            role: prrole,
            ownerLabel: prownerLabel,
          } = (params ?? {}) as { resourceType: EditSessionResourceType; resourceId: string; role: "editor" | "viewer"; ownerLabel?: string };
          const prWsId = wsId();
          if (!prWsId) {
            respondError("ワークスペースが選択されていません");
            break;
          }
          let entry;
          if (prrole === "editor") {
            entry = presenceRegisterEditor(prWsId, clientId, prrt, prrid, prownerLabel);
          } else {
            entry = presenceRegisterViewer(prWsId, clientId, prrt, prrid);
          }
          respond({ entry });
          const allEntries = presenceList(prWsId, prrt, prrid);
          this.broadcast({
            wsId: prWsId,
            event: "presence:update",
            data: { resourceType: prrt, resourceId: prrid, entries: allEntries },
          });
          break;
        }

        // ── EditSession 管理 (#899 / meta #897 Phase 2) ──────────────────
        // spec docs/spec/edit-session-protocol.md §14 / §15.1 に準拠。
        // 旧 lock.* / draft.* handler は変更しない (Phase 4 で adapter 化、Phase 6 で削除)。

        case "editSession.create": {
          // #906: 公開 API editSessionCreate を adapter として呼ぶ (MCP tool と共有)
          const {
            resourceType: esRt,
            resourceId: esRid,
            displayLabel: esLabel,
          } = (params ?? {}) as {
            resourceType: EditSessionResourceType;
            resourceId: string;
            displayLabel?: string;
          };
          try {
            const result = this.editSessionCreate(clientId, esRt, esRid, esLabel);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.attachAsView": {
          // #906: 公開 API editSessionAttachAsView を adapter として呼ぶ
          const {
            editSessionId: esAvId,
            displayLabel: esAvLabel,
            parentHumanSessionId: esAvParent,
          } = (params ?? {}) as {
            editSessionId: string;
            displayLabel?: string;
            parentHumanSessionId?: string;
          };
          try {
            const result = this.editSessionAttachAsView(clientId, esAvId, esAvLabel, esAvParent);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.detach": {
          // #906: 公開 API editSessionDetach を adapter として呼ぶ
          const { editSessionId: esDtId } = (params ?? {}) as { editSessionId: string };
          try {
            const result = this.editSessionDetach(clientId, esDtId);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.setRole": {
          // #906: 公開 API editSessionSetRole を adapter として呼ぶ
          const {
            editSessionId: esRoleId,
            role: esNewRole,
          } = (params ?? {}) as { editSessionId: string; role: "Edit" | "View" };
          try {
            const result = this.editSessionSetRole(clientId, esRoleId, esNewRole);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.transferEdit": {
          // #906: 公開 API editSessionTransferEdit を adapter として呼ぶ
          // (caller = take-over 実行者 = new Edit holder; fromSessionId は participants から自動検索)
          const { editSessionId: esTrId } = (params ?? {}) as { editSessionId: string; toSessionId?: string };
          try {
            const result = this.editSessionTransferEdit(clientId, esTrId);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.update": {
          // opaque envelope: payload は server で解釈しない (Forward-Compat 原則 ①)
          // #906: 公開 API editSessionUpdate を adapter として呼ぶ
          const {
            editSessionId: esUpId,
            payload: esUpPayload,
          } = (params ?? {}) as { editSessionId: string; payload: unknown };
          try {
            const result = this.editSessionUpdate(clientId, esUpId, esUpPayload);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.save": {
          // #906: 公開 API editSessionSave を adapter として呼ぶ (#912 stage パラメータ含む)
          const { editSessionId: esSvId, force, stage } = (params ?? {}) as {
            editSessionId: string;
            force?: boolean;
            stage?: "checkOnly" | "commit";
          };
          try {
            const result = await this.editSessionSave(clientId, esSvId, { force, stage });
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.discard": {
          // #906: 公開 API editSessionDiscard を adapter として呼ぶ
          const { editSessionId: esDiscId } = (params ?? {}) as { editSessionId: string };
          try {
            const result = await this.editSessionDiscard(clientId, esDiscId);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.list": {
          // #906: 公開 API editSessionList を adapter として呼ぶ
          const {
            resourceType: esLstRt,
            resourceId: esLstRid,
          } = (params ?? {}) as { resourceType?: EditSessionResourceType; resourceId?: string };
          try {
            const result = this.editSessionList(clientId, { resourceType: esLstRt, resourceId: esLstRid });
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.fetchPayload": {
          // #906: 公開 API editSessionFetchPayload を adapter として呼ぶ
          const { editSessionId: esFpId } = (params ?? {}) as { editSessionId: string };
          try {
            const result = this.editSessionFetchPayload(clientId, esFpId);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.listHistory": {
          // #893: DraftHistory 一覧を返す
          const {
            resourceType: esLhRt,
            resourceId: esLhRid,
          } = (params ?? {}) as { resourceType: string; resourceId: string };
          try {
            const result = await this.editSessionListHistory(clientId, esLhRt, esLhRid);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        case "editSession.restoreFromHistory": {
          // #893: 履歴から新規 EditSession を作成して返す
          const {
            historyId: esRhId,
            displayLabel: esRhLabel,
          } = (params ?? {}) as { historyId: string; displayLabel?: string };
          try {
            const result = await this.editSessionRestoreFromHistory(clientId, esRhId, esRhLabel);
            respond(result);
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }

        default: {
          // 動的に登録されたハンドラ (#750 follow-up: client.log.flush 等)
          const dynHandler = this._browserHandlers.get(method);
          if (dynHandler) {
            const result = await dynHandler(params, { clientId });
            respond(result);
            break;
          }
          respondError(`未知のリクエストメソッド: ${method}`);
        }
      }
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  }

  /** 動的にブラウザリクエストハンドラを登録する (#750 follow-up: client.log.flush 等)。 */
  private _browserHandlers = new Map<
    string,
    (params: unknown, ctx: { clientId: string }) => Promise<unknown> | unknown
  >();
  registerBrowserHandler(
    method: string,
    handler: (params: unknown, ctx: { clientId: string }) => Promise<unknown> | unknown,
  ): void {
    this._browserHandlers.set(method, handler);
  }

  /**
   * sendCommand のラッパー。ブラウザ未接続・エラー時は null を返す (browser-first fallback 用)。
   */
  async tryCommand(method: string, params?: unknown): Promise<unknown | null> {
    try {
      return await this.sendCommand(method, params);
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.error(`[WsBridge] tryCommand(${method}) failed, falling back to file:`, e);
      }
      return null;
    }
  }

  /** MCP コマンドをアクティブクライアントへ送信 */
  async sendCommand(method: string, params?: unknown): Promise<unknown> {
    const ws = this.activeClient;
    if (!ws) {
      throw new Error(
        "デザイナーがブラウザで開かれていません。http://localhost:5173 を開いてください",
      );
    }

    const id = randomUUID();
    const command: Command = { id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`タイムアウト: ${method} が ${TIMEOUT_MS}ms 以内に応答しませんでした`),
        );
      }, TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(command));
    });
  }

  private _clearPending(err: Error): void {
    for (const [id, handler] of this.pending.entries()) {
      clearTimeout(handler.timer);
      handler.reject(err);
      this.pending.delete(id);
    }
  }
}

export const wsBridge = new WsBridge();

// ── EditSession シリアライズヘルパー (Phase 2) ────────────────────────────────

/**
 * EditSession の Map<string, ParticipantInfo> を JSON シリアライズ可能な
 * Record<string, ParticipantInfo> に変換して返す。
 * spec §14.3 broadcast の wsId scoping と同様の理由で、
 * participants の Map は Object.fromEntries で変換する (editSessionStore.ts の FS write と同じ手法)。
 */
function _serializeEditSession(session: import("./editSessionStore.js").EditSession): unknown {
  return {
    ...session,
    participants: Object.fromEntries(session.participants.entries()),
  };
}
