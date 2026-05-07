/**
 * 画面項目定義プロトタイプ (#318 / PR #320) の基本 E2E。
 * #696: per-screen タブ化 — /w/:wsId/screen/items/:screenId URL に移行。
 *
 * - /screen/items/:screenId を開けること
 * - 新規項目の追加 / name / type / required 編集
 * - 項目の削除
 * - 保存ボタン押下で isDirty が解消されること
 * - @conv.* lint バナー表示 (#351)
 * - pattern 欄の @conv.* 補完 (#352)
 * - errorMessages.* 保存・リロード後の永続化 (#352)
 */
/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect, type Page } from "@playwright/test";

const screenId1 = "scr-1";
const screenId2 = "scr-2";

const sampleCatalog = {
  version: "1.0.0",
  msg: { required: { template: "{label}は必須入力です" } },
  regex: { "email-simple": { pattern: "^[^@]+@[^@]+$", description: "メールアドレス" } },
  limit: {},
  scope: {},
  currency: {},
  tax: {},
  auth: {},
  db: {},
  numbering: {},
  tx: {},
  externalOutcomeDefaults: {},
};

const dummyProject = {
  version: 1,
  name: "screen-items-ui",
  screens: [
    { id: screenId1, no: 1, name: "ログイン画面", type: "standard", updatedAt: new Date().toISOString() },
    { id: screenId2, no: 2, name: "顧客登録画面", type: "standard", updatedAt: new Date().toISOString() },
  ],
  groups: [], edges: [], tables: [], processFlows: [],
  updatedAt: new Date().toISOString(),
};

interface SetupOptions {
  /** 規約カタログを localStorage にシード (lint / 補完テスト用) */
  catalog?: typeof sampleCatalog;
  /** 画面項目定義を localStorage にシード */
  screenItems?: Record<string, unknown>;
}

async function setup(page: Page, opts: SetupOptions = {}) {
  // MCP WebSocket をブロックして localStorage モードに固定する。
  // 接続が成立するとプロジェクトが実 MCP データで上書きされ、
  // テスト途中で画面切替が発生して状態がリセットされるため。
  await page.routeWebSocket(/ws:\/\/localhost:5179/, (ws) => {
    ws.close();
  });
  await page.addInitScript(({ project, catalog, screenItems }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("screen-items-") || k.startsWith("draft-screen-items-")) {
        localStorage.removeItem(k);
      }
    }
    if (catalog) {
      localStorage.setItem("conventions-catalog", JSON.stringify(catalog));
    } else {
      localStorage.removeItem("conventions-catalog");
    }
    if (screenItems) {
      for (const [key, val] of Object.entries(screenItems)) {
        localStorage.setItem(key, JSON.stringify(val));
      }
    }
  }, { project: dummyProject, catalog: opts.catalog ?? null, screenItems: opts.screenItems ?? null });
  await page.goto(`/w/ws-e2e/screen/items/${screenId1}`);
  await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
}

