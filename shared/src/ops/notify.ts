/**
 * 通知 (Slack / Teams / 汎用 Webhook)。接続先の URL は秘密なので、`.harmony-ops/notify.json` (自分の .gitignore を持つ。git に載らない) に置く。
 * 形の検証・文面の組み立てはここ。送信 (https のみ・社内向けのアドレスへは送らない) は backend。
 */
import { ID_RE, isRecord, type Parsed } from "./common.js";

export const NOTIFY_EVENTS = ["approval", "comment", "issues", "git"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];
export const NOTIFY_EVENT_LABELS: Record<NotifyEvent, string> = { approval: "承認の状態の変化", comment: "レビューコメント", issues: "要確認の増加", git: "Git のコミット" };
export const NOTIFY_FORMATS = ["slack", "teams", "generic"] as const;
export type NotifyFormat = (typeof NOTIFY_FORMATS)[number];
export const NOTIFY_FORMAT_LABELS: Record<NotifyFormat, string> = { slack: "Slack", teams: "Teams", generic: "汎用 (JSON)" };

export interface Webhook { id: string; name: string; url: string; format: NotifyFormat; events: NotifyEvent[]; enabled: boolean }
export interface NotifyFile { version: 1; webhooks: Webhook[] }
export const emptyNotify = (): NotifyFile => ({ version: 1, webhooks: [] });
export const MAX_WEBHOOKS = 20;

/** 構文だけの検査 (https・資格情報なし・ホスト名あり・社内向けと分かるホスト名でない)。実際の接続先 (DNS の結果) の検査は、送るときに backend が行う */
export function checkWebhookUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "URL の形が正しくありません"; }
  if (u.protocol !== "https:") return "https:// の URL だけ使えます";
  if (u.username || u.password) return "URL に利用者名・パスワードを含めないでください";
  const h = u.hostname.toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return "社内・ローカルのホストへは送れません";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return "IP アドレスの直接指定はできません (ホスト名を使ってください)";
  if (raw.length > 800) return "URL が長すぎます";
  return null;
}

export function parseNotify(raw: unknown): Parsed<NotifyFile> {
  const value = emptyNotify();
  const problems: string[] = [];
  if (raw === undefined || raw === null) return { value, problems };
  if (!isRecord(raw) || !Array.isArray(raw.webhooks)) return { value, problems: ["notify.json の形が正しくありません"] };
  const seen = new Set<string>();
  raw.webhooks.slice(0, MAX_WEBHOOKS).forEach((w, i) => {
    if (!isRecord(w) || typeof w.id !== "string" || !ID_RE.test(w.id) || typeof w.name !== "string" || !w.name.trim() || w.name.length > 60 || typeof w.url !== "string") { problems.push(`通知先の ${i + 1} 件目が読めません`); return; }
    const bad = checkWebhookUrl(w.url);
    if (bad) { problems.push(`通知先「${w.name}」: ${bad}`); return; }
    if (seen.has(w.id)) { problems.push(`通知先「${w.id}」が重複しています`); return; }
    seen.add(w.id);
    const events = (Array.isArray(w.events) ? w.events : []).filter((e): e is NotifyEvent => (NOTIFY_EVENTS as readonly string[]).includes(e as string));
    value.webhooks.push({ id: w.id, name: w.name.trim(), url: w.url, format: (NOTIFY_FORMATS as readonly string[]).includes(w.format as string) ? (w.format as NotifyFormat) : "generic", events: [...new Set(events)], enabled: w.enabled !== false });
  });
  if (raw.webhooks.length > MAX_WEBHOOKS) problems.push(`通知先が多すぎます (${MAX_WEBHOOKS} 件まで)`);
  return { value, problems };
}

/** URL の、画面に出す形 (秘密の部分を伏せる: ホスト名だけ) */
export function maskWebhookUrl(url: string): string {
  try { const u = new URL(url); return `${u.protocol}//${u.hostname}/…`; } catch { return "(不正な URL)"; }
}

export interface NotifyMessage { event: NotifyEvent; title: string; lines: string[]; projectName?: string }

/** 送信する本文 (形式ごと)。入力の文字は、そのまま文字列として入れる (JSON.stringify される) */
export function buildPayload(format: NotifyFormat, m: NotifyMessage): unknown {
  const head = `${m.projectName ? `【${m.projectName}】` : ""}${m.title}`;
  const text = [head, ...m.lines].join("\n");
  if (format === "slack") return { text };
  if (format === "teams") return { "@type": "MessageCard", "@context": "https://schema.org/extensions", summary: head, title: head, text: m.lines.join("\n\n") };
  return { event: m.event, title: m.title, project: m.projectName ?? null, lines: m.lines, text };
}
