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

export function regeneratePuckDataIds(data: Data): Data {
  const idMap = new Map<string, string>();
  const zones = data.zones
    ? Object.fromEntries(
      Object.entries(data.zones).map(([zoneId, content]) => [
        zoneId,
        regenerateContent(content, idMap),
      ]),
    )
    : undefined;

  return {
    ...data,
    content: regenerateContent(data.content, idMap),
    ...(zones ? { zones } : {}),
  };
}
