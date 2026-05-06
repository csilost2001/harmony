/**
 * canvas ↔ screen-items 双方向同期。
 *
 * - component:add → screen-items に自動登録 (重複 no-op)
 * - component:remove → screen-items から自動削除
 * - reconcileScreenItems → ロード後の canvas 全件 ↔ screen-items 差分適用 (追加のみ)
 *
 * ロード中ガード: isInternalLoadRef.current === true の間は add/remove を無視する。
 * 操作シリアライズ: per-screen の Promise チェーンで read→modify→write を直列化し
 * 競合を防ぐ。
 *
 * reconcile は canvas に存在する items を screen-items に追加するのみ。
 * canvas にない items は削除しない (entity.items[] の定義はユーザーの権限)。
 */
import type { Editor as GEditor, Component } from "grapesjs";
import type { FieldType, Identifier } from "../types/v3";
import { loadScreenItems, saveScreenItems } from "../store/screenItemsStore";
import { isNamableElement, walk } from "./dataItemId";

// ── 操作シリアライズキュー ──────────────────────────────────────────────────

const opQueues = new Map<string, Promise<void>>();

function enqueue(screenId: string, op: () => Promise<void>): void {
  const prev = opQueues.get(screenId) ?? Promise.resolve();
  opQueues.set(screenId, prev.then(op).catch(console.error));
}

// ── 型推定 ──────────────────────────────────────────────────────────────────

const BLOCK_TYPE_TO_FIELD_TYPE: Record<string, FieldType> = {
  "validation-input": "string",
  "validation-select": "string",
  "validation-textarea": "string",
  "checkbox": "boolean",
};

function inferScreenItemType(cmp: Component): FieldType {
  const customType = cmp.get("type") as string | undefined;
  if (customType && BLOCK_TYPE_TO_FIELD_TYPE[customType]) {
    return BLOCK_TYPE_TO_FIELD_TYPE[customType];
  }
  const inputType = String(cmp.getAttributes()["type"] ?? "");
  if (inputType === "number" || inputType === "range") return "number";
  if (inputType === "date") return "date";
  if (inputType === "checkbox") return "boolean";
  return "string";
}

// ── ID 収集 ─────────────────────────────────────────────────────────────────

function collectIds(root: Component): Map<string, Component> {
  const ids = new Map<string, Component>();
  walk(root, (c) => {
    if (!isNamableElement(c)) return;
    const id = String(c.getAttributes()["id"] ?? c.getAttributes()["name"] ?? "");
    if (id) ids.set(id, c);
  });
  return ids;
}

// ── 公開 API ────────────────────────────────────────────────────────────────

/** ブロック追加時: screen-items に存在しない項目を登録する */
function syncAddComponent(screenId: string, cmp: Component): void {
  const toAdd: Array<{ id: string; cmp: Component }> = [];
  walk(cmp, (c) => {
    if (!isNamableElement(c)) return;
    const id = String(c.getAttributes()["id"] ?? c.getAttributes()["name"] ?? "");
    if (id) toAdd.push({ id, cmp: c });
  });
  if (toAdd.length === 0) return;

  enqueue(screenId, async () => {
    const file = await loadScreenItems(screenId);
    let changed = false;
    for (const { id, cmp: c } of toAdd) {
      if (file.items.some((i) => i.id === id)) continue;
      file.items.push({ id: id as Identifier, label: "", type: inferScreenItemType(c) });
      changed = true;
    }
    if (changed) await saveScreenItems(file);
  });
}

/** ブロック削除時: screen-items から該当項目を削除する */
function syncRemoveComponent(screenId: string, cmp: Component): void {
  const toRemove = new Set<string>();
  walk(cmp, (c) => {
    if (!isNamableElement(c)) return;
    const id = String(c.getAttributes()["id"] ?? c.getAttributes()["name"] ?? "");
    if (id) toRemove.add(id);
  });
  if (toRemove.size === 0) return;

  enqueue(screenId, async () => {
    const file = await loadScreenItems(screenId);
    const before = file.items.length;
    file.items = file.items.filter((i) => !toRemove.has(i.id));
    if (file.items.length !== before) await saveScreenItems(file);
  });
}

/**
 * ロード後の canvas ↔ screen-items 突合。
 * isInternalLoadRef が false になった直後 (onReady の setTimeout 内) に呼ぶ。
 * canvas にある items を screen-items に追加するのみ (削除しない)。
 */
export function reconcileScreenItems(editor: GEditor, screenId: string): void {
  const wrapper = editor.getWrapper();
  if (!wrapper) return;

  const canvasIds = collectIds(wrapper);

  enqueue(screenId, async () => {
    const file = await loadScreenItems(screenId);
    let changed = false;

    // canvas にあって screen-items にない → 追加のみ
    for (const [id, cmp] of canvasIds) {
      if (!file.items.some((i) => i.id === id)) {
        file.items.push({ id: id as Identifier, label: "", type: inferScreenItemType(cmp) });
        changed = true;
      }
    }

    if (changed) await saveScreenItems(file);
  });
}

/**
 * GrapesJS editor に canvas ↔ screen-items 同期ハンドラを登録する。
 * @returns unsubscribe 関数
 */
export function attachScreenItemsSync(
  editor: GEditor,
  screenId: string,
  isInternalLoadRef: { current: boolean },
): () => void {
  const onAdd = (cmp: Component) => {
    if (isInternalLoadRef.current) return;
    syncAddComponent(screenId, cmp);
  };
  const onRemove = (cmp: Component) => {
    if (isInternalLoadRef.current) return;
    syncRemoveComponent(screenId, cmp);
  };

  editor.on("component:add", onAdd);
  editor.on("component:remove", onRemove);

  return () => {
    editor.off("component:add", onAdd);
    editor.off("component:remove", onRemove);
  };
}
