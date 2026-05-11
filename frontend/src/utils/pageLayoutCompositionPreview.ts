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

/** PageLayout.assignments の型 (regionName → gadget screenId) */
export type RegionAssignments = Record<string, string>;

/** gadget 解決に使う Screen entry の最低限情報 */
export interface ScreenEntry {
  id: string;
  name: string;
}

/**
 * GrapesJS canvas 内の region 要素に gadget preview を inject する。
 *
 * @param editor - GrapesJS Editor インスタンス
 * @param assignments - PageLayout.assignments (regionName → gadget screenId)
 * @param screens - 全 Screen の entry 一覧 (gadget name 解決に使う)
 */
export function injectGadgetPreviews(
  editor: GEditor,
  assignments: RegionAssignments,
  screens: ScreenEntry[],
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
