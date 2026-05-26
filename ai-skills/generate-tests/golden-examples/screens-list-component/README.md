# golden-examples/screens-list-component

Screen `post-list-screen` (投稿一覧) を題材にした
`/generate-tests` スキルの P3 ゴールデン出力。

`examples/diary/harmony/screens/post-list-screen.json` を入力として
`/generate-tests` スキルが SKILL.md の Screen 変換ルールに従い生成する
vitest + @testing-library/react テストの見本。

---

## items[] ↔ DOM selector マッピング

| item.id | label | direction | type | data-testid | DOM element |
|---|---|---|---|---|---|
| `searchQuery` | 検索キーワード | input | string | `searchQuery` | `<input type="text">` |
| `selectedTagSlugs` | タグフィルタ | input | array | `selectedTagSlugs` (親コンテナ) / `selectedTagSlugs-<slug>` (個別 checkbox) | `<div>` + `<input type="checkbox">` |
| `statusFilter` | 公開状態フィルタ | input | enum | `statusFilter` | `<select>` |
| `posts` | 投稿一覧 | output | array | `posts` (親 `<ul>`) / `post-<id>` (個別 `<li>`) | `<ul>` + `<li>` |
| `availableTags` | 利用可能タグ | output | array | `availableTags` (親 `<div>`) / `tag-<slug>` (個別 `<span>`) | `<div>` + `<span>` |
| `totalCount` | 総件数 | output | integer | `totalCount` | `<span>` |

---

## PLACEHOLDER 解決表

| PLACEHOLDER | 解決元 | diary での具体値 |
|---|---|---|
| `<screenId>` | Screen JSON の `id` | `post-list-screen` |
| `<Screen.name>` | Screen JSON の `name` | `投稿一覧` |
| `<Screen.kind>` | Screen JSON の `kind` | `list` |
| `<COMPONENT_NAME>` | 実装コンポーネント名 (推測) | `PostsListPage` (PLACEHOLDER) |
| `<PROCESS_FLOW_ID>` (posts/totalCount) | `items[].valueFrom.processFlowId` | `post-search-flow` |
| `<HTTP_METHOD>` | flow の `actions[0].httpRoute.method` | `GET` |
| `<HTTP_PATH>` | flow の `actions[0].httpRoute.path` | `/api/posts/search` |
| `<API_BASE>` | 環境変数 `NEXT_PUBLIC_API_BASE` 等 | `http://localhost:3001` (msw は `*` でマッチ) |

---

## processFlowId → httpRoute 解決ログ

`items[id=posts].valueFrom.processFlowId = post-search-flow`

Read: `examples/diary/harmony/process-flows/post-search-flow.json`
→ `meta.name: "投稿検索"`
→ `actions[0].httpRoute.method: "GET"`
→ `actions[0].httpRoute.path: "/api/posts/search"`
→ `actions[0].httpRoute.auth: "optional"`

`items[id=totalCount].valueFrom.processFlowId = post-search-flow`
(同上フロー、同一 httpRoute)

→ msw handler: `http.get('*/api/posts/search', ...)` 1 個で両 output item をカバー

---

## テストケース一覧

