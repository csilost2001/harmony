/**
 * 業務部品デザイナの編集操作 (部品の追加・ドロップ・削除・複製・移動・改名)。
 * 画面デザイナと独自部品の編集画面で共通に使う。doc の更新は apply に委ねる。
 */
import { useCallback, useMemo } from "react";
import {
  LAYOUT_NODE_LABELS, createComponentNode, findNode, findParent, moveNode, updateNode,
  type LayoutComponentDef, type LayoutNode, type LayoutNodeType,
} from "@harmony/shared";
import type { ScreenItem } from "../../types/v3/screen-item";
import { showToast } from "../../utils/toast";
import type { Table } from "../../types/v3/table";
import type { DragPayload } from "./layoutDnd";
import { indentPlace, outdentPlace } from "./layoutKeyboard";
import {
  docDuplicateMany, docRemoveMany, docWrap, moveManyInSiblings, normalizeSelection,
} from "./layoutSelection";
import {
  createNode, docDuplicate, docInsert, docRemove, insertionPlace, itemFromColumn, newFieldWithItem, nodeForItem, type LayoutDoc, type Place,
} from "./layoutModel";

export interface LayoutOpsInput {
  apply: (fn: (d: LayoutDoc) => LayoutDoc, commitNow?: boolean) => void;
  nodes: LayoutNode[];
  items: ScreenItem[];
  tables: Table[];
  components: LayoutComponentDef[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** 複数選択 (主の選択を含む、選ばれている部品すべて)。省略すると 1 つだけの選択 */
  selectedIds?: string[];
  setSelection?: (ids: string[]) => void;
}

export function useLayoutOps({ apply, nodes, items, tables, components, selectedId, setSelectedId, selectedIds, setSelection }: LayoutOpsInput) {
  const selected = selectedId ? findNode(nodes, selectedId) : null;
  // 2 つ以上を選んでいるときの、整えた選択 (親も選ばれている部品は親にまとめる)
  const multi = useMemo(() => (selectedIds && selectedIds.length > 1 ? normalizeSelection(nodes, selectedIds) : []), [nodes, selectedIds]);
  const select = useCallback((ids: string[]) => (setSelection ? setSelection(ids) : setSelectedId(ids[ids.length - 1] ?? null)), [setSelection, setSelectedId]);

  /** 新しい部品を置く場所 (規則は insertionPlace) */
  const insertionPoint = useCallback((type: LayoutNodeType): Place => insertionPlace(nodes, selected, type), [selected, nodes]);

  // 新しい部品の ID は、いまの内容から先に決める (apply の中の処理は、React の都合で、後から実行されることがあり、
  // そこで決めた値を、すぐ後の選択に使えない)
  const snapshot = useCallback((): LayoutDoc => ({ items, layout: { version: 1, nodes } }), [items, nodes]);

  const addNode = useCallback((type: LayoutNodeType, at?: Place) => {
    const place = at ?? insertionPoint(type);
    let newId: string;
    if (type === "field" || type === "table") {
      const made = newFieldWithItem(snapshot(), type);
      newId = made.node.id;
      apply((d) => {
        // 反映の時点で同じ ID が使われていたら、その時点の内容でもう一度作る
        const m = d.items.some((i) => i.id === made.item.id) ? newFieldWithItem(d, type) : made;
        return docInsert(d, place.parentId, m.node, place.index, [m.item]);
      });
    } else {
      const node = createNode(type, nodes);
      newId = node.id;
      apply((d) => docInsert(d, place.parentId, node, place.index));
    }
    setSelectedId(newId);
  }, [apply, insertionPoint, setSelectedId, snapshot, nodes]);

  const addComponent = useCallback((componentId: string, at?: Place) => {
    const def = components.find((c) => c.id === componentId);
    if (!def) return;
    const place = at ?? insertionPoint("component");
    const node = createComponentNode(def, nodes);
    apply((d) => docInsert(d, place.parentId, node, place.index));
    setSelectedId(node.id);
  }, [apply, components, insertionPoint, setSelectedId, nodes]);

  const placeItem = useCallback((itemId: string, at?: Place) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const node = nodeForItem(item, nodes);
    const place = at ?? insertionPoint(node.type);
    apply((d) => docInsert(d, place.parentId, node, place.index));
    setSelectedId(node.id);
  }, [apply, items, insertionPoint, setSelectedId, nodes]);

  const addColumnItem = useCallback((tableId: string, columnId: string, at?: Place) => {
    const table = tables.find((t) => t.id === tableId);
    const col = table?.columns.find((c) => c.id === columnId);
    if (!table || !col) return;
    const item = itemFromColumn(table, col, items);
    const node = nodeForItem(item, nodes);
    const place = at ?? insertionPoint("field");
    apply((d) => docInsert(d, place.parentId, node, place.index, [item]));
    setSelectedId(node.id);
  }, [apply, tables, insertionPoint, setSelectedId, items, nodes]);

