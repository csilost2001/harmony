import type { Data } from "@measured/puck";
import { generateUUID } from "../utils/uuid";

type ComponentItem = {
  type: string;
  props: {
    id: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function isComponentItem(value: unknown): value is ComponentItem {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { props?: { id?: unknown } }).props?.id === "string"
  );
}

function nextId(oldId: string, idMap: Map<string, string>): string {
  const existing = idMap.get(oldId);
  if (existing) return existing;
  const generated = generateUUID();
  idMap.set(oldId, generated);
  return generated;
}

function regenerateUnknown(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => regenerateUnknown(item, idMap));
  }
  if (isComponentItem(value)) {
    return regenerateItem(value, idMap);
  }
  return value;
}

function regenerateItem(item: ComponentItem, idMap: Map<string, string>): ComponentItem {
  const props = Object.fromEntries(
    Object.entries(item.props).map(([key, value]) => [
      key,
      key === "id" ? nextId(value as string, idMap) : regenerateUnknown(value, idMap),
    ]),
  ) as ComponentItem["props"];

  return {
    ...item,
    props,
  };
}

function regenerateContent(
  content: Data["content"],
  idMap: Map<string, string>,
): Data["content"] {
  return content.map((item) => regenerateItem(item as ComponentItem, idMap)) as Data["content"];
}

/**
 * legacy DropZone の zones map キー (`<itemId>:<zoneName>`) の itemId 部分を
 * idMap で書き換える (#1412 P-4)。
 *
 * - キーを最初の ":" で分解し、itemId 部分が idMap に登録済 (= subtree 内で id 再生成された
 *   親ノード) なら新 itemId に置換する。
 * - idMap に未登録の itemId (= subtree 外を指す orphan key、または既存の "main:zone" のような
 *   リテラルキー) はそのまま保持する。これにより既存 data の zones キーは破壊されない。
 * - zoneName 部分に ":" が含まれても、最初の ":" のみで分割するため保持される。
 */
function regenerateZoneKey(zoneKey: string, idMap: Map<string, string>): string {
  const sepIdx = zoneKey.indexOf(":");
  if (sepIdx < 0) return zoneKey; // ":" 無しキーはそのまま
  const itemId = zoneKey.slice(0, sepIdx);
  const zoneName = zoneKey.slice(sepIdx + 1);
  const newItemId = idMap.get(itemId);
  if (!newItemId) return zoneKey; // subtree 外 / リテラルキーは不変
  return `${newItemId}:${zoneName}`;
}

export function regeneratePuckDataIds(data: Data): Data {
  const idMap = new Map<string, string>();
  // 先に content / zones の各 value を処理して idMap (旧 itemId → 新 itemId) を充填する。
  // zones の value 配列内ノードの props.id も再生成され idMap に載るため、
  // ネストした DropZone の親 itemId もこの段階で idMap に揃う。
  const newContent = regenerateContent(data.content, idMap);
  const regeneratedZoneEntries = data.zones
    ? Object.entries(data.zones).map(
        ([zoneId, content]) =>
          [zoneId, regenerateContent(content, idMap)] as const,
      )
    : undefined;

  // value 処理後の idMap を使って zones キーの itemId 部分を書き換える。
  const zones = regeneratedZoneEntries
    ? Object.fromEntries(
        regeneratedZoneEntries.map(([zoneId, content]) => [
          regenerateZoneKey(zoneId, idMap),
          content,
        ]),
      )
    : undefined;

  return {
    ...data,
    content: newContent,
    ...(zones ? { zones } : {}),
  };
}
