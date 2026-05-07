/**
 * 赤線 free-form 描画マーカー (#261)
 *
 * マルチストローク対応 + 消しゴムツールの動作検証。
 */
/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-draw";

const dummyGroup = {
  id: groupId, name: "draw test", type: "screen", description: "",
  mode: "upstream", maturity: "draft",
  actions: [{ id: "act-1", name: "ボタン", trigger: "click", maturity: "draft", responses: [{id:"201-ok",status:201}], steps: [] }],
  markers: [
    // 既存 shape 付き marker (表示 + 消しゴムテスト用)
    {
      id: "mk-pre",
      kind: "attention",
      body: "ここ危ない",
      shape: { type: "path", d: "M 10 10 L 50 50 L 30 70" },
      author: "human",
      createdAt: "2026-04-21T00:00:00.000Z",
    },
  ],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const dummyProject = {
  version: 1, name: "draw", screens: [], groups: [], edges: [], tables: [],
  processFlows: [{ id: groupId, no: 1, name: dummyGroup.name, type: dummyGroup.type, actionCount: 1, updatedAt: dummyGroup.updatedAt, maturity: "draft" }],
  updatedAt: new Date().toISOString(),
};

async function setup(page: Page) {
  await page.addInitScript(({ project, group }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.setItem(`process-flow-${group.id}`, JSON.stringify(group));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
  }, { project: dummyProject, group: dummyGroup });
  await page.goto(`/process-flow/edit/${groupId}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
}

async function drawStroke(page: Page, x0: number, y0: number, dx: number, dy: number) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + dx / 2, y0 + dy / 2, { steps: 4 });
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe.skip("描画マーカー (#261)", () => {
  test("既存 shape marker が SVG overlay に描画される (path 要素)", async ({ page }) => {
    await setup(page);
    const overlay = page.locator(".drawing-overlay");
    await expect(overlay).toBeVisible();
    // path が 1 個 (既存 marker の shape)
    await expect(overlay.locator("path")).toHaveCount(1);
    const d = await overlay.locator("path").first().getAttribute("d");
    expect(d).toContain("M 10 10");
  });

  test("描画ボタン ON で pointer-events が有効化しツールバーが表示される", async ({ page }) => {
    await setup(page);
    const overlay = page.locator(".drawing-overlay");
    // 既定 off: pointer-events:none
    await expect(overlay).toHaveCSS("pointer-events", "none");
    // ツールバーは描画モード OFF では非表示
    await expect(page.locator(".drawing-toolbar")).toHaveCount(0);

    await page.locator("button:has-text('描画')").click();
    await expect(overlay).toHaveCSS("pointer-events", "auto");
    await expect(page.locator("button:has-text('描画中')")).toBeVisible();
    // ツールバー表示
    await expect(page.locator(".drawing-toolbar")).toBeVisible();
    // ペンが既定でアクティブ (色スウォッチも active を持つのでツール group に限定)
    await expect(page.locator(".drawing-toolbar-btn[title*='ペン']")).toHaveClass(/active/);
  });

  test("複数ストロークを描画してから確定で 1 marker として起票される", async ({ page }) => {
    await setup(page);
    page.on("dialog", async (d) => {
      if (d.type() === "prompt") await d.accept("まとめて修正して");
    });
    await page.locator("button:has-text('描画')").click();

    const overlay = page.locator(".drawing-overlay");
    const box = await overlay.boundingBox();
    if (!box) throw new Error("overlay bbox missing");

    // 2 ストローク描画
    await drawStroke(page, box.x + box.width * 0.3, box.y + box.height * 0.3, 100, 50);
    await drawStroke(page, box.x + box.width * 0.5, box.y + box.height * 0.5, -80, 60);

    // ストローク数表示 (2 ストローク)
    await expect(page.locator(".drawing-toolbar-info")).toContainText("2 ストローク");

    // 確定で marker 起票
    await page.locator(".drawing-toolbar-commit").click();

    // ツールバーは閉じて描画モード OFF
    await expect(page.locator(".drawing-toolbar")).toHaveCount(0);
    await expect(page.locator("button:has-text('描画')")).toBeVisible();

    // 新 marker が 1 件追加された (既存 1 + 新 1 = 2)
    await expect(overlay.locator("path")).toHaveCount(2);

    // 新 marker の d 属性に 2 つの M セグメントが含まれる (マルチストローク合体)
    const paths = await overlay.locator("path").all();
    let foundMulti = false;
    for (const p of paths) {
      const d = (await p.getAttribute("d")) ?? "";
      const mCount = (d.match(/M /g) ?? []).length;
      if (mCount >= 2) { foundMulti = true; break; }
    }
    expect(foundMulti).toBe(true);
  });

  test("undo ボタンで 1 ストローク戻せる", async ({ page }) => {
    await setup(page);
    await page.locator("button:has-text('描画')").click();

    const overlay = page.locator(".drawing-overlay");
    const box = await overlay.boundingBox();
    if (!box) throw new Error("overlay bbox missing");

    await drawStroke(page, box.x + box.width * 0.2, box.y + box.height * 0.2, 60, 40);
    await drawStroke(page, box.x + box.width * 0.4, box.y + box.height * 0.4, 60, 40);

    await expect(page.locator(".drawing-toolbar-info")).toContainText("2 ストローク");

    // undo (1 ストローク戻す)
    await page.locator(".drawing-toolbar-btn[title*='ストローク戻す']").click();
    await expect(page.locator(".drawing-toolbar-info")).toContainText("1 ストローク");
  });

  test("キャンセルで描画破棄・marker は増えない", async ({ page }) => {
    await setup(page);
    await page.locator("button:has-text('描画')").click();

    const overlay = page.locator(".drawing-overlay");
    const box = await overlay.boundingBox();
    if (!box) throw new Error("overlay bbox missing");

    await drawStroke(page, box.x + box.width * 0.3, box.y + box.height * 0.3, 100, 50);

    // キャンセル
    await page.locator(".drawing-toolbar-cancel").click();
    await expect(page.locator(".drawing-toolbar")).toHaveCount(0);

    // 既存 marker のみ
    await expect(overlay.locator("path")).toHaveCount(1);
  });

  test("色/太さを変更してコミット → shape.color / strokeWidth に反映", async ({ page }) => {
    await setup(page);
    page.on("dialog", async (d) => {
      if (d.type() === "prompt") await d.accept("色変更テスト");
    });
    await page.locator("button:has-text('描画')").click();

    // 色・太さ プリセットが表示される (ペン時のみ)
    await expect(page.locator(".drawing-color-swatch")).toHaveCount(4);
    await expect(page.locator(".drawing-width-btn")).toHaveCount(2);

    // 青に切替
    await page.locator(".drawing-color-swatch[data-color='#3b82f6']").click();
    await expect(page.locator(".drawing-color-swatch[data-color='#3b82f6']")).toHaveClass(/active/);
    // 太線に切替
    await page.locator(".drawing-width-btn[data-width='4']").click();
    await expect(page.locator(".drawing-width-btn[data-width='4']")).toHaveClass(/active/);

    const overlay = page.locator(".drawing-overlay");
    const box = await overlay.boundingBox();
    if (!box) throw new Error("overlay bbox missing");
    await drawStroke(page, box.x + box.width * 0.3, box.y + box.height * 0.3, 80, 50);

    // 描画中/確定済みストロークが青・太線でレンダされる
    // (確定前: svg 内の新規 path で stroke 色を確認)
    const newStrokes = overlay.locator("path:not(.drawing-existing-shape)");
    const strokeAttr = await newStrokes.first().getAttribute("stroke");
    expect(strokeAttr).toBe("#3b82f6");
    const widthAttr = await newStrokes.first().getAttribute("stroke-width");
    expect(widthAttr).toBe("4");

    // 確定で marker 起票
    await page.locator(".drawing-toolbar-commit").click();

    // 新 marker が描画オーバーレイに既存 shape として表示される (既存 1 + 新 1 = 2)
    await expect(overlay.locator("path.drawing-existing-shape")).toHaveCount(2);

    // 新 shape は青・太線で描画される
    // (既存 mk-pre は M 10 10 開始、新マーカーはそれ以外の M で始まる)
    const newShapeColors = await overlay.locator("path.drawing-existing-shape").evaluateAll((paths) => {
      return paths.map((p) => ({
        d: p.getAttribute("d"),
        stroke: p.getAttribute("stroke"),
        strokeWidth: p.getAttribute("stroke-width"),
      }));
    });
    const newOne = newShapeColors.find((s) => !s.d?.startsWith("M 10 10"));
    expect(newOne?.stroke).toBe("#3b82f6");
    expect(newOne?.strokeWidth).toBe("4");
  });

  test("消しゴムツール時は色選択UIが非表示になる", async ({ page }) => {
    await setup(page);
    await page.locator("button:has-text('描画')").click();
    // ペン時は色スウォッチあり
    await expect(page.locator(".drawing-color-swatch")).toHaveCount(4);
    // 消しゴムに切替 → 色スウォッチ消える
    await page.locator(".drawing-toolbar-btn[title*='消しゴム']").click();
    await expect(page.locator(".drawing-color-swatch")).toHaveCount(0);
  });

  test("消しゴムツールで既存 shape marker を削除できる", async ({ page }) => {
    await setup(page);
    await page.locator("button:has-text('描画')").click();

    // 消しゴムに切替
    await page.locator(".drawing-toolbar-btn[title*='消しゴム']").click();
    await expect(page.locator(".drawing-toolbar-btn.active")).toHaveAttribute("title", /消しゴム/);

    const overlay = page.locator(".drawing-overlay");
    // 既存 path をクリックで削除 (pointer-events:stroke のため stroke 上のクリックイベントを直接 dispatch)
    await overlay.locator("path.drawing-existing-shape").first().evaluate((el) => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    await expect(overlay.locator("path")).toHaveCount(0);
  });
});
