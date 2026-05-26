# COMPONENT_SPEC.md — React (Next.js) + Tailwind コンポーネントテスト構造規約

`/generate-tests` スキルが Screen JSON から生成するコンポーネントテストファイル
(`<screenName>.component.test.tsx`) の構造規約とコードテンプレートを定義する。

対象 techStack:
- `frontend.library = "react"` + `frontend.framework = "next"`
- test runner: `vitest` + `@testing-library/react` (D-6 確定)

---

## 1. ファイル先頭 header (D-1 / D-4 anchor)

```typescript
/**
 * コンポーネントテスト: <Screen.name> (<Screen.kind>)
 *
 * // ===HARMONY_GENERATED_SECTION_START screenId=<screenId>===
 * // このコメントブロックは /generate-tests スキル再実行時に overwrite される。
 * // anchor の外側 (人手追記 assertion) は保護される。
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * Screen: <screenId> (<Screen.name>)
 *
 * === spec → test mapping ===
 *
 * [items[direction=input]]
 *   → render テスト: data-item-id="<item.id>" が DOM に存在
 *   → input テスト: type 別の state 更新 (string→input, enum→select, array→checkbox/multi-select, boolean→toggle, date→input[type=date])
 *
 * [items[direction=output, valueFrom.kind=flowVariable]]
 *   → output テスト: msw で flow の httpRoute を mock → 表示内容を assert
 *
 * [events[].handlerFlowId (events 配列あり)]
 *   → events テスト: button click → fetch が正しい body で発火 (vi.fn() mock)
 *
 * [events[] 空配列]
 *   → events section: spec ↔ impl 乖離検出ノート + skip テストのみ生成
 *
 * === 申し送り事項 ===
 * EVENTS-1: events[] が空。#864 (events[] 補完) 完了後に再生成すること。
 */
```

---

## 2. import 規約

```typescript
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderWithProviders } from '@/test/renderWithProviders';   // ← provider wrap ヘルパー
// import PostsListPage from '@/app/(dashboard)/page';              // PLACEHOLDER: 実際のコンポーネントパスに置換
```

---

## 3. renderWithProviders ヘルパー

コンポーネントには `useRouter`・auth context・QueryClient など複数のプロバイダーが必要な場合が多い。
テスト専用の `renderWithProviders` ヘルパーを `src/test/renderWithProviders.tsx` (または相当パス) に置く。

```typescript
// src/test/renderWithProviders.tsx
import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// import { SessionProvider } from 'next-auth/react';  // auth=required の画面
// import { useRouter } from 'next/navigation';

// useRouter の mock (next/navigation)
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

interface RenderWithProvidersOptions extends RenderOptions {
  session?: { user?: { id: string; name: string } } | null;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
) {
  const { session = null, ...renderOptions } = options;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {/* screen.auth=required の場合は SessionProvider を追加 */}
      {/* <SessionProvider session={session}> */}
        {children}
      {/* </SessionProvider> */}
    </QueryClientProvider>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
```

**使い方**:
```typescript
const { getByTestId } = renderWithProviders(<PostsListPage />);
```

---

## 4. msw サーバーセットアップ

`output` items の `valueFrom.kind=flowVariable` を持つ items は msw で API を mock する。

### 4-1. processFlowId → httpRoute 解決手順

1. `output.valueFrom.processFlowId` を取得
2. `<workspace>/harmony/process-flows/<processFlowId>.json` を Read
3. `actions[0].httpRoute.method + actions[0].httpRoute.path` を取得
4. その URL を msw でインターセプト

### 4-2. msw handler テンプレート

```typescript
// ===HARMONY_GENERATED_SECTION_START screenId=<screenId>===
const handlers = [
  // <OUTPUT_ITEM_LABEL> (<OUTPUT_ITEM_ID>): processFlowId=<PROCESS_FLOW_ID>
  // flow httpRoute: <HTTP_METHOD> <HTTP_PATH>
  http.<method>('<API_BASE><HTTP_PATH>', () => {
    return HttpResponse.json({
      items: [
        {
          id: 1,
          // PLACEHOLDER: <PROCESS_FLOW_NAME> のレスポンス構造に合わせて記述
          // flow.outputs[] を参照して適切なフィールドを追加
        },
      ],
      total: 1,
      hasNext: false,
    });
  }),
];
// ===HARMONY_GENERATED_SECTION_END===

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());
```

