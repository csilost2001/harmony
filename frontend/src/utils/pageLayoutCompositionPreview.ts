/**
 * pageLayoutCompositionPreview — PageLayout GrapesJS region へ gadget preview を inject する
 * ユーティリティ (pl-5, #1026)
 *
 * 動作概要:
 *   1. GrapesJS canvas iframe 内で `[data-region-name]` 要素を列挙する
 *   2. PageLayout.assignments から各 region に対応する gadget Screen ID を取得する
 *   3. gadget name (placeholder レベル) を region 内に injection する
 *      (完全 HTML 再現は pl-6 dogfood のため、MVP では name + identifier で OK)
 *   4. main region は assignment を取らず content-slot placeholder を表示
 *
 * GrapesJS canvas iframe へのアクセス:
 *   editor.Canvas.getDocument() → iframe 内 document を返す
 */

import type { Editor as GEditor } from "grapesjs";
import DOMPurify from "dompurify";

/** PageLayout.assignments の型 (regionName → gadget screenId) */
export type RegionAssignments = Record<string, string>;

/** gadget 解決に使う Screen entry の最低限情報 */
export interface ScreenEntry {
  id: string;
  name: string;
}

/**
 * RFC #1021 pl-6 (Codex A-3): GrapesJS design data から HTML 本体を抽出する。
 * 既存サンプルは `pages[0].frames[0].component.components` に HTML string で格納される
 * (例: examples/retail/.../*.design.json)。components が string でない場合は null を返す。
 */
export function extractGrapesHtml(design: unknown): string | null {
  if (!design || typeof design !== "object") return null;
  const d = design as { pages?: Array<{ frames?: Array<{ component?: { components?: unknown } }> }> };
  const components = d?.pages?.[0]?.frames?.[0]?.component?.components;
  return typeof components === "string" ? components : null;
}

// ---------------------------------------------------------------------------
// #1406: GrapesJS design data の `styles` (CssRule[] JSON) を CSS string に直列化する。
//
// 背景: composition preview は HTML だけを合成し、PageLayout / gadget design に紐づく
// project CSS (GrapesJS Style Manager で付与された規則) を反映できていなかった。
// canvas は live editor の `editor.getCss()` で project CSS を持つが、preview は raw
// design JSON しか持たないため、ここで JSON → CSS の serializer を用意する。
//
// GrapesJS の永続化形式 (CssRuleJSON):
//   { selectors: (string|{name,type?})[], selectorsAdd?, style?, state?,
//     atRuleType?, mediaText?, singleAtRule? }
// セレクタ type: 1=class (.foo) / 2=id (#foo) / 省略時は class 扱い。
// ---------------------------------------------------------------------------

/** GrapesJS selector JSON の最小型 */
interface GrapesSelectorJson {
  name: string;
  type?: number;
}

/** GrapesJS CssRule JSON の最小型 */
interface GrapesCssRuleJson {
  selectors?: Array<string | GrapesSelectorJson>;
  selectorsAdd?: string;
  style?: Record<string, unknown>;
  state?: string;
  atRuleType?: string;
  mediaText?: string;
  singleAtRule?: boolean;
}

/** 単一 selector JSON を CSS セレクタ文字列に変換する (type 1=class / 2=id)。 */
function _selectorToCss(sel: string | GrapesSelectorJson): string {
  if (typeof sel === "string") {
    // 文字列形式は素の class 名 (prefix なし) を想定。既に . / # 付きならそのまま使う。
    return /^[.#]/.test(sel) ? sel : `.${sel}`;
  }
  const name = sel?.name ?? "";
  if (!name) return "";
  if (sel.type === 2) return `#${name}`;
  return `.${name}`;
}

/** style オブジェクトを `prop: value;` 宣言ブロックに変換する。 */
function _styleToDeclarations(style: Record<string, unknown> | undefined): string {
  if (!style || typeof style !== "object") return "";
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([prop, value]) => `${prop}:${String(value)};`)
    .join("");
}

