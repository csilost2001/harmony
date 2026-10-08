/**
 * canvas ↔ screen-items 双方向同期。
 *
 * - component:add → screen-items に自動登録 (重複 no-op)
 * - component:remove → screen-items から自動削除
 *
 * 項目 ID として採用するのは設計者 (または追加時の自動発番) が明示した
 * `data-item-id` / `name` のみ。GrapesJS が内部で付与する `id` (例: `imyus6`) は採用しない。
 * ロード・再読込では原本を書き換えない (明示保存モデル)。過去に存在した
 * ロード時の自動突合 (reconcile) は、開くだけで項目定義を汚染したため廃止した。
 *
 * ロード中ガード: isInternalLoadRef.current === true の間は add/remove を無視する。
 * 操作シリアライズ: per-screen の Promise チェーンで read→modify→write を直列化し
 * 競合を防ぐ。
 *
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

// ── ID 判定 ─────────────────────────────────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 明示された項目 ID を返す。data-item-id (UUID 以外) → name の順。GrapesJS 内部 id は使わない。 */
export function explicitItemId(cmp: Component): string {
  const attrs = cmp.getAttributes() ?? {};
  const dataItemId = String(attrs["data-item-id"] ?? "");
  if (dataItemId && !UUID_PATTERN.test(dataItemId)) return dataItemId;
  return String(attrs["name"] ?? "");
}

// ── 公開 API ────────────────────────────────────────────────────────────────

/** ブロック追加時: screen-items に存在しない項目を登録する */
function syncAddComponent(screenId: string, cmp: Component): void {
  const toAdd: Array<{ id: string; cmp: Component }> = [];
  walk(cmp, (c) => {
    if (!isNamableElement(c)) return;
    const id = explicitItemId(c);
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
    const id = explicitItemId(c);
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
 * GrapesJS editor に canvas ↔ screen-items 同期ハンドラを登録する。
 * @returns unsubscribe 関数
 */
export function attachScreenItemsSync(
  editor: GEditor,
  screenId: string,
  isInternalLoadRef: { current: boolean },
  isReadonlyRef?: { current: boolean },
): () => void {
  // 原本を書き換えてよいのは、利用者が編集中にブロックを追加・削除した時だけ。
  // - ロード / 再読込中 (isInternalLoadRef) は無視
  // - 閲覧中 (isReadonlyRef) は無視 (開いただけで原本を変えない)
  // - エディタ破棄中 (タブを閉じる・旧デザイナから切り替える) は全部品の除去イベントが出るため無視
  let destroying = false;
  const blocked = () => destroying || isInternalLoadRef.current || !!isReadonlyRef?.current;
  const onAdd = (cmp: Component) => {
    if (blocked()) return;
    syncAddComponent(screenId, cmp);
  };
  const onRemove = (cmp: Component) => {
    if (blocked()) return;
    syncRemoveComponent(screenId, cmp);
  };
  const onDestroy = () => { destroying = true; };

  editor.on("component:add", onAdd);
  editor.on("component:remove", onRemove);
  editor.on("destroy", onDestroy);

  return () => {
    destroying = true;
    editor.off("component:add", onAdd);
    editor.off("component:remove", onRemove);
    editor.off("destroy", onDestroy);
  };
}
