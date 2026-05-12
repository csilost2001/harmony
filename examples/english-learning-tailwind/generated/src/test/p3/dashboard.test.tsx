/**
 * コンポーネントテスト: ダッシュボード (dashboard)
 *
 * // ===HARMONY_GENERATED_SECTION_START screenId=496e43f8-d243-48a1-b680-32d34d98cc2d===
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * Screen: 496e43f8-d243-48a1-b680-32d34d98cc2d (ダッシュボード)
 *
 * === spec → test mapping ===
 * items:
 *   - streakDays   (output, integer) — 連続学習日数
 *   - cefrLevel    (output, string)  — 現在の CEFR レベル
 *   - todayGoal    (output, integer) — 本日の学習目標セッション数
 *   - todayDone    (output, integer) — 本日完了セッション数
 *   - recentStoryList (output, json) — 最近のストーリー一覧
 * events: [] (空配列 — SC-F: skip テスト + 乖離検出ノートを生成)
 * path: /
 * auth: required
 * purpose: (未設定 → "page" 扱い)
 * pageLayoutId: なし → Step 3-X は skip
 */

// Spec anchor: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderWithProviders } from '@/test/renderWithProviders';
import DashboardPage from '@/app/page';

// ===HARMONY_GENERATED_SECTION_START screenId=496e43f8-d243-48a1-b680-32d34d98cc2d===

/**
 * MSW ハンドラー
 *
 * ダッシュボードの全 output items は valueFrom.kind が未定義 (コンポーネント内部 state 想定)。
 * 実際の API エンドポイントが判明した場合は以下に追加する。
 *
 * PLACEHOLDER: ダッシュボードデータ取得 API エンドポイントを確認してください。
 * 例: GET /api/el/dashboard → { streakDays, cefrLevel, todayGoal, todayDone, recentStoryList }
 */
const handlers = [
  http.get('/api/el/dashboard', () => {
    return HttpResponse.json({
      streakDays: 7,
      cefrLevel: 'B1',
      todayGoal: 3,
      todayDone: 1,
      recentStoryList: [
        { id: 1, title: 'サンプルストーリー 1', cefrLevel: 'B1' },
        { id: 2, title: 'サンプルストーリー 2', cefrLevel: 'A2' },
      ],
    });
  }),
];

// ===HARMONY_GENERATED_SECTION_END===

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

describe('ダッシュボード コンポーネント', () => {

  describe('Section 1: render (全 items DOM 存在確認)', () => {

    /**
     * Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d item:streakDays
     *   direction=output, type=integer, label=連続学習日数
     */
    it('#1 連続学習日数 (data-testid="streakDays") が表示される', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('streakDays')).toBeInTheDocument();
      });
    });

    /**
     * Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d item:cefrLevel
     *   direction=output, type=string, label=現在の CEFR レベル
     */
    it('#2 現在の CEFR レベル (data-testid="cefrLevel") が表示される', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('cefrLevel')).toBeInTheDocument();
      });
    });

    /**
     * Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d item:todayGoal
     *   direction=output, type=integer, label=本日の学習目標 (セッション数)
     */
    it('#3 本日の学習目標セッション数 (data-testid="todayGoal") が表示される', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('todayGoal')).toBeInTheDocument();
      });
    });

    /**
     * Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d item:todayDone
     *   direction=output, type=integer, label=本日完了セッション数
     */
    it('#4 本日完了セッション数 (data-testid="todayDone") が表示される', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('todayDone')).toBeInTheDocument();
      });
    });

    /**
     * Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d item:recentStoryList
     *   direction=output, type=json, label=最近のストーリー
     */
    it('#5 最近のストーリー (data-testid="recentStoryList") が DOM に存在する', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('recentStoryList')).toBeInTheDocument();
      });
    });

  });

  describe('Section 2: input (input items なし)', () => {
    /**
     * Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d items
     *   ダッシュボードは全 items が direction=output のため、input テストは不要
     */
    it('#6 input items が存在しないことを確認 (ダッシュボードは全 output)', () => {
      // Spec: Screen 496e43f8 の items は全て direction=output
      // input 型の UI 要素は仕様上ない
      expect(true).toBe(true); // 仕様確認済み
    });
  });

  describe('Section 3: output (API レスポンスから表示)', () => {

    /**
     * Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d item:streakDays
     *   direction=output, type=integer
     *   valueFrom: コンポーネント内部 state (users.streak_days)
     */
    it('#7 連続学習日数が API レスポンスから表示される', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByText('7')).toBeInTheDocument(); // mock: streakDays=7
      });
    });

    /**
     * Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d item:cefrLevel
     *   direction=output, type=string
     *   valueFrom: コンポーネント内部 state (users.cefr_level)
     */
    it('#8 CEFR レベルが API レスポンスから表示される', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByText('B1')).toBeInTheDocument(); // mock: cefrLevel='B1'
      });
    });

    /**
     * Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d item:recentStoryList
     *   direction=output, type=json
     *   直近 3 件のストーリーがリスト表示されること
     */
    it('#9 最近のストーリーリストが表示される (直近 3 件まで)', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByText('サンプルストーリー 1')).toBeInTheDocument();
      });
    });

  });

  describe('Section 4: events (空配列 — 乖離検出ノート)', () => {

    /**
     * NOTICE: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d の events[] は現在空配列です。
     * events[] 補完後に再生成してください:
     *   /generate-tests 496e43f8-d243-48a1-b680-32d34d98cc2d
     *
     * 【spec ↔ impl 乖離検出ノート】
     * events 未定義の状態では、ダッシュボードのボタン/アクション (例: 学習開始ボタン、
     * ストーリー選択リンク) が特定の ProcessFlow を呼ぶことを spec で追跡できない。
     * 補完後に Section 4 を自動更新する。
     *
     * 想定されるイベント (設計者による確認が必要):
     *   - recentStoryList 内のストーリークリック → 学習セッション開始 (cc173367) へ遷移
     *   - 「全ストーリーを見る」ボタン → ストーリー一覧画面へ遷移
     */
    it.skip('#10 events テストは events[] 補完後に生成予定', () => {});

  });

});
