/**
 * 完成度 (成熟度) の日ごとの記録。推移を見るための、運用の記録 (設計の原本ではない)。
 * 配置: <ワークスペース>/.harmony-progress/history.json (自分の .gitignore を持つので、利用者の git には載らない)。
 * 記録するのは、設計の分析の「進捗」を開いたとき・ダッシュボードのパネルを表示したとき (その日の分を、最新の件数で置き換える)。
 */
import path from "node:path";
import type { ProgressSnapshot, ProgressSummary } from "@harmony/shared";
import { snapshotOf } from "@harmony/shared";
import { writeJSON, readJSON, withFileLock } from "./storageCore.js";
import { ensureWorkDir } from "./workDirs.js";

export const PROGRESS_DIR = ".harmony-progress";
/** 残す日数 (これより古い記録は捨てる) */
export const PROGRESS_KEEP = 366;

const historyFile = (root: string) => path.join(root, PROGRESS_DIR, "history.json");
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const KINDS = ["screen", "processFlow", "table", "businessFlow", "report"] as const;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** 読み込んだ記録を整える (壊れた行は捨てる) */
export function sanitizeHistory(raw: unknown): ProgressSnapshot[] {
  const list = isRecord(raw) && Array.isArray(raw.snapshots) ? raw.snapshots : [];
  const out: ProgressSnapshot[] = [];
  for (const s of list) {
    if (!isRecord(s) || typeof s.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !isRecord(s.byKind)) continue;
    const byKind = Object.fromEntries(KINDS.map((k) => {
      const c = isRecord(s.byKind) && isRecord((s.byKind as Record<string, unknown>)[k]) ? (s.byKind as Record<string, Record<string, unknown>>)[k] : {};
      return [k, { draft: num(c.draft), provisional: num(c.provisional), committed: num(c.committed), total: num(c.total) }];
    })) as ProgressSnapshot["byKind"];
    out.push({ date: s.date, byKind });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(-PROGRESS_KEEP);
}

export async function readProgressHistory(root: string): Promise<ProgressSnapshot[]> {
  return sanitizeHistory(await readJSON<unknown>(historyFile(root)));
}

/** サーバーのローカル日付 (YYYY-MM-DD) */
export function localDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** その日の記録を、最新の件数に置き換える。件数が変わらなければ書かない */
export async function recordProgress(root: string, summary: ProgressSummary, now = new Date()): Promise<ProgressSnapshot[]> {
  const file = historyFile(root);
  return withFileLock(file, async () => {
    const history = sanitizeHistory(await readJSON<unknown>(file));
    const snap = snapshotOf(summary, localDate(now));
    const same = history.find((h) => h.date === snap.date);
    if (same && JSON.stringify(same.byKind) === JSON.stringify(snap.byKind)) return history;
    const next = [...history.filter((h) => h.date !== snap.date), snap].sort((a, b) => a.date.localeCompare(b.date)).slice(-PROGRESS_KEEP);
    try {
      await ensureWorkDir(path.dirname(file));
      await writeJSON(file, { version: 1, snapshots: next });
    } catch { /* 記録できなくても、進捗の表示は続ける (読み取り専用の場所など) */ return history; }
    return next;
  });
}
