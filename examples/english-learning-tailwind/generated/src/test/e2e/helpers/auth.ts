/**
 * auth helper — loginAs() / loginViaUI()
 *
 * techStack.auth.method = "jwt" → loginAs (API 経由) を使用
 *
 * PLACEHOLDER: /api/auth/login エンドポイントのレスポンス形式を確認して
 *   accessToken フィールド名を調整すること。
 */

import type { Page } from '@playwright/test';

interface LoginOptions {
  username: string;
  password: string;
}

/**
 * JWT 認証: API エンドポイント経由でトークンを取得し、localStorage に設定する。
 * techStack.auth.method = "jwt" の場合に使用する。
 *
 * PLACEHOLDER: トークン保存先 (localStorage.accessToken / cookie 等) を確認すること。
 */
export async function loginAs(page: Page, options: LoginOptions): Promise<void> {
  const { username, password } = options;

  // PLACEHOLDER: /api/auth/login エンドポイントを確認すること
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

  // PLACEHOLDER: トークン保存先を確認すること (localStorage / sessionStorage / cookie)
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

  // PLACEHOLDER: ログイン画面の path を確認すること
  await page.goto('/login');
  await page.fill('[data-testid="email"]', username);
  await page.fill('[data-testid="password"]', password);
  await page.click('[data-testid="loginSubmit"]');

  // PLACEHOLDER: ログイン成功後のリダイレクト先を確認すること
  await page.waitForURL('/');
}
