/**
 * 要確認の増加の通知。設計が変わったあと (30 秒まとめて) に、要確認 (error + warning) の件数を数え、前回より増えていれば通知する。
 * 「要確認の増加」を受ける通知先があるときだけ計算する (無ければ、何もしない)。前回の件数は `.harmony-ops/notify-state.json`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { buildDesignDocument } from "@harmony/shared";
import { loadDesignInputFromRoot } from "../designInput.js";
import { collectExtraIssues } from "../schemaIssues.js";
import { ensureHiddenDir, opsDirOf } from "./opsFiles.js";
import { emitNotify } from "./service.js";
import { notifyStore } from "./stores.js";

const DEBOUNCE_MS = 30_000;
const timers = new Map<string, NodeJS.Timeout>();

export async function checkIssueIncrease(root: string): Promise<{ before: number | null; after: number; notified: boolean } | null> {
  const { value } = await notifyStore.read(root);
  if (!value.webhooks.some((w) => w.enabled && w.events.includes("issues"))) return null;
  const { input } = await loadDesignInputFromRoot(root);
  const { issues } = buildDesignDocument({ ...input, extraIssues: await collectExtraIssues(root) });
  const after = issues.filter((i) => i.severity === "error" || i.severity === "warning").length;
  const file = path.join(opsDirOf(root), "notify-state.json");
  let before: number | null = null;
  try { const j = JSON.parse(await fs.readFile(file, "utf-8")) as { issues?: unknown }; if (typeof j.issues === "number") before = j.issues; } catch { /* 初回 */ }
  await ensureHiddenDir(root);
  await fs.writeFile(file, JSON.stringify({ issues: after }), "utf-8");
  const increased = before !== null && after > before;
  if (increased) emitNotify(root, { event: "issues", title: `要確認が増えました (${before} → ${after} 件)`, lines: ["設計の分析の「要確認」で、内容を確認してください"] });
  return { before, after, notified: increased };
}

/** 設計を変えたあとに呼ぶ。続けて呼ばれたら、最後から 30 秒後に 1 回だけ数える */
export function scheduleIssueCheck(root: string, delayMs = DEBOUNCE_MS): void {
  const t = timers.get(root);
  if (t) clearTimeout(t);
  const timer = setTimeout(() => { timers.delete(root); void checkIssueIncrease(root).catch(() => undefined); }, delayMs);
  timer.unref?.();
  timers.set(root, timer);
}
