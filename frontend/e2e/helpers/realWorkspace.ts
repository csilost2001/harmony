/**
 * realWorkspace ヘルパー — e2e テストを実 backend (port 5179) 経由で動かすためのユーティリティ。
 *
 * #923 シリーズで localStorage fallback が削除されたため、ストアは backend が無いと throw する。
 * そのため e2e テストは「`addInitScript` で localStorage に seed」方式から「ファイルシステム + WS open」
 * 方式に移行する必要がある (#926)。
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
}

/** Playwright `Page` から必要な機能のみ抜き出した interface (依存軽減) */
export interface PageLike {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: string | ((arg: string) => boolean | Promise<boolean>), arg?: string, options?: { timeout?: number }): Promise<unknown>;
  evaluate<R, A>(pageFunction: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

/**
 * setupTestWorkspace の引数。各フィールドは省略可。
 * 渡したフィールドは harmony.json + 個別ファイルとして書き出される。
 */
export interface SetupTestWorkspaceOptions {
  /** 一意キー (.tmp/e2e-workspaces/<key>/ になる) */
  key: string;
  /** v1 LegacyFlowProject 形式 (旧 localStorage seed と同じ shape)。harmony.json に変換される */
  project?: LegacyProjectInput;
  /** TableData[] — 各 entry は loadTable で返る body。harmony/tables/<id>.json に書き出し */
  tables?: TableInput[];
  /** ProcessFlow JSON — harmony/process-flows/<id>.json */
  processFlows?: ProcessFlowInput[];
  /** Sequence — harmony/sequences/<id>.json */
  sequences?: SequenceInput[];
  /** View — harmony/views/<id>.json */
  views?: ViewInput[];
  /** ViewDefinition — harmony/view-definitions/<id>.json */
  viewDefinitions?: ViewDefinitionInput[];
  /** 規約カタログ (catalog.json) */
  conventions?: unknown;
  /** Screen 個別 entity ファイル (`harmony/screens/<id>.json`)。
   *  通常は project.screens に入った header から自動生成されるので明示は不要。 */
  screenEntities?: ScreenEntityInput[];
  /** Screen design (puck data 等) — `harmony/screens/<id>.design.json` */
  screenDesigns?: ScreenDesignInput[];
  /** カスタムブロック (`harmony/custom-blocks.json`) */
  customBlocks?: unknown[];
  /** Puck コンポーネント (`harmony/puck-components.json`) */
  puckComponents?: unknown[];
  /** ER レイアウト (`harmony/er-layout.json`) */
  erLayout?: unknown;
  /** screen-layout.json (画面フロー用座標) */
  screenLayout?: ScreenLayoutInput;
  /** 既存 examples/<name> をベースにコピーしてから追加 seed する場合 */
  fromExample?: string;
}

export interface LegacyProjectInput {
  version?: number;
  name?: string;
  screens?: Array<{
    id: string;
    no?: number;
    name: string;
    /** v1 互換: type / kind どちらでも可 (kind 優先) */
    type?: string;
    kind?: string;
    description?: string;
    path?: string;
    hasDesign?: boolean;
    groupId?: string;
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    createdAt?: string;
    updatedAt?: string;
  }>;
  groups?: Array<{
    id: string;
    name: string;
    color?: string;
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    createdAt?: string;
    updatedAt?: string;
  }>;
  edges?: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    trigger?: string;
  }>;
  tables?: Array<{
    id: string;
    no?: number;
    name?: string;
    physicalName?: string;
    category?: string;
    columnCount?: number;
    maturity?: string;
    updatedAt?: string;
  }>;
  processFlows?: Array<{
    id: string;
    no?: number;
    name: string;
    type?: string;
    kind?: string;
    actionCount?: number;
    maturity?: string;
    updatedAt?: string;
    screenId?: string;
  }>;
  sequences?: Array<{
    id: string;
    name?: string;
    maturity?: string;
    updatedAt?: string;
    [key: string]: unknown;
  }>;
  views?: Array<{
    id: string;
    name?: string;
    maturity?: string;
    updatedAt?: string;
    [key: string]: unknown;
  }>;
  viewDefinitions?: Array<{
    id: string;
    name?: string;
    maturity?: string;
    updatedAt?: string;
    [key: string]: unknown;
  }>;
  meta?: { id?: string; name?: string; description?: string };
  techStack?: unknown;
  conventionsApplied?: unknown[];
  conventions?: unknown;
  updatedAt?: string;
}

export interface TableInput {
  id: string;
  [key: string]: unknown;
}

export interface ProcessFlowInput {
  id: string;
  [key: string]: unknown;
}

