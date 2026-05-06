/**
 * recentStore.ts (#671)
 *
 * 最近使ったワークスペースを `~/.harmony/recent-workspaces.json` に永続化。
 *
 * 構造:
 * {
 *   "$schema": "harmony-recent-workspaces-v1",
 *   "version": 1,
 *   "workspaces": [
 *     { "id": "<uuid>", "path": "<absolute>", "name": "<display>", "lastOpenedAt": "<iso>" }
 *   ],
 *   "lastActiveId": "<uuid|null>"
 * }
 *
 * lockdown モード (env DESIGNER_DATA_DIR 指定) 時はこのファイルを読み書きしない。
 * 呼び出し側 (workspace.* MCP tool ハンドラ) が isLockdown() を確認した上で本モジュールを使う。
 */
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "node:crypto";

export type WorkspaceEntry = {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
};

type RecentFile = {
  $schema: string;
  version: 1;
  workspaces: WorkspaceEntry[];
  lastActiveId: string | null;
};

const SCHEMA_TAG = "harmony-recent-workspaces-v1";

/**
 * 永続化先の解決。env DESIGNER_RECENT_FILE で上書き可能 (テスト / VS Code 拡張等の
 * sandbox 用途)。未指定なら ~/.harmony/recent-workspaces.json。
 * 関数化することで、テスト中の vi.stubEnv / 直接代入が即座に反映される。
 */
function recentFile(): string {
  const override = process.env.DESIGNER_RECENT_FILE;
  if (override && override.trim().length > 0) return path.resolve(override);
  return path.join(os.homedir(), ".harmony", "recent-workspaces.json");
}

function recentDir(): string {
  return path.dirname(recentFile());
}

function emptyFile(): RecentFile {
  return { $schema: SCHEMA_TAG, version: 1, workspaces: [], lastActiveId: null };
}

function isRecentFile(value: unknown): value is RecentFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (!Array.isArray(v.workspaces)) return false;
  if (v.lastActiveId !== null && typeof v.lastActiveId !== "string") return false;
  return v.workspaces.every((w) => {
    if (typeof w !== "object" || w === null) return false;
    const e = w as Record<string, unknown>;
    return typeof e.id === "string"
      && typeof e.path === "string"
      && typeof e.name === "string"
      && typeof e.lastOpenedAt === "string";
  });
}

export async function readRecent(): Promise<RecentFile> {
  try {
    const raw = await fs.readFile(recentFile(), "utf-8");
    const parsed = JSON.parse(raw);
    if (isRecentFile(parsed)) return parsed;
  } catch {
    /* not found or malformed → return empty */
  }
  return emptyFile();
}

async function writeRecent(file: RecentFile): Promise<void> {
  await fs.mkdir(recentDir(), { recursive: true });
  await fs.writeFile(recentFile(), JSON.stringify(file, null, 2), "utf-8");
}

function normalizePath(p: string): string {
  return path.resolve(p);
}

/**
 * read-modify-write 直列化用の write chain (#676 review: P1)。
 * upsert / setLastActive / removeWorkspace の並行呼び出しが interleave すると、
 * 後発の write が先発の差分を上書き失う問題 (例: A.upsert と B.setLastActive 並行で
 * lastActiveId が消える) を防ぐ。
 *
 * セマンティクス (#676 Sonnet re-review P2):
 * - `_writeChain.then(fn, fn)` は前段の成功・失敗どちらでも次の fn を実行する
 *   (continue-on-error)。これは意図的な選択: 1 度の例外で chain が永続停滞し後続
 *   全 RMW がブロックされる状況を回避するため。
 * - 各 fn は `readRecent → modify → writeRecent` の独立 RMW で毎回 fresh に file を
 *   読むので、前段が writeRecent の前で失敗しても次段に汚れた state は引き継がれない
 *   (file 上の状態が真実)。
 * - `result.catch(() => undefined)` は次 chain への接続のための rejection 抑制
 *   (本来の caller は `result` を受け取るので個別エラーは見れる)。
 * - 通常の mutex のように「前段失敗で残りを中断」を期待する用途では使えない。
 *   本ファイル内には該当用途は無いため OK。
 */
let _writeChain: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _writeChain.then(fn, fn);
  _writeChain = result.catch(() => undefined);
  return result;
}

/**
 * 指定 path のエントリを upsert (既存なら lastOpenedAt と name を更新、無ければ追加)。
 * 戻り値は upsert 後のエントリ。lastActiveId は呼び出し側で setLastActive を別途呼ぶ。
 */
export function upsertWorkspace(
  workspacePath: string,
  name: string,
): Promise<WorkspaceEntry> {
  return withWriteLock(async () => {
    const file = await readRecent();
    const norm = normalizePath(workspacePath);
    const now = new Date().toISOString();
    const existing = file.workspaces.find((w) => normalizePath(w.path) === norm);
    let entry: WorkspaceEntry;
    if (existing) {
      existing.path = norm;
      existing.name = name;
      existing.lastOpenedAt = now;
      entry = existing;
    } else {
      entry = { id: randomUUID(), path: norm, name, lastOpenedAt: now };
      file.workspaces.push(entry);
    }
    await writeRecent(file);
    return entry;
  });
}

export function setLastActive(id: string | null): Promise<void> {
  return withWriteLock(async () => {
    const file = await readRecent();
    file.lastActiveId = id;
    await writeRecent(file);
  });
}

export function removeWorkspace(id: string): Promise<boolean> {
  return withWriteLock(async () => {
    const file = await readRecent();
    const before = file.workspaces.length;
    file.workspaces = file.workspaces.filter((w) => w.id !== id);
    if (file.lastActiveId === id) file.lastActiveId = null;
    if (file.workspaces.length === before) return false;
    await writeRecent(file);
    return true;
  });
}

export async function findById(id: string): Promise<WorkspaceEntry | null> {
  const file = await readRecent();
  return file.workspaces.find((w) => w.id === id) ?? null;
}

export async function findByPath(workspacePath: string): Promise<WorkspaceEntry | null> {
  const norm = normalizePath(workspacePath);
  const file = await readRecent();
  return file.workspaces.find((w) => normalizePath(w.path) === norm) ?? null;
}

export async function listWorkspaces(): Promise<{
  workspaces: WorkspaceEntry[];
  lastActiveId: string | null;
}> {
  const file = await readRecent();
  return { workspaces: file.workspaces, lastActiveId: file.lastActiveId };
}

/** test-only */
export const _internals = {
  recentFile,
  recentDir,
  emptyFile,
  isRecentFile,
};
