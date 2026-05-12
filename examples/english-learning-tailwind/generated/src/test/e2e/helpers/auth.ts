/**
 * auth helper — loginAs() / loginViaUI()
 *
 * techStack.auth.method = "jwt" → loginAs (API 経由) を使用。
 * POST /api/auth/login は { accessToken } を返す (本 dogfood の NestJS AuthController 実装)。
 */

import type { Page } from '@playwright/test';

interface LoginOptions {
  username: string;
  password: string;
}

/**
 * JWT 認証: API エンドポイント経由でトークンを取得し、localStorage に設定する。
 * techStack.auth.method = "jwt" の場合に使用する。
 * 本 dogfood は accessToken を localStorage に保存し Authorization: Bearer で送信する。
 */
export async function loginAs(page: Page, options: LoginOptions): Promise<void> {
  const { username, password } = options;

  const response = await page.request.post('/api/auth/login', {
    data: { email: username, password },
  });

  if (!response.ok()) {
    throw new Error(`Login failed: ${response.status()} ${await response.text()}`);
  }

  const body = await response.json();
  const accessToken = body.accessToken ?? body.token ?? body.access_token;

  if (!accessToken) {
    throw new Error(`Access token not found in response: ${JSON.stringify(body)}`);
  }

  // Navigate to root first so localStorage is accessible (avoids about:blank SecurityError)
  if (page.url() === 'about:blank' || !page.url().startsWith('http')) {
    await page.goto('/');
  }

  await page.evaluate((token) => {
    localStorage.setItem('accessToken', token);
  }, accessToken);
}

/**
 * セッション認証: UI 経由でログインする。
 * techStack.auth.method = "session" の場合に使用する。
 * english-learning-tailwind は jwt を使うため、このヘルパーは補助用。
 */
export async function loginViaUI(page: Page, options: LoginOptions): Promise<void> {
  const { username, password } = options;

  // 本 dogfood の loginViaUI は補助用 (jwt 方式のため未使用)。
  // 採用プロジェクトで session 方式時のサンプル経路として保持する。
  await page.goto('/login');
  await page.fill('[data-testid="email"]', username);
  await page.fill('[data-testid="password"]', password);
  await page.click('[data-testid="loginSubmit"]');
  await page.waitForURL('/');
}
