/**
 * 図 (React Flow) の画像書き出しと印刷 (UI 改善提案 続編 第 7 弾 #128 #135)。
 * - PNG: 図の全体 (表示している範囲ではなく、すべてのノードを収める) を、操作用の部品 (ミニマップ・ボタン) を除いて画像にする
 * - 印刷: PNG を、用紙・向きを決めた印刷用の枠に入れて、印刷ダイアログを開く (1 ページに収める。ページ分割はしない)
 * 画像化は html2canvas (画面の見た目をそのまま描く)。
 */
import html2canvas from "html2canvas";
import { hasColorFunction, replaceColorFunctions } from "./cssColor";

/**
 * 複製した画面の全要素 (と、内容のある ::before / ::after) で、`color(srgb ...)` (color-mix の計算後の値) を rgba に直す。
 * html2canvas は、この書き方を読めず失敗する。要素の値は style 属性に、疑似要素の値は、印を付けた要素への規則として書く。
 */
export function inlineLegacyColors(root: ParentNode, view: Window): void {
  const doc = (root as Node).ownerDocument ?? document;
  const pseudoRules: string[] = [];
  let n = 0;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const cs = view.getComputedStyle(el);
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      const v = cs.getPropertyValue(prop);
      if (v && hasColorFunction(v)) el.style.setProperty(prop, replaceColorFunctions(v), "important");
    }
    for (const pseudo of ["::before", "::after"] as const) {
      const ps = view.getComputedStyle(el, pseudo);
      const content = ps.content;
      if (!content || content === "none" || content === "normal") continue;
      const decls: string[] = [];
      for (let i = 0; i < ps.length; i++) {
        const prop = ps[i];
        const v = ps.getPropertyValue(prop);
        if (v && hasColorFunction(v)) decls.push(`${prop}: ${replaceColorFunctions(v)} !important`);
      }
      if (decls.length) {
        if (!el.hasAttribute("data-h2c")) el.setAttribute("data-h2c", String(++n));
        pseudoRules.push(`[data-h2c="${el.getAttribute("data-h2c")}"]${pseudo} { ${decls.join("; ")} }`);
      }
    }
  }
  if (pseudoRules.length) {
    const style = doc.createElement("style");
    style.textContent = pseudoRules.join("\n");
    doc.head.appendChild(style);
  }
}

export interface Bounds { x: number; y: number; width: number; height: number }

/** 図の全体の範囲に余白を足した大きさ */
export function paddedBounds(b: Bounds, pad = 24): Bounds {
  return { x: b.x - pad, y: b.y - pad, width: Math.max(1, Math.ceil(b.width + pad * 2)), height: Math.max(1, Math.ceil(b.height + pad * 2)) };
}

/** 背景色: アプリの面の色 (CSS の変数を、実際の色にして渡す。html2canvas は var() を解けない) */
export function resolveCssColor(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

export async function diagramToPngDataUrl(root: HTMLElement, bounds: Bounds, scale = 2): Promise<string> {
  const b = paddedBounds(bounds);
  const bg = resolveCssColor("--hm-surface", "#ffffff");
  const canvas = await html2canvas(root, {
    backgroundColor: bg, scale, logging: false, useCORS: true, width: b.width, height: b.height, windowWidth: b.width, windowHeight: b.height,
    onclone: (doc) => {
      const clone = doc.querySelector<HTMLElement>(".react-flow");
      if (!clone) return;
      clone.style.width = `${b.width}px`; clone.style.height = `${b.height}px`; clone.style.position = "relative"; clone.style.overflow = "hidden";
      clone.querySelectorAll(".react-flow__panel, .react-flow__minimap, .react-flow__controls, .react-flow__attribution, .dgm-guides, .react-flow__handle").forEach((el) => el.remove());
      inlineLegacyColors(clone, doc.defaultView ?? window);
      const vp = clone.querySelector<HTMLElement>(".react-flow__viewport");
      // 図の全体が左上から始まるように、移動と拡大を決め直す
      if (vp) vp.style.transform = `translate(${-b.x}px, ${-b.y}px) scale(1)`;
    },
  });
  return canvas.toDataURL("image/png");
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
}

export type PaperSize = "A4" | "A3";
export type Orientation = "portrait" | "landscape";
export const PAPER_SIZES: PaperSize[] = ["A4", "A3"];

/** 印刷用の枠 (HTML) を作る: 用紙・向き・余白・見出し・日付。画像は 1 ページに収める。画面に依存しない (試験できる) */
export function buildPrintDocument(opts: { title: string; imageUrl: string; paper: PaperSize; orientation: Orientation; date?: string }): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>
@page { size: ${opts.paper} ${opts.orientation}; margin: 10mm; }
html, body { margin: 0; padding: 0; font-family: "BIZ UDPGothic", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif; color: #1d2433; }
.page { display: flex; flex-direction: column; height: calc(100vh - 2px); }
h1 { font-size: 13pt; margin: 0 0 4mm; }
.fig { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.fig img { max-width: 100%; max-height: 100%; object-fit: contain; }
footer { font-size: 8pt; color: #5d677a; margin-top: 3mm; display: flex; justify-content: space-between; }
</style></head><body><div class="page"><h1>${esc(opts.title)}</h1><div class="fig"><img src="${esc(opts.imageUrl)}" alt="${esc(opts.title)}"></div><footer><span>Harnize Harmony</span><span>${esc(date)}</span></footer></div></body></html>`;
}

/** 隠した枠 (iframe) に印刷用の文書を入れて、印刷ダイアログを開く */
export function printHtmlDocument(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open(); doc.write(html); doc.close();
  const img = doc.querySelector("img");
  const go = () => { try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } finally { setTimeout(() => frame.remove(), 2000); } };
  if (img && !img.complete) img.addEventListener("load", go, { once: true }); else go();
}
