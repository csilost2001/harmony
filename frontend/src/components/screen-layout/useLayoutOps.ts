/**
 * 業務部品デザイナの編集操作 (部品の追加・ドロップ・削除・複製・移動・改名)。
 * 画面デザイナと独自部品の編集画面で共通に使う。doc の更新は apply に委ねる。
 */
import { useCallback } from "react";
import {
  createComponentNode, findNode, findParent, moveNode, updateNode,
  type LayoutComponentDef, type LayoutNode, type LayoutNodeType,
} from "@harmony/shared";
import type { ScreenItem } from "../../types/v3/screen-item";
import type { Table } from "../../types/v3/table";
import type { DragPayload } from "./layoutDnd";
import {
  createNode, docDuplicate, docInsert, docRemove, itemFromColumn, newFieldWithItem, nodeForItem, type LayoutDoc,
} from "./layoutModel";

export interface LayoutOpsInput {
  apply: (fn: (d: LayoutDoc) => LayoutDoc, commitNow?: boolean) => void;
  nodes: LayoutNode[];
  items: ScreenItem[];
  tables: Table[];
  components: LayoutComponentDef[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

export interface Place { parentId: string | null; index?: number }

export function useLayoutOps({ apply, nodes, items, tables, components, selectedId, setSelectedId }: LayoutOpsInput) {
  const selected = selectedId ? findNode(nodes, selectedId) : null;

  /** 新しい部品を置く場所: 選択中の容器の末尾、または選択中の部品の直後 */
  const insertionPoint = useCallback((type: LayoutNodeType): Place => {
    if (!selected) return { parentId: null };
    if (selected.children !== undefined && type !== "column" && type !== "tab") return { parentId: selected.id };
    const pos = findParent(nodes, selected.id);
    return { parentId: pos?.parent?.id ?? null, index: (pos?.index ?? -1) + 1 };
  }, [selected, nodes]);

  const addNode = useCallback((type: LayoutNodeType, at?: Place) => {
    const place = at ?? insertionPoint(type);
    let newId = "";
    apply((d) => {
      if (type === "field" || type === "table") {
        const { item, node } = newFieldWithItem(d, type);
        newId = node.id;
        return docInsert(d, place.parentId, node, place.index, [item]);
      }
      const node = createNode(type, d.layout?.nodes ?? []);
      newId = node.id;
      return docInsert(d, place.parentId, node, place.index);
    });
    if (newId) setSelectedId(newId);
  }, [apply, insertionPoint, setSelectedId]);

  const addComponent = useCallback((componentId: string, at?: Place) => {
    const def = components.find((c) => c.id === componentId);
    if (!def) return;
    const place = at ?? insertionPoint("component");
    let newId = "";
    apply((d) => {
      const node = createComponentNode(def, d.layout?.nodes ?? []);
      newId = node.id;
      return docInsert(d, place.parentId, node, place.index);
    });
    if (newId) setSelectedId(newId);
  }, [apply, components, insertionPoint, setSelectedId]);

  const placeItem = useCallback((itemId: string, at?: Place) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    let newId = "";
    apply((d) => {
      const node = nodeForItem(item, d.layout?.nodes ?? []);
      newId = node.id;
      const place = at ?? insertionPoint(node.type);
      return docInsert(d, place.parentId, node, place.index);
    });
    if (newId) setSelectedId(newId);
  }, [apply, items, insertionPoint, setSelectedId]);

  const addColumnItem = useCallback((tableId: string, columnId: string, at?: Place) => {
    const table = tables.find((t) => t.id === tableId);
    const col = table?.columns.find((c) => c.id === columnId);
    if (!table || !col) return;
    let newId = "";
    apply((d) => {
      const item = itemFromColumn(table, col, d.items);
      const node = nodeForItem(item, d.layout?.nodes ?? []);
      newId = node.id;
      const place = at ?? insertionPoint("field");
      return docInsert(d, place.parentId, node, place.index, [item]);
    });
    if (newId) setSelectedId(newId);
  }, [apply, tables, insertionPoint, setSelectedId]);

  const handleDrop = useCallback((payload: DragPayload, at: { parentId: string | null; index: number }) => {
    switch (payload.kind) {
      case "new-node": addNode(payload.nodeType, at); break;
      case "new-component": addComponent(payload.componentId, at); break;
      case "place-item": placeItem(payload.itemId, at); break;
      case "table-column": addColumnItem(payload.tableId, payload.columnId, at); break;
      case "move-node":
        apply((d) => ({ ...d, layout: { version: 1, nodes: moveNode(d.layout?.nodes ?? [], payload.nodeId, at.parentId, at.index) } }));
        setSelectedId(payload.nodeId);
        break;
    }
  }, [addNode, addComponent, placeItem, addColumnItem, apply, setSelectedId]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const pos = findParent(nodes, selectedId);
    apply((d) => docRemove(d, selectedId, true, components).doc);
    // 削除後は同じ親の近くの部品を選ぶ
    const siblings = pos?.parent ? pos.parent.children ?? [] : nodes;
    const near = siblings[pos ? pos.index + 1 : -1] ?? siblings[pos ? pos.index - 1 : -1];
    setSelectedId(near && near.id !== selectedId ? near.id : pos?.parent?.id ?? null);
  }, [selectedId, nodes, components, apply, setSelectedId]);

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return;
    let newId: string | null = null;
    apply((d) => { const r = docDuplicate(d, selectedId); newId = r.newId; return r.doc; });
    if (newId) setSelectedId(newId);
  }, [selectedId, apply, setSelectedId]);

  const moveSelected = useCallback((dir: -1 | 1) => {
    if (!selectedId) return;
    const pos = findParent(nodes, selectedId);
    if (!pos) return;
    const siblings = pos.parent ? pos.parent.children ?? [] : nodes;
    const to = pos.index + dir;
    if (to < 0 || to >= siblings.length) return;
    apply((d) => ({ ...d, layout: { version: 1, nodes: moveNode(d.layout?.nodes ?? [], selectedId, pos.parent?.id ?? null, dir > 0 ? to + 1 : to) } }));
  }, [selectedId, nodes, apply]);

  const renameNode = useCallback((oldId: string, newId: string) => {
    apply((d) => ({ ...d, layout: { version: 1, nodes: updateNode(d.layout?.nodes ?? [], oldId, (n) => ({ ...n, id: newId })) } }));
    setSelectedId(newId);
  }, [apply, setSelectedId]);

  const addChild = useCallback((type: "column" | "tab") => {
    if (!selectedId) return;
    addNode(type, { parentId: selectedId });
  }, [selectedId, addNode]);

  return { selected, insertionPoint, addNode, addComponent, placeItem, addColumnItem, handleDrop, deleteSelected, duplicateSelected, moveSelected, renameNode, addChild };
}