/**
 * GrapesJS の `getAtRuleFromProps` 相当: atRuleType / mediaText から `@media (...)` /
 * `@font-face` 等の at-rule prelude を組み立てる。
 *   - atRuleType あり → `@<atRuleType>` (+ mediaText あれば ` <mediaText>`)
 *   - atRuleType なし & mediaText あり → `@media <mediaText>`
 *   - どちらも無し → "" (at-rule なし)
 * (grapesjs/dist/grapes.mjs CssRule.getAtRuleFromProps と同じ規則)
 */
function _atRulePrelude(rule: GrapesCssRuleJson): string {
  const type = rule.atRuleType;
  const condition = rule.mediaText;
  const typeStr = type ? `@${type}` : condition ? "@media" : "";
  if (!typeStr) return "";
  return condition ? `${typeStr} ${condition}` : typeStr;
}

/**
 * 単一 CssRule JSON を CSS 規則文字列に変換する。
 *
 * GrapesJS の永続化形式 (CssRuleJSON) を、live editor の `editor.getCss()` 相当の出力に
 * 揃えるための serializer。以下を再現する (grapesjs CssRule.toCSS / getDeclaration 準拠):
 *   - selectors[] 連結 + state (`:hover` 等) + `, selectorsAdd`
 *   - media 系 at-rule: `@media (...){selector{decls}}`
 *   - singleAtRule (`@font-face` / `@keyframes` / `@page` 等、宣言ブロックのみ持つ at-rule):
 *     selector を付けず `@<atRuleType>{decls}` 形式で出力する
 *
 * selectorsAdd に state を付けない理由: GrapesJS の `selectorsToString` は state を主セレクタ群
 * (`selectors[] + state`) にのみ付与し、selectorsAdd は別グループとして `, ` で連結する。
 * 本実装もその契約に合わせる (state は selectorPart 側のみ)。
 */
function _ruleToCss(rule: GrapesCssRuleJson): string {
  const decls = _styleToDeclarations(rule.style);
  if (!decls) return "";

  const atRule = _atRulePrelude(rule);

  // singleAtRule (@font-face / @keyframes 等) は selector を持たず、宣言ブロックのみを at-rule で包む。
  // GrapesJS: getDeclaration() は singleAtRule のとき style 文字列をそのまま返し、
  // toCSS() が `@<type>{style}` で包む。
  if (rule.singleAtRule && atRule) {
    return `${atRule}{${decls}}`;
  }

  // セレクタ組み立て: selectors[] を連結 (例: .a.b) + state (例: :hover) + selectorsAdd
  const selectorPart = (rule.selectors ?? [])
    .map(_selectorToCss)
    .filter(Boolean)
    .join("");
  const statePart = rule.state ? `:${rule.state}` : "";
  let selector = `${selectorPart}${statePart}`;
  if (rule.selectorsAdd) {
    // selectorsAdd は追加セレクタ (例: タグ名や複合)。selector が空ならそのまま使う。
    selector = selector ? `${selector}, ${rule.selectorsAdd}` : rule.selectorsAdd;
  }
  if (!selector) return "";

  const body = `${selector}{${decls}}`;

  // media クエリ等の at-rule をラップ (@media / @supports 等、selector を内側に持つ at-rule)
  if (atRule) {
    return `${atRule}{${body}}`;
  }
  return body;
}

/**
 * #1406: GrapesJS design data の `styles` 配列を CSS string に直列化する。
 * design が styles を持たない / 空配列の場合は空文字を返す。
 */
export function extractGrapesCss(design: unknown): string {
  if (!design || typeof design !== "object") return "";
  const d = design as { styles?: unknown };
  if (!Array.isArray(d.styles) || d.styles.length === 0) return "";
  return (d.styles as GrapesCssRuleJson[])
    .map(_ruleToCss)
    .filter(Boolean)
    .join("\n");
}

