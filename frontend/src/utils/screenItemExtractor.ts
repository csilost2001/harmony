/**
 * 画面 (GrapesJS JSON) からフォーム要素を走査し、画面項目定義の候補として抽出する。
 * #323 / #318 ユーザーフィードバックへの対応 — 既存画面をモーダルで参照して
 * チェックボックス選択で項目を一括追加する UX を支える。
 *
 * GrapesJS の JSON 構造:
 *   pages[].frames[].component.components  —  char 配列 (joined = 生 HTML) または
 *                                              ネスト構造化コンポーネント
 * ここでは出てくる全ての文字列断片を再帰的に連結して 1 つの HTML にし、
 * ブラウザの DOMParser で input/select/textarea を抽出する。
 */
import type { FieldType } from "../types/v3";

export interface ExtractedCandidate {
  /** 元 HTML 要素の outerHTML (モーダルで表示するプレビュー用) */
  elementHtml: string;
  /** GrapesJS 側で発番された data-item-id (#322)。ScreenItem.id として使う */
  dataItemId?: string;
  /** HTML name 属性 (なければ placeholder ベースの推測) */
  name: string;
  /** label 推定 (nearby <label> or placeholder or name) */
  label: string;
  /** 推定型 */
  type: FieldType;
  /** HTML required 属性 */
  required?: boolean;
  /** HTML pattern 属性 */
  pattern?: string;
  /** HTML maxlength 属性 */
  maxLength?: number;
  /** HTML minlength 属性 */
  minLength?: number;
  /** HTML placeholder 属性 */
  placeholder?: string;
  /** 元タグ種別 (input / select / textarea) */
  tag: string;
}

const VOID_TAGS = new Set([
  "area","base","br","col","embed","hr","img","input",
  "link","meta","param","source","track","wbr",
]);

/** GrapesJS カスタムコンポーネントタイプ → HTML タグ名のマッピング。
 *  デザイナーで D&D したブロックは tagName を持たず type で識別される。 */
const CUSTOM_TYPE_TO_TAG: Record<string, string> = {
  "validation-input": "input",
  "validation-select": "select",
  "validation-textarea": "textarea",
  "checkbox": "input",
};

/** GrapesJS JSON から HTML を再構築して buf に追加。
 *  2 形式に対応:
 *  - seed / 旧形式: components が raw HTML 文字列 (または char 配列)
 *  - GrapesJS 保存形式: components が { tagName, attributes, classes, components[] } の構造化 JSON
 *  - GrapesJS カスタムタイプ: tagName なし、type でブロック種別を示す */
function gatherHtml(node: unknown, buf: string[]): void {
  if (typeof node === "string") {
    buf.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) gatherHtml(item, buf);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;

    // テキストノード
    if (obj.type === "textnode" && typeof obj.content === "string") {
      buf.push(obj.content);
      return;
    }

    // 構造化 GrapesJS コンポーネント。
    // tagName が無い場合はカスタムタイプ名から HTML タグを推定する。
    const tagName = typeof obj.tagName === "string"
      ? obj.tagName
      : (typeof obj.type === "string" ? (CUSTOM_TYPE_TO_TAG[obj.type] ?? null) : null);
    if (tagName) {
      let attrStr = "";
      // attributes オブジェクト
      if (obj.attributes && typeof obj.attributes === "object") {
        for (const [k, v] of Object.entries(obj.attributes as Record<string, unknown>)) {
          attrStr += ` ${k}="${String(v).replace(/"/g, "&quot;")}"`;
        }
      }
      // classes 配列 → class 属性
      if (Array.isArray(obj.classes) && obj.classes.length > 0) {
        const names = (obj.classes as Array<string | { id?: string; label?: string }>)
          .map((c) => (typeof c === "string" ? c : (c.id ?? c.label ?? "")))
          .filter(Boolean)
          .join(" ");
        if (names) attrStr += ` class="${names}"`;
      }
      if (VOID_TAGS.has(tagName.toLowerCase()) || obj.void === true) {
        buf.push(`<${tagName}${attrStr}>`);
      } else {
        buf.push(`<${tagName}${attrStr}>`);
        if (typeof obj.content === "string") buf.push(obj.content);
        if (obj.components) gatherHtml(obj.components, buf);
        buf.push(`</${tagName}>`);
      }
      return;
    }

    // コンテナ (pages / frames / component / wrapper など tagName なし)
    if ("components" in obj) gatherHtml(obj.components, buf);
    if ("pages" in obj) gatherHtml(obj.pages, buf);
    if ("frames" in obj) gatherHtml(obj.frames, buf);
    if ("component" in obj) gatherHtml(obj.component, buf);
  }
}

function inferType(tag: string, typeAttr: string): FieldType {
  if (tag === "textarea") return "string";
  if (tag === "select") return "string";
  // input の type 属性で判別
  switch (typeAttr) {
    case "number":
    case "range":
      return "number";
    case "checkbox":
    case "radio":
      return "boolean";
    case "date":
    case "datetime-local":
    case "month":
    case "week":
    case "time":
      return "date";
    default:
      return "string";
  }
}

/** input/select/textarea の直近 <label> を探す (for 属性一致 or 祖先ラップ) */
function findNearbyLabel(el: Element): string | null {
  const id = el.getAttribute("id");
  if (id) {
    const lbl = el.ownerDocument?.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  // 祖先の <label>
  let p: Element | null = el.parentElement;
  while (p) {
    if (p.tagName.toLowerCase() === "label") {
      return p.textContent?.replace(/\s+/g, " ").trim() ?? null;
    }
    p = p.parentElement;
  }
  // 直前兄弟の <label>
  const prev = el.previousElementSibling;
  if (prev?.tagName.toLowerCase() === "label") {
    return prev.textContent?.trim() ?? null;
  }
  return null;
}

function parseIntOrUndefined(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * GrapesJS 画面 JSON から input/select/textarea 要素を抽出。
 * DOMParser を使うためブラウザ環境でのみ動作 (node 環境は jsdom 要)。
 */
export function extractScreenItemCandidates(screenData: unknown): ExtractedCandidate[] {
  const buf: string[] = [];
  gatherHtml(screenData, buf);
  const html = buf.join("");
  if (!html) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const candidates: ExtractedCandidate[] = [];

  for (const el of doc.querySelectorAll("input, select, textarea")) {
    const tag = el.tagName.toLowerCase();
    const typeAttr = (el.getAttribute("type") || "text").toLowerCase();
    // button / submit / reset / hidden は除外
    if (tag === "input" && ["button", "submit", "reset", "hidden"].includes(typeAttr)) continue;

    const name = el.getAttribute("name") || "";
    const placeholder = el.getAttribute("placeholder") || "";
    const label = findNearbyLabel(el) || placeholder || name || `(${tag})`;
    const type = inferType(tag, typeAttr);

    candidates.push({
      elementHtml: (el as HTMLElement).outerHTML.slice(0, 300),
      dataItemId: el.getAttribute("data-item-id") || undefined,
      name,
      label,
      type,
      required: el.hasAttribute("required") || undefined,
      pattern: el.getAttribute("pattern") || undefined,
      maxLength: parseIntOrUndefined(el.getAttribute("maxlength")),
      minLength: parseIntOrUndefined(el.getAttribute("minlength")),
      placeholder: placeholder || undefined,
      tag,
    });
  }

  return candidates;
}