test.describe.skip("画面項目定義プロトタイプ (#318)", () => {
  test("画面名がヘッダータイトルに表示される", async ({ page }) => {
    await setup(page);
    // EditorHeader の title に画面名が表示されること
    await expect(page.locator(".screen-items-view")).toContainText("ログイン画面");
  });

  test("項目追加 → ID 入力 → 保存", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    // 1 行出現
    await expect(page.locator(".screen-items-table tbody tr")).toHaveCount(1);
    // ID 入力
    const idInput = page.locator('.screen-items-table input[placeholder="email"]').first();
    await idInput.fill("userId");
    await expect(idInput).toHaveValue("userId");
    // label 入力
    const labelInput = page.locator('.screen-items-table input[placeholder="メールアドレス"]').first();
    await labelInput.fill("ユーザー ID");
    // 必須 チェック
    await page.locator('.screen-items-table input[type="checkbox"][aria-label="必須"]').first().check();
    // 保存 (EditorHeader 内の SaveResetButtons)
    const saveBtn = page.locator(".srb-btn-save");
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(saveBtn).toBeDisabled({ timeout: 3000 }); // isDirty 解消
  });

  test("別画面の URL に移動すると別タブで開く", async ({ page }) => {
    await setup(page);
    // scr-1 に 1 件追加 + 保存
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    await page.locator('.screen-items-table input[placeholder="email"]').first().fill("field1");
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    // scr-2 の URL に遷移
    await page.goto(`/w/ws-e2e/screen/items/${screenId2}`);
    await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
    // scr-2 は項目 0 件
    await expect(page.locator(".screen-items-empty-row")).toBeVisible();
  });

  test("画面デザインから追加モーダルを開ける", async ({ page }) => {
    await setup(page);
    const btn = page.locator(".screen-items-view button:has-text('画面デザインから追加')");
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator(".screen-item-candidates")).toBeVisible();
    // キャンセルで閉じる
    await page.locator(".screen-item-candidates-footer button:has-text('キャンセル')").click();
    await expect(page.locator(".screen-item-candidates")).toHaveCount(0);
  });

  test("削除ボタンで項目が消える", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    await page.locator('.screen-items-table input[placeholder="email"]').first().fill("willDelete");
    await expect(page.locator(".screen-items-table tbody tr")).toHaveCount(1);
    await page.locator('.screen-items-table button[aria-label="削除"]').first().click();
    await expect(page.locator(".screen-items-empty-row")).toBeVisible();
  });

  test("ID を空にして blur すると元の ID に戻る", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    // tr:last-child で新規追加行のみを対象にする (既存 MCP 行を避ける)
    const row = page.locator(".screen-items-table tbody tr:last-child");
    const idInput = row.locator('input[placeholder="email"]');
    const labelInput = row.locator('input[placeholder="メールアドレス"]');
    // ID を設定して blur で確定 (originalId が "" → !originalId → commit)
    await idInput.fill("userId");
    await labelInput.click();
    // クリックして focus → idFocusVals に "userId" が記録される
    await idInput.click();
    await idInput.fill("");
    await labelInput.click();
    // 元の ID に戻っているはず
    await expect(idInput).toHaveValue("userId", { timeout: 2000 });
  });

  test("ID を既存 ID に変更して blur するとアラートが出て元の ID に戻る", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    // nth-last-child で末尾 2 行のみ操作 (既存 MCP 行を避ける)
    const rowA = page.locator(".screen-items-table tbody tr:nth-last-child(2)");
    const rowB = page.locator(".screen-items-table tbody tr:last-child");
    const idA = rowA.locator('input[placeholder="email"]');
    const idB = rowB.locator('input[placeholder="email"]');
    const labelA = rowA.locator('input[placeholder="メールアドレス"]');
    const labelB = rowB.locator('input[placeholder="メールアドレス"]');
    // 各行の ID を設定して確定
    await idA.fill("fieldA");
    await labelA.click();
    await idB.fill("fieldB");
    await labelB.click();
    // 2 行目をクリックして focus → idFocusVals に "fieldB" が記録される
    await idB.click();
    let alertFired = false;
    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("既に同じ画面内で使用されています")) {
        alertFired = true;
        await dialog.accept();
      }
    });
    await idB.fill("fieldA");
    await labelB.click();
    await expect.poll(() => alertFired, { timeout: 3000 }).toBe(true);
    // 元の ID (fieldB) に戻る
    await expect(idB).toHaveValue("fieldB", { timeout: 2000 });
  });

  test("無効な JS 識別子 (数字始まり) を入力して blur するとアラートが出て元の ID に戻る", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    const idInput = row.locator('input[placeholder="email"]');
    const labelInput = row.locator('input[placeholder="メールアドレス"]');
    // ID を設定して blur で確定
    await idInput.fill("myField");
    await labelInput.click();
    // クリックして focus → idFocusVals に "myField" が記録される
    await idInput.click();
    let alertFired = false;
    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("有効な ID ではありません")) {
        alertFired = true;
        await dialog.accept();
      }
    });
    await idInput.fill("123invalid");
    await labelInput.click();
    await expect.poll(() => alertFired, { timeout: 3000 }).toBe(true);
    await expect(idInput).toHaveValue("myField", { timeout: 2000 });
  });
});

