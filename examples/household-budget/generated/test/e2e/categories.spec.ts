// Spec: 3a000000-2000-4000-8000-000000000006 (CategoryList screen)
// Flow: viewer (categories list)
// J7: カテゴリ管理閲覧 — /categories で 12 件のカテゴリが表示

import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('J7: カテゴリ管理閲覧', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('/categories で 12 件のカテゴリが表示される', async ({ page }) => {
    await page.goto('/categories');
    await expect(page.getByText('カテゴリ管理')).toBeVisible({ timeout: 10_000 });

    // Wait for loading to complete
    await page.waitForFunction(
      () => !document.body.innerText.includes('読み込み中...'),
      { timeout: 15_000 }
    );

    // Count category items — seed has 12 categories
    // The page shows categories as list items
    const categoryItems = page.locator('li');
    const count = await categoryItems.count();
    expect(count).toBeGreaterThanOrEqual(12);
  });
});
