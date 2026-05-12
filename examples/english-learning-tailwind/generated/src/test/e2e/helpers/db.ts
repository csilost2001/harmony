/**
 * DB seed/truncate helper
 *
 * database.type = "postgresql" → Prisma (PrismaClient) を使用
 *
 * PLACEHOLDER: Prisma スキーマのモデル名を確認すること。
 *   - stories → Story model
 *   - learning_sessions → LearningSession model
 *   - turn_logs → TurnLog model
 */

import type { Page } from '@playwright/test';

// Spec anchor: Scenario scenario-496e43f8-18bcc879 DB helper

interface SeededData {
  storyId: number;
  sessionId?: number;
}

/**
 * テストデータのシード
 * シナリオ固有のテストデータを DB に作成し、参照 ID を返す。
 *
 * PLACEHOLDER: テスト用ユーザーのシードも行うこと (users テーブル)
 */
export async function seedTestData(page: Page, scenarioId: string): Promise<SeededData> {
  // PLACEHOLDER: Prisma またはテスト専用 API エンドポイントでシードを行うこと
  // 以下は Prisma 直接呼び出しの例 (API server 側で実行)

  // 暫定: テスト用ストーリー ID を固定値で返す (実際は DB から取得)
  // PLACEHOLDER: db.ts は実際の Prisma クライアント呼び出しを実装すること
  return {
    storyId: 1, // PLACEHOLDER: 既存ストーリーの ID を使用するか新規作成すること
    sessionId: undefined,
  };
}

/**
 * テストデータのクリーンアップ
 * seedTestData で作成したデータを削除する。
 */
export async function truncateTestData(page: Page, scenarioId: string): Promise<void> {
  // PLACEHOLDER: 作成したテストデータを削除すること
  // 例: await prisma.learningSession.deleteMany({ where: { story_id: seededData.storyId } });
  // 例: await prisma.story.deleteMany({ where: { title: { startsWith: 'E2E_TEST_' } } });
}
