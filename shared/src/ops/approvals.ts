/**
 * 承認 (`<データフォルダ>/approvals.json`)。設計 (画面・テーブル・処理フロー ほか) ごとの、確定までの状態と履歴。
 * 承認したときの内容の印 (hash) を残し、承認のあとに内容が変わったら「承認後に変更されました」と分かるようにする。
 */
import { cleanActor, ID_RE, isIsoDateTime, isOpsEntityKind, isRecord, OPS_ENTITY_LABELS, type OpsEntityKind, type Parsed } from "./common.js";
import type { Role } from "./access.js";

export const APPROVAL_STATES = ["draft", "review", "approved", "rejected"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];
export const APPROVAL_LABELS: Record<ApprovalState, string> = { draft: "下書き", review: "承認待ち", approved: "承認済み", rejected: "差し戻し" };

export interface ApprovalEvent { state: ApprovalState; by: string; at: string; note?: string }
export interface Approval {
  kind: OpsEntityKind;
  id: string;
  state: ApprovalState;
  /** 承認したときの内容の印 (承認済みのときだけ) */
  hash?: string;
  history: ApprovalEvent[];
}
export interface ApprovalsFile { version: 1; items: Approval[] }
export const emptyApprovals = (): ApprovalsFile => ({ version: 1, items: [] });
export const MAX_APPROVAL_HISTORY = 50;
export const MAX_APPROVAL_ITEMS = 5000;

export function parseApprovals(raw: unknown): Parsed<ApprovalsFile> {
  const value = emptyApprovals();
  const problems: string[] = [];
  if (raw === undefined || raw === null) return { value, problems };
  if (!isRecord(raw) || !Array.isArray(raw.items)) return { value, problems: ["approvals.json の形が正しくありません"] };
  const seen = new Set<string>();
  raw.items.slice(0, MAX_APPROVAL_ITEMS).forEach((it, i) => {
    if (!isRecord(it) || !isOpsEntityKind(it.kind) || typeof it.id !== "string" || !ID_RE.test(it.id) || !(APPROVAL_STATES as readonly string[]).includes(it.state as string)) { problems.push(`承認の ${i + 1} 件目が読めません`); return; }
    const key = `${it.kind}:${it.id}`;
    if (seen.has(key)) { problems.push(`承認「${key}」が重複しています`); return; }
    seen.add(key);
    const history: ApprovalEvent[] = [];
    for (const h of Array.isArray(it.history) ? it.history.slice(-MAX_APPROVAL_HISTORY) : []) {
      if (isRecord(h) && (APPROVAL_STATES as readonly string[]).includes(h.state as string) && isIsoDateTime(h.at)) {
        history.push({ state: h.state as ApprovalState, by: cleanActor(h.by) || "(不明)", at: h.at, ...(typeof h.note === "string" && h.note ? { note: h.note.slice(0, 1000) } : {}) });
      }
    }
    value.items.push({ kind: it.kind, id: it.id, state: it.state as ApprovalState, ...(it.state === "approved" && typeof it.hash === "string" && /^[0-9a-f]{64}$/.test(it.hash) ? { hash: it.hash } : {}), history });
  });
  return { value, problems };
}

/** 状態の遷移 (誰が行えるか)。承認・差し戻しは、承認の役割以上 */
export interface Transition { to: ApprovalState; needs: Role }
export function allowedTransitions(from: ApprovalState): Transition[] {
  switch (from) {
    case "draft": return [{ to: "review", needs: "editor" }];
    case "review": return [{ to: "approved", needs: "approver" }, { to: "rejected", needs: "approver" }, { to: "draft", needs: "editor" }];
    case "approved": return [{ to: "draft", needs: "editor" }];
    case "rejected": return [{ to: "review", needs: "editor" }, { to: "draft", needs: "editor" }];
  }
}
export function transitionNeeds(from: ApprovalState, to: ApprovalState): Role | null {
  return allowedTransitions(from).find((t) => t.to === to)?.needs ?? null;
}

export type ApprovalStatus = "none" | ApprovalState | "stale";

/** いまの内容の印と突き合わせた状態。承認済みなのに内容が変わっていれば stale */
export function effectiveStatus(a: Approval | undefined, currentHash: string | null): ApprovalStatus {
  if (!a) return "none";
  if (a.state === "approved" && a.hash && currentHash && a.hash !== currentHash) return "stale";
  return a.state;
}
export const STATUS_LABELS: Record<ApprovalStatus, string> = { none: "未申請", ...APPROVAL_LABELS, stale: "承認後に変更" };

export const entityLabel = (kind: OpsEntityKind): string => OPS_ENTITY_LABELS[kind];

/** 内容の印から外す項目 (承認の操作で変わる・保存のたびに変わるもの) */
const VOLATILE_KEYS = new Set(["maturity", "updatedAt"]);
/** 印を決めるための、安定した文字列 (キーを並べ替え、揮発する項目を除く。先頭の階層とその meta だけを対象にする) */
export function canonicalForHash(value: unknown): string {
  const walk = (v: unknown, depth: number, parentIsMeta: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1, false));
    if (isRecord(v)) {
      // 原型のない入れ物に組む (自前の `__proto__` キーも、内容として印に入る)
      const out: Record<string, unknown> = Object.create(null);
      for (const k of Object.keys(v).sort()) {
        if ((depth === 0 || parentIsMeta) && VOLATILE_KEYS.has(k)) continue;
        out[k] = walk(v[k], depth + 1, depth === 0 && k === "meta");
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value, 0, false));
}