### 4-3. httpRoute が未解決の場合 (PLACEHOLDER パターン)

processFlowId の JSON に httpRoute が無い場合:

```typescript
// PLACEHOLDER: processFlowId=<PROCESS_FLOW_ID> の httpRoute を確認して置換
// 確認方法: process-flows/<PROCESS_FLOW_ID>.json の actions[0].httpRoute.method / path
http.get('<API_BASE>/PLACEHOLDER_PATH', () => {
  return HttpResponse.json({/* PLACEHOLDER: レスポンス構造を記述 */});
}),
```

---

## 5. section 構成 (7 sections)

### Section 1: render — items が DOM に存在すること

全 items (input / output) が `data-item-id` 属性付きで DOM にマウントされることを確認する。

```typescript
// ===HARMONY_GENERATED_SECTION_START screenId=<screenId>===
describe('<Screen.name> コンポーネント', () => {

  // ─────────────────────────────────────────────────
  // Section 1: render
  // ─────────────────────────────────────────────────
  describe('render: items が DOM に存在すること', () => {

    /**
     * Spec: Screen <screenId> item:<ITEM_ID>
     *   direction=<DIRECTION>, type=<TYPE>
     */
    it('#1 <ITEM_LABEL> (data-item-id="<ITEM_ID>") が表示される', async () => {
      renderWithProviders(<COMPONENT_NAME />);
      await waitFor(() => {
        expect(screen.getByTestId('<ITEM_ID>')).toBeInTheDocument();
      });
    });

    // 全 items 分を繰り返す
  });
```

**実装前提**: コンポーネント側は各 item に `data-testid={item.id}` (= `data-item-id` と等価) を付与する。

---

### Section 2: input — direction=input items の state 更新

`direction=input` の items は、type 別に適切な DOM element を操作して state が更新されることを確認する。

#### type 別 snippet

##### string → `<input type="text">`

```typescript
/**
 * Spec: Screen <screenId> item:<ITEM_ID>
 *   direction=input, type=string
 */
it('#N <ITEM_LABEL> に値を入力すると state が更新される', async () => {
  const user = userEvent.setup();
  renderWithProviders(<COMPONENT_NAME />);

  const input = screen.getByTestId('<ITEM_ID>') as HTMLInputElement;
  await user.clear(input);
  await user.type(input, 'テスト入力値');

  expect(input).toHaveValue('テスト入力値');
});
```

##### enum → `<select>` (options[] あり)

```typescript
/**
 * Spec: Screen <screenId> item:<ITEM_ID>
 *   direction=input, type=enum, options=[<OPTIONS>]
 */
it('#N <ITEM_LABEL> の選択値が変更される', async () => {
  const user = userEvent.setup();
  renderWithProviders(<COMPONENT_NAME />);

  const select = screen.getByTestId('<ITEM_ID>') as HTMLSelectElement;
  await user.selectOptions(select, '<OPTION_VALUE>');

  expect(select).toHaveValue('<OPTION_VALUE>');
});
```

##### array → `<input type="checkbox">` または multi-select

array type の items は実装パターンが 2 種類ある:
- チェックボックス群 (複数 checkbox)
- multi-select `<select multiple>`

```typescript
/**
 * Spec: Screen <screenId> item:<ITEM_ID>
 *   direction=input, type=array
 */
// パターン A: checkbox 群
it('#N <ITEM_LABEL> のチェックボックスを選択すると配列に追加される', async () => {
  const user = userEvent.setup();
  renderWithProviders(<COMPONENT_NAME />);

  // PLACEHOLDER: checkbox の testid は "<ITEM_ID>-<value>" 規約を推奨
  const checkbox = screen.getByTestId('<ITEM_ID>-<CHECKBOX_VALUE>') as HTMLInputElement;
  await user.click(checkbox);

  expect(checkbox).toBeChecked();
});

// パターン B: data-item-id 付き select[multiple]
it('#N <ITEM_LABEL> で複数選択すると state が更新される', async () => {
  const user = userEvent.setup();
  renderWithProviders(<COMPONENT_NAME />);

  const select = screen.getByTestId('<ITEM_ID>') as HTMLSelectElement;
  await user.selectOptions(select, ['<VALUE_1>', '<VALUE_2>']);

  const selectedValues = Array.from(select.selectedOptions).map(o => o.value);
  expect(selectedValues).toContain('<VALUE_1>');
  expect(selectedValues).toContain('<VALUE_2>');
});
```