| # | テスト内容 | spec anchor | Section |
|---|---|---|---|
| 1 | searchQuery が DOM に存在 | Screen post-list-screen item:searchQuery | render |
| 2 | selectedTagSlugs が DOM に存在 | Screen post-list-screen item:selectedTagSlugs | render |
| 3 | statusFilter が DOM に存在 | Screen post-list-screen item:statusFilter | render |
| 4 | posts が DOM に存在 | Screen post-list-screen item:posts | render |
| 5 | availableTags が DOM に存在 | Screen post-list-screen item:availableTags | render |
| 6 | totalCount が DOM に存在 | Screen post-list-screen item:totalCount | render |
| 7 | searchQuery に入力 → state 更新 | Screen post-list-screen item:searchQuery direction=input type=string | input |
| 8 | statusFilter を "published" に変更 → state 更新 | Screen post-list-screen item:statusFilter type=enum | input |
| 9 | statusFilter 初期値が "all" | Screen post-list-screen item:statusFilter defaultValue=all | input |
| 10 | selectedTagSlugs checkbox 選択 → 配列追加 | Screen post-list-screen item:selectedTagSlugs type=array | input |
| 11 | selectedTagSlugs checkbox 再 click → 配列除去 | Screen post-list-screen item:selectedTagSlugs type=array | input |
| 12 | posts が API レスポンスから表示 | Screen post-list-screen item:posts valueFrom.flowVariable | output |
| 13 | posts が 2 件表示される | Screen post-list-screen item:posts (mock total=2) | output |
| 14 | totalCount が API の total を表示 | Screen post-list-screen item:totalCount valueFrom.flowVariable | output |
| 15 | availableTags がレンダリングされる | Screen post-list-screen item:availableTags | output |
| 16 | API 500 エラー時も posts エリアが表示される | Screen post-list-screen item:posts エラー耐性 | output |
| 17 (skip) | events テスト (#864 補完待ち) | Screen post-list-screen events[] 空配列 | events |

---

## mental invocation 結果 (P3 確認)

`/generate-tests post-list-screen` を実行した場合の想定動作:

1. **引数解析**: `post-list-screen` は EntityId (kebab-case) 形式 ✓
2. **techStack 確認**: `frontend.library=react`, `frontend.framework=next` → P3 Screen test 生成ルートへ
3. **Screen JSON 読込**: `examples/diary/harmony/screens/post-list-screen.json`
4. **items index 構築**: 6 items (input: 3件 / output: 3件)
5. **processFlowId 解決**:
   - `posts` → `post-search-flow` → GET /api/posts/search ✓
   - `totalCount` → 同上 ✓
   - `availableTags` → valueFrom なし → API 非依存として処理 ✓
6. **events 確認**: `events[]` が空 → Section 4 は skip テスト + 乖離検出ノートのみ ✓
7. **anchor 付与**: 全 items に `// Spec: Screen post-list-screen item:<item.id>` ✓
8. **生成ファイル**: `posts-list.component.test.tsx` (本 golden と構造一致)

### items 6 件の anchor 付与確認

| item.id | anchor コメント | テストケース |
|---|---|---|
| searchQuery | `// Spec: Screen post-list-screen item:searchQuery` | #1 render, #7 input |
| selectedTagSlugs | `// Spec: Screen post-list-screen item:selectedTagSlugs` | #2 render, #10-11 input |
| statusFilter | `// Spec: Screen post-list-screen item:statusFilter` | #3 render, #8-9 input |
| posts | `// Spec: Screen post-list-screen item:posts` | #4 render, #12-13 output |
| availableTags | `// Spec: Screen post-list-screen item:availableTags` | #5 render, #15 output |
| totalCount | `// Spec: Screen post-list-screen item:totalCount` | #6 render, #14 output |

**全 6 items に anchor 付与済み。events なしのため events section は skip 済み (#864 補完待ち)。**

---

## P3 受け入れ基準の充足状況 (#872 より)

| # | 受け入れ基準 | golden での実現 | 充足 |
|---|---|---|---|
| 1 | テンプレート COMPONENT_SPEC.md 新規作成 | `templates/frontend/react-tailwind-next/COMPONENT_SPEC.md` | ✅ |
| 2a | render: 各 items[] が DOM に存在 (`data-item-id` selector) | tests #1〜#6 | ✅ |
| 2b | input: direction=input → type 別 state 更新 | tests #7〜#11 (string/enum/array) | ✅ |
| 2c | output: valueFrom.kind=flowVariable → msw mock → 表示 assert | tests #12〜#15 | ✅ |
| 2d | events: handlerFlowId → fetch 発火 assert / 空配列 → skip | test #17 skip + 乖離検出ノート | ✅ |
| 3 | renderWithProviders ヘルパー (useRouter/auth context) | ファイル内インライン実装 | ✅ |
| 4 | msw で API mock (vi.fn() fetch mock も許容) | msw setupServer + handlers | ✅ |

---

## events[] 補完後の再生成手順

```bash
# #864 が close されたら:
# 1. Screen JSON の events[] が補完されていることを確認
cat examples/diary/harmony/screens/post-list-screen.json | python3 -c "
import json, sys; d = json.load(sys.stdin); print('events:', d.get('events', []))
"

# 2. /generate-tests で再生成
# /generate-tests post-list-screen
# → Section 4 が自動更新される (anchor 外の人手 assertion は保護される)
```

---

## 実機確認手順 (P3)

```bash
# 前提: diary プロジェクトルートで npm install 済み + vitest 設定済み
# golden は抽象的なため、実際のコンポーネントに対して実行する場合:

# 1. StubPostsListPage を実際のコンポーネントに置き換え
# 2. src/test/setup.ts に @testing-library/jest-dom を追加
# 3. vitest.config.ts を Next.js プロジェクトに配置

cd apps/web  # または Next.js プロジェクトルート
npx vitest --reporter=verbose posts-list.component.test
```

期待結果: tests #1〜#16 pass、#17 skip (events[] 補完待ち)

---

## P4 (Playwright E2E) への申し送り

- Screen ID: `post-list-screen` が P4 の対象候補
- Screen path: `/` (= トップページ)
- auth: `required` (認証 mock が必要)
- 投稿フィルタ操作 (statusFilter / selectedTagSlugs) → URL query params 変更 → API 再呼び出しの E2E 検証が P4 のスコープ
- FAB クリック → `/posts/new` への遷移も P4 候補 (#864 events[] 補完後に確定)
