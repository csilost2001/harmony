/**
 * ダッシュボードの「今日やること」(UI 改善提案 続編 第 6 弾 #116)。未保存の下書き・要確認のエラー・未解決のマーカー・要確認の警告を、
 * 先にやったほうがよい順に 1 本の列にする (画面に依存しない純関数)。
 * 順: 未保存の下書き (失うと戻せない) → 自分のメモ (今日の印) → 要確認のエラー → 未解決のマーカー (古いものから) → 要確認の警告。
 */
import type { DocIssue } from "@harmony/shared";
import type { DraftMeta } from "./draftStorage";
import { markerEntityRoute, type MarkerItem } from "./markerOverview";
import { referrerRoute } from "./references";
import type { NotesMap } from "./personalNotes";

export type TodayKind = "draft" | "note" | "error" | "marker" | "warning";

export interface TodayTask {
  key: string;
  kind: TodayKind;
  title: string;
  detail: string;
  /** ワークスペース配下の経路。開き先が分からないもの (設計全体にかかる指摘) は null */
  route: string | null;
}

export const TODAY_KIND_LABELS: Record<TodayKind, string> = { draft: "未保存の下書き", note: "自分のメモ", error: "要確認 (エラー)", marker: "未解決のマーカー", warning: "要確認 (警告)" };

const DRAFT_KINDS: Record<string, { label: string; route: (id: string) => string }> = {
  table: { label: "テーブル", route: (id) => `/table/edit/${encodeURIComponent(id)}` },
  action: { label: "処理フロー", route: (id) => `/process-flow/edit/${encodeURIComponent(id)}` },
  flow: { label: "画面フロー", route: () => "/screen/flow" },
  businessFlow: { label: "業務フロー", route: (id) => `/business-flow/edit/${encodeURIComponent(id)}` },
  report: { label: "帳票", route: (id) => `/report/edit/${encodeURIComponent(id)}` },
};

const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** 個人メモの印 (`<種類>:<id>`) → 設計の呼び名と、開く経路 (続編 第 9 弾 #173) */
const NOTE_KINDS: Record<string, { label: string; route: (id: string) => string }> = {
  table: { label: "テーブル", route: (id) => `/table/edit/${encodeURIComponent(id)}` },
  processFlow: { label: "処理フロー", route: (id) => `/process-flow/edit/${encodeURIComponent(id)}` },
  screen: { label: "画面", route: (id) => `/screen/items/${encodeURIComponent(id)}` },
  businessFlow: { label: "業務フロー", route: (id) => `/business-flow/edit/${encodeURIComponent(id)}` },
  report: { label: "帳票", route: (id) => `/report/edit/${encodeURIComponent(id)}` },
  sequence: { label: "シーケンス", route: (id) => `/sequence/edit/${encodeURIComponent(id)}` },
  view: { label: "DB ビュー", route: (id) => `/view/edit/${encodeURIComponent(id)}` },
  viewDefinition: { label: "ビュー定義", route: (id) => `/view-definition/edit/${encodeURIComponent(id)}` },
  pageLayout: { label: "ページレイアウト", route: (id) => `/page-layout/edit/${encodeURIComponent(id)}` },
};

export function buildTodayTasks(src: { drafts: readonly DraftMeta[]; issues: readonly DocIssue[]; markers: readonly MarkerItem[]; notes?: NotesMap }, limit = 30): TodayTask[] {
  const out: TodayTask[] = [];
  for (const d of src.drafts) {
    const meta = DRAFT_KINDS[d.kind];
    out.push({ key: `draft:${d.key}`, kind: "draft", title: `${meta?.label ?? d.kind}「${d.id}」の下書き`, detail: "保存されていない変更がブラウザに残っています", route: meta ? meta.route(d.id) : null });
  }
  // 自分のメモ (「今日」の印を付けたもの。新しい順)
  const todayNotes = Object.entries(src.notes ?? {}).filter(([, n]) => n.today).sort((a, b) => b[1].at.localeCompare(a[1].at));
  for (const [ref, n] of todayNotes) {
    const sep = ref.indexOf(":");
    const kind = ref.slice(0, sep);
    const id = ref.slice(sep + 1);
    const meta = NOTE_KINDS[kind];
    out.push({ key: `note:${ref}`, kind: "note", title: clip(n.text, 40), detail: `${meta?.label ?? kind}「${id}」のメモ`, route: meta ? meta.route(id) : null });
  }
  const issueTask = (i: DocIssue, kind: TodayKind): TodayTask => ({
    key: `issue:${i.key ?? `${i.section}:${i.message}`}`, kind, title: i.section, detail: clip(i.message, 80), route: i.ref ? referrerRoute(i.ref) ?? null : null,
  });
  for (const i of src.issues) if (i.severity === "error") out.push(issueTask(i, "error"));
  const markers = [...src.markers].filter((m) => !m.marker.resolvedAt).sort((a, b) => String(a.marker.createdAt).localeCompare(String(b.marker.createdAt)));
  for (const m of markers) out.push({ key: `marker:${m.entityType}:${m.entityId}:${m.marker.id}`, kind: "marker", title: clip(m.marker.body, 40), detail: `${m.entityName || m.entityId} のマーカー`, route: markerEntityRoute(m.entityType, m.entityId) });
  for (const i of src.issues) if (i.severity === "warning") out.push(issueTask(i, "warning"));
  // 同じ印 (key) の指摘が 2 つ来ても、1 つだけ出す (一覧の key が重なるのを防ぐ)
  const seen = new Set<string>();
  return out.filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), true))).slice(0, limit);
}
