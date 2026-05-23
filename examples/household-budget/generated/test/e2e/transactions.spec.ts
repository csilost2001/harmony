// Spec: 3a000000-2000-4000-8000-000000000002 (TransactionList)
//       3a000000-2000-4000-8000-000000000003 (TransactionNew)
//       3a000000-2000-4000-8000-000000000004 (TransactionEdit)
// J2: 取引新規登録 — form 入力 → submit → list に新規 row 表示
// J3: 取引一覧閲覧 — 40 件以上の row が時系列で表示
// J4: 取引編集 — 行 click → form pre-filled → memo 変更 → submit → list に反映
// J5: 取引削除 — edit 画面の delete button → confirm → list から row 消失

import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('J2: 取引新規登録', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('取引入力フォームで登録 → 取引一覧に表示される', async ({ page }) => {
    // Navigate to new transaction form
    await page.goto('/transactions/new');
    await expect(page.getByText('取引入力')).toBeVisible({ timeout: 10_000 });

    // Fill form
    const today = new Date().toISOString().slice(0, 10);
    await page.locator('#occurredOn').fill(today);
    // Account and category selects - auto-selects first option
    await page.locator('#amount').fill('9999');
    await page.locator('#memo').fill('E2Eテスト自動入力');

    // Submit
    await page.getByRole('button', { name: '登録する' }).click();

    // Should navigate to /transactions
    await page.waitForURL(/\/transactions$/, { timeout: 15_000 });

    // Verify the new transaction appears in list (use first() to handle duplicate runs)
    await expect(page.getByText('E2Eテスト自動入力').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('J3: 取引一覧閲覧', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('取引一覧に 40 件以上の行が表示される', async ({ page }) => {
    await page.goto('/transactions');
    await expect(page.getByText('取引一覧')).toBeVisible({ timeout: 10_000 });

    // Wait for items to load (not showing "取引がありません")
    await page.waitForFunction(
      () => !document.body.innerText.includes('取引がありません'),
      { timeout: 10_000 }
    );

    // Count list items — seed has 40 transactions
    const rows = page.locator('ul li');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(40);
  });
});

test.describe('J4: 取引編集', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('取引行をクリック → edit フォームが pre-filled → memo 変更 → 更新 → 一覧に反映', async ({ page }) => {
    await page.goto('/transactions');
    await expect(page.getByText('取引一覧')).toBeVisible({ timeout: 10_000 });

    // Wait for rows to load
    const firstRow = page.locator('ul li').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });

    // Click on first row to navigate to edit page
    await firstRow.click();
    await page.waitForURL(/\/transactions\/\d+\/edit/, { timeout: 10_000 });

    await expect(page.getByText('取引編集')).toBeVisible({ timeout: 10_000 });

    // Verify form is pre-filled (amount should not be empty)
    const amountInput = page.locator('#amount');
    await expect(amountInput).not.toHaveValue('');

    // Change memo
    const uniqueMemo = `J4テスト${Date.now()}`;
    const memoInput = page.locator('#memo');
    await memoInput.fill(uniqueMemo);

    // Submit update
    await page.getByRole('button', { name: '更新する' }).click();

    // Should navigate back to /transactions
    await page.waitForURL(/\/transactions$/, { timeout: 15_000 });

    // Verify the updated memo appears in the list
    await expect(page.getByText(uniqueMemo)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('J5: 取引削除', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Edit 画面の削除ボタン → confirm → 一覧から行が消える', async ({ page }) => {
    // First create a transaction to delete (to avoid deleting seed data)
    await page.goto('/transactions/new');
    await expect(page.getByText('取引入力')).toBeVisible({ timeout: 10_000 });
    await page.locator('#amount').fill('1234');
    const deleteMemo = `削除テスト${Date.now()}`;
    await page.locator('#memo').fill(deleteMemo);
    await page.getByRole('button', { name: '登録する' }).click();
    await page.waitForURL(/\/transactions$/, { timeout: 15_000 });

    // Find and click the newly created transaction
    const newRow = page.getByText(deleteMemo);
    await expect(newRow).toBeVisible({ timeout: 10_000 });

    // Click on the list item that contains the delete memo text
    const rowLi = page.locator('ul li').filter({ hasText: deleteMemo });
    await rowLi.click();
    await page.waitForURL(/\/transactions\/\d+\/edit/, { timeout: 10_000 });

    await expect(page.getByText('取引編集')).toBeVisible({ timeout: 10_000 });

    // Handle the confirm dialog
    page.once('dialog', (dialog) => {
      dialog.accept();
    });

    // Click delete button
    await page.getByRole('button', { name: '削除' }).click();

    // Should navigate back to /transactions
    await page.waitForURL(/\/transactions$/, { timeout: 15_000 });

    // Verify the deleted transaction no longer appears
    await expect(page.getByText(deleteMemo)).not.toBeVisible({ timeout: 10_000 });
  });
});
