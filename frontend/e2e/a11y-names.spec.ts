/**
 * 主要画面の操作部品 (ボタン・リンク・入力欄) が、読み上げに使える名前 (文字・aria-label・title・関連づけた label・入力例) を持つ。
 * アイコンだけのボタンや、label を横に置いただけの入力欄を、新しく増やさないための検査。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

const KEY = `a11y-names-${Date.now()}`;
let ws: OpenedWorkspace;

test.beforeAll(async () => {
  test.skip(!(await isMcpRunning()), "backend 未起動");
  ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
});
test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });

const ROUTES = [
  "/", "/document", "/screen/flow", "/screen/list", "/screen/items/cart", "/screen/design/cart",
  "/table/list", "/table/edit/order-item", "/table/er", "/process-flow/list", "/process-flow/edit/order-confirm",
  "/business-flow/list", "/report/list", "/conventions/catalog", "/extensions", "/generic-definition",
  "/sequence/list", "/view/list", "/view-definition/list", "/page-layout/list", "/gadget/list", "/project/tech-stack",
];

test("主要画面の操作部品は、名前を持つ @smoke", async ({ page }) => {
  test.setTimeout(240000);
  const problems: string[] = [];
  for (const route of ROUTES) {
    await ws.gotoActive(page, route);
    await page.waitForTimeout(700);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const visible = (el: Element) => !!(el as HTMLElement).offsetParent;
      const text = (el: Element) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el as HTMLElement).innerText || "").trim();
      document.querySelectorAll("button, [role=button], a[href]").forEach((el) => {
        if (visible(el) && !text(el) && !el.querySelector("img[alt]")) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
      });
      document.querySelectorAll("input:not([type=hidden]), select, textarea").forEach((el) => {
        if (!visible(el)) return;
        const id = el.id;
        const labelled = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest("label")
          || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el as HTMLInputElement).placeholder;
        if (!labelled) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}: ${(el.closest("tr,section,div")?.textContent ?? "").slice(0, 40)}`);
      });
      return out;
    });
    for (const b of new Set(bad)) problems.push(`${route}: ${b}`);
  }
  expect(problems).toEqual([]);
});
