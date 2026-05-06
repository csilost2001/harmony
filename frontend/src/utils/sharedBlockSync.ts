/**
 * sharedBlockSync.ts
 * 共有ブロックを全画面に反映するユーティリティ
 *
 * 保存時に付与した data-shared-block-id 属性を手がかりに、
 * 全デザイン済み画面の JSON を走査・置換する。
 */
import { mcpBridge } from "../mcp/mcpBridge";
import { loadProject } from "../store/flowStore";

export interface SyncResult {
  screenId: string;
  screenName: string;
  replaced: number;
  error?: string;
}

/** デザイン済み画面の一覧を返す（反映対象プレビュー用） */
export async function getDesignedScreens(): Promise<Array<{ id: string; name: string }>> {
  const project = await loadProject();
  return project.screens.filter((s) => s.hasDesign).map((s) => ({ id: s.id, name: s.name }));
}

/**
 * 指定ブロックの新しい HTML を全デザイン済み画面に反映する。
 * mcpBridge 経由で各画面の JSON を取得・更新・保存する。
 */
export async function propagateSharedBlock(
  blockId: string,
  newHtml: string,
): Promise<SyncResult[]> {
  if (mcpBridge.getStatus() !== "connected") {
    throw new Error("MCP サーバーに接続されていません。反映を実行できません。");
  }

  const project = await loadProject();
  const designedScreens = project.screens.filter((s) => s.hasDesign);
  const results: SyncResult[] = [];

  for (const screen of designedScreens) {
    try {
      const data = await mcpBridge.request("loadScreen", { screenId: screen.id });
      const { data: updated, count } = deepReplace(data, blockId, newHtml, 0);

      if (count > 0) {
        await mcpBridge.request("saveScreen", { screenId: screen.id, data: updated });
      }

      results.push({ screenId: screen.id, screenName: screen.name, replaced: count });
    } catch (e) {
      results.push({
        screenId: screen.id,
        screenName: screen.name,
        replaced: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}

// ── 内部実装 ──────────────────────────────────────────────────────────────────

/**
 * GrapesJS の JSON データを再帰的に走査し、
 * 指定ブロック ID を持つ要素を newHtml で置換する。
 *
 * - components が文字列（HTML）の場合: DOMParser で置換
 * - components が配列（コンポーネント JSON）の場合: JSON 走査で置換
 */
function deepReplace(
  data: unknown,
  blockId: string,
  newHtml: string,
  depth: number,
): { data: unknown; count: number } {
  if (depth > 40) return { data, count: 0 };

  // HTML 文字列
  if (typeof data === "string") {
    if (!data.includes(`data-shared-block-id="${blockId}"`)) {
      return { data, count: 0 };
    }
    const { html, count } = replaceInHtmlString(data, blockId, newHtml);
    return { data: html, count };
  }

  // コンポーネント配列
  if (Array.isArray(data)) {
    let total = 0;
    const result: unknown[] = [];
    for (const item of data) {
      if (isGjsComponentWithSharedId(item, blockId)) {
        result.push(htmlToGjsComponent(newHtml));
        total++;
      } else {
        const { data: newItem, count } = deepReplace(item, blockId, newHtml, depth + 1);
        result.push(newItem);
        total += count;
      }
    }
    return { data: result, count: total };
  }

  // オブジェクト: 全キーを再帰
  if (data !== null && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    let total = 0;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const { data: newVal, count } = deepReplace(obj[key], blockId, newHtml, depth + 1);
      result[key] = newVal;
      total += count;
    }
    return { data: result, count: total };
  }

  return { data, count: 0 };
}

/** GrapesJS コンポーネント JSON が指定ブロック ID を持つか判定 */
function isGjsComponentWithSharedId(item: unknown, blockId: string): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const comp = item as Record<string, unknown>;
  const attrs = comp.attributes as Record<string, string> | undefined;
  return attrs?.["data-shared-block-id"] === blockId;
}

/** HTML 文字列中の共有ブロック要素を置換 */
function replaceInHtmlString(
  html: string,
  blockId: string,
  newHtml: string,
): { html: string; count: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const escapedId = CSS.escape(blockId);
  const targets = Array.from(doc.querySelectorAll(`[data-shared-block-id="${escapedId}"]`));

  if (targets.length === 0) return { html, count: 0 };

  for (const el of targets) {
    const temp = doc.createElement("div");
    temp.innerHTML = newHtml;
    const replacement = temp.firstElementChild;
    if (replacement) {
      el.replaceWith(replacement.cloneNode(true));
    }
  }

  return { html: doc.body.innerHTML, count: targets.length };
}

/** HTML 文字列を GrapesJS コンポーネント JSON に変換 */
function htmlToGjsComponent(html: string): Record<string, unknown> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const root = doc.body.firstElementChild;
  if (root) return elementToGjsComponent(root);
  return { type: "textnode", content: html };
}

function elementToGjsComponent(el: Element): Record<string, unknown> {
  const comp: Record<string, unknown> = {
    tagName: el.tagName.toLowerCase(),
  };

  const classes = Array.from(el.classList);
  if (classes.length > 0) comp.classes = classes;

  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name !== "class" && attr.name !== "style") {
      attrs[attr.name] = attr.value;
    }
  }
  if (Object.keys(attrs).length > 0) comp.attributes = attrs;

  const styleStr = el.getAttribute("style");
  if (styleStr) {
    const style: Record<string, string> = {};
    for (const part of styleStr.split(";")) {
      const colonIdx = part.indexOf(":");
      if (colonIdx > 0) {
        const k = part.slice(0, colonIdx).trim();
        const v = part.slice(colonIdx + 1).trim();
        if (k && v) style[k] = v;
      }
    }
    if (Object.keys(style).length > 0) comp.style = style;
  }

  const children: unknown[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text.trim()) children.push({ type: "textnode", content: text });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      children.push(elementToGjsComponent(child as Element));
    }
  }
  if (children.length > 0) comp.components = children;

  return comp;
}
