/**
 * 保存で上書きされる前の内容を、ワークスペース直下の `.harmony-backups/` に世代で残す。
 *
 * 編集セッションの履歴 (draftHistoryStore。保存した内容を 7 日だけ残す) とは別に、
 * AI (MCP) や一括操作が直接書き換えた場合も含めて、**ファイルが上書きされる直前の内容**を残す最小の安全網。
 * 保存の失敗にはしない (バックアップできなくても保存は通す)。
 *
 * 配置: <ワークスペース>/.harmony-backups/<ワークスペースからの相対パス>/<時刻>.json  (新しい順に最大 BACKUP_KEEP 件)
 * `.harmony-backups/.gitignore` (`*`) を置くので、利用者の git には載らない。
 * 仕様: docs/spec/file-backup.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import { logWarn } from "./serverLog.js";

export const BACKUP_DIR = ".harmony-backups";
/** 1 ファイルあたりに残す世代数 */
export const BACKUP_KEEP = 20;
/** バックアップする 1 ファイルの大きさの上限 (これを超える巨大なファイルは対象外) */
export const BACKUP_MAX_BYTES = 8 * 1024 * 1024;

export interface BackupVersion {
  /** 一覧・復元で使う ID (ファイル名から `.json` を除いたもの。時刻の昇順 = 辞書順) */
  id: string;
  /** 上書きされた時刻 (ISO) */
  savedAt: string;
  size: number;
}

const toPosix = (p: string): string => p.split(path.sep).join("/");

/** ファイルから上へたどって harmony.json のあるフォルダ (ワークスペース) を探す */
export async function findWorkspaceRoot(filePath: string): Promise<string | null> {
  let dir = path.dirname(path.resolve(filePath));
  for (let i = 0; i < 8; i++) {
    try { await fs.access(path.join(dir, "harmony.json")); return dir; } catch { /* 上へ */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** ワークスペースからの相対パス (posix)。隠しフォルダ・一時ファイル・退避ファイルは対象外 (null) */
export function backupRelPath(wsRoot: string, filePath: string): string | null {
  const rel = toPosix(path.relative(wsRoot, path.resolve(filePath)));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const segs = rel.split("/");
  if (segs.some((s) => s.startsWith("."))) return null;
  if (!rel.endsWith(".json")) return null;
  return rel;
}

const versionsDir = (wsRoot: string, rel: string): string => path.join(wsRoot, BACKUP_DIR, ...rel.split("/"));

let seq = 0;
const newVersionId = (): string => `${new Date().toISOString().replace(/:/g, "-")}-${String(seq++ % 1000).padStart(3, "0")}`;
/** ID (`2026-10-13T01-02-03.456Z-007`) から時刻 (ISO) へ */
export function versionIdToIso(id: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}\.\d{3}Z)/.exec(id);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}` : id;
}

/** 上書きの直前に呼ぶ。ファイルが無い・内容が同じ・対象外なら何もしない。失敗しても例外にしない */
export async function backupBeforeOverwrite(filePath: string, nextText: string): Promise<void> {
  try {
    const wsRoot = await findWorkspaceRoot(filePath);
    if (!wsRoot) return;
    const rel = backupRelPath(wsRoot, filePath);
    if (!rel) return;
    let prev: string;
    try {
      const st = await fs.stat(filePath);
      if (!st.isFile() || st.size > BACKUP_MAX_BYTES) return;
      prev = await fs.readFile(filePath, "utf-8");
    } catch { return; }
    if (prev === nextText) return;
    const dir = versionsDir(wsRoot, rel);
    const existing = await listVersionFiles(dir);
    if (existing.length) {
      const latest = await fs.readFile(path.join(dir, `${existing[existing.length - 1]}.json`), "utf-8").catch(() => null);
      if (latest === prev) return;
    }
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(wsRoot, BACKUP_DIR, ".gitignore"), "*\n", { flag: "wx" }).catch(() => undefined);
    await fs.writeFile(path.join(dir, `${newVersionId()}.json`), prev, "utf-8");
    const all = await listVersionFiles(dir);
    for (const id of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) {
      await fs.rm(path.join(dir, `${id}.json`), { force: true }).catch(() => undefined);
    }
  } catch (e) {
    logWarn("backup", "backup.failed", { file: path.basename(filePath), error: e instanceof Error ? e.message : String(e) });
  }
}

async function listVersionFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  } catch { return []; }
}

/** 世代の一覧 (新しい順)。relPath はワークスペースからの相対パス (例: `data/tables/orders.json`) */
export async function listBackupVersions(wsRoot: string, relPath: string): Promise<BackupVersion[]> {
  const rel = assertRelPath(relPath);
  const dir = versionsDir(wsRoot, rel);
  const ids = await listVersionFiles(dir);
  const out: BackupVersion[] = [];
  for (const id of ids.reverse()) {
    const st = await fs.stat(path.join(dir, `${id}.json`)).catch(() => null);
    if (st) out.push({ id, savedAt: versionIdToIso(id), size: st.size });
  }
  return out;
}

/** 世代の中身 (文字列)。無ければ null */
export async function readBackupVersion(wsRoot: string, relPath: string, versionId: string): Promise<string | null> {
  const rel = assertRelPath(relPath);
  if (!/^[0-9TZ.\-]+$/.test(versionId)) throw new Error("版の ID が不正です");
  try { return await fs.readFile(path.join(versionsDir(wsRoot, rel), `${versionId}.json`), "utf-8"); } catch { return null; }
}

/** 相対パスの検査 (外へ出ない・隠しフォルダでない・.json) */
export function assertRelPath(relPath: unknown): string {
  if (typeof relPath !== "string" || !relPath) throw new Error("ファイルの場所を指定してください");
  const rel = relPath.replace(/\\/g, "/");
  const segs = rel.split("/");
  if (path.isAbsolute(rel) || segs.some((s) => s === ".." || s === "." || s === "" || s.startsWith(".")) || !rel.endsWith(".json")) {
    throw new Error(`ファイルの場所が不正です: ${relPath}`);
  }
  return rel;
}
