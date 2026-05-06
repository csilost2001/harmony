// helpers/auth.ts
//
// 認証 helper — Playwright E2E テスト用
// API 経由ログイン (推奨) と UI 経由ログイン (fallback) の 2 方式を提供する。
//
// PLACEHOLDER 解決表:
//   <LOGIN_API_PATH>  : POST /api/auth/login  (diary アプリの認証エンドポイント)
//   <TOKEN_FIELD>     : accessToken           (レスポンス JSON のキー名)
//   <STORAGE_KEY>     : accessToken           (localStorage のキー名)

import { type Page } from '@playwright/test';

export interface LoginCredentials {
  username: string;
  password: string;
}

/**
 * API 経由ログイン helper (推奨: UI 経由より高速)
 *
 * POST /api/auth/login → JWT 取得 → localStorage にセット。
 * UI 遷移なしで認証済み状態を作れるため E2E の冒頭ステップに最適。
 *
 * PLACEHOLDER: diary アプリの実際のエンドポイントとレスポンス形式に合わせて調整すること。
 */
export async function loginAs(page: Page, credentials: LoginCredentials): Promise<void> {
  // API 経由でトークンを取得
  const response = await page.request.post('/api/auth/login', {
    data: {
      username: credentials.username,
      password: credentials.password,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `ログイン失敗: status=${response.status()} body=${await response.text()}`,
    );
  }

  const json = await response.json() as Record<string, unknown>;
  const accessToken = json['accessToken'] as string;

  if (!accessToken) {
    throw new Error(`ログインレスポンスに accessToken が含まれていません: ${JSON.stringify(json)}`);
  }

  // JWT を localStorage にセット
  // PLACEHOLDER: Next.js アプリの auth 実装に応じて調整
  //   - localStorage 方式: localStorage.setItem('accessToken', token)
  //   - cookie 方式: context.addCookies([{ name: 'accessToken', value: token, url: ... }])
  await page.evaluate((token: string) => {
    localStorage.setItem('accessToken', token);
  }, accessToken);
}

/**
 * UI 経由ログイン (fallback: API が /auth/login を提供しない場合)
 *
 * ログイン画面を実際に操作して認証する。
 * API 経由より遅いが、ログイン画面自体の E2E 確認を兼ねる場合に使う。
 *
 * PLACEHOLDER: data-testid の値は diary アプリの実装に合わせること。
 *   "username"    → ログイン画面のユーザー名 input の data-testid
 *   "password"    → パスワード input の data-testid
 *   "loginButton" → ログインボタンの data-testid
 */
export async function loginViaUI(page: Page, credentials: LoginCredentials): Promise<void> {
  await page.goto('/login');
  await page.fill('[data-testid="username"]', credentials.username);
  await page.fill('[data-testid="password"]', credentials.password);
  await page.click('[data-testid="loginButton"]');
  // ログイン後のリダイレクト先 (トップページ "/") まで待機
  await page.waitForURL(url => !url.toString().includes('/login'));
}

/**
 * ログアウト helper
 */
export async function logout(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('accessToken');
  });
}
