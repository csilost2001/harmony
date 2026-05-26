/**
 * コンポーネントテスト: 投稿一覧 (list)
 *
 * // ===HARMONY_GENERATED_SECTION_START screenId=post-list-screen===
 * // このコメントブロックは /generate-tests スキル再実行時に overwrite される。
 * // anchor の外側 (人手追記 assertion) は保護される。
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * Screen: post-list-screen (投稿一覧)
 * Screen kind: list
 * Screen path: /
 * Screen auth: required
 *
 * === spec → test mapping ===
 *
 * [items[direction=input, id=searchQuery], type=string]
 *   → render テスト: data-testid="searchQuery" が DOM に存在
 *   → input テスト: <input type="text"> に文字入力 → state 更新
 *
 * [items[direction=input, id=selectedTagSlugs], type=array]
 *   → render テスト: data-testid="selectedTagSlugs" が DOM に存在
 *   → input テスト: チェックボックス選択 or multi-select → state 更新
 *
 * [items[direction=input, id=statusFilter], type=enum, options=[all/published/draft]]
 *   → render テスト: data-testid="statusFilter" が DOM に存在
 *   → input テスト: <select> 選択値変更 → state 更新
 *
 * [items[direction=output, id=posts], type=array]
 *   valueFrom.kind=flowVariable, processFlowId=post-search-flow, variableName=posts
 *   → flow httpRoute: GET /api/posts/search
 *   → msw で GET /api/posts/search をインターセプト → mock レスポンス → 投稿カード表示を assert
 *
 * [items[direction=output, id=availableTags], type=array]
 *   valueFrom なし (コンポーネント内部 state / 別途フェッチ)
 *   → render テスト: data-testid="availableTags" が DOM に存在
 *
 * [items[direction=output, id=totalCount], type=integer]
 *   valueFrom.kind=flowVariable, processFlowId=post-search-flow, variableName=totalCount
 *   → msw mock レスポンスの total 値が画面に表示されることを assert
 *
 * [events[] = 空配列]
 *   → events section: spec ↔ impl 乖離検出ノート + skip テストのみ
 *   → #864 (events[] 補完) 完了後に /generate-tests post-list-screen を再実行
 *
 * === 申し送り事項 ===
 * EVENTS-1: events[] が空。#864 (events[] 補完) 完了後に再生成すること。
 *           FAB (新規投稿ボタン) の click → POST /api/posts フロー起動は
 *           events[] 補完後に Section 4 で自動生成される予定。
 * API-1: processFlowId=post-search-flow の httpRoute は
 *        GET /api/posts/search (process-flows/post-search-flow.json より確認済み)。
 * COMPONENT-1: 実際のコンポーネントファイルパスは PLACEHOLDER。
 *              Next.js App Router 構成の場合 app/(dashboard)/page.tsx 等に配置想定。
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// ──────────────────────────────────────────────────────────────
// renderWithProviders (useRouter / auth context wrap)
// ──────────────────────────────────────────────────────────────
// PLACEHOLDER: 実際のプロジェクトでは src/test/renderWithProviders.tsx に移動する
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// next/navigation の mock (Next.js App Router 対応)
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  return render(ui, { wrapper: Wrapper });
}

// ──────────────────────────────────────────────────────────────
// msw サーバー設定
// ──────────────────────────────────────────────────────────────

// ===HARMONY_GENERATED_SECTION_START screenId=post-list-screen===
// output items の valueFrom.kind=flowVariable 解決結果:
//   item:posts       → processFlowId=post-search-flow
//   item:totalCount  → processFlowId=post-search-flow
//   flow httpRoute:  GET /api/posts/search (process-flows/e6f7a8b9...json actions[0].httpRoute)
const mockPosts = [
  {
    postId: 1,
    title: 'テスト投稿タイトル 1',
    summary: 'これはテスト投稿のサマリです。',
    status: 'published',
    mood: '😊',
    publishedAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    authorDisplayName: 'テストユーザー',
    thumbnailUrl: null,
  },
  {
    postId: 2,
    title: 'テスト投稿タイトル 2',
    summary: '下書き投稿のサマリです。',
    status: 'draft',
    mood: '🌧',
    publishedAt: null,
    updatedAt: '2026-05-02T00:00:00.000Z',
    authorDisplayName: 'テストユーザー',
    thumbnailUrl: null,
  },
];

const handlers = [
  // Spec: Screen post-list-screen item:posts
  //   valueFrom.processFlowId=post-search-flow
  //   flow httpRoute: GET /api/posts/search
  http.get('*/api/posts/search', () => {
    return HttpResponse.json({
      items: mockPosts,
      total: 2,
      hasNext: false,
    });
  }),
];
// ===HARMONY_GENERATED_SECTION_END===

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