export type SequenceInput = TableInput;
export type ViewInput = TableInput;
export type ViewDefinitionInput = TableInput;
export type ScreenEntityInput = TableInput;
export interface ScreenDesignInput {
  id: string;
  data: unknown;
}
export interface ScreenLayoutInput {
  positions?: Record<string, { x: number; y: number; width?: number; height?: number; thumbnail?: string; color?: string }>;
  transitions?: Record<string, { sourceHandle?: string; targetHandle?: string }>;
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

// ── 内部: harmony.json 構築 ─────────────────────────────────────────────────

const SCHEMA_REF = "../schemas/v3/harmony.v3.schema.json";

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

/** legacy v1 入力 → v3 harmony.json shape に変換。id は UUID v4 へ正規化される */
function legacyToHarmony(input: LegacyProjectInput): unknown {
  const ts = input.updatedAt ?? nowIso();
  const screens = (input.screens ?? []).map((s, i) => ({
    id: normalizeId(s.id),
    no: typeof s.no === "number" ? s.no : i + 1,
    name: s.name,
    kind: s.kind ?? s.type ?? "other",
    path: s.path ?? "",
    ...(s.groupId ? { groupId: normalizeId(s.groupId) } : {}),
    ...(s.hasDesign !== undefined ? { hasDesign: s.hasDesign } : {}),
    maturity: "draft",
    updatedAt: s.updatedAt ?? ts,
  }));
  const screenGroups = (input.groups ?? []).map((g) => ({
    id: normalizeId(g.id),
    name: g.name,
    ...(g.color ? { color: g.color } : {}),
  }));
  const screenTransitions = (input.edges ?? []).map((e) => ({
    id: normalizeId(e.id),
    sourceScreenId: normalizeId(e.source),
    targetScreenId: normalizeId(e.target),
    ...(e.label ? { label: e.label } : {}),
    trigger: e.trigger ?? "click",
  }));
  const tables = (input.tables ?? []).map((t, i) => ({
    id: normalizeId(t.id),
    no: typeof t.no === "number" ? t.no : i + 1,
    name: t.name ?? t.physicalName ?? t.id,
    physicalName: t.physicalName ?? t.id,
    category: t.category ?? "マスタ",
    columnCount: t.columnCount ?? 0,
    maturity: t.maturity ?? "draft",
    updatedAt: t.updatedAt ?? ts,
  }));
  const processFlows = (input.processFlows ?? []).map((f, i) => ({
    id: normalizeId(f.id),
    no: typeof f.no === "number" ? f.no : i + 1,
    name: f.name,
    kind: f.kind ?? f.type ?? "common",
    actionCount: f.actionCount ?? 0,
    maturity: f.maturity ?? "draft",
    updatedAt: f.updatedAt ?? ts,
    ...(f.screenId ? { screenId: normalizeId(f.screenId) } : {}),
  }));
  const sequences = (input.sequences ?? []).map((s, i) => ({
    id: normalizeId(s.id),
    no: typeof s.no === "number" ? (s.no as number) : i + 1,
    name: typeof s.name === "string" ? s.name : s.id,
    maturity: typeof s.maturity === "string" ? s.maturity : "draft",
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : ts,
  }));
  const views = (input.views ?? []).map((v, i) => ({
    id: normalizeId(v.id),
    no: typeof v.no === "number" ? (v.no as number) : i + 1,
    name: typeof v.name === "string" ? v.name : v.id,
    maturity: typeof v.maturity === "string" ? v.maturity : "draft",
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : ts,
  }));
  const viewDefinitions = (input.viewDefinitions ?? []).map((v, i) => ({
    id: normalizeId(v.id),
    no: typeof v.no === "number" ? (v.no as number) : i + 1,
    name: typeof v.name === "string" ? v.name : v.id,
    maturity: typeof v.maturity === "string" ? v.maturity : "draft",
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : ts,
  }));
  return {
    $schema: SCHEMA_REF,
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: {
      id: input.meta?.id ? normalizeId(input.meta.id) : uuid(),
      name: input.meta?.name ?? input.name ?? "E2E テストプロジェクト",
      ...(input.meta?.description ? { description: input.meta.description } : {}),
      createdAt: ts,
      updatedAt: ts,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    ...(input.techStack ? { techStack: input.techStack } : {}),
    entities: {
      screens,
      tables,
      processFlows,
      views,
      viewDefinitions,
      sequences,
      screenGroups,
      screenTransitions,
    },
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
  if (opts.project || !opts.fromExample) {
    const harmony = legacyToHarmony(opts.project ?? {});
    await writeJson(path.join(workspacePath, "harmony.json"), harmony);
  }

  // 個別 entity ファイル — id は UUID v4 に正規化済の値で書く
  const idOf = (raw: string) => normalizeId(raw);
  // 入力の id field を解決: top-level id → meta.id の順
  const resolveItemId = (item: Record<string, unknown>): string => {
    if (typeof item.id === "string") return item.id;
    const meta = item.meta as Record<string, unknown> | undefined;
    if (meta && typeof meta.id === "string") return meta.id;
    throw new Error("setupTestWorkspace entity must have id (top-level) or meta.id");
  };
  for (const t of opts.tables ?? []) {
    const id = idOf(resolveItemId(t as unknown as Record<string, unknown>));
    await writeJson(path.join(dataDir, "tables", `${id}.json`), { ...t, id });
  }
  for (const f of opts.processFlows ?? []) {
    const id = idOf(resolveItemId(f as unknown as Record<string, unknown>));
    const meta = (f as unknown as { meta?: Record<string, unknown> }).meta;
    const body: Record<string, unknown> = { ...f, id };
    if (meta) body.meta = { ...meta, id };
    await writeJson(path.join(dataDir, "process-flows", `${id}.json`), body);
  }
  for (const s of opts.sequences ?? []) {
    const id = idOf(s.id);
    await writeJson(path.join(dataDir, "sequences", `${id}.json`), { ...s, id });
  }
  for (const v of opts.views ?? []) {
    const id = idOf(v.id);
    await writeJson(path.join(dataDir, "views", `${id}.json`), { ...v, id });
  }
  for (const v of opts.viewDefinitions ?? []) {
    const id = idOf(v.id);
    await writeJson(path.join(dataDir, "view-definitions", `${id}.json`), { ...v, id });
  }
  for (const s of opts.screenEntities ?? []) {
    const id = idOf(s.id);
    await writeJson(path.join(dataDir, "screens", `${id}.json`), { ...s, id });
  }
  for (const d of opts.screenDesigns ?? []) {
    const id = idOf(d.id);
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
    await writeJson(path.join(dataDir, "screen-layout.json"), opts.screenLayout);
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
      // SPA 遷移なので page.url() はすぐに target になる。React Router の async 解決待ち。
      await page.waitForURL((url) => url.pathname === targetPath, { timeout: 5000 }).catch(() => undefined);
    },
  };
}