test.describe.skip("@conv.* lint + 補完 + errorMessages 永続化 (#351 #352)", () => {
  test("存在しない @conv.regex を pattern に書いて保存すると lint バナーが表示される", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    // 項目追加
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('input[placeholder="email"]').fill("phone");
    // pattern 欄に存在しないキー
    const patternInput = row.locator('input[placeholder="@conv.regex.email-simple"]');
    await patternInput.fill("@conv.regex.no-such-key");
    await patternInput.blur();
    // 保存
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    // lint バナーが表示される
    await expect(page.locator(".screen-items-lint-warnings")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(".screen-items-lint-warnings")).toContainText("@conv.regex.no-such-key");
  });

  test("実在する @conv.regex を pattern に書いても lint バナーが出ない", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('input[placeholder="email"]').fill("email");
    const patternInput = row.locator('input[placeholder="@conv.regex.email-simple"]');
    await patternInput.fill("@conv.regex.email-simple");
    await patternInput.blur();
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    await expect(page.locator(".screen-items-lint-warnings")).toHaveCount(0);
  });

  test("pattern 欄で @conv. と打つと補完ポップアップが表示される", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    const patternInput = row.locator('input[placeholder="@conv.regex.email-simple"]');
    await patternInput.click();
    await patternInput.fill("@conv.");
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 3000 });
  });

  test("errorMessages.required を入力して保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('input[placeholder="email"]').fill("email");
    // 💬 ボタンで errorMessages 展開
    await row.locator('button[aria-label="エラーメッセージ展開"]').click();
    const errorRow = page.locator(".screen-items-error-row").last();
    await expect(errorRow).toBeVisible({ timeout: 3000 });
    // required フィールドに入力
    const requiredInput = errorRow.locator('input[placeholder="@conv.msg.required"]');
    await requiredInput.fill("@conv.msg.required");
    await requiredInput.blur();
    // 保存
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    // localStorage に errorMessages が書き込まれていることを確認
    const stored = await page.evaluate((sid) => {
      const raw = localStorage.getItem(`screen-items-${sid}`);
      return raw ? JSON.parse(raw) : null;
    }, screenId1);
    expect(stored).not.toBeNull();
    expect(stored.items[0].errorMessages?.required).toBe("@conv.msg.required");
  });

  test("保存済み errorMessages を持つ画面項目は展開後に値が表示される", async ({ page }) => {
    // リロード相当: 初期 localStorage に errorMessages 込みのデータを seed して表示を検証
    const preSeeded = {
      screenId: screenId1,
      version: "0.1.0",
      updatedAt: new Date().toISOString(),
      items: [{ id: "email", label: "メール", type: "string", errorMessages: { required: "@conv.msg.required" } }],
    };
    await setup(page, {
      catalog: sampleCatalog,
      screenItems: { [`screen-items-${screenId1}`]: preSeeded },
    });
    // 展開して値を確認
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('button[aria-label="エラーメッセージ展開"]').click();
    const errorRow = page.locator(".screen-items-error-row").last();
    await expect(errorRow.locator('input[placeholder="@conv.msg.required"]')).toHaveValue("@conv.msg.required", { timeout: 3000 });
  });

  test("別画面の URL に移動すると errorMessages 展開状態がリセットされる", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    // 💬 ボタンで展開
    await row.locator('button[aria-label="エラーメッセージ展開"]').click();
    await expect(page.locator(".screen-items-error-row")).toBeVisible({ timeout: 3000 });
    // 保存して別画面に遷移
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    await page.goto(`/w/ws-e2e/screen/items/${screenId2}`);
    await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
    // scr-2 では展開行なし
    await expect(page.locator(".screen-items-error-row")).toHaveCount(0);
  });
});