##### boolean → toggle / checkbox

```typescript
/**
 * Spec: Screen <screenId> item:<ITEM_ID>
 *   direction=input, type=boolean
 */
it('#N <ITEM_LABEL> のトグルが切り替わる', async () => {
  const user = userEvent.setup();
  renderWithProviders(<COMPONENT_NAME />);

  const toggle = screen.getByTestId('<ITEM_ID>') as HTMLInputElement;
  expect(toggle.checked).toBe(false);  // 初期値確認
  await user.click(toggle);
  expect(toggle.checked).toBe(true);
});
```

##### date → `<input type="date">`

```typescript
/**
 * Spec: Screen <screenId> item:<ITEM_ID>
 *   direction=input, type=date (または string + format=date)
 */
it('#N <ITEM_LABEL> に日付を入力すると state が更新される', async () => {
  const user = userEvent.setup();
  renderWithProviders(<COMPONENT_NAME />);

  const dateInput = screen.getByTestId('<ITEM_ID>') as HTMLInputElement;
  await user.clear(dateInput);
  // fireEvent.change で type=date の値を設定 (userEvent は type=date と相性が悪い場合あり)
  fireEvent.change(dateInput, { target: { value: '2026-01-15' } });

  expect(dateInput).toHaveValue('2026-01-15');
});
```

---

### Section 3: output — direction=output / valueFrom.kind=flowVariable

```typescript
  // ─────────────────────────────────────────────────
  // Section 3: output
  // ─────────────────────────────────────────────────
  describe('output: API レスポンスが画面に反映されること', () => {

    /**
     * Spec: Screen <screenId> item:<OUTPUT_ITEM_ID>
     *   direction=output, valueFrom.kind=flowVariable
     *   processFlowId=<PROCESS_FLOW_ID>, variableName=<VARIABLE_NAME>
     *
     * msw で GET <HTTP_PATH> をインターセプトして mock レスポンスを返す
     */
    it('#N <OUTPUT_ITEM_LABEL> が API レスポンスから表示される', async () => {
      renderWithProviders(<COMPONENT_NAME />);

      // API 呼び出し完了を待機
      await waitFor(() => {
        // PLACEHOLDER: コンポーネントの表示ロジックに合わせて assert を記述
        // 例: mock の items[0].title が表示される
        expect(screen.getByText('<MOCK_RESPONSE_FIELD_VALUE>')).toBeInTheDocument();
      });
    });

    /**
     * Spec: Screen <screenId> item:<OUTPUT_ITEM_ID>
     *   direction=output, type=integer
     *   valueFrom.kind=flowVariable, variableName=<VARIABLE_NAME>
     *
     * 整数型の表示: mock で返した数値が文字列として表示されること
     */
    it('#N <OUTPUT_ITEM_LABEL> (整数) が表示される', async () => {
      renderWithProviders(<COMPONENT_NAME />);

      await waitFor(() => {
        // PLACEHOLDER: totalCount 等の整数を表示する要素の testid と値
        const el = screen.getByTestId('<OUTPUT_ITEM_ID>');
        expect(el).toBeInTheDocument();
        expect(el.textContent).toBeTruthy();
      });
    });

    /**
     * Spec: Screen <screenId> item:<OUTPUT_ITEM_ID>
     *   direction=output (valueFrom なし)
     *   API 非依存の output item (コンポーネント内部 state や parent から props)
     */
    it('#N <OUTPUT_ITEM_LABEL> が DOM に存在する', async () => {
      renderWithProviders(<COMPONENT_NAME />);

      // valueFrom が無い output は render 後すぐに確認 (API 待ちなし)
      expect(screen.getByTestId('<OUTPUT_ITEM_ID>')).toBeInTheDocument();
    });

  });
```

