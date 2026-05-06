/**
 * GrapesJS 画面デザイナーで input/select/textarea/button 要素に `data-item-id` を
 * 自動発番するフック (#322)。
 *
 * 画面項目定義 (#318) の ScreenItem.id と画面 DOM 要素を紐付けるキーとなる。
 * ScreenItemsView の候補抽出モーダル (#323) が data-item-id を読み取って
 * ScreenItem.id として採用することで、同じ要素に対する再抽出がべき等になる。
 *
 * 発番戦略:
 * - component:add: 新規追加 (ブロック drop / カスタムブロック挿入) 時に
 *   対象要素で data-item-id 未設定なら UUID を、name/id 未設定なら 種別+連番 を発番
 * - 子孫コンポーネントも再帰的にチェック (ブロックが input を内包するケース)
 * - 既存画面の未発番要素は load 後に自動付与しない (dirty 化を避けるため)
 *   → 必要なら別コマンド (Follow-up) で一括付与を提供
 */
import type { Editor as GEditor, Component } from "grapesjs";
import { generateUUID } from "../utils/uuid";
import { generateAutoId } from "../utils/screenItemNaming";

const NAMABLE_TAGS = new Set(["input", "select", "textarea", "button"]);
const EXCLUDED_INPUT_TYPES = new Set(["button", "submit", "reset", "hidden", "image"]);

export function isNamableElement(cmp: Component): boolean {
  const tag = String(cmp.get("tagName") ?? "").toLowerCase();
  if (!NAMABLE_TAGS.has(tag)) return false;
  if (tag === "input") {
    const attrs = cmp.getAttributes() ?? {};
    const t = String(attrs.type ?? "text").toLowerCase();
    if (EXCLUDED_INPUT_TYPES.has(t)) return false;
  }
  return true;
}

/**
 * コンポーネントの tagName + type 属性から命名プレフィックスを返す。
 * 例: `<input type="text">` → `"textInput"`, `<button>` → `"button"`
 */
export function getItemIdPrefix(cmp: Component): string {
  const tag = String(cmp.get("tagName") ?? "").toLowerCase();
  const attrs = cmp.getAttributes() ?? {};
  const type = String(attrs.type ?? "text").toLowerCase();

  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (tag === "button") return "button";

  // input
  switch (type) {
    case "text": return "textInput";
    case "password": return "passwordInput";
    case "number": case "range": return "numberInput";
    case "date": return "dateInput";
    case "datetime-local": return "datetimeInput";
    case "time": return "timeInput";
    case "month": return "monthInput";
    case "week": return "weekInput";
    case "email": return "emailInput";
    case "tel": return "telInput";
    case "url": return "urlInput";
    case "file": return "fileInput";
    case "checkbox": return "checkbox";
    case "radio": return "radio";
    default: return "textInput";
  }
}

/** component とその子孫を再帰走査 */
export function walk(cmp: Component, visit: (c: Component) => void): void {
  visit(cmp);
  const children = cmp.components?.();
  if (children) {
    children.forEach((c: Component) => walk(c, visit));
  }
}

/** 画面内の全 name 属性値を収集して返す (reset 時の generateAutoId 用) */
export function getExistingNamesFromEditor(editor: GEditor): string[] {
  const wrapper = editor.getWrapper();
  if (!wrapper) return [];
  const existing: string[] = [];
  walk(wrapper, (c) => {
    const nameVal = String(c.getAttributes?.()?.name ?? "");
    if (nameVal) existing.push(nameVal);
  });
  return existing;
}

function nextItemId(prefix: string, editor: GEditor): string {
  return generateAutoId(prefix, getExistingNamesFromEditor(editor));
}

/**
 * 対象要素に data-item-id / name / id を一括で付与する。
 * 既に値がある属性は絶対に上書きしない。
 * editor が渡された場合は種別+連番形式 (#331)、なければ UUID ベースのフォールバック。
 * @returns 何か 1 つ以上付与した場合 true
 */
export function ensureFormFieldIdentity(cmp: Component, editor?: GEditor): boolean {
  if (!isNamableElement(cmp)) return false;
  const attrs = cmp.getAttributes() ?? {};
  const patch: Record<string, string> = {};

  if (!attrs["data-item-id"]) {
    patch["data-item-id"] = generateUUID();
  }

  if (!attrs.name) {
    if (editor) {
      patch.name = nextItemId(getItemIdPrefix(cmp), editor);
    } else {
      const dataItemId = (patch["data-item-id"] ?? String(attrs["data-item-id"])) as string;
      const shortId = dataItemId.split("-")[0];
      patch.name = `field_${shortId}`;
    }
  }
  if (!attrs.id) {
    patch.id = (patch.name ?? String(attrs.name)) as string;
  }

  if (Object.keys(patch).length === 0) return false;
  cmp.addAttributes(patch);
  return true;
}

/**
 * GrapesJS editor にフックを張って新規要素に data-item-id / name を発番する。
 * @returns unsubscribe 関数
 */
export function attachDataItemIdAutoAssign(editor: GEditor): () => void {
  const onAdd = (cmp: Component) => {
    walk(cmp, (c) => { ensureFormFieldIdentity(c, editor); });
  };
  editor.on("component:add", onAdd);

  return () => {
    editor.off("component:add", onAdd);
  };
}

/**
 * 画面全体をスキャンして未発番の要素に data-item-id / name を一括発番する。
 * ScreenItemsView の「画面デザインから追加」モーダル等、明示的なユーザー操作
 * から呼び出す想定 (load 時の自動実行はしない)。
 *
 * @returns 発番した要素数
 */
export function assignAllMissingDataItemIds(editor: GEditor): number {
  const wrapper = editor.getWrapper();
  if (!wrapper) return 0;
  let count = 0;
  walk(wrapper, (c) => {
    if (ensureFormFieldIdentity(c, editor)) count++;
  });
  return count;
}
