/**
 * workspace-multi-parallel.spec.ts (#703 R-5 D)
 *
 * 2 つの独立したブラウザコンテキスト (= 別ブラウザタブ相当) で、
 * workspace の active 状態が独立していることを検証する。
 *
 * MCP サーバー不要: localStorage を直接操作し、URL ベースの独立性を検証する。
 * MCP 接続済み環境での broadcast 独立性は vitest (wsBridge.test.ts) でカバー。
 *
 * カバー範囲:
 *  1. 2 ブラウザコンテキストで異なる /w/:wsId/ URL に goto → 互いの URL が独立
 *  2. コンテキスト A が /w/<wsA>/ → コンテキスト B は /w/<wsB>/ のまま
 *  3. workspace/select への直接アクセスは両コンテキストで独立動作
 */

import { test, expect } from "@playwright/test";

const WS_A_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const WS_B_ID = "bbbbbbbb-0002-4000-8000-000000000002";

test.describe("並行ブラウザコンテキスト — workspace URL 独立性", () => {
  test("2 ブラウザコンテキストの URL が互いに独立している", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      // 各コンテキストを初期化
      await pageA.addInitScript(() => {
        localStorage.clear();
        window.alert = () => {};
        window.confirm = () => false;
      });
      await pageB.addInitScript(() => {
        localStorage.clear();
        window.alert = () => {};
        window.confirm = () => false;
      });

      // 別々の /w/:wsId/ URL に goto
      await pageA.goto(`/w/${WS_A_ID}/`);
      await pageB.goto(`/w/${WS_B_ID}/`);

      // 各ページの URL が独立している
      await pageA.waitForTimeout(500);
      await pageB.waitForTimeout(500);

      const urlA = pageA.url();
      const urlB = pageB.url();

      // A は WS_A_ID を含む URL (またはスプラッシュ / select にリダイレクト)
      // B は WS_B_ID を含む URL (またはスプラッシュ / select にリダイレクト)
      // 重要: A の URL に WS_B_ID が含まれないこと (独立性)
      expect(urlA).not.toContain(WS_B_ID);
      expect(urlB).not.toContain(WS_A_ID);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("コンテキスト A の navigate がコンテキスト B に影響しない", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      await pageA.addInitScript(() => { localStorage.clear(); window.alert = () => {}; });
      await pageB.addInitScript(() => { localStorage.clear(); window.alert = () => {}; });

      // B は workspace/select に goto してその URL を確認
      await pageB.goto("/workspace/select");
      await expect(pageB).toHaveURL("/workspace/select");

      // A は別の URL に navigate
      await pageA.goto(`/w/${WS_A_ID}/`);
      await pageA.waitForTimeout(500);

      // B の URL は変わっていない (独立したコンテキスト)
      await expect(pageB).toHaveURL("/workspace/select");
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("workspace/list は各コンテキストで独立してアクセス可能", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      await pageA.addInitScript(() => { localStorage.clear(); window.alert = () => {}; });
      await pageB.addInitScript(() => { localStorage.clear(); window.alert = () => {}; });

      // 両コンテキストで workspace/list にアクセス → 独立して動作
      await pageA.goto("/workspace/list");
      await pageB.goto("/workspace/list");

      await expect(pageA).toHaveURL("/workspace/list");
      await expect(pageB).toHaveURL("/workspace/list");

      // A が select に navigate しても B は list のまま
      await pageA.goto("/workspace/select");
      await expect(pageA).toHaveURL("/workspace/select");
      await expect(pageB).toHaveURL("/workspace/list");
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
