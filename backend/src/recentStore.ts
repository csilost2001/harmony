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
 *   "workspaceRoots": [
 *     { "id": "<uuid>", "path": "<absolute>", "label": "<display>", "registeredAt": "<iso>" }
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

export type WorkspaceRootEntry = {
  id: string;
  path: string;
  label: string;
  registeredAt: string;
};

export type WorkspaceCandidate = {
  path: string;
  name: string | null;
  status: "ready" | "invalid";
  reason?: string;
  alreadyRecent: boolean;
};

type RecentFile = {
  $schema: string;
  version: 1;
  workspaces: WorkspaceEntry[];
  workspaceRoots: WorkspaceRootEntry[];
  lastActiveId: string | null;
};

const SCHEMA_TAG = "harmony-recent-workspaces-v1";

/**
 * 永続化先の解決。優先順位 (高い順):
 *   1. env `DESIGNER_RECENT_FILE` — 完全な file path (テスト / VS Code 拡張等の sandbox 用)
 *   2. env `HARMONY_HOME`         — Harmony state 用のディレクトリ。recent-workspaces.json は
 *                                   この配下に作られる (#1055: container 配布の path 規約)
 *   3. default                    — ~/.harmony/recent-workspaces.json
 *
 * 関数化することで、テスト中の vi.stubEnv / 直接代入が即座に反映される。
 *
 * 規約詳細: docs/spec/path-conventions.md
 */
function recentFile(): string {
  const override = process.env.DESIGNER_RECENT_FILE;
  if (override && override.trim().length > 0) return path.resolve(override);
  const home = process.env.HARMONY_HOME?.trim();
  const dir = home && home.length > 0 ? path.resolve(home) : path.join(os.homedir(), ".harmony");
  return path.join(dir, "recent-workspaces.json");
}

function recentDir(): string {
  return path.dirname(recentFile());
}

function emptyFile(): RecentFile {
  return { $schema: SCHEMA_TAG, version: 1, workspaces: [], workspaceRoots: [], lastActiveId: null };
}

function isRecentFile(value: unknown): value is RecentFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (!Array.isArray(v.workspaces)) return false;
  if (v.workspaceRoots !== undefined && !Array.isArray(v.workspaceRoots)) return false;
  if (v.lastActiveId !== null && typeof v.lastActiveId !== "string") return false;
  const workspacesValid = v.workspaces.every((w) => {
    if (typeof w !== "object" || w === null) return false;
    const e = w as Record<string, unknown>;
    return typeof e.id === "string"
      && typeof e.path === "string"
      && typeof e.name === "string"
      && typeof e.lastOpenedAt === "string";
  });
  if (!workspacesValid) return false;
  const roots = Array.isArray(v.workspaceRoots) ? v.workspaceRoots : [];
  return roots.every((r) => {
    if (typeof r !== "object" || r === null) return false;
    const e = r as Record<string, unknown>;
    return typeof e.id === "string"
      && typeof e.path === "string"
      && typeof e.label === "string"
      && typeof e.registeredAt === "string";
  });
}

export async function readRecent(): Promise<RecentFile> {
  try {
    const raw = await fs.readFile(recentFile(), "utf-8");
    const parsed = JSON.parse(raw);
    if (isRecentFile(parsed)) {
      return {
        ...parsed,
        workspaceRoots: parsed.workspaceRoots ?? [],
      };
    }
  } catch {
    /* not found or malformed → return empty */
  }
  return emptyFile();
}

async function writeRecent(file: RecentFile): Promise<void> {
  // #1359: atomic write via tmp + rename。
  // 旧実装 `fs.writeFile(target, ...)` は O_TRUNC で target を 0 bytes に切り詰めてから
  // 書き戻すため、同一 backend に並行接続する複数 worker (Playwright workers > 1) の片方が
  // 書き込み中に他方が `readRecent` (lock-less) で読むと、空ファイル / 部分 JSON を読み込み
  // → JSON.parse 例外 → catch で emptyFile() を返す → `findById(wsId)` が null → e2e で
  // "id <wsId> のワークスペースが見つかりません" エラーが頻発していた。
  // tmp file への write 後 rename することで reader からは旧 file → 新 file の atomic 切替に
  // 見え、part-write 読み出しを排除する (POSIX rename(2) は同 fs 内で atomic)。
  await fs.mkdir(recentDir(), { recursive: true });
  const target = recentFile();
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), "utf-8");
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
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

export function listWorkspaceRoots(): Promise<WorkspaceRootEntry[]> {
  return withWriteLock(async () => {
    const file = await readRecent();
    return file.workspaceRoots;
  });
}

export function upsertWorkspaceRoot(rootPath: string, label?: string): Promise<WorkspaceRootEntry> {
  return withWriteLock(async () => {
    const file = await readRecent();
    const norm = normalizePath(rootPath);
    const existing = file.workspaceRoots.find((r) => normalizePath(r.path) === norm);
    if (existing) {
      existing.path = norm;
      existing.label = label?.trim() || existing.label || path.basename(norm) || norm;
      await writeRecent(file);
      return existing;
    }
    const entry: WorkspaceRootEntry = {
      id: randomUUID(),
      path: norm,
      label: label?.trim() || path.basename(norm) || norm,
      registeredAt: new Date().toISOString(),
    };
    file.workspaceRoots.push(entry);
    await writeRecent(file);
    return entry;
  });
}

export function removeWorkspaceRoot(id: string): Promise<boolean> {
  return withWriteLock(async () => {
    const file = await readRecent();
    const before = file.workspaceRoots.length;
    file.workspaceRoots = file.workspaceRoots.filter((r) => r.id !== id);
    if (file.workspaceRoots.length === before) return false;
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

async function hasWorkspaceManifest(workspacePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(workspacePath, "harmony.json"));
    return stat.isFile();
  } catch {
    return false;
  }
}

function isE2eWorkspacePath(workspacePath: string): boolean {
  const normalized = normalizePath(workspacePath);
  const parts = normalized.split(path.sep);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === ".tmp" && parts[i + 1] === "e2e-workspaces") return true;
  }
  return false;
}

export async function listWorkspaces(): Promise<{
  workspaces: WorkspaceEntry[];
  lastActiveId: string | null;
}> {
  const file = await readRecent();
  return { workspaces: file.workspaces, lastActiveId: file.lastActiveId };
}

export async function listDisplayWorkspaces(): Promise<{
  workspaces: WorkspaceEntry[];
  lastActiveId: string | null;
  prunedCount: number;
  hiddenCount: number;
}> {
  return withWriteLock(async () => {
    const file = await readRecent();
    const kept: WorkspaceEntry[] = [];
    const visible: WorkspaceEntry[] = [];
    let prunedCount = 0;
    let hiddenCount = 0;

    for (const entry of file.workspaces) {
      if (!(await hasWorkspaceManifest(entry.path))) {
        prunedCount += 1;
        continue;
      }
      kept.push(entry);
      if (isE2eWorkspacePath(entry.path)) {
        hiddenCount += 1;
        continue;
      }
      visible.push(entry);
    }

    let lastActiveId = file.lastActiveId;
    if (lastActiveId && !kept.some((entry) => entry.id === lastActiveId)) {
      lastActiveId = null;
    }

    if (prunedCount > 0 || lastActiveId !== file.lastActiveId) {
      await writeRecent({
        ...file,
        workspaces: kept,
        lastActiveId,
      });
    }

    return { workspaces: visible, lastActiveId, prunedCount, hiddenCount };
  });
}

/** test-only */
export const _internals = {
  recentFile,
  recentDir,
  emptyFile,
  isRecentFile,
  isE2eWorkspacePath,
};
