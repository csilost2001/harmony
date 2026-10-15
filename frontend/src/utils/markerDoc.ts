/**
 * 設計の authoring のマーカーの欄を、画面から更新するための小さな道具 (処理フロー以外の編集画面で共通)。
 */
import type { Authoring, Marker } from "../types/v3";

/** マーカーの一覧を入れ替えた authoring を返す。空になり、ほかの欄も無ければ undefined (authoring ごと外す) */
export function authoringWithMarkers(authoring: Authoring | undefined, markers: readonly Marker[]): Authoring | undefined {
  const rest = { ...(authoring ?? {}) };
  delete rest.markers;
  const next: Authoring = markers.length > 0 ? { ...rest, markers: [...markers] } : rest;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** 位置 (anchor.fieldPath) ごとの、未解決のマーカーの件数 */
export function unresolvedCountByPath(markers: readonly Marker[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of markers ?? []) {
    const p = m.anchor?.fieldPath;
    if (!p || m.resolvedAt) continue;
    out.set(p, (out.get(p) ?? 0) + 1);
  }
  return out;
}

/** 未解決の件数 */
export function unresolvedCount(markers: readonly Marker[] | undefined): number {
  return (markers ?? []).filter((m) => !m.resolvedAt).length;
}
