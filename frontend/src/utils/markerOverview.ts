/**
 * マーカーの横断の一覧 (全設計) と、ダッシュボードの集計に使う、純粋な計算。
 */
import { MARKER_ENTITY_LABELS, type MarkerEntityType } from "@harmony/shared";
import type { Marker, MarkerKind } from "../types/v3";

export interface MarkerItem {
  entityType: MarkerEntityType;
  entityId: string;
  entityName: string;
  marker: Marker;
}

/** マーカーのある画面 (編集画面) の経路。画面のマーカーは、画面項目の画面にある */
export function markerEntityRoute(type: MarkerEntityType, id: string): string {
  const e = encodeURIComponent(id);
  switch (type) {
    case "processFlow": return `/process-flow/edit/${e}`;
    case "screen": return `/screen/items/${e}`;
    case "table": return `/table/edit/${e}`;
    case "view": return `/view/edit/${e}`;
    case "viewDefinition": return `/view-definition/edit/${e}`;
    case "sequence": return `/sequence/edit/${e}`;
    case "pageLayout": return `/page-layout/edit/${e}`;
  }
}

export interface MarkerFilterState {
  /** 設計の種類 (null = すべて) */
  entityType: MarkerEntityType | null;
  kind: MarkerKind | null;
  /** 解決済みも含める */
  includeResolved: boolean;
  /** 語 (本文・設計の名前・id・解決メモに含まれる) */
  query: string;
}

export const DEFAULT_MARKER_FILTER: MarkerFilterState = { entityType: null, kind: null, includeResolved: false, query: "" };

const norm = (s: string) => s.normalize("NFKC").toLowerCase();

/** 絞り込んで、古いもの (長く滞っているもの) から並べる。同じ日時なら、設計の名前順 */
export function filterMarkerItems(items: readonly MarkerItem[], f: MarkerFilterState): MarkerItem[] {
  const q = norm(f.query.trim());
  return items
    .filter((i) => (f.includeResolved || !i.marker.resolvedAt)
      && (f.entityType === null || i.entityType === f.entityType)
      && (f.kind === null || i.marker.kind === f.kind)
      && (q === "" || norm(`${i.marker.body} ${i.entityName} ${i.entityId} ${i.marker.resolution ?? ""}`).includes(q)))
    .sort((a, b) => a.marker.createdAt.localeCompare(b.marker.createdAt) || a.entityName.localeCompare(b.entityName, "ja"));
}

/** 経過日数 (整数。未来・不正な日時は 0) */
export function ageDays(createdAt: string, now: number = Date.now()): number {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0;
}

export interface MarkerDashboardSummary {
  total: number;
  byKind: Record<MarkerKind, number>;
  byType: Array<{ type: MarkerEntityType; label: string; count: number }>;
  perEntity: Array<{ type: MarkerEntityType; id: string; name: string; count: number }>;
  /** いちばん古い未解決 (日数) */
  oldestDays: number;
  recent: MarkerItem[];
}

/** 未解決のマーカーの集計 (ダッシュボード) */
export function summarizeMarkerItems(items: readonly MarkerItem[], now: number = Date.now()): MarkerDashboardSummary {
  const open = items.filter((i) => !i.marker.resolvedAt);
  const byKind: Record<MarkerKind, number> = { chat: 0, attention: 0, todo: 0, question: 0, validator: 0 };
  const typeCount = new Map<MarkerEntityType, number>();
  const per = new Map<string, { type: MarkerEntityType; id: string; name: string; count: number }>();
  let oldest = 0;
  for (const i of open) {
    byKind[i.marker.kind] = (byKind[i.marker.kind] ?? 0) + 1;
    typeCount.set(i.entityType, (typeCount.get(i.entityType) ?? 0) + 1);
    const key = `${i.entityType}:${i.entityId}`;
    const p = per.get(key) ?? { type: i.entityType, id: i.entityId, name: i.entityName || i.entityId, count: 0 };
    p.count++;
    per.set(key, p);
    oldest = Math.max(oldest, ageDays(i.marker.createdAt, now));
  }
  return {
    total: open.length,
    byKind,
    byType: [...typeCount.entries()].map(([type, count]) => ({ type, label: MARKER_ENTITY_LABELS[type], count })).sort((a, b) => b.count - a.count),
    perEntity: [...per.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja")),
    oldestDays: oldest,
    recent: [...open].sort((a, b) => b.marker.createdAt.localeCompare(a.marker.createdAt)).slice(0, 5),
  };
}
