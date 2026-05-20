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
