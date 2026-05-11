/**
 * realWorkspace ヘルパー — e2e テストを実 backend (port 5179) 経由で動かすためのユーティリティ。
 *
 * #923 シリーズで localStorage fallback が削除されたため、ストアは backend が無いと throw する。
 * そのため e2e テストは「`addInitScript` で localStorage に seed」方式から「ファイルシステム + WS open」
 * 方式に移行する必要がある (#926)。
 *
 * #964 α: helper を v3 typed only に改修。LegacyProjectInput / legacyToHarmony 削除済み。
 * 各フィールドは v3 schema 由来の TypeScript 型 (Project / Table / ProcessFlow 等) を受け取る。
 *
 * 主な API:
 *   - copyExampleWorkspace(exampleName, key): examples/<name>/ をコピー
 *   - setupTestWorkspace({ key, project, tables, processFlows, ... }): 任意 seed データから
 *     最小ワークスペースを作って backend に open し、wsId を返す
 *   - cleanupRealWorkspaces(keys): .tmp/e2e-workspaces/<key>/ を削除
 *   - isMcpRunning(): port 5179 LISTEN チェック (test.skip 用)
 *   - sendBrowserRequest(method, params): wsBridge への RPC (workspace.open 等の操作)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as net from "net";
import WebSocketImpl from "ws";
import type {
  Conventions,
  CustomBlock,
  ProcessFlow,
  Project,
  Screen,
  ScreenFlowPositions,
  Sequence,
  Table,
  View,
  ViewDefinition,
} from "../../src/types/v3/index.ts";

export interface RealWorkspaceFixture {
  key: string;
  sourcePath: string;
  workspacePath: string;
}

export interface OpenedWorkspace {
  key: string;
  workspacePath: string;
  wsId: string;
  name: string;
  /** `/w/<wsId><subPath>` を返す。subPath は "/" 始まりでも省略でも OK */
  path(subPath: string): string;
  /**
   * page.goto + ブラウザ側で `mcpBridge.request("workspace.open", { id })` を呼んで
   * per-session active を本ワークスペースに固定する。
   *
   * `setupTestWorkspace` では helper の short-lived WS 経由でしか workspace.open
   * していないため、ブラウザ側 WS は backend の起動時 default workspace で接続される。
   * `page.goto` 後に `__mcpBridge` 経由で workspace.open することで、loadProject 等が
   * 本 workspace を読み込むようにする。
   */
  gotoActive(page: PageLike, subPath: string): Promise<void>;
  /**
   * backend in-memory state (editSession + activePath) をリセットする。
   * spec 内の test.afterEach から呼び出すことでテスト間 isolation を強化できる。
   *
   * setupTestWorkspace の resetEachTest: true を有効にするために、
   * spec の describe ブロック内で以下のように呼び出す:
   *
   * ```ts
   * test.afterEach(async () => { await ws.resetRuntimeState(); });
   * ```
   *
   * Note: Playwright の制約上、test.afterEach は async 関数 (beforeAll 等) 内から
   * 登録できないため、自動登録の代わりに このメソッドを expose している。
   */
  resetRuntimeState(page?: PageLike): Promise<void>;
}

/** Playwright `Page` から必要な機能のみ抜き出した interface (依存軽減) */
export interface PageLike {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: string | ((arg: string) => boolean | Promise<boolean>), arg?: string, options?: { timeout?: number }): Promise<unknown>;
  evaluate<R, A>(pageFunction: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  /** Playwright Page の waitForURL (SPA 遷移後の URL 確認に使用) */
  waitForURL?(predicate: (url: URL) => boolean, options?: { timeout?: number }): Promise<void>;
  /** Playwright Page の addInitScript (localStorage seed に使用) */
  addInitScript?: (script: unknown, arg?: unknown) => Promise<void>;
  /** Playwright Page の locator (DOM marker 待ちに使用) */
  locator?: (selector: string) => {
    waitFor(opts: { state: string; timeout: number }): Promise<void>;
    isVisible(opts?: { timeout?: number }): Promise<boolean>;
  };
}

/**
 * setupTestWorkspace の引数。各フィールドは省略可。
 * 渡したフィールドは harmony.json + 個別ファイルとして書き出される。
 *
 * #964 α: 全フィールドを v3 schema 由来 TypeScript 型 (Project / Table / ProcessFlow 等) に統一。
 * 旧 LegacyProjectInput は削除済み。v1 形式のデータは β/γ で builder 経由で v3 に変換する。
 */