/**
 * RFC #1021 pl-6 (Codex C-1): Page Screen の composition preview HTML を組み立てる。
 *
 * pageLayoutHtml の中の `data-region-name="<region>"` 要素を以下のルールで差し替える:
 *   - region="main": screenContentHtml に置換 (page Screen 本文)
 *   - その他 (header/sidebar/footer 等): assignments[region] の gadget HTML に置換
 *
 * `DOMParser` を使うため browser context (Designer 内) でのみ動作。SSR 不可。
 */
export function composePreviewHtml(
  pageLayoutHtml: string,
  assignments: Record<string, string>,
  gadgetHtmlByScreenId: Map<string, string>,
  screenContentHtml: string,
): string {
  if (typeof DOMParser === "undefined") return pageLayoutHtml; // SSR fallback
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div id="__pl_root__">${pageLayoutHtml}</div>`, "text/html");
    const root = doc.getElementById("__pl_root__");
    if (!root) return pageLayoutHtml;

    root.querySelectorAll<HTMLElement>("[data-region-name]").forEach((el) => {
      const name = el.getAttribute("data-region-name") ?? "";
      el.removeAttribute("data-region-name");
      el.setAttribute("data-pl-region-rendered", name);
      if (name === "main") {
        // S-003: design HTML を XSS対策でサニタイズ (CWE-79)
        el.innerHTML = DOMPurify.sanitize(screenContentHtml);
        el.setAttribute("data-pl-content-slot", "true");
        return;
      }
      const gadgetId = assignments[name];
      const gadgetHtml = gadgetId ? gadgetHtmlByScreenId.get(gadgetId) : null;
      if (gadgetHtml) {
        el.innerHTML = DOMPurify.sanitize(gadgetHtml); // S-003
      } else {
        el.innerHTML = `<span style="font-size:11px;color:#94a3b8;font-style:italic">(region: ${name} — 未割り当て or 未ロード)</span>`;
      }
    });
    return root.innerHTML;
  } catch {
    return pageLayoutHtml;
  }
}

/**
 * #1406: composition preview iframe の srcDoc (完全な HTML document) を組み立てる。
 *
 * canvas と同一の CSS スタックを再現するため、以下を `<head>` に注入する:
 *   1. styleHrefs — grapesCanvasAssets.buildPreviewStyleHrefs() が返す framework + variant の
 *      `<link>` (Bootstrap CDN / theme-bootstrap・tailwind / variant override / common.css)
 *   2. projectCssBlocks — PageLayout / gadget / 編集中 Screen の GrapesJS project CSS を
 *      `<style>` ブロックとして後から注入 (link より後勝ちで、設計者が付けた規則が優先される)
 *
 * セキュリティ (S-003 / CWE-79): bodyHtml は composePreviewHtml() 内で DOMPurify 済。
 * projectCssBlocks は CSS 文字列であり HTML サニタイズ対象外だが、`<style>` ブロックからの
 * 脱出 (`</style>` 注入による HTML injection) を防ぐため `_neutralizeStyleClose()` で
 * `</style` シーケンスを無害化する。
 * styleHrefs は信頼できる asset URL (自前定数 / import.meta.url 解決) だが、防御として
 * `_escapeAttr()` で HTML 属性エスケープを通してから埋め込む。
 */
export function buildCompositionPreviewSrcDoc(
  bodyHtml: string,
  styleHrefs: string[],
  projectCssBlocks: string[] = [],
): string {
  const links = styleHrefs
    .filter((href) => typeof href === "string" && href.length > 0)
    .map((href) => `<link href="${_escapeAttr(href)}" rel="stylesheet">`)
    .join("\n");
  const styleBlocks = projectCssBlocks
    .filter((css) => typeof css === "string" && css.trim().length > 0)
    .map((css) => `<style>${_neutralizeStyleClose(css)}</style>`)
    .join("\n");
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
${links}
<style>body{margin:0;font-family:system-ui,sans-serif}</style>
${styleBlocks}
</head><body>${bodyHtml}</body></html>`;
}

