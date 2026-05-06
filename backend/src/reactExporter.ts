/**
 * reactExporter.ts
 * HTML → React TSX コンポーネント変換器
 * htmlparser2 を使用して DOM ツリーを走査し JSX に変換する
 */
import { parseDocument } from "htmlparser2";

// ─── Internal node types (matches domhandler structure) ──────────────────────

interface NodeBase {
  type: string;
}

interface ElemNode extends NodeBase {
  type: "tag" | "script" | "style";
  name: string;
  attribs: Record<string, string>;
  children: NodeBase[];
}

interface TextNode extends NodeBase {
  type: "text";
  data: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** 自己閉じタグにする HTML ボイド要素 */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** HTML 属性 → JSX プロパティ名の変換テーブル */
const ATTR_RENAME: Record<string, string> = {
  class:            "className",
  for:              "htmlFor",
  tabindex:         "tabIndex",
  readonly:         "readOnly",
  maxlength:        "maxLength",
  minlength:        "minLength",
  colspan:          "colSpan",
  rowspan:          "rowSpan",
  cellpadding:      "cellPadding",
  cellspacing:      "cellSpacing",
  crossorigin:      "crossOrigin",
  autofocus:        "autoFocus",
  autoplay:         "autoPlay",
  contenteditable:  "contentEditable",
  novalidate:       "noValidate",
  autocomplete:     "autoComplete",
  accesskey:        "accessKey",
  enctype:          "encType",
  usemap:           "useMap",
  frameborder:      "frameBorder",
  allowfullscreen:  "allowFullScreen",
  spellcheck:       "spellCheck",
  draggable:        "draggable",
};

/** インラインイベントハンドラ → JSX イベントプロップ */
const EVENT_HANDLERS: Record<string, { prop: string; handler: string }> = {
  onclick:       { prop: "onClick",        handler: "() => { /* TODO */ }" },
  ondblclick:    { prop: "onDoubleClick",  handler: "() => { /* TODO */ }" },
  onchange:      { prop: "onChange",       handler: "(e) => { /* TODO */ }" },
  onsubmit:      { prop: "onSubmit",       handler: "(e) => { e.preventDefault(); /* TODO */ }" },
  oninput:       { prop: "onInput",        handler: "(e) => { /* TODO */ }" },
  onblur:        { prop: "onBlur",         handler: "(e) => { /* TODO */ }" },
  onfocus:       { prop: "onFocus",        handler: "(e) => { /* TODO */ }" },
  onkeydown:     { prop: "onKeyDown",      handler: "(e) => { /* TODO */ }" },
  onkeyup:       { prop: "onKeyUp",        handler: "(e) => { /* TODO */ }" },
  onkeypress:    { prop: "onKeyPress",     handler: "(e) => { /* TODO */ }" },
  onmouseenter:  { prop: "onMouseEnter",   handler: "() => { /* TODO */ }" },
  onmouseleave:  { prop: "onMouseLeave",   handler: "() => { /* TODO */ }" },
  onmousedown:   { prop: "onMouseDown",    handler: "(e) => { /* TODO */ }" },
  onmouseup:     { prop: "onMouseUp",      handler: "(e) => { /* TODO */ }" },
};

// ─── Type guards ─────────────────────────────────────────────────────────────

function isElem(n: NodeBase): n is ElemNode {
  return n.type === "tag" || n.type === "script" || n.type === "style";
}

function isText(n: NodeBase): n is TextNode {
  return n.type === "text";
}

// ─── Style converter ─────────────────────────────────────────────────────────

/**
 * "color: red; font-size: 14px" → {{ color: 'red', fontSize: '14px' }}
 */
function styleToJsx(style: string): string {
  const pairs = style
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx === -1) return null;
      const prop = pair.slice(0, idx).trim();
      const val  = pair.slice(idx + 1).trim();
      // CSS カスタムプロパティ (--xxx) はそのまま、それ以外は camelCase 化
      const jsProp = prop.startsWith("--")
        ? prop
        : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      return `${jsProp}: '${val.replace(/'/g, "\\'")}'`;
    })
    .filter((x): x is string => x !== null);

  return `{{ ${pairs.join(", ")} }}`;
}

// ─── Attribute converter ──────────────────────────────────────────────────────

function attribsToJsx(attribs: Record<string, string>): string[] {
  const parts: string[] = [];

  for (const [name, value] of Object.entries(attribs)) {
    // イベントハンドラ
    if (name in EVENT_HANDLERS) {
      const { prop, handler } = EVENT_HANDLERS[name];
      parts.push(`${prop}={${handler}}`);
      continue;
    }

    // style 属性
    if (name === "style" && value) {
      parts.push(`style=${styleToJsx(value)}`);
      continue;
    }

    // 属性名のリネーム
    const jsxName = ATTR_RENAME[name] ?? name;

    // ブール属性（値なし）
    if (value === "") {
      parts.push(jsxName);
    } else {
      parts.push(`${jsxName}="${value.replace(/"/g, "&quot;")}"`);
    }
  }

  return parts;
}

// ─── Node → JSX lines ────────────────────────────────────────────────────────