---

### Section 4: events — events[] → ボタンクリック → fetch 発火

#### events 配列がある場合 (handlers あり)

```typescript
  // ─────────────────────────────────────────────────
  // Section 4: events
  // ─────────────────────────────────────────────────
  describe('events: ボタンクリックで fetch が発火すること', () => {

    /**
     * Spec: Screen <screenId> events[<EVENT_INDEX>]
     *   trigger=click, handlerFlowId=<HANDLER_FLOW_ID>
     *   button: data-item-id="<EVENT_TRIGGER_ITEM_ID>"
     *
     * vi.fn() で fetch を mock し、正しい body / URL で呼ばれることを確認する
     */
    it('#N <EVENT_LABEL> ボタンをクリックすると <HANDLER_FLOW_HTTP_METHOD> <HANDLER_FLOW_PATH> が呼ばれる', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ /* PLACEHOLDER: expected response */ }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const user = userEvent.setup();
      renderWithProviders(<COMPONENT_NAME />);

      // イベントトリガーとなるボタンを探す
      const button = screen.getByTestId('<EVENT_TRIGGER_ITEM_ID>');
      await user.click(button);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('<HANDLER_FLOW_PATH>'),
          expect.objectContaining({
            method: '<HANDLER_FLOW_HTTP_METHOD>',
            // PLACEHOLDER: body の期待値を記述
            // body: JSON.stringify({ ... }),
          }),
        );
      });

      vi.unstubAllGlobals();
    });

  });
```

#### events 配列が空の場合 (spec ↔ impl 乖離検出ノート + skip)

```typescript
  // ─────────────────────────────────────────────────
  // Section 4: events (空配列の場合)
  // ─────────────────────────────────────────────────
  describe('events: ボタンクリックで fetch が発火すること', () => {

    /**
     * NOTICE: Screen <screenId> の events[] は現在空配列です。
     *
     * events[] 補完 (#864) が完了したら再生成してください:
     *   /generate-tests <screenId>
     *
     * 【spec ↔ impl 乖離検出ノート】
     * events 未定義の場合、コンポーネント側のボタンが hardcode された fetch を
     * 呼んでいても spec 追跡が不可能になる。
     * events[] 補完後に以下を必ず確認すること:
     *   1. コンポーネントの各ボタン/アクションと events[].trigger の対応を突き合わせる
     *   2. handlerFlowId → httpRoute → fetch URL のマッピングを確認する
     *   3. /generate-tests 再実行で events section を自動生成する
     */
    it.skip('#N events テストは events[] 補完 (#864) 完了後に生成予定', () => {
      // このテストは events[] が空のため skip している。
      // #864 が close されたら /generate-tests <screenId> を再実行すること。
    });

  });
```

---

### Section 5: providers — useRouter / auth context

```typescript
// ─────────────────────────────────────────────────
// Section 5: providers
// ─────────────────────────────────────────────────
// useRouter, auth context は renderWithProviders で wrap 済み。
// 個別プロバイダーテストが必要な場合はここに追加。
//
// 例: auth=required 画面でログアウト状態のリダイレクト確認
// it('#N 未認証ユーザーは /login にリダイレクトされる', async () => {
//   const mockPush = vi.fn();
//   vi.mocked(useRouter).mockReturnValue({ push: mockPush, ... });
//   renderWithProviders(<COMPONENT_NAME />, { session: null });
//   await waitFor(() => {
//     expect(mockPush).toHaveBeenCalledWith('/login');
//   });
// });
```

---

### Section 6: msw — API mock 設定詳細

Section 4 の msw サーバーをここで詳細定義する。Section 4-2 の再掲 + 追加ケース。

```typescript
// ─────────────────────────────────────────────────
// Section 6: msw — 追加 mock ハンドラー
// ─────────────────────────────────────────────────
// エラーケースの mock (output が空配列 / API エラー) が必要な場合:
//
// it('#N API エラー時にエラー表示が出る', async () => {
//   server.use(
//     http.get('<API_BASE><HTTP_PATH>', () => {
//       return new HttpResponse(null, { status: 500 });
//     }),
//   );
//   renderWithProviders(<COMPONENT_NAME />);
//   await waitFor(() => {
//     expect(screen.getByTestId('error-message')).toBeInTheDocument();
//   });
// });
```