/**
 * `<style>` 要素 break-out 中和専用ヘルパ。
 *
 * 責務は限定的: CSS 文字列中の `</style` シーケンス (case-insensitive、`</STYLE>` /
 * `</style >` 含む) を `<\/style` に置換し、`<style>...</style>` ブロックを途中で閉じて
 * その後ろに任意 HTML (`<script>` 等) を注入する break-out を防ぐ。CSS 構文として
 * `<\/style` は無害な (適用されない) 宣言として扱われ、要素は閉じない。
 *
 * これは CSS 全般のサニタイズ **ではない** (CSS expression / url() 等は対象外)。
 * preview body 側の HTML サニタイズは composePreviewHtml() 内の DOMPurify が担当しており、
 * 本関数は `<style>` への CSS 注入経路に限った break-out 中和のみを担う。
 */
function _neutralizeStyleClose(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

/**
 * HTML 属性値エスケープ。href は信頼できる asset URL 想定だが、防御として
 * `&` / `"` / `'` / `<` / `>` を文字実体参照に変換する。
 * `&` を最初に処理し、後続のエスケープ結果を二重エスケープしないようにする。
 */
function _escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * GrapesJS canvas 内の region 要素に gadget preview を inject する。
 *
 * @param editor - GrapesJS Editor インスタンス
 * @param assignments - PageLayout.assignments (regionName → gadget screenId)
 * @param screens - 全 Screen の entry 一覧 (gadget name 解決に使う)
 * @param gadgetHtmlMap - gadget screenId → 取得済 HTML 本体 (省略時は placeholder のみ inject)
 *                       RFC #1021 pl-6 (Codex A-3): gadget の design HTML を read-only preview として注入
 */
export function injectGadgetPreviews(
  editor: GEditor,
  assignments: RegionAssignments,
  screens: ScreenEntry[],
  gadgetHtmlMap?: Map<string, string>,
): void {
  try {
    const canvasDoc = editor.Canvas.getDocument();
    if (!canvasDoc) return;

    const regionEls = canvasDoc.querySelectorAll<HTMLElement>("[data-region-name]");
    if (regionEls.length === 0) return;

    const screenMap = new Map(screens.map((s) => [s.id, s.name]));

    regionEls.forEach((regionEl) => {
      const regionName = regionEl.getAttribute("data-region-name") ?? "";

      // 既存の injection marker があれば skip (再 inject による二重表示を防ぐ)
      if (regionEl.querySelector("[data-pl5-injection]")) return;

      if (regionName === "main") {
        // main region は content slot placeholder を表示
        _appendPlaceholder(regionEl, {
          text: "content slot (page Screen 本文がここに嵌まる)",
          color: "#f59e0b",
          bgColor: "rgba(245,158,11,0.08)",
          icon: "bi-layout-text-window",
        });
        return;
      }

      const gadgetScreenId = assignments[regionName];
      if (!gadgetScreenId) {
        // 未割り当て region
        _appendPlaceholder(regionEl, {
          text: `[未割り当て] region: ${regionName}`,
          color: "#94a3b8",
          bgColor: "rgba(148,163,184,0.06)",
          icon: "bi-dash-circle",
        });
        return;
      }

      const gadgetName = screenMap.get(gadgetScreenId) ?? gadgetScreenId;
      const gadgetHtml = gadgetHtmlMap?.get(gadgetScreenId);

      // RFC #1021 pl-6 (Codex A-3): gadget の design HTML を inject する read-only preview
      if (gadgetHtml) {
        _appendPreviewHtml(regionEl, {
          gadgetName,
          screenId: gadgetScreenId,
          html: gadgetHtml,
        });
        return;
      }

      _appendPlaceholder(regionEl, {
        text: `gadget: ${gadgetName}`,
        color: "#6366f1",
        bgColor: "rgba(99,102,241,0.08)",
        icon: "bi-puzzle",
        screenId: gadgetScreenId,
      });
    });
  } catch (e) {
    // canvas 未準備 / iframe access 失敗は無視 (non-blocking)
    console.warn("[pageLayoutCompositionPreview] inject failed:", e);
  }
}

interface PlaceholderOptions {
  text: string;
  color: string;
  bgColor: string;
  icon: string;
  screenId?: string;
}

function _appendPlaceholder(
  regionEl: HTMLElement,
  opts: PlaceholderOptions,
): void {
  const wrapper = regionEl.ownerDocument.createElement("div");
  wrapper.setAttribute("data-pl5-injection", "true");
  wrapper.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:8px",
    "padding:8px 12px",
    `background:${opts.bgColor}`,
    "border-radius:4px",
    "margin-top:8px",
    "pointer-events:none",
    "user-select:none",
  ].join(";");

  const badge = regionEl.ownerDocument.createElement("span");
  badge.style.cssText = [
    `color:${opts.color}`,
    "font-size:12px",
    "font-family:system-ui,sans-serif",
    "font-weight:600",
  ].join(";");
  badge.textContent = opts.text;

  if (opts.screenId) {
    const idLabel = regionEl.ownerDocument.createElement("span");
    idLabel.style.cssText = [
      "color:#94a3b8",
      "font-size:10px",
      "font-family:monospace",
    ].join(";");
    idLabel.textContent = `(${opts.screenId})`;
    wrapper.appendChild(badge);
    wrapper.appendChild(idLabel);
  } else {
    wrapper.appendChild(badge);
  }

  regionEl.appendChild(wrapper);
}

