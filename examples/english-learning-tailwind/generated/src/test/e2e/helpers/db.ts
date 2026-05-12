/**
 * DB seed/truncate helper
 *
 * Phase D: backend seed.ts で既に user + story id=1 + learning_session id=1 が入っている
 * globalSetup で db:reset を実行済みのため、test 毎の cleanup なし
 */

import type { Page } from '@playwright/test';

// Spec anchor: Scenario scenario-496e43f8-18bcc879 DB helper

interface SeededData {
  storyId: number;
  sessionId?: number;
}

/**
 * テストデータのシード
 * globalSetup (db:reset) で user + story id=1 + learning_session id=1 は設定済み
 */
export async function seedTestData(_page: Page, _scenarioId: string): Promise<SeededData> {
  // backend seed.ts で既に user + story id=1 + learning_session id=1 が入っている
  return { storyId: 1, sessionId: 1 };
}

/**
 * テストデータのクリーンアップ
 * 本 E2E では cleanup なし (sqlite を test 毎に reset せず複数 test 走らせる)
 */
export async function truncateTestData(_page: Page, _scenarioId: string): Promise<void> {
  // 本 E2E では cleanup なし
}