export interface SetupTestWorkspaceOptions {
  /** 一意キー (.tmp/e2e-workspaces/<key>/ になる) */
  key: string;
  /**
   * 予約フラグ (現在未使用)。
   * 将来的に Playwright fixture 経由の afterEach 自動 hook に使う予定。
   * 現在は `ws.resetRuntimeState()` を test.afterEach から手動で呼ぶことで同等効果が得られる。
   */
  resetEachTest?: boolean;
  /** v3 Project — harmony.json として書き出される */
  project?: Project;
  /** v3 Table[] — 各 entry は harmony/tables/<meta.id>.json に書き出し */
  tables?: Table[];
  /** v3 ProcessFlow[] — harmony/process-flows/<meta.id>.json */
  processFlows?: ProcessFlow[];
  /** v3 Sequence[] — harmony/sequences/<meta.id>.json */
  sequences?: Sequence[];
  /** v3 View[] — harmony/views/<meta.id>.json */
  views?: View[];
  /** v3 ViewDefinition[] — harmony/view-definitions/<meta.id>.json */
  viewDefinitions?: ViewDefinition[];
  /** v3 Conventions — harmony/conventions/catalog.json */
  conventions?: Conventions;
  /** v3 Screen[] — harmony/screens/<meta.id>.json */
  screenEntities?: Screen[];
  /** Screen design (puck data 等) — `harmony/screens/<id>.design.json` */
  screenDesigns?: ScreenDesignInput[];
  /** v3 CustomBlock[] — harmony/custom-blocks.json */
  customBlocks?: CustomBlock[];
  /** Puck コンポーネント (`harmony/puck-components.json`) */
  puckComponents?: unknown[];
  /** ER レイアウト (`harmony/er-layout.json`) */
  erLayout?: unknown;
  /** v3 ScreenFlowPositions — screen-flow-positions.json (画面フロー用座標) */
  screenLayout?: ScreenFlowPositions;
  /** 既存 examples/<name> をベースにコピーしてから追加 seed する場合 */
  fromExample?: string;
}

export interface ScreenDesignInput {
  id: string;
  data: unknown;
}

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "../../..");
const TMP_ROOT = path.join(REPO_ROOT, ".tmp", "e2e-workspaces");

export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

export function tempWorkspacePath(key: string): string {
  return path.join(TMP_ROOT, key);
}

/** examples/<exampleName>/ を .tmp/e2e-workspaces/<key>/ にコピー */
export async function copyExampleWorkspace(
  exampleName: string,
  key: string,
): Promise<RealWorkspaceFixture> {
  const sourcePath = repoPath("examples", exampleName);
  const workspacePath = tempWorkspacePath(key);
  await fs.rm(workspacePath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(workspacePath), { recursive: true });
  await fs.cp(sourcePath, workspacePath, { recursive: true });
  return { key, sourcePath, workspacePath };
}

export async function cleanupRealWorkspaces(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) => fs.rm(tempWorkspacePath(key), { recursive: true, force: true })),
  );
}

/** backend サーバが port 5179 で起動しているか */
export async function isMcpRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.connect(5179, "127.0.0.1", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => resolve(false));
  });
}

/**
 * `ws://localhost:5179` に register → request → response を送る RPC ヘルパー。
 * `workspace.open` 等を呼び出し結果を取得するのに使う。10 秒タイムアウト。
 */