  const handleDrop = useCallback((payload: DragPayload, at: { parentId: string | null; index: number }) => {
    switch (payload.kind) {
      case "new-node": addNode(payload.nodeType, at); break;
      case "new-component": addComponent(payload.componentId, at); break;
      case "place-item": placeItem(payload.itemId, at); break;
      case "table-column": addColumnItem(payload.tableId, payload.columnId, at); break;
      case "move-node": {
        const from = findParent(nodes, payload.nodeId);
        const moved = moveNode(nodes, payload.nodeId, at.parentId, at.index);
        apply((d) => ({ ...d, layout: { version: 1, nodes: moveNode(d.layout?.nodes ?? [], payload.nodeId, at.parentId, at.index) } }));
        setSelectedId(payload.nodeId);
        // 別の入れ物へ移したときは、何をどこへ移したかを知らせる (誤って落としたときに、すぐ気づけるように)
        const now = findParent(moved, payload.nodeId);
        if (from && now && (from.parent?.id ?? null) !== (now.parent?.id ?? null)) {
          const dest = now.parent ? `「${LAYOUT_NODE_LABELS[now.parent.type]} ${now.parent.id}」の中` : "最上位";
          showToast(`「${payload.nodeId}」を${dest}へ移しました (Ctrl+Z で戻せます)`, "info");
        }
        break;
      }
    }
  }, [addNode, addComponent, placeItem, addColumnItem, apply, setSelectedId, nodes]);

  const deleteSelected = useCallback(() => {
    if (multi.length > 1) {
      apply((d) => docRemoveMany(d, multi, components).doc);
      select([]);
      return;
    }
    if (!selectedId) return;
    const pos = findParent(nodes, selectedId);
    apply((d) => docRemove(d, selectedId, true, components).doc);
    // 削除後は同じ親の近くの部品を選ぶ
    const siblings = pos?.parent ? pos.parent.children ?? [] : nodes;
    const near = siblings[pos ? pos.index + 1 : -1] ?? siblings[pos ? pos.index - 1 : -1];
    setSelectedId(near && near.id !== selectedId ? near.id : pos?.parent?.id ?? null);
  }, [selectedId, multi, nodes, components, apply, setSelectedId, select]);

  const duplicateSelected = useCallback(() => {
    if (multi.length > 1) {
      const { newIds } = docDuplicateMany(snapshot(), multi);
      apply((d) => docDuplicateMany(d, multi).doc);
      if (newIds.length) select(newIds);
      return;
    }
    if (!selectedId) return;
    const { newId } = docDuplicate(snapshot(), selectedId);
    apply((d) => docDuplicate(d, selectedId).doc);
    if (newId) setSelectedId(newId);
  }, [selectedId, multi, apply, setSelectedId, select, snapshot]);

  const moveSelected = useCallback((dir: -1 | 1) => {
    if (multi.length > 1) {
      const moved = moveManyInSiblings(nodes, multi, dir);
      if (moved.length === nodes.length && moved.every((n, i) => n === nodes[i])) return; // 動かせない (端・違う親)
      apply((d) => ({ ...d, layout: { version: 1, nodes: moveManyInSiblings(d.layout?.nodes ?? [], multi, dir) } }));
      return;
    }
    if (!selectedId) return;
    const pos = findParent(nodes, selectedId);
    if (!pos) return;
    const siblings = pos.parent ? pos.parent.children ?? [] : nodes;
    const to = pos.index + dir;
    if (to < 0 || to >= siblings.length) return;
    apply((d) => ({ ...d, layout: { version: 1, nodes: moveNode(d.layout?.nodes ?? [], selectedId, pos.parent?.id ?? null, dir > 0 ? to + 1 : to) } }));
  }, [selectedId, multi, nodes, apply]);

  /** 選んだ部品 (複数でも) を、新しい入れ物で包む。包めなければ false */
  const wrapSelected = useCallback((type: LayoutNodeType): boolean => {
    const ids = multi.length > 1 ? multi : selectedId ? [selectedId] : [];
    if (ids.length === 0) return false;
    const r = docWrap(snapshot(), ids, type);
    if (!r.wrapperId) return false;
    apply((d) => docWrap(d, ids, type).doc);
    select([r.wrapperId]);
    return true;
  }, [multi, selectedId, apply, select, snapshot]);

  /** 親の外へ出す (親の直後へ)。出せなければ false */
  const outdentSelected = useCallback((): boolean => {
    if (!selectedId) return false;
    const place = outdentPlace(nodes, selectedId);
    if (!place) return false;
    apply((d) => ({ ...d, layout: { version: 1, nodes: moveNode(d.layout?.nodes ?? [], selectedId, place.parentId, place.index) } }));
    return true;
  }, [selectedId, nodes, apply]);

  /** 直前の兄弟の中へ入れる (最後の子として)。入れられなければ false */
  const indentSelected = useCallback((): boolean => {
    if (!selectedId) return false;
    const place = indentPlace(nodes, selectedId);
    if (!place) return false;
    apply((d) => ({ ...d, layout: { version: 1, nodes: moveNode(d.layout?.nodes ?? [], selectedId, place.parentId, place.index) } }));
    return true;
  }, [selectedId, nodes, apply]);

  const renameNode = useCallback((oldId: string, newId: string) => {
    apply((d) => ({ ...d, layout: { version: 1, nodes: updateNode(d.layout?.nodes ?? [], oldId, (n) => ({ ...n, id: newId })) } }));
    setSelectedId(newId);
  }, [apply, setSelectedId]);

  const addChild = useCallback((type: "column" | "tab") => {
    if (!selectedId) return;
    addNode(type, { parentId: selectedId });
  }, [selectedId, addNode]);

  return { selected, multi, wrapSelected, insertionPoint, addNode, addComponent, placeItem, addColumnItem, handleDrop, deleteSelected, duplicateSelected, moveSelected, outdentSelected, indentSelected, renameNode, addChild };
}
