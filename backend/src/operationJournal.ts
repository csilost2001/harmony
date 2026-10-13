/**
 * 複数のファイルにまたがる操作 (改名など) の、途中で止まったときの復旧用の記録 (先行書き込みログ)。
 *
 * 操作の途中の失敗は、操作の中で元に戻す。だが、プロセスが強制終了した・電源が落ちたときは、その処理が動けず、
 * 一部のファイルだけが書き換わった状態が残る。操作の前に「元の内容」を `.harmony-journal/` に書いておき、操作が終わったら消す。
 * 次にワークスペースを使うとき、残っている記録があれば、元の内容に戻す (操作の前の状態に戻る)。
 *
 * 記録の対象は、改名の主な書き込み (参照元の更新・新しいファイルの作成・古いファイルの削除) まで。
 * 仕様: docs/spec/workspace-health.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { logWarn } from "./serverLog.js";

export const JOURNAL_DIR = ".harmony-journal";

export interface JournalPlan {
  /** 操作の名前 (ログ用) */
  label: string;
  /** 元の内容に戻すファイル (ワークスペースからの相対パス → 元の内容) */
  restore: Array<{ rel: string; content: string }>;
  /** 操作で新しく作るファイル (復旧では消す。ワークスペースからの相対パス) */
  remove: string[];
}

const toRel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join("/");

/** 絶対パスのまま渡せるよう、ワークスペースからの相対パスにそろえる。外を指すものは例外 */
export function planFromAbsolute(root: string, label: string, restore: Array<{ absPath: string; content: string }>, remove: string[]): JournalPlan {
  const rel = (abs: string): string => {
    const r = toRel(root, abs);
    if (!r || r.startsWith("..") || path.isAbsolute(r)) throw new Error(`記録できない場所です: ${abs}`);
    return r;
  };
  return { label, restore: restore.map((x) => ({ rel: rel(x.absPath), content: x.content })), remove: remove.map(rel) };
}

/** 記録を書く。戻り値の commit を、操作が終わったとき (成功・失敗を問わず、元に戻し終えたとき) に呼ぶ */
export async function openJournal(root: string, plan: JournalPlan): Promise<() => Promise<void>> {
  const dir = path.join(root, JOURNAL_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, ".gitignore"), "*\n", { flag: "wx" }).catch(() => undefined);
  const file = path.join(dir, `${Date.now()}-${crypto.randomUUID()}.json`);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(plan), "utf-8");
  await fs.rename(tmp, file); // 書き終えた記録だけが、復旧の対象になる
  return async () => { await fs.rm(file, { force: true }); };
}

function contained(root: string, rel: string): string {
  const abs = path.resolve(root, ...rel.split("/"));
  const r = path.relative(root, abs);
  if (!r || r.startsWith("..") || path.isAbsolute(r)) throw new Error(`記録の場所が不正です: ${rel}`);
  return abs;
}

/** 残っている記録を、元の内容に戻す。戻したファイルの数を返す */
export async function recoverJournals(root: string): Promise<{ journals: number; restored: number }> {
  const dir = path.join(root, JOURNAL_DIR);
  let files: string[];
  try { files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort(); } catch { return { journals: 0, restored: 0 }; }
  let restored = 0;
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      const plan = JSON.parse(await fs.readFile(file, "utf-8")) as JournalPlan;
      for (const r of plan.restore) {
        const abs = contained(root, r.rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, r.content, "utf-8");
        restored++;
      }
      for (const rel of plan.remove) await fs.rm(contained(root, rel), { force: true });
      logWarn("journal", "journal.recovered", { label: plan.label, restored: plan.restore.length, removed: plan.remove.length });
      await fs.rm(file, { force: true });
    } catch (e) {
      // 読めない・不正な記録は、元に戻さずに残す (手で確認できるように)。次回も試す
      logWarn("journal", "journal.recover.failed", { file: f, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { journals: files.length, restored };
}

const recovered = new Map<string, Promise<unknown>>();
/** プロセスの中で、ワークスペースごとに 1 回だけ復旧する (最初の要求のとき。以降は同じ結果を待つ) */
export function ensureRecovered(root: string): Promise<unknown> {
  let p = recovered.get(root);
  if (!p) { p = recoverJournals(root).catch(() => undefined); recovered.set(root, p); }
  return p;
}