export function sendBrowserRequest(method: string, params: unknown = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl("ws://localhost:5179");
    const clientId = `e2e-real-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 10000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", clientId }));
      ws.send(JSON.stringify({ type: "request", id: reqId, method, params }));
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; id?: string; error?: string; result?: unknown };
        if (msg.type === "response" && msg.id === reqId) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      } catch { /* ignore other messages */ }
    });
    ws.on("error", (err) => reject(new Error(`WebSocket error: ${err.message}`)));
  });
}

/**
 * 複数 RPC を同一 WS connection (= 同一 clientId / 同一 per-session activePath) で実行する。
 * `workspace.open` で activePath を設定後、続けて `editSession.list / discard` 等を発火するのに使う。
 */
export async function withBrowserSession<T>(
  fn: (call: (method: string, params?: unknown) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolveOuter, rejectOuter) => {
    const ws = new WebSocketImpl("ws://localhost:5179");
    const clientId = `e2e-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    let registered = false;
    const queue: Array<() => void> = [];
    const flushQueue = () => {
      while (queue.length > 0) queue.shift()?.();
    };
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", clientId }));
      registered = true;
      flushQueue();
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; id?: string; error?: string; result?: unknown };
        if (msg.type === "response" && typeof msg.id === "string") {
          const handler = pending.get(msg.id);
          if (handler) {
            clearTimeout(handler.timer);
            pending.delete(msg.id);
            if (msg.error) handler.reject(new Error(msg.error));
            else handler.resolve(msg.result);
          }
        }
      } catch { /* ignore */ }
    });
    ws.on("error", (err) => rejectOuter(new Error(`WebSocket error: ${err.message}`)));

    const call = (method: string, params: unknown = {}): Promise<unknown> => new Promise((resolveCall, rejectCall) => {
      const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        pending.delete(reqId);
        rejectCall(new Error(`Timeout waiting for response to ${method}`));
      }, 10000);
      pending.set(reqId, { resolve: resolveCall, reject: rejectCall, timer });
      const send = () => ws.send(JSON.stringify({ type: "request", id: reqId, method, params }));
      if (registered) send();
      else queue.push(send);
    });

    fn(call).then(
      (value) => { try { ws.close(); } catch { /* ignore */ } resolveOuter(value); },
      (err) => { try { ws.close(); } catch { /* ignore */ } rejectOuter(err); },
    );
  });
}

/**
 * backend in-memory の workspace runtime state をリセットするヘルパー。
 *
 * spec 横断 leak の根因:
 *   1. editSessionStore が backend プロセス生存期間中に sessions を保持 → ResumeOrDiscardDialog 再表示
 *   2. per-session activePath が前 spec の wsId を引き継ぐ
 *
 * 本関数は以下を順に実行してクリーンな状態に戻す:
 *   1. editSession.list で全 session を取得して discard
 *   2. per-session activePath を null reset (workspaceId が指定された場合は workspace.open で再設定)
 *
 * setupTestWorkspace から test.afterEach で自動呼び出しされる (resetEachTest: true の場合)。
 * page が渡された場合は harmony-prefixed localStorage も clear する。
 */
export async function resetWorkspaceRuntimeState(
  page?: PageLike,
): Promise<void> {
  await withBrowserSession(async (call) => {
    // 1. editSession 全 discard
    try {
      const result = await call("editSession.list", {}) as
        | { sessions?: Array<{ id: string }> }
        | null;
      for (const s of result?.sessions ?? []) {
        await call("editSession.discard", { editSessionId: s.id }).catch(() => undefined);
      }
    } catch { /* best-effort */ }
    // 2. per-session activePath を null 相当にリセット (clearActive)
    try {
      await call("workspace.clearActive", {}).catch(() => undefined);
    } catch { /* best-effort: workspace.clearActive が無い版では workspace.open で代替 */ }
  });
  // 3. ブラウザ side の harmony-prefixed localStorage を全 clear
  if (page) {
    try {
      await page.evaluate(
        (_unused: null) => {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith("harmony-")) localStorage.removeItem(k);
          }
        },
        null,
      );
    } catch { /* best-effort */ }
  }
}

/**
 * harmony-open-tabs / harmony-active-tab を workspaceId ベースの wsPath 形式で seed する helper。
 *
 * addInitScript 呼出の代替。wsId が変わっても URL を正しく構築できる。
 *
 * @param page         Playwright の Page
 * @param wsId         setupTestWorkspace が返した wsId (将来の wsPath 構築用に受け取る)
 * @param tabs         seed するタブの配列 (type / resourceId / label 等)
 * @param activeTabId  harmony-active-tab に設定するタブ id
 */
export async function seedTabsForWorkspace(
  page: PageLike,
  wsId: string,
  tabs: Array<{ id: string; type: string; resourceId: string; label: string; isDirty?: boolean; isPinned?: boolean }>,
  activeTabId?: string,
): Promise<void> {
  // wsId は将来の wsPath 構築に備えて受け取る
  void wsId;
  // localStorage.setItem は addInitScript 内でないと初期化前に走らないため、
  // addInitScript 経由で実行する
  if (page.addInitScript) {
    await page.addInitScript(
      ({ tabs: t, activeTabId: active }: { tabs: typeof tabs; activeTabId: string | undefined }) => {
        localStorage.setItem("harmony-open-tabs", JSON.stringify(t));
        if (active) localStorage.setItem("harmony-active-tab", active);
        // 前回テストの harmony-prefixed キー残留をまとめてクリア (tabs/active 以外)
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith("harmony-") && k !== "harmony-open-tabs" && k !== "harmony-active-tab") {
            localStorage.removeItem(k);
          }
        }
      },
      { tabs, activeTabId },
    );
  }
  // addInitScript 非対応 or フォールバック不要 (初期化前でないと意味が無いため evaluate は使わない)
}