/**
 * RFC #1021 pl-6 (Codex A-3): gadget の design HTML を region 内に read-only preview として inject する。
 * placeholder badge より上に gadget の実描画を出して composition の見た目を確認可能にする。
 */
function _appendPreviewHtml(
  regionEl: HTMLElement,
  opts: { gadgetName: string; screenId: string; html: string },
): void {
  const wrapper = regionEl.ownerDocument.createElement("div");
  wrapper.setAttribute("data-pl5-injection", "true");
  wrapper.setAttribute("data-pl5-gadget-id", opts.screenId);
  wrapper.style.cssText = [
    "position:relative",
    "border:1px dashed rgba(99,102,241,0.4)",
    "border-radius:4px",
    "padding:8px",
    "margin-top:8px",
    "background:rgba(99,102,241,0.04)",
    "pointer-events:none",
    "user-select:none",
  ].join(";");

  const tag = regionEl.ownerDocument.createElement("div");
  tag.style.cssText = [
    "position:absolute",
    "top:-10px",
    "left:8px",
    "padding:2px 8px",
    "border-radius:10px",
    "background:#6366f1",
    "color:#fff",
    "font-size:10px",
    "font-family:system-ui,sans-serif",
    "font-weight:600",
  ].join(";");
  tag.textContent = `gadget: ${opts.gadgetName} (read-only preview)`;
  wrapper.appendChild(tag);

  // gadget HTML を inject (innerHTML)。pointer-events:none で編集不可、scope は wrapper 内に閉じる
  //
  // S-003: gadget design HTML を DOMPurify でサニタイズして XSS を防ぐ (CWE-79)
  const body = regionEl.ownerDocument.createElement("div");
  body.style.cssText = "min-height:24px;";
  body.innerHTML = DOMPurify.sanitize(opts.html);
  wrapper.appendChild(body);

  regionEl.appendChild(wrapper);
}

/**
 * canvas 内の injection marker を全て削除する (re-inject 前のクリーンアップ用)
 */
export function clearGadgetPreviews(editor: GEditor): void {
  try {
    const canvasDoc = editor.Canvas.getDocument();
    if (!canvasDoc) return;
    const markers = canvasDoc.querySelectorAll("[data-pl5-injection]");
    markers.forEach((el) => el.remove());
  } catch {
    /* ignore */
  }
}
