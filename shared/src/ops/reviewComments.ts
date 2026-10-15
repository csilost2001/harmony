/**
 * レビューコメント (`<データフォルダ>/review-comments.json`)。設計の箇所に紐づく、スレッドの議論と解決の状態。
 * 付箋 (マーカー) は「AI への依頼」で、こちらは「人どうしの議論 (と AI レビューの指摘)」。
 */
import { cleanActor, ID_RE, isIsoDateTime, isOpsEntityKind, isRecord, type OpsEntityKind, type Parsed } from "./common.js";

export interface CommentTarget {
  kind: OpsEntityKind;
  id: string;
  /** 設計の中の箇所 (例: `items.email` `actions[2]`)。任意 */
  path?: string;
}
export interface CommentMessage { id: string; by: string; at: string; text: string; ai?: boolean }
export type ThreadStatus = "open" | "resolved";
export interface CommentThread {
  id: string;
  target: CommentTarget;
  status: ThreadStatus;
  /** AI レビューの指摘から作ったスレッド */
  source?: "human" | "ai-review";
  severity?: "error" | "warning" | "info";
  messages: CommentMessage[];
  resolvedBy?: string;
  resolvedAt?: string;
}
export interface ReviewCommentsFile { version: 1; threads: CommentThread[] }
export const emptyReviewComments = (): ReviewCommentsFile => ({ version: 1, threads: [] });
export const MAX_THREADS = 5000;
export const MAX_MESSAGES_PER_THREAD = 200;
export const MAX_COMMENT_CHARS = 4000;

export function parseReviewComments(raw: unknown): Parsed<ReviewCommentsFile> {
  const value = emptyReviewComments();
  const problems: string[] = [];
  if (raw === undefined || raw === null) return { value, problems };
  if (!isRecord(raw) || !Array.isArray(raw.threads)) return { value, problems: ["review-comments.json の形が正しくありません"] };
  const seen = new Set<string>();
  raw.threads.slice(0, MAX_THREADS).forEach((t, i) => {
    if (!isRecord(t) || typeof t.id !== "string" || !ID_RE.test(t.id) || !isRecord(t.target) || !isOpsEntityKind(t.target.kind) || typeof t.target.id !== "string" || !ID_RE.test(t.target.id)) { problems.push(`コメントのスレッド ${i + 1} 件目が読めません`); return; }
    if (seen.has(t.id)) { problems.push(`スレッド「${t.id}」が重複しています`); return; }
    seen.add(t.id);
    const messages: CommentMessage[] = [];
    for (const m of Array.isArray(t.messages) ? t.messages.slice(0, MAX_MESSAGES_PER_THREAD) : []) {
      if (isRecord(m) && typeof m.id === "string" && ID_RE.test(m.id) && isIsoDateTime(m.at) && typeof m.text === "string" && m.text.trim()) {
        messages.push({ id: m.id, by: cleanActor(m.by) || "(不明)", at: m.at, text: m.text.slice(0, MAX_COMMENT_CHARS), ...(m.ai === true ? { ai: true } : {}) });
      }
    }
    if (!messages.length) { problems.push(`スレッド「${t.id}」に、読めるコメントがありません (捨てました)`); return; }
    const path = typeof t.target.path === "string" && t.target.path.length <= 300 ? t.target.path : undefined;
    value.threads.push({
      id: t.id, target: { kind: t.target.kind, id: t.target.id, ...(path ? { path } : {}) }, status: t.status === "resolved" ? "resolved" : "open",
      ...(t.source === "ai-review" ? { source: "ai-review" as const } : {}),
      ...(t.severity === "error" || t.severity === "warning" || t.severity === "info" ? { severity: t.severity } : {}),
      messages, ...(typeof t.resolvedBy === "string" ? { resolvedBy: cleanActor(t.resolvedBy) } : {}), ...(isIsoDateTime(t.resolvedAt) ? { resolvedAt: t.resolvedAt } : {}),
    });
  });
  return { value, problems };
}

export const threadKey = (t: CommentTarget): string => `${t.kind}:${t.id}`;
export function openThreadCounts(file: ReviewCommentsFile): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of file.threads) if (t.status === "open") m.set(threadKey(t.target), (m.get(threadKey(t.target)) ?? 0) + 1);
  return m;
}