// ──────────────────────────────────────────────────────────────
// PLACEHOLDER: 実際のコンポーネントを import する
// ──────────────────────────────────────────────────────────────
// import PostsListPage from '@/app/(dashboard)/page';
//
// golden では実際のコンポーネントが無いため、
// 各テストで DOM を手動構築する stub コンポーネントを使用する。
// 実際のテスト生成時はこの stub を削除して上記 import に置き換える。
const StubPostsListPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedTagSlugs, setSelectedTagSlugs] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [posts, setPosts] = React.useState<typeof mockPosts>([]);
  const [availableTags] = React.useState([{ id: 1, name: 'タグ1', slug: 'tag-1', color: '#ff0000' }]);
  const [totalCount, setTotalCount] = React.useState<number>(0);

  React.useEffect(() => {
    fetch('/api/posts/search')
      .then(r => r.json())
      .then(data => {
        setPosts(data.items ?? []);
        setTotalCount(data.total ?? 0);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      {/* Spec: Screen post-list-screen item:searchQuery direction=input type=string */}
      <input
        data-testid="searchQuery"
        type="text"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder="投稿を検索…"
      />

      {/* Spec: Screen post-list-screen item:selectedTagSlugs direction=input type=array */}
      <div data-testid="selectedTagSlugs">
        {availableTags.map(tag => (
          <input
            key={tag.slug}
            data-testid={`selectedTagSlugs-${tag.slug}`}
            type="checkbox"
            checked={selectedTagSlugs.includes(tag.slug)}
            onChange={e => {
              if (e.target.checked) {
                setSelectedTagSlugs(prev => [...prev, tag.slug]);
              } else {
                setSelectedTagSlugs(prev => prev.filter(s => s !== tag.slug));
              }
            }}
          />
        ))}
      </div>

      {/* Spec: Screen post-list-screen item:statusFilter direction=input type=enum options=[all,published,draft] */}
      <select
        data-testid="statusFilter"
        value={statusFilter}
        onChange={e => setStatusFilter(e.target.value)}
      >
        <option value="all">全部</option>
        <option value="published">公開</option>
        <option value="draft">下書き</option>
      </select>

      {/* Spec: Screen post-list-screen item:posts direction=output type=array valueFrom.kind=flowVariable */}
      <ul data-testid="posts">
        {posts.map(p => (
          <li key={p.postId} data-testid={`post-${p.postId}`}>{p.title}</li>
        ))}
      </ul>

      {/* Spec: Screen post-list-screen item:availableTags direction=output type=array */}
      <div data-testid="availableTags">
        {availableTags.map(t => (
          <span key={t.id} data-testid={`tag-${t.slug}`}>{t.name}</span>
        ))}
      </div>

      {/* Spec: Screen post-list-screen item:totalCount direction=output type=integer valueFrom.kind=flowVariable */}
      <span data-testid="totalCount">{totalCount}</span>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Section 1: render — items が DOM に存在すること
// ──────────────────────────────────────────────────────────────
describe('投稿一覧コンポーネント', () => {

  describe('Section 1: render — items が DOM に存在すること', () => {

    /**
     * Spec: Screen post-list-screen item:searchQuery
     *   direction=input, type=string
     */
    it('#1 searchQuery (data-testid="searchQuery") が表示される', () => {
      renderWithProviders(<StubPostsListPage />);
      expect(screen.getByTestId('searchQuery')).toBeInTheDocument();
    });

    /**
     * Spec: Screen post-list-screen item:selectedTagSlugs
     *   direction=input, type=array
     */
    it('#2 selectedTagSlugs (data-testid="selectedTagSlugs") が表示される', () => {
      renderWithProviders(<StubPostsListPage />);
      expect(screen.getByTestId('selectedTagSlugs')).toBeInTheDocument();
    });

    /**
     * Spec: Screen post-list-screen item:statusFilter
     *   direction=input, type=enum, options=[all,published,draft]
     */
    it('#3 statusFilter (data-testid="statusFilter") が表示される', () => {
      renderWithProviders(<StubPostsListPage />);
      expect(screen.getByTestId('statusFilter')).toBeInTheDocument();
    });

    /**
     * Spec: Screen post-list-screen item:posts
     *   direction=output, type=array, valueFrom.kind=flowVariable
     */
    it('#4 posts (data-testid="posts") が表示される', () => {
      renderWithProviders(<StubPostsListPage />);
      expect(screen.getByTestId('posts')).toBeInTheDocument();
    });

    /**
     * Spec: Screen post-list-screen item:availableTags
     *   direction=output, type=array (valueFrom なし)
     */
    it('#5 availableTags (data-testid="availableTags") が表示される', () => {
      renderWithProviders(<StubPostsListPage />);
      expect(screen.getByTestId('availableTags')).toBeInTheDocument();
    });

    /**
     * Spec: Screen post-list-screen item:totalCount
     *   direction=output, type=integer, valueFrom.kind=flowVariable
     */
    it('#6 totalCount (data-testid="totalCount") が表示される', () => {
      renderWithProviders(<StubPostsListPage />);
      expect(screen.getByTestId('totalCount')).toBeInTheDocument();
    });

  });

  // ──────────────────────────────────────────────────────────────
  // Section 2: input — direction=input items の state 更新
  // ──────────────────────────────────────────────────────────────
  describe('Section 2: input — state 更新テスト', () => {

    /**
     * Spec: Screen post-list-screen item:searchQuery
     *   direction=input, type=string
     *   <input type="text"> に文字入力 → value が更新される
     */
    it('#7 searchQuery に値を入力すると state が更新される', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StubPostsListPage />);

      const input = screen.getByTestId('searchQuery') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, '日記テスト');

      expect(input).toHaveValue('日記テスト');
    });

    /**
     * Spec: Screen post-list-screen item:statusFilter
     *   direction=input, type=enum, options=[all,published,draft]
     *   <select> の選択値変更 → value が更新される
     */
    it('#8 statusFilter の選択値を "published" に変更すると state が更新される', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StubPostsListPage />);

      const select = screen.getByTestId('statusFilter') as HTMLSelectElement;
      await user.selectOptions(select, 'published');

      expect(select).toHaveValue('published');
    });

    /**
     * Spec: Screen post-list-screen item:statusFilter
     *   direction=input, type=enum, options=[all,published,draft]
     *   defaultValue="all" が初期値になっている
     */
    it('#9 statusFilter の初期値が "all" である', () => {
      renderWithProviders(<StubPostsListPage />);

      const select = screen.getByTestId('statusFilter') as HTMLSelectElement;
      expect(select).toHaveValue('all');
    });

    /**
     * Spec: Screen post-list-screen item:selectedTagSlugs
     *   direction=input, type=array
     *   checkbox を click → 配列に slug が追加される
     */
    it('#10 selectedTagSlugs のチェックボックスを選択すると追加される', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StubPostsListPage />);

      const checkbox = screen.getByTestId('selectedTagSlugs-tag-1') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);

      await user.click(checkbox);
      expect(checkbox.checked).toBe(true);
    });

    /**
     * Spec: Screen post-list-screen item:selectedTagSlugs
     *   direction=input, type=array
     *   選択済み checkbox を再 click → 配列から slug が除去される
     */
    it('#11 selectedTagSlugs のチェックボックスを再クリックすると除去される', async () => {
      const user = userEvent.setup();
      renderWithProviders(<StubPostsListPage />);

      const checkbox = screen.getByTestId('selectedTagSlugs-tag-1') as HTMLInputElement;
      await user.click(checkbox); // 追加
      expect(checkbox.checked).toBe(true);

      await user.click(checkbox); // 除去
      expect(checkbox.checked).toBe(false);
    });

  });

  // ──────────────────────────────────────────────────────────────
  // Section 3: output — API レスポンスが画面に反映されること
  // ──────────────────────────────────────────────────────────────
  describe('Section 3: output — API レスポンスが画面に反映されること', () => {

    /**
     * Spec: Screen post-list-screen item:posts
     *   direction=output, type=array
     *   valueFrom.kind=flowVariable, processFlowId=post-search-flow, variableName=posts
     *
     * msw で GET /api/posts/search をインターセプト → mockPosts[0].title が表示される
     */
    it('#12 posts が API レスポンスから表示される', async () => {
      renderWithProviders(<StubPostsListPage />);

      await waitFor(() => {
        expect(screen.getByText('テスト投稿タイトル 1')).toBeInTheDocument();
        expect(screen.getByText('テスト投稿タイトル 2')).toBeInTheDocument();
      });
    });

    /**
     * Spec: Screen post-list-screen item:posts
     *   direction=output, type=array
     *   msw mock で 2 件返す → post カードが 2 件表示される
     */
    it('#13 posts が 2 件表示される (mock の total=2 と一致)', async () => {
      renderWithProviders(<StubPostsListPage />);

      await waitFor(() => {
        const postItems = screen.getAllByTestId(/^post-/);
        expect(postItems).toHaveLength(2);
      });
    });

    /**
     * Spec: Screen post-list-screen item:totalCount
     *   direction=output, type=integer
     *   valueFrom.kind=flowVariable, processFlowId=e6f7a8b9-..., variableName=totalCount
     *
     * msw mock の total=2 → totalCount 要素が "2" を表示する
     */
    it('#14 totalCount が API レスポンスの total 値を表示する', async () => {
      renderWithProviders(<StubPostsListPage />);

      await waitFor(() => {
        const el = screen.getByTestId('totalCount');
        expect(el.textContent).toBe('2');
      });
    });

    /**
     * Spec: Screen post-list-screen item:availableTags
     *   direction=output, type=array (valueFrom なし)
     *   コンポーネント内部で管理されるタグ一覧が表示される
     */
    it('#15 availableTags がレンダリングされる', () => {
      renderWithProviders(<StubPostsListPage />);

      expect(screen.getByTestId('availableTags')).toBeInTheDocument();
      // PLACEHOLDER: 実際のタグデータを取得する API が決まったら msw mock を追加する
    });

    /**
     * Spec: Screen post-list-screen item:posts
     *   API エラー時の挙動 (msw で 500 を返す)
     */
    it('#16 GET /api/posts/search が 500 を返しても posts エリアは表示される', async () => {
      server.use(
        http.get('*/api/posts/search', () => {
          return new HttpResponse(null, { status: 500 });
        }),
      );

      renderWithProviders(<StubPostsListPage />);

      // エラー時は posts が空のまま表示される (クラッシュしないこと)
      await waitFor(() => {
        expect(screen.getByTestId('posts')).toBeInTheDocument();
      });
    });

  });

  // ──────────────────────────────────────────────────────────────
  // Section 4: events — events[] 空配列 → skip + 乖離検出ノート
  // ──────────────────────────────────────────────────────────────
  describe('Section 4: events — ボタンクリックで fetch が発火すること', () => {

    /**
     * NOTICE: Screen post-list-screen の events[] は現在空配列です。
     *
     * events[] 補完 (#864) が完了したら再生成してください:
     *   /generate-tests post-list-screen
     *
     * 【spec ↔ impl 乖離検出ノート】
     * events 未定義の場合、コンポーネント側のボタン (例: FAB「新規投稿」) が
     * hardcode された fetch を呼んでいても spec 追跡が不可能になる。
     * events[] 補完後に以下を必ず確認すること:
     *   1. FAB クリック → POST /api/posts (投稿作成フロー 0671b051-...) の起動
     *   2. タグフィルタ変更 → GET /api/posts/search の再呼び出し
     *   3. handlerFlowId → httpRoute → fetch URL のマッピングを確認する
     *   4. /generate-tests post-list-screen を再実行して
     *      Section 4 を自動更新する
     */
    it.skip('#17 events テストは events[] 補完 (#864) 完了後に生成予定', () => {
      // このテストは events[] が空のため skip している。
      // #864 が close されたら /generate-tests post-list-screen を再実行すること。
    });

  });

});
