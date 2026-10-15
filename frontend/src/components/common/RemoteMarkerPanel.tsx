import { useCallback, useEffect, useRef, useState } from "react";
import type { MarkerEntityType } from "@harmony/shared";
import { mcpBridge } from "../../mcp/mcpBridge";
import { reportFailure } from "../../utils/failureToast";
import type { Marker } from "../../types/v3";
import { MarkerListPanel, type MarkerListPanelProps } from "./MarkerListPanel";

/** 設計が変わったことを知らせるイベント (マーカーを読み直す) */
const CHANGE_EVENT: Record<MarkerEntityType, string> = {
  processFlow: "processFlowChanged", screen: "screenChanged", table: "tableChanged", view: "viewChanged",
  viewDefinition: "viewDefinitionChanged", sequence: "sequenceChanged", pageLayout: "pageLayoutChanged",
};

/** 画面の一覧 (prev) から次の一覧 (next) への、追加・更新・削除 */
export function diffMarkers(prev: readonly Marker[], next: readonly Marker[]): { added: Marker[]; updated: Marker[]; removedIds: string[] } {
  const prevById = new Map(prev.map((m) => [m.id as string, m]));
  const nextIds = new Set(next.map((m) => m.id as string));
  return {
    added: next.filter((m) => !prevById.has(m.id)),
    updated: next.filter((m) => { const p = prevById.get(m.id); return !!p && JSON.stringify(p) !== JSON.stringify(m); }),
    removedIds: prev.filter((m) => !nextIds.has(m.id)).map((m) => m.id as string),
  };
}

type Props = Omit<MarkerListPanelProps, "markers" | "onChange" | "entity"> & {
  type: MarkerEntityType;
  id: string;
  name?: string;
  /** マーカーの一覧が (読み込み・追加・解決などで) 変わるたびに呼ぶ。行のバッジなど、親の表示に使う */
  onMarkersChange?: (markers: readonly Marker[]) => void;
};

/**
 * 設計の保存とは別に、マーカーだけをその場で保存するパネル (画面など、編集中の内容にマーカーを持たない編集画面用)。
 * 追加・解決・削除は、サーバの内容へ重ねて保存する (AI が並行して足したマーカーを消さない)。
 */
export function RemoteMarkerPanel({ type, id, name, onMarkersChange, ...rest }: Props) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const markersRef = useRef<Marker[]>([]);
  const notifyRef = useRef(onMarkersChange);
  useEffect(() => { notifyRef.current = onMarkersChange; });
  const set = useCallback((next: Marker[]) => { markersRef.current = next; setMarkers(next); notifyRef.current?.(next); }, []);

  const reload = useCallback(() => {
    mcpBridge.request("listMarkers", { entityType: type, entityId: id })
      .then((r) => set(((r as { markers?: Marker[] } | null)?.markers) ?? []))
      .catch((e) => reportFailure(e, "マーカーの読み込み"));
  }, [type, id, set]);

  useEffect(() => {
    reload();
    return mcpBridge.onBroadcast(CHANGE_EVENT[type], (data) => {
      const d = (data ?? {}) as Record<string, unknown>;
      const key = type === "processFlow" ? "processFlowId" : `${type}Id`;
      if (d[key] === undefined || d[key] === id) reload();
    });
  }, [type, id, reload]);

  const onChange = (next: Marker[]) => {
    const changes = diffMarkers(markersRef.current, next);
    if (changes.added.length + changes.updated.length + changes.removedIds.length === 0) return;
    set(next); // すぐ画面に反映 (サーバの結果で、あとから整える)
    mcpBridge.request("applyMarkerChanges", { entityType: type, entityId: id, changes })
      .then((r) => set(((r as { markers?: Marker[] } | null)?.markers) ?? next))
      .catch((e) => { reportFailure(e, "マーカーの保存"); reload(); });
  };

  return <MarkerListPanel {...rest} markers={markers} onChange={onChange} entity={{ type, id, name }} />;
}
