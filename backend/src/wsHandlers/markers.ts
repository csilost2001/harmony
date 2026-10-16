/**
 * マーカー (AI への指示・質問) の RPC (#1509)。どの設計の編集画面からでも、同じ手順で読み書きする。
 *
 * - listMarkers: 1 件の設計のマーカー
 * - listAllMarkers: 全設計のマーカー (ダッシュボードの集計・横断の一覧用。読むだけ)
 * - applyMarkerChanges: 画面での追加・更新・削除を、いまの内容へ重ねて保存する。AI が並行して足したマーカーを消さないよう、
 *   一覧ごと上書きはしない。保存はすぐ (設計の保存を待たない)
 */
import { MARKER_ENTITY_TYPES, applyMarkerChanges, listMarkers, summarizeMarkers, type MarkerChanges } from "@harmony/shared";
import { assertEntityId } from "../security/idValidator.js";
import { isMarkerEntityType, listMarkerDocs, readMarkerDoc, writeMarkerDoc } from "../markerStore.js";
import type { RpcHandlerMap } from "./types.js";

function target(params: unknown): { type: Parameters<typeof readMarkerDoc>[0]; id: string } {
  const p = (params ?? {}) as { entityType?: unknown; entityId?: unknown };
  if (!isMarkerEntityType(p.entityType)) throw new Error(`entityType は ${MARKER_ENTITY_TYPES.join(" / ")} のどれかです`);
  const id = p.entityId;
  assertEntityId(id, "entityId");
  return { type: p.entityType, id: id as string };
}

export const markerHandlers: RpcHandlerMap = {
  listMarkers: async ({ params, root, respond }) => {
    const { type, id } = target(params);
    const doc = await readMarkerDoc(type, id, root());
    if (!doc) { respond({ markers: [] }); return; }
    respond({ markers: listMarkers(doc) });
  },

  listAllMarkers: async ({ params, root, respond }) => {
    const p = (params ?? {}) as { unresolvedOnly?: boolean };
    const items: Array<Record<string, unknown>> = [];
    let total = 0;
    let unresolved = 0;
    for (const t of await listMarkerDocs(root())) {
      const all = listMarkers(t.doc);
      if (all.length === 0) continue;
      const s = summarizeMarkers(all);
      total += s.total;
      unresolved += s.unresolved;
      for (const m of all) {
        if (p.unresolvedOnly && m.resolvedAt) continue;
        items.push({ entityType: t.entityType, entityId: t.entityId, entityName: t.entityName, marker: m });
      }
    }
    respond({ items, total, unresolved });
  },

  applyMarkerChanges: async ({ params, root, respond, respondError }) => {
    const { type, id } = target(params);
    const doc = await readMarkerDoc(type, id, root());
    if (!doc) { respondError(`${type} ${id} が見つかりません`); return; }
    const changes = ((params ?? {}) as { changes?: MarkerChanges }).changes ?? {};
    if (applyMarkerChanges(doc, changes)) await writeMarkerDoc(type, id, doc, root());
    respond({ markers: listMarkers(doc) });
  },
};