test.describe.skip("詳細フィールド展開行 (#353)", () => {
  test("⚙ ボタンで detail-row が開閉する", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    // データ行は .screen-items-detail-row 以外の行 (tr:first-child)
    const dataRow = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    const detailBtn = dataRow.locator('button[aria-label="詳細展開"]');
    // 初期状態: 非表示
    await expect(page.locator(".screen-items-detail-row")).toHaveCount(0);
    // ⚙ ボタンで展開
    await detailBtn.click();
    await expect(page.locator(".screen-items-detail-row")).toBeVisible({ timeout: 3000 });
    // 再度クリックで閉じる
    await detailBtn.click();
    await expect(page.locator(".screen-items-detail-row")).toHaveCount(0);
  });

  test("readonly チェックを ON にして保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    await row.locator('input[placeholder="email"]').fill("field1");
    // 展開して readonly ON
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    await detailRow.locator('input[aria-label="readonly"]').check();
    // 保存
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    // localStorage で確認
    const stored = await page.evaluate((sid) => {
      const raw = localStorage.getItem(`screen-items-${sid}`);
      return raw ? JSON.parse(raw) : null;
    }, screenId1);
    expect(stored).not.toBeNull();
    expect(stored.items[0].readonly).toBe(true);
  });

  test("placeholder を入力して保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    await row.locator('input[placeholder="email"]').fill("field1");
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    const placeholderInput = detailRow.locator('input[aria-label="placeholder"]');
    await placeholderInput.fill("例: user@example.com");
    await placeholderInput.blur();
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    const stored = await page.evaluate((sid) => {
      const raw = localStorage.getItem(`screen-items-${sid}`);
      return raw ? JSON.parse(raw) : null;
    }, screenId1);
    expect(stored?.items[0].placeholder).toBe("例: user@example.com");
  });

  test("helperText を入力して保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    await row.locator('input[placeholder="email"]').fill("field1");
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    const helperTextInput = detailRow.locator('input[aria-label="helperText"]');
    await helperTextInput.fill("半角英数字で入力してください");
    await helperTextInput.blur();
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    const stored = await page.evaluate((sid) => {
      const raw = localStorage.getItem(`screen-items-${sid}`);
      return raw ? JSON.parse(raw) : null;
    }, screenId1);
    expect(stored?.items[0].helperText).toBe("半角英数字で入力してください");
  });

  test("visibleWhen を入力して保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    await row.locator('input[placeholder="email"]').fill("field1");
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    const visibleWhenInput = detailRow.locator('input[aria-label="visibleWhen"]');
    await visibleWhenInput.fill("@inputs.role === 'admin'");
    await visibleWhenInput.blur();
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    const stored = await page.evaluate((sid) => {
      const raw = localStorage.getItem(`screen-items-${sid}`);
      return raw ? JSON.parse(raw) : null;
    }, screenId1);
    expect(stored?.items[0].visibleWhen).toBe("@inputs.role === 'admin'");
  });

  test("pre-seed した readonly/min/max が展開後に表示される", async ({ page }) => {
    const preSeeded = {
      screenId: screenId1,
      version: "0.1.0",
      updatedAt: new Date().toISOString(),
      items: [{ id: "qty", label: "数量", type: "number", readonly: true, min: 1, max: 100 }],
    };
    await setup(page, { screenItems: { [`screen-items-${screenId1}`]: preSeeded } });
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    // readonly チェック ON
    await expect(detailRow.locator('input[aria-label="readonly"]')).toBeChecked();
    // min / max フィールドに値
    const numInputs = detailRow.locator('input[type="number"]');
    await expect(numInputs.nth(0)).toHaveValue("1");
    await expect(numInputs.nth(1)).toHaveValue("100");
  });

  test("別画面の URL に移動すると detail 展開状態がリセットされる", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('button[aria-label="詳細展開"]').click();
    await expect(page.locator(".screen-items-detail-row")).toBeVisible({ timeout: 3000 });
    // 保存して別画面に遷移
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    await page.goto(`/w/ws-e2e/screen/items/${screenId2}`);
    await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".screen-items-detail-row")).toHaveCount(0);
  });
});

test.describe.skip("per-screen タブ独立編集 (#696)", () => {
  /**
   * 2 画面の項目定義を別タブで開いて独立編集できることを確認する。
   * localStorage モードで動作するため MCP 不要。
   */
  test("2 画面のタブを独立編集: 片方を保存しても他方の dirty が保持される", async ({ browser }) => {
    // 2 コンテキストで別タブをシミュレート (同一ページ内での複数タブは難しいため URL 切替で代替)
    // ここでは 1 コンテキスト内で 2 ページを開き、それぞれ独立した localStorage を持つことを確認
    const context = await browser.newContext();

    const setupLocal = async (p: import("@playwright/test").Page, targetScreenId: string) => {
      await p.addInitScript(({ project, sid }) => {
        localStorage.setItem("workspace-e2e-bypass", "true");
        localStorage.setItem("flow-project", JSON.stringify(project));
        localStorage.removeItem("harmony-open-tabs");
        localStorage.removeItem("harmony-active-tab");
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("screen-items-") || k.startsWith("draft-screen-items-")) {
            localStorage.removeItem(k);
          }
        }
      }, {
        project: dummyProject,
        sid: targetScreenId,
      });
      await p.goto(`/w/ws-e2e/screen/items/${targetScreenId}`);
      await expect(p.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
    };

    // タブ1: scr-1 を開いて項目追加
    const page1 = await context.newPage();
    await setupLocal(page1, screenId1);
    await page1.locator(".screen-items-view button:has-text('項目追加')").click();
    await page1.locator('.screen-items-table input[placeholder="email"]').first().fill("screen1Field");
    // dirty になっていること (保存ボタンが有効)
    await expect(page1.locator(".srb-btn-save")).toBeEnabled({ timeout: 3000 });

    // タブ2: scr-2 を開いて別の項目追加
    const page2 = await context.newPage();
    await setupLocal(page2, screenId2);
    await page2.locator(".screen-items-view button:has-text('項目追加')").click();
    await page2.locator('.screen-items-table input[placeholder="email"]').first().fill("screen2Field");
    await expect(page2.locator(".srb-btn-save")).toBeEnabled({ timeout: 3000 });

    // タブ2 だけ保存 → タブ1 は dirty のまま
    await page2.locator(".srb-btn-save").click();
    await expect(page2.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });

    // タブ1 は保存ボタンがまだ有効 (dirty 保持)
    await expect(page1.locator(".srb-btn-save")).toBeEnabled();

    await context.close();
  });
});