function nodeToLines(node: NodeBase, indent: string, warnings: string[]): string[] {
  // コメントノードはスキップ
  if (node.type === "comment") return [];

  // テキストノード
  if (isText(node)) {
    const text = node.data.replace(/\s+/g, " ").trim();
    if (!text) return [];
    // { } を含む場合は JSX 式として wrap
    return text.includes("{") || text.includes("}")
      ? [`${indent}{${JSON.stringify(text)}}`]
      : [`${indent}${text}`];
  }

  if (!isElem(node)) return [];

  const tag      = node.name.toLowerCase();
  const attrParts = attribsToJsx(node.attribs ?? {});
  const attrStr   = attrParts.length ? " " + attrParts.join(" ") : "";

  // void 要素 → 自己閉じタグ
  if (VOID_ELEMENTS.has(tag)) {
    return [`${indent}<${tag}${attrStr} />`];
  }

  // 子要素を再帰変換
  const childIndent = indent + "  ";
  const childLines: string[] = [];
  for (const child of node.children ?? []) {
    childLines.push(...nodeToLines(child, childIndent, warnings));
  }

  // 子なし
  if (childLines.length === 0) {
    return [`${indent}<${tag}${attrStr}></${tag}>`];
  }

  // 短い一行子の場合はワンライナー
  if (childLines.length === 1 && !childLines[0].includes("\n")) {
    const inner = childLines[0].trim();
    const oneLiner = `${indent}<${tag}${attrStr}>${inner}</${tag}>`;
    if (oneLiner.length <= 100) return [oneLiner];
  }

  return [`${indent}<${tag}${attrStr}>`, ...childLines, `${indent}</${tag}>`];
}

// ─── Props inference ──────────────────────────────────────────────────────────

interface FieldInfo {
  name: string;
  inputType: string;
  tagName: string;
}

function collectFields(nodes: NodeBase[]): FieldInfo[] {
  const fields: FieldInfo[] = [];
  function walk(n: NodeBase) {
    if (!isElem(n)) return;
    if (["input", "select", "textarea"].includes(n.name) && n.attribs?.name) {
      fields.push({
        name: n.attribs.name,
        inputType: n.attribs.type ?? "text",
        tagName: n.name,
      });
    }
    (n.children ?? []).forEach(walk);
  }
  nodes.forEach(walk);
  return fields;
}

function hasFormElement(nodes: NodeBase[]): boolean {
  function walk(n: NodeBase): boolean {
    if (!isElem(n)) return false;
    return n.name === "form" || (n.children ?? []).some(walk);
  }
  return nodes.some(walk);
}

function fieldToTs(f: FieldInfo): string {
  if (f.tagName === "select" || f.tagName === "textarea") return "string";
  const t = f.inputType.toLowerCase();
  if (t === "number" || t === "range") return "number";
  if (t === "checkbox" || t === "radio") return "boolean";
  return "string";
}

function toCamelCase(s: string): string {
  return s.replace(/[-_]([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ExportResult {
  code: string;
  warnings: string[];
}

/**
 * HTML 文字列を React TSX コンポーネントコードに変換する
 * @param html       GrapesJS の editor.getHtml() 出力
 * @param componentName  生成するコンポーネント名（PascalCase）
 */
export function htmlToReact(html: string, componentName: string): ExportResult {
  const warnings: string[] = [];

  const doc = parseDocument(html, { decodeEntities: false }) as unknown as {
    children: NodeBase[];
  };

  // 空白のみのテキストノードをルートから除去
  const roots = doc.children.filter(
    (n) => !(isText(n) && !n.data.trim())
  );

  // フォームフィールドから Props インターフェースを推定
  const fields   = collectFields(roots);
  const withForm = hasFormElement(roots);
  const seen     = new Set<string>();
  const propLines: string[] = [];

  for (const f of fields) {
    const propName = toCamelCase(f.name);
    if (seen.has(propName)) continue;
    seen.add(propName);
    propLines.push(`  ${propName}?: ${fieldToTs(f)};`);
  }
  if (withForm) {
    propLines.push("  onSubmit?: (data: FormData) => void;");
  }

  // JSX 本体（return 内、ベースインデント 4 スペース）
  const BASE = "    ";
  const jsxLines: string[] = [];
  for (const n of roots) {
    jsxLines.push(...nodeToLines(n, BASE, warnings));
  }

  let jsxBody: string;
  if (jsxLines.length === 0) {
    jsxBody = `${BASE}<></>`;
  } else if (jsxLines.length === 1) {
    jsxBody = jsxLines[0];
  } else {
    jsxBody = [`${BASE}<>`, ...jsxLines, `${BASE}</>`].join("\n");
  }

  // Props インターフェース
  const propsInterface =
    propLines.length > 0
      ? `interface ${componentName}Props {\n${propLines.join("\n")}\n}\n`
      : `type ${componentName}Props = Record<string, never>;\n`;

  const code = [
    "import React from 'react';",
    "",
    propsInterface,
    `// prettier-ignore`,
    `export const ${componentName}: React.FC<${componentName}Props> = (_props: ${componentName}Props) => {`,
    "  return (",
    jsxBody,
    "  );",
    "};",
    "",
    `export default ${componentName};`,
  ].join("\n");

  return { code, warnings };
}

/**
 * 日本語などの非 ASCII を除いた PascalCase コンポーネント名に変換
 * ASCII 文字がなければ "ScreenComponent" を返す
 */
export function toPascalCase(str: string): string {
  const ascii = str.replace(/[^\x00-\x7F]/g, "");
  if (!ascii.trim()) return "ScreenComponent";
  return ascii
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}