// ── 内部: UUID ヘルパー ─────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  // crypto.randomUUID は Node 18+ で利用可能
  return (globalThis.crypto as { randomUUID?: () => string }).randomUUID?.()
    ?? `${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * 任意 id を UUID v4 形式に正規化する。既に UUID v4 ならそのまま、
 * そうでない時は文字列の SHA-1 ベースで決定論的な UUID v4 を生成する。
 *
 * これにより既存テストコードが `screen-0001` 等の人間可読な id を渡しても
 * harmony.v3 schema (UUID v4 必須) を満たすファイルを生成できる。
 *
 * 同じ key + 同じ入力 id からは常に同じ UUID が出るため、テスト内で複数箇所
 * (project.screens の id と URL の id 等) が一致する。
 */
export function normalizeId(input: string): string {
  if (UUID_V4_RE.test(input)) return input;
  // 単純な決定論的 hash (FNV-1a 32bit) を 4 回チェインして 128 bit を作る
  let h0 = 0x811c9dc5, h1 = 0xdeadbeef, h2 = 0xcafebabe, h3 = 0x12345678;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h0 = ((h0 ^ c) >>> 0); h0 = Math.imul(h0, 0x01000193) >>> 0;
    h1 = ((h1 ^ c) >>> 0); h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = ((h2 ^ c) >>> 0); h2 = Math.imul(h2, 0x01000193) >>> 0;
    h3 = ((h3 ^ c) >>> 0); h3 = Math.imul(h3, 0x01000193) >>> 0;
  }
  const hex = (n: number, len: number) => n.toString(16).padStart(8, "0").slice(-len);
  // UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx (y in 8/9/a/b)
  const part1 = hex(h0, 8);
  const part2 = hex(h1 >>> 16, 4);
  const part3 = "4" + hex(h1, 3);
  const yRaw = (h2 >>> 24) & 0x3;
  const y = (8 + yRaw).toString(16);
  const part4 = y + hex(h2, 3);
  const part5 = hex(h2 >>> 8, 4) + hex(h3, 8);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

/**
 * project が省略されたとき用の最小 v3 Project を生成する。
 * #964 α: legacyToHarmony を削除し、v3 typed input をそのまま書き出す方針に変更。
 * branded type (Uuid / Timestamp 等) は実行時は plain string なので `as unknown as T` でキャスト。
 */
function buildMinimalProject(): Project {
  const ts = nowIso() as unknown as Project["meta"]["createdAt"];
  return {
    $schema: "../schemas/v3/harmony.v3.schema.json",
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: {
      id: uuid() as unknown as Project["meta"]["id"],
      name: "E2E テストプロジェクト",
      maturity: "draft",
      createdAt: ts,
      updatedAt: ts,
      mode: "upstream",
    },
    extensionsApplied: [],
    entities: {},
  };
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * 任意の seed データから最小ワークスペースを作成し、backend に workspace.open する。
 *
 * 戻り値の wsId を `/w/<wsId>/...` に使うことで、URL 経路を本物の MCP/WS 経路で動かせる。
 *
 * 呼び出し前に `await isMcpRunning()` で backend 起動を確認すること。
 */
export async function setupTestWorkspace(opts: SetupTestWorkspaceOptions): Promise<OpenedWorkspace> {
  const { key } = opts;
  const workspacePath = tempWorkspacePath(key);

  // 既存を消して fresh start
  await fs.rm(workspacePath, { recursive: true, force: true });
  await fs.mkdir(workspacePath, { recursive: true });

  if (opts.fromExample) {
    const sourcePath = repoPath("examples", opts.fromExample);
    await fs.cp(sourcePath, workspacePath, { recursive: true });
  }

  const dataDir = path.join(workspacePath, "harmony");
  await fs.mkdir(dataDir, { recursive: true });
  // 必要なサブディレクトリは ensureDataDir 相当を生成 (空でも作っておく)
  for (const sub of ["screens", "tables", "process-flows", "actions", "conventions", "sequences", "views", "view-definitions", "extensions"]) {
    await fs.mkdir(path.join(dataDir, sub), { recursive: true });
  }

  // harmony.json: project が無くても最小 shape を書く
  // #964 α: v3 typed input をそのまま JSON として書き出す (v1→v3 変換なし)
  if (opts.project || !opts.fromExample) {
    await writeJson(path.join(workspacePath, "harmony.json"), opts.project ?? buildMinimalProject());
  }

  // 個別 entity ファイル — v3 typed input をそのまま書き出す
  // meta.id が entity の識別子 (v3 schema 準拠の UUID)
  for (const t of opts.tables ?? []) {
    const id = t.id;
    await writeJson(path.join(dataDir, "tables", `${id}.json`), t);
  }
  for (const f of opts.processFlows ?? []) {
    const id = f.meta.id;
    await writeJson(path.join(dataDir, "process-flows", `${id}.json`), f);
  }
  for (const s of opts.sequences ?? []) {
    const id = s.id;
    await writeJson(path.join(dataDir, "sequences", `${id}.json`), s);
  }
  for (const v of opts.views ?? []) {
    const id = v.id;
    await writeJson(path.join(dataDir, "views", `${id}.json`), v);
  }
  for (const v of opts.viewDefinitions ?? []) {
    const id = v.id;
    await writeJson(path.join(dataDir, "view-definitions", `${id}.json`), v);
  }
  for (const s of opts.screenEntities ?? []) {
    const id = s.id;
    await writeJson(path.join(dataDir, "screens", `${id}.json`), s);
  }
  for (const d of opts.screenDesigns ?? []) {
    const id = d.id;
    await writeJson(path.join(dataDir, "screens", `${id}.design.json`), d.data);
  }
  if (opts.conventions !== undefined) {
    await writeJson(path.join(dataDir, "conventions", "catalog.json"), opts.conventions);
  }
  if (opts.customBlocks !== undefined) {
    await writeJson(path.join(dataDir, "custom-blocks.json"), opts.customBlocks);
  }
  if (opts.puckComponents !== undefined) {
    await writeJson(path.join(dataDir, "puck-components.json"), opts.puckComponents);
  }
  if (opts.erLayout !== undefined) {
    await writeJson(path.join(dataDir, "er-layout.json"), opts.erLayout);
  }
  if (opts.screenLayout !== undefined) {
    await writeJson(path.join(dataDir, "screen-flow-positions.json"), opts.screenLayout);
  }

  // backend に open + 過去 test 由来の in-memory editSession を全件 discard を SAME WS で実行する。
  // editSessionStore は backend プロセス生存期間中ずっと sessions を保持するため、
  // 同 wsId を再利用する e2e では前回の draft が ResumeOrDiscardDialog として再表示される。
  // workspace.open で activePath を立てた直後に editSession.list/discard を同 clientId で
  // 呼ぶ必要がある (clientId が異なると `_resolveActiveWsId` で別 ws に解決される)。
  const result = await withBrowserSession<{
    active: { id: string; path: string; name: string };
  }>(async (call) => {
    const opened = await call("workspace.open", { path: workspacePath }) as {
      active: { id: string; path: string; name: string };
    };
    try {
      const sessions = await call("editSession.list", {}) as { sessions?: Array<{ id: string }> } | null;
      for (const s of sessions?.sessions ?? []) {
        await call("editSession.discard", { editSessionId: s.id }).catch(() => undefined);
      }
    } catch { /* best-effort */ }
    return opened;
  });
  if (!result?.active?.id) {
    throw new Error(`workspace.open did not return active.id for ${workspacePath}`);
  }
  const wsId = result.active.id;
  const name = result.active.name;
  const buildPath = (subPath: string): string => {
    const p = subPath.startsWith("/") ? subPath : `/${subPath}`;
    return `/w/${wsId}${p === "/" ? "/" : p}`;
  };

  return {
    key,
    workspacePath,
    wsId,
    name,
    path: buildPath,
    async gotoActive(page, subPath) {
      // 既存の addInitScript-based test は localStorage に flow-project 等を seed してから
      // page.goto(target) する 1 段階方式だった。これを backend 経由に置き換えるにあたり、
      // 単純に page.goto(/w/<wsId>/) しただけだと:
      //   1. 新 WS connection の per-session activePath = backend 起動時の global default
      //      (= autoActivateOnStartup が拾った前回 lastActive、e2e 文脈では他テストの残骸)
      //      で初期化される。
      //   2. AppShell が URL wsId != active.id を検知して workspace.open(id) を発行するが、
      //      非同期完了前に panels (FunctionCountsPanel 等) が loadProject を発火 → 旧 ws の
      //      データを読んで初回 mount のまま再 fetch しないため stale 表示になる。
      // 解決: SPA 内ナビゲーションで bridge connection を維持しつつ activePath だけ書き換える。
      //   1) /workspace/select に goto (AppShellInner 配下ではないので panels 起動しない)
      //   2) 同 page で openWorkspace(id) → backend per-session activePath 切替 + local store 更新
      //   3) history.pushState + popstate で React Router 経由 SPA 遷移 → bridge は再利用
      //   4) AppShellInner が初回 mount し panels も初回 mount → 正しい activePath で読み込み
      await page.goto("/workspace/select");
      await page.waitForFunction(
        () => Boolean(
          (window as unknown as { __mcpBridge?: { request?: unknown; status?: string } }).__mcpBridge?.request
            && (window as unknown as { __mcpBridge?: { status?: string } }).__mcpBridge?.status === "connected",
        ),
        undefined,
        { timeout: 10000 },
      );
      const targetPath = buildPath(subPath);
      await page.evaluate(async ({ id, target }: { id: string; target: string }) => {
        const mod = await import("/src/store/workspaceStore.ts") as {
          openWorkspace: (idOrPath: string, useId?: boolean) => Promise<string>;
        };
        await mod.openWorkspace(id, true);
        // SPA 遷移: bridge connection を維持したまま React Router を target に飛ばす。
        // pushState だけだと popstate が発火しないので明示的に dispatch する。
        window.history.pushState({}, "", target);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, { id: wsId, target: targetPath });

      // 変更 3: gotoActive 終了 guard 強化
      // 1. waitForURL — catch を外して timeout は throw に (5s → 15s)
      if (page.waitForURL) {
        await page.waitForURL((url) => url.pathname === targetPath, { timeout: 15000 });
      }

      // 2. bridge connected 確認 (navigation 後も)
      await page.waitForFunction(
        () => (window as unknown as { __mcpBridge?: { status?: string } }).__mcpBridge?.status === "connected",
        undefined,
        { timeout: 15000 },
      );

      // 3. route 別 marker visible 待ち
      // subPath から route を抽出して対応する DOM marker を待つ
      const routeMarkerMap: Record<string, string> = {
        "/screen/list": ".screen-list-page",
        "screen/list": ".screen-list-page",
        "/table/list": ".table-list-page",
        "table/list": ".table-list-page",
        "/process-flow/list": ".process-flow-page",
        "process-flow/list": ".process-flow-page",
        "/view-definition/list": ".table-list-page",
        "view-definition/list": ".table-list-page",
        "/extensions": ".extensions-panel",
        "extensions": ".extensions-panel",
        "/conventions/catalog": ".conventions-catalog-view",
        "conventions/catalog": ".conventions-catalog-view",
        "/": ".dashboard-view",
        "": ".dashboard-view",
        "/dashboard": ".dashboard-view",
        "dashboard": ".dashboard-view",
      };
      // 個別エディタ route (/<resource>/edit/<id>) の marker prefix 対応 (#945)
      // pushState 後に editor の初期 render が始まるが、フル run で前 spec の workspace
      // switch race と重なると個別 editor の DOM 確定前に gotoActive が return してしまい、
      // setup helper 側 .table-editor-page 5s timeout で fail する flake を引き起こす。
      // 各 editor の root class:
      // - TableEditor / ViewEditor / ViewDefinitionEditor / SequenceEditor: .table-editor-page (legacy class 共有)
      // - ProcessFlowEditor: .process-flow-page (line 743 of ProcessFlowEditor.tsx)
      // - Designer: backend (grapesjs / puck) 切替で root が動的、marker は spec 側で扱う
      const editorPrefixMarkerMap: Array<[string, string]> = [
        ["/table/edit/", ".table-editor-page"],
        ["/view/edit/", ".table-editor-page"],
        ["/view-definition/edit/", ".table-editor-page"],
        ["/sequence/edit/", ".table-editor-page"],
        ["/process-flow/edit/", ".process-flow-page"],
      ];
      const normalizedSub = subPath.startsWith("/") ? subPath : `/${subPath}`;
      let marker = routeMarkerMap[normalizedSub];
      if (!marker) {
        for (const [prefix, m] of editorPrefixMarkerMap) {
          if (normalizedSub.startsWith(prefix)) { marker = m; break; }
        }
      }
      if (marker && page.locator) {
        await page.locator(marker).waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
      }
    },
    async resetRuntimeState(page?: PageLike) {
      await resetWorkspaceRuntimeState(page).catch(() => undefined);
    },
  };
}
