// Spec: 3a000000-2000-4000-8000-000000000001 (Dashboard screen) + auth flow
// J1: 初回アクセス → login redirect → login 成功 → dashboard 表示 + 当月収支 KPI

import { test, expect } from '@playwright/test';

test.describe('J1: 初回アクセス + login 後ダッシュボード表示', () => {
  test('未認証で / にアクセスすると /login にリダイレクトされる', async ({ page }) => {
    // Clear token so the test starts unauthenticated
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('accessToken'));
    await page.goto('/');
    await page.waitForURL(/\/login$/);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('login 後にダッシュボードが表示される + KPI 3 カード', async ({ page }) => {
    await page.goto('/login');
    // Fill the login form using element IDs matching the actual login page
    await page.locator('#login_id').fill('demo');
    await page.locator('#password').fill('demo123');
    await page.getByRole('button', { name: 'ログイン' }).click();

    // Should redirect to dashboard
    await page.waitForURL('/', { timeout: 15_000 });
    await expect(page).toHaveURL('/');

    // Dashboard title
    await expect(page.getByText('家計簿ダッシュボード')).toBeVisible({ timeout: 10_000 });

    // KPI cards: 今月の収入, 今月の支出, 今月の収支
    await expect(page.getByText('今月の収入')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('今月の支出')).toBeVisible();
    await expect(page.getByText('今月の収支')).toBeVisible();
  });
});
