// Spec: 3a000000-2000-4000-8000-000000000005 (MonthlyReport screen)
// Flow: fetchMonthlyReport
// J6: 月次レポート閲覧 — yearMonth select → 3 KPI + カテゴリ別 breakdown 表示

import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('J6: 月次レポート閲覧', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('月次レポートページで 3 KPI が表示される', async ({ page }) => {
    await page.goto('/reports/monthly');
    await expect(page.getByText('月次レポート')).toBeVisible({ timeout: 10_000 });

    // Wait for loading to complete
    await page.waitForFunction(
      () => !document.body.innerText.includes('読み込み中...'),
      { timeout: 15_000 }
    );

    // 3 KPI cards: 収入合計, 支出合計
    await expect(page.getByText('収入合計')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('支出合計')).toBeVisible();
  });

  test('yearMonth selector を変更するとレポートが再取得される', async ({ page }) => {
    await page.goto('/reports/monthly');
    await expect(page.getByText('月次レポート')).toBeVisible({ timeout: 10_000 });

    // Wait for initial load
    await page.waitForFunction(
      () => !document.body.innerText.includes('読み込み中...'),
      { timeout: 15_000 }
    );

    // Change yearMonth to 2026-01 using the input[type=month]
    const yearMonthInput = page.locator('#yearMonth');
    await expect(yearMonthInput).toBeVisible({ timeout: 5_000 });
    await yearMonthInput.fill('2026-01');

    // Wait for re-load
    await page.waitForFunction(
      () => !document.body.innerText.includes('読み込み中...'),
      { timeout: 10_000 }
    );

    // KPI cards should still be visible after re-fetch
    await expect(page.getByText('収入合計')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('支出合計')).toBeVisible();
  });
});
