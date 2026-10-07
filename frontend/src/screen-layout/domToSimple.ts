/**
 * ブラウザの DOM (DOMParser の結果) を designToLayout の入力形式 (SimpleNode) に変換する。
 * backend / スクリプトでは htmlparser2 で同等の変換を行う (scripts/dev/convert-screens-to-layout.mjs)。
 */
import type { SimpleNode } from "@harmony/shared";

export function domToSimple(node: Node): SimpleNode | null {
  if (node.nodeType === Node.TEXT_NODE) return { kind: "text", text: node.textContent ?? "" };
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name.toLowerCase()] = a.value;
  return {
    kind: "el",
    tag: el.tagName.toLowerCase(),
    attrs,
    children: Array.from(el.childNodes).map(domToSimple).filter((c): c is SimpleNode => c !== null),
    outerHTML: el.outerHTML,
  };
}

/** HTML 文字列を SimpleNode の配列にする */
export function htmlToSimple(html: string): SimpleNode[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return Array.from(doc.body.childNodes).map(domToSimple).filter((c): c is SimpleNode => c !== null);
}
