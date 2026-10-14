/**
 * 主要画面の構造 (スクリーンリーダー向け): ランドマーク (banner / navigation / main)・見出し・状態の読み上げ領域・ダイアログ・画像の代替テキストを、機械で確かめる。
 * 操作部品の名前は a11y-names.spec.ts が確かめる。実際のスクリーンリーダー (NVDA・VoiceOver) での確認は、この検査には含まれない。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

const KEY = `a11y-structure-${Date.now()}`;
let ws: OpenedWorkspace;

test.beforeAll(async () => {
  test.skip(!(await isMcpRunning()), "backend 未起動");
  ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
});
test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });

const ROUTES = [
  "/", "/document", "/analysis", "/screen/flow", "/screen/list", "/screen/items/cart", "/screen/design/cart",
  "/table/list", "/table/edit/order-item", "/table/er", "/process-flow/list", "/process-flow/edit/order-confirm",
  "/business-flow/list", "/report/list", "/conventions/catalog", "/extensions", "/generic-definition",
  "/sequence/list", "/view/list", "/view-definition/list", "/page-layout/list", "/gadget/list", "/project/tech-stack",
];

test("主要画面は、ランドマーク・見出し・状態の読み上げ領域・ダイアログ・画像の代替テキストを持つ @smoke", async ({ page }) => {
  test.setTimeout(300000);
  const problems: string[] = [];
  for (const route of ROUTES) {
    await ws.gotoActive(page, route);
    await page.waitForTimeout(800);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const visible = (el: Element) => !!(el as HTMLElement).offsetParent || getComputedStyle(el).position === "fixed";
      // ランドマーク: main は 1 つ。banner (ヘッダー)・navigation (タブ・メニュー) がある。同じ種類が複数あるときは、名前で区別できる
      const mains = [...document.querySelectorAll("main, [role=main]")].filter(visible);
      if (mains.length !== 1) out.push(`main ランドマークが ${mains.length} 個 (1 個が必要)`);
      if (!document.querySelector("header, [role=banner]")) out.push("banner (ヘッダー) が無い");
      const navs = [...document.querySelectorAll("nav, [role=navigation]")].filter(visible);
      if (navs.length === 0) out.push("navigation が無い");
      if (navs.length > 1 && navs.some((n) => !(n.getAttribute("aria-label") || n.getAttribute("aria-labelledby")))) out.push("navigation が複数あるのに、名前の無いものがある");
      // 見出し: main の中に、見出しが 1 つ以上。段が 2 つ以上飛ばない
      const headingEls = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")].filter(visible);
      const levelOf = (h: Element) => Number(h.getAttribute("aria-level")) || (/^H[1-6]$/.test(h.tagName) ? Number(h.tagName[1]) : 2);
      if (headingEls.length === 0) out.push("見出しが無い");
      let prev = 0;
      for (const h of headingEls) {
        const lv = levelOf(h);
        if (prev && lv > prev + 1) { out.push(`見出しの段が飛んでいる: ${prev} → ${lv} (${(h.textContent ?? "").trim().slice(0, 20)})`); break; }
        prev = lv;
      }
      // 状態の読み上げ領域 (通知)
      if (!document.querySelector('[role=status], [aria-live=polite], [role=alert]')) out.push("読み上げ領域 (role=status / aria-live) が無い");
      // ダイアログ: 名前がある
      document.querySelectorAll("[role=dialog]").forEach((d) => { if (visible(d) && !(d.getAttribute("aria-label") || d.getAttribute("aria-labelledby"))) out.push("名前の無い dialog"); });
      // 画像: 代替テキスト (装飾なら alt="" か aria-hidden)
      document.querySelectorAll("img").forEach((img) => { if (visible(img) && !img.hasAttribute("alt") && img.getAttribute("aria-hidden") !== "true") out.push(`alt の無い画像: ${(img.getAttribute("src") ?? "").slice(0, 30)}`); });
      // aria-hidden の中に、フォーカスできるものがある
      document.querySelectorAll('[aria-hidden="true"]').forEach((h) => {
        const f = h.querySelector('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (f && visible(h)) out.push(`aria-hidden の中にフォーカスできる要素: ${f.tagName.toLowerCase()}`);
      });
      return out;
    });
    for (const b of new Set(bad)) problems.push(`${route}: ${b}`);
  }
  expect(problems).toEqual([]);
});
