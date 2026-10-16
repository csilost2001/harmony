/**
 * マーカーを、種類の違う設計 (処理フロー・画面・テーブル・ビュー・ビュー定義・シーケンス・ページレイアウト) に対して、
 * 同じ手順で読み書きする入口。マーカーの置き場は、どの設計でも `authoring.markers` (schema どおり。画面と同じ場所)。
 *
 * 書き込みは、設計の実体ファイルへ直接 (編集中の画面には、変更の通知を出す)。古い形 (最上位の `markers`) は、
 * 読むときにメモリ上で authoring.markers へ移し、次の書き込みで保存される。
 */
import {
  MARKER_ENTITY_TYPES, migrateLegacyMarkers, type MarkerEntityType, type MarkerHost,
} from "@harmony/shared";
import {
  readProcessFlow, writeProcessFlow, readScreenEntity, writeScreenEntity, readTable, writeTable, readView, writeView,
  readViewDefinition, writeViewDefinition, readSequence, writeSequence, readPageLayout, writePageLayout,
  listEntitiesReadOnly, type TopLevelEntityKind,
} from "./projectStorage.js";
import { wsBridge } from "./wsBridge.js";

export { MARKER_ENTITY_TYPES };
export type { MarkerEntityType, MarkerHost };

const KIND_OF: Record<MarkerEntityType, TopLevelEntityKind> = {
  processFlow: "processFlow", screen: "screen", table: "table", view: "view",
  viewDefinition: "viewDefinition", sequence: "sequence", pageLayout: "pageLayout",
};

/** 変更を知らせるイベントと、その id の名前 */
const EVENTS: Record<MarkerEntityType, Array<{ event: string; idKey: string }>> = {
  processFlow: [{ event: "processFlowChanged", idKey: "processFlowId" }],
  screen: [{ event: "screenChanged", idKey: "screenId" }, { event: "screenItemsChanged", idKey: "screenId" }],
  table: [{ event: "tableChanged", idKey: "tableId" }],
  view: [{ event: "viewChanged", idKey: "viewId" }],
  viewDefinition: [{ event: "viewDefinitionChanged", idKey: "viewDefinitionId" }],
  sequence: [{ event: "sequenceChanged", idKey: "sequenceId" }],
  pageLayout: [{ event: "pageLayoutChanged", idKey: "pageLayoutId" }],
};

export function isMarkerEntityType(v: unknown): v is MarkerEntityType {
  return typeof v === "string" && (MARKER_ENTITY_TYPES as readonly string[]).includes(v);
}

/** 設計を読む (無ければ null)。古い形のマーカーは、メモリ上で移して返す */
export async function readMarkerDoc(type: MarkerEntityType, id: string, root: string): Promise<MarkerHost | null> {
  let doc: unknown;
  switch (type) {
    case "processFlow": doc = await readProcessFlow(id, root); break;
    case "screen": doc = await readScreenEntity(id, root); break;
    case "table": doc = await readTable(id, root); break;
    case "view": doc = await readView(id, root); break;
    case "viewDefinition": doc = await readViewDefinition(id, root); break;
    case "sequence": doc = await readSequence(id, root); break;
    case "pageLayout": doc = await readPageLayout(id, root); break;
  }
  if (!doc || typeof doc !== "object") return null;
  migrateLegacyMarkers(doc as MarkerHost);
  return doc as MarkerHost;
}

/** 設計を書き、開いている画面へ変更を知らせる */
export async function writeMarkerDoc(type: MarkerEntityType, id: string, doc: MarkerHost, root: string): Promise<void> {
  // 更新日時の置き場所: 処理フローは meta の中 (最上位は schema が禁じる)。ほかは最上位
  const now = new Date().toISOString();
  if (type === "processFlow") {
    const d = doc as { meta?: { updatedAt?: string } };
    if (d.meta && typeof d.meta === "object") d.meta.updatedAt = now;
  } else {
    (doc as { updatedAt?: string }).updatedAt = now;
  }
  switch (type) {
    case "processFlow": await writeProcessFlow(id, doc, root); break;
    case "screen": await writeScreenEntity(id, doc, root); break;
    case "table": await writeTable(id, doc, root); break;
    case "view": await writeView(id, doc, root); break;
    case "viewDefinition": await writeViewDefinition(id, doc, root); break;
    case "sequence": await writeSequence(id, doc, root); break;
    case "pageLayout": await writePageLayout(id, doc, root); break;
  }
  for (const { event, idKey } of EVENTS[type]) wsBridge.broadcast({ wsId: root, event, data: { [idKey]: id } });
}

const idOf = (type: MarkerEntityType, d: Record<string, unknown>): string | undefined => {
  const meta = d.meta as { id?: unknown } | undefined;
  const v = type === "processFlow" ? (meta?.id ?? d.id) : d.id;
  return typeof v === "string" ? v : undefined;
};
const nameOf = (type: MarkerEntityType, d: Record<string, unknown>): string => {
  const meta = d.meta as { name?: unknown } | undefined;
  const v = type === "processFlow" ? (meta?.name ?? d.name) : d.name;
  return typeof v === "string" ? v : "";
};

export interface MarkerTargetDoc { entityType: MarkerEntityType; entityId: string; entityName: string; doc: MarkerHost }

/** 種類ごと (省略なら全種類) の、読むだけの設計の一覧。古い形のマーカーは、メモリ上で移す */
export async function listMarkerDocs(root: string, only?: MarkerEntityType): Promise<MarkerTargetDoc[]> {
  const out: MarkerTargetDoc[] = [];
  for (const type of only ? [only] : MARKER_ENTITY_TYPES) {
    for (const raw of await listEntitiesReadOnly(KIND_OF[type], root)) {
      if (!raw || typeof raw !== "object") continue;
      const d = raw as Record<string, unknown>;
      const id = idOf(type, d);
      if (!id) continue;
      migrateLegacyMarkers(d as MarkerHost);
      out.push({ entityType: type, entityId: id, entityName: nameOf(type, d), doc: d as MarkerHost });
    }
  }
  return out;
}
