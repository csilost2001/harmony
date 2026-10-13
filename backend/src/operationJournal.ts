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
import os from "node:os";
import { logWarn } from "./serverLog.js";

export const JOURNAL_DIR = ".harmony-journal";

/** このプロセスの起動ごとの識別子。再起動すると変わる (配布の Docker は、再起動のたびに pid が 1 のままなので、pid だけでは世代を区別できない) */
export const INSTANCE_ID = crypto.randomUUID();
/** 別のホスト (別のコンテナで、同じボリュームを使う場合) の記録は、生死を確かめられない。これより古ければ、残骸とみなす */
export const FOREIGN_STALE_MS = 10 * 60 * 1000;

export interface JournalPlan {
  /** 操作の名前 (ログ用) */
  label: string;
  /** 元の内容に戻すファイル (ワークスペースからの相対パス → 元の内容) */
  restore: Array<{ rel: string; content: string }>;
  /** 操作で新しく作るファイル (復旧では消す。ワークスペースからの相対パス)。restore に入っているものは消さない */
  remove: string[];
  /** 記録を書いたプロセスの起動ごとの識別子 / pid / ホスト名。生きている持ち主の記録は、進行中の操作なので復旧しない (isOwnerAlive) */
  instanceId?: string;
  pid?: number;
  host?: string;
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
  await fs.writeFile(tmp, JSON.stringify({ ...plan, instanceId: INSTANCE_ID, pid: process.pid, host: os.hostname() }), "utf-8");
  await fs.rename(tmp, file); // 書き終えた記録だけが、復旧の対象になる
  return async () => { await fs.rm(file, { force: true }); };
}

function contained(root: string, rel: string): string {
  const abs = path.resolve(root, ...rel.split("/"));
  const r = path.relative(root, abs);
  if (!r || r.startsWith("..") || path.isAbsolute(r)) throw new Error(`記録の場所が不正です: ${rel}`);
  return abs;
}

/**
 * 記録の持ち主が、まだ操作の途中か (生きているか)。
 * - このプロセスの起動中の記録 (instanceId が同じ): 進行中の操作
 * - 別の起動の記録: 同じホストで、別の pid が生きていれば、別のプロセスの進行中の操作。pid が同じ (= 再起動した自分) か、死んでいれば残骸
 *   (pid の一致では「自分」とみなさない: 配布の Docker は毎回 pid 1 で、強制終了後に再起動した新しいプロセスが、前の世代の記録を飛ばしてしまう)
 * - 別のホストの記録: 生死を確かめられないので、FOREIGN_STALE_MS より新しければ進行中とみなす
 * - 持ち主の情報が無い (古い形式) 記録: 残骸
 */
export function isOwnerAlive(plan: JournalPlan, fileMtimeMs: number, now = Date.now()): boolean {
  if (plan.instanceId === INSTANCE_ID) return true;
  if (plan.pid === undefined) return false;
  if (plan.host !== undefined && plan.host !== os.hostname()) return now - fileMtimeMs < FOREIGN_STALE_MS;
  if (plan.pid === process.pid) return false;
  try { process.kill(plan.pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

/** 残っている記録 (持ち主が終わっているもの) を、元の内容に戻す。戻したファイルの数を返す */
export async function recoverJournals(root: string): Promise<{ journals: number; restored: number }> {
  const dir = path.join(root, JOURNAL_DIR);
  let files: string[];
  try { files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort(); } catch { return { journals: 0, restored: 0 }; }
  let restored = 0;
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      const plan = JSON.parse(await fs.readFile(file, "utf-8")) as JournalPlan;
      // 持ち主のプロセスが生きている記録は、進行中の操作。巻き戻さない
      const st = await fs.stat(file).catch(() => null);
      if (isOwnerAlive(plan, st?.mtimeMs ?? 0)) {
        logWarn("journal", "journal.skipped.owner-alive", { label: plan.label, pid: plan.pid, host: plan.host });
        continue;
      }
      const restoring = new Set(plan.restore.map((r) => r.rel));
      for (const r of plan.restore) {
        const abs = contained(root, r.rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, r.content, "utf-8");
        restored++;
      }
      // 元の内容へ戻したファイルは、消さない (同じパスが「戻す」と「消す」の両方に入っていても、戻したまま)
      for (const rel of plan.remove) if (!restoring.has(rel)) await fs.rm(contained(root, rel), { force: true });
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