---

### Section 7: setup — vitest 設定ファイル

```typescript
// vitest.config.ts (コンポーネントテスト用最小設定)
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['**/*.component.test.{ts,tsx}'],
  },
});

// src/test/setup.ts
import '@testing-library/jest-dom';
```

---

## 6. runIf 分岐対応 (D-5)

Screen の item に `showIf` 条件 (または Flow 起動条件) がある場合は true / false 両方のケースを生成する。

```typescript
/**
 * Spec: Screen <screenId> item:<ITEM_ID>
 *   showIf="<condition>"
 */
// runIf=true: <condition> が true → item が表示される
it('#N showIf=true: <条件説明> → <ITEM_LABEL> が表示される', async () => {
  // PLACEHOLDER: condition を true にする props / state をセット
  renderWithProviders(<COMPONENT_NAME props={{ <conditionTrueProps> }} />);

  await waitFor(() => {
    expect(screen.getByTestId('<ITEM_ID>')).toBeInTheDocument();
  });
});

// runIf=false: <condition> が false → item が非表示
it('#N showIf=false: <条件説明> → <ITEM_LABEL> が表示されない', async () => {
  renderWithProviders(<COMPONENT_NAME props={{ <conditionFalseProps> }} />);

  // queryByTestId は存在しない場合 null を返す (getByTestId と異なりエラーにならない)
  expect(screen.queryByTestId('<ITEM_ID>')).not.toBeInTheDocument();
});
```

---

## 7. anchor (D-4) 再生成ポリシー

```
// ===HARMONY_GENERATED_SECTION_START screenId=<screenId>===
... (この間を /generate-tests 再実行時に overwrite)
// ===HARMONY_GENERATED_SECTION_END===
```

再生成時のルール:
1. 既存ファイルに anchor が存在する場合、`HARMONY_GENERATED_SECTION_START` から `HARMONY_GENERATED_SECTION_END` の間のみ overwrite
2. anchor の外 (人手追記 assertion 等) は保護
3. **anchor 単位は screenId + events 状態** で区別する。events が空→補完後に再生成することで Section 4 が自動更新される

---

## 8. PLACEHOLDER 解決表 (スキル実行時に埋める)

| PLACEHOLDER | 解決元 | 例 |
|---|---|---|
| `<screenId>` | Screen JSON の `id` | `post-list-screen` |
| `<Screen.name>` | Screen JSON の `name` | `投稿一覧` |
| `<Screen.kind>` | Screen JSON の `kind` | `list` |
| `<ITEM_ID>` | `items[].id` | `searchQuery` |
| `<ITEM_LABEL>` | `items[].label` | `検索キーワード` |
| `<DIRECTION>` | `items[].direction` | `input` / `output` |
| `<TYPE>` | `items[].type` | `string` / `enum` / `array` / `boolean` / `integer` |
| `<OPTIONS>` | `items[].options[].value` | `["all","published","draft"]` |
| `<PROCESS_FLOW_ID>` | `items[].valueFrom.processFlowId` | `post-search-flow` |
| `<VARIABLE_NAME>` | `items[].valueFrom.variableName` | `posts` |
| `<HTTP_METHOD>` | flow の `actions[0].httpRoute.method` | `GET` |
| `<HTTP_PATH>` | flow の `actions[0].httpRoute.path` | `/api/posts/search` |
| `<COMPONENT_NAME>` | 実装コンポーネント名 (推測) | `PostsListPage` |
| `<API_BASE>` | env var `NEXT_PUBLIC_API_BASE` 等 | `http://localhost:3001` |
| `<EVENT_TRIGGER_ITEM_ID>` | `events[].trigger.itemId` (または FAB ボタン等) | `fab-new-post` |
| `<HANDLER_FLOW_ID>` | `events[].handlerFlowId` | `post-create-flow` |
| `<HANDLER_FLOW_HTTP_METHOD>` | handler flow の `actions[0].httpRoute.method` | `POST` |
| `<HANDLER_FLOW_PATH>` | handler flow の `actions[0].httpRoute.path` | `/api/posts` |
