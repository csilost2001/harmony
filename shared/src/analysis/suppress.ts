/**
 * 要確認事項の抑制。「意図どおり」の指摘を、理由つきで止める。期限を過ぎると、また出る。
 * 抑制は設定 (`design-check.json`) に残り、一覧で見直せる。
 */
import type { DocIssue } from "../designDocument.js";
import type { IssueSuppression } from "./settings.js";

/** 指摘を見分ける印。重大度・対象・内容が同じなら、同じ印になる (64 bit の FNV-1a を 2 本) */
export function issueKey(issue: Pick<DocIssue, "severity" | "section" | "message">): string {
  const text = `${issue.severity}\u0000${issue.section}\u0000${issue.message}`;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return `i-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export interface SuppressedIssue { issue: DocIssue; suppression: IssueSuppression }
export interface SuppressionStatus {
  /** 抑制が効いている指摘 */
  suppressed: SuppressedIssue[];
  /** 期限を過ぎたため、抑制が効かなくなった指摘 (要確認には出る) */
  expired: SuppressedIssue[];
  /** 該当する指摘がなくなった抑制 (直したか、内容が変わった。整理の対象) */
  orphaned: IssueSuppression[];
}

/** 抑制を適用する。`today` は YYYY-MM-DD (この日までは有効、翌日から期限切れ) */
export function applySuppressions(issues: readonly DocIssue[], suppressions: readonly IssueSuppression[], today: string): { active: DocIssue[]; status: SuppressionStatus } {
  const byKey = new Map(suppressions.map((s) => [s.key, s]));
  const active: DocIssue[] = [];
  const status: SuppressionStatus = { suppressed: [], expired: [], orphaned: [] };
  const matched = new Set<string>();
  for (const issue of issues) {
    const key = issue.key ?? issueKey(issue);
    const s = byKey.get(key);
    if (!s) { active.push(issue); continue; }
    matched.add(key);
    if (s.expiresOn && s.expiresOn < today) { status.expired.push({ issue, suppression: s }); active.push(issue); }
    else status.suppressed.push({ issue, suppression: s });
  }
  status.orphaned = suppressions.filter((s) => !matched.has(s.key));
  return { active, status };
}
