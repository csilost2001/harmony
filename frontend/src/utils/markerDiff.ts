import type { Marker } from "../types/v3";

/** 画面の一覧 (prev) から次の一覧 (next) への、追加・更新・削除 (id で突き合わせる) */
export function diffMarkers(prev: readonly Marker[], next: readonly Marker[]): { added: Marker[]; updated: Marker[]; removedIds: string[] } {
  const prevById = new Map(prev.map((m) => [m.id as string, m]));
  const nextIds = new Set(next.map((m) => m.id as string));
  return {
    added: next.filter((m) => !prevById.has(m.id)),
    updated: next.filter((m) => { const p = prevById.get(m.id); return !!p && JSON.stringify(p) !== JSON.stringify(m); }),
    removedIds: prev.filter((m) => !nextIds.has(m.id)).map((m) => m.id as string),
  };
}
