// Spec helper: auth.ts — shared login helper for all E2E specs
import { Page } from '@playwright/test';

export async function login(page: Page) {
  // Navigate to login page first, then clear any stale token
  await page.goto('/login');
  // Clear token from this page's localStorage context so auth is fresh
  await page.evaluate(() => {
    localStorage.removeItem('accessToken');
  });
  await page.locator('#login_id').fill('demo');
  await page.locator('#password').fill('demo123');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL('http://localhost:3000/', { timeout: 15_000 });
}
