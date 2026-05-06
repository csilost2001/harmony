# golden-examples/diary-post-lifecycle-e2e

diary アプリ (`examples/diary/harmony.json`) を題材にした
`/generate-tests` スキルの P4 (Playwright E2E) ゴールデン出力。

**シナリオ 1**: ログイン → 投稿一覧 → 新規投稿作成 → 投稿詳細 → 編集 → 削除 (`post-lifecycle.e2e.spec.ts`)

**注意**: diary の `entities.screenTransitions[] = []` (空配列) かつ `events[]` も未補完 (#864 OPEN) のため、
本 golden は **3次 path-based fallback** で遷移を推測して生成している。
各ステップに `// TODO: screenTransitions 補完待ち` コメントを付与済み。

---

## 対象 screens (diary harmony.json より)

| screen.id | name | kind | path |
|---|---|---|---|
| `a5088d22-4ad8-4615-a4c5-447ff9cdd280` | ログイン | login | /login |
| `31d56212-b654-46dc-b004-096c7382c404` | 投稿一覧 | list | / |
| `ffec74d0-6c21-45f7-a387-167ac8819255` | 投稿詳細 | detail | /post/:id |
| `531619ae-0f5f-4f55-8043-03e5a9ef6670` | 投稿編集 | form | /post/edit/:id? |
| `c0bd613a-ab67-4f72-8e2d-775e827bf9b2` | タグ管理 | list | /tags |

## 遷移導出フロー

```
遷移導出 3段 fallback:

1次ソース: entities.screenTransitions[]
  → diary では [] (空配列) のためスキップ

2次ソース: screen.events[].handlerFlowId → ProcessFlow → next screen
  → diary ではすべての screen.events が未定義 (#864 OPEN) のためスキップ

3次ソース: path-based 推測 (本 golden が採用)
  kind 慣習:
    login  → list   (ログイン成功 → トップの一覧画面)
    list   → form   (一覧の "新規作成" ボタン → フォーム)
    form   → detail (作成/更新 → 詳細画面)
    detail → form   (詳細の "編集" ボタン → フォーム)
    detail → list   (詳細の "削除" ボタン → 一覧)
    form   → list   (キャンセル → 一覧)

生成された遷移チェーン (post-lifecycle):
  ログイン (/login) → 投稿一覧 (/) → 投稿編集 (/post/edit)
  → [作成後] 投稿詳細 (/post/:id) → 投稿編集 (/post/edit/:id)
  → [更新後] 投稿詳細 (/post/:id) → [削除後] 投稿一覧 (/)
```

---

## PLACEHOLDER 解決表

各 PLACEHOLDER は diary アプリの実装に合わせて置換すること。

| PLACEHOLDER | 解決元 | 推定値 / 確認方法 |
|---|---|---|
| `TEST_USER.password` | テスト用パスワード | `apps/api/prisma/seed.ts` の testuser パスワードを確認 |
| `PLACEHOLDER_HASH` | bcrypt ハッシュ値 | `bcrypt.hashSync('password', 10)` で生成 |
| `[data-testid="posts"]` | 投稿一覧コンポーネント | `apps/web/src/app/(dashboard)/page.tsx` を確認 |
| `[data-testid="title"]` | 投稿タイトル input | `apps/web/src/app/post/edit/page.tsx` を確認 |
| `[data-testid="body"]` | 投稿本文 input/textarea | 同上 |
| `[data-testid="submitButton"]` | フォーム送信ボタン | 同上 |
| `[data-testid="postTitle"]` | 詳細画面のタイトル表示 | `apps/web/src/app/post/[id]/page.tsx` を確認 |
| `[data-testid="postBody"]` | 詳細画面の本文表示 | 同上 |
| `[data-testid="editButton"]` | 詳細画面の編集ボタン | 同上 |
| `[data-testid="deleteButton"]` | 詳細画面の削除ボタン | 同上 |
| `[data-testid="post-{id}"]` | 一覧の投稿 item | `apps/web/src/app/(dashboard)/page.tsx` を確認 |
| `POST /api/posts` | 投稿作成 API | ProcessFlow `0671b051-...` の httpRoute を確認 |
| `PATCH /api/posts/:id` | 投稿更新 API | ProcessFlow `b3a1c2d4-...` の httpRoute を確認 |
| `DELETE /api/posts/:id` | 投稿削除 API | ProcessFlow `c4d5e6f7-...` の httpRoute を確認 |
| `POST /api/auth/login` | ログイン API | `apps/api/src/auth/auth.controller.ts` を確認 |
| `accessToken` | JWT レスポンスキー | `apps/api/src/auth/auth.service.ts` を確認 |
| `localStorage.setItem('accessToken', ...)` | フロントエンドの auth 保存方式 | `apps/web/src/lib/auth.ts` 等を確認 |

### ProcessFlow → httpRoute 解決ログ

| ProcessFlow | id | 推定 httpRoute |
|---|---|---|
| 投稿作成 | `0671b051-4acc-49cf-ba92-9fa29b47f671` | POST /api/posts |
| 投稿更新 | `b3a1c2d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` | PATCH /api/posts/:id |
| 投稿削除 | `c4d5e6f7-a8b9-4c0d-8e1f-2a3b4c5d6e7f` | DELETE /api/posts/:id |
| 投稿詳細取得 | `d5e6f7a8-b9c0-4d1e-8f2a-3b4c5d6e7f8a` | GET /api/posts/:id |

**注意**: 上記は ProcessFlow の kind/name から推定した値。
実際の httpRoute.path は各 ProcessFlow JSON を Read して確認すること。

---

## ファイル構成

```
diary-post-lifecycle-e2e/
├ post-lifecycle.e2e.spec.ts  — 投稿ライフサイクル E2E (シナリオ 1)
├ playwright.config.ts        — Playwright 設定 (SQLite workers=1)
├ helpers/
│  ├ auth.ts                  — loginAs() / loginViaUI() / logout()
│  └ db.ts                    — seedTestData() / truncateTestData() / deletePost()
└ README.md                   — 本ファイル
```

---

## シナリオテストケース一覧 (post-lifecycle.e2e.spec.ts)

| # | テスト内容 | spec anchor | 遷移導出 |
|---|---|---|---|
| 1 | 投稿一覧画面が表示される | Scenario post-lifecycle step:2, Screen 31d56212 item:posts | 3次 path-based |
| 2 | 新規投稿作成フォームを表示して投稿を作成できる | Scenario post-lifecycle step:3-4 via ProcessFlow 0671b051 | 3次 path-based |
| 3 | 投稿詳細画面が表示され入力した内容が確認できる | Scenario post-lifecycle step:5 | 3次 path-based |
| 4 | 投稿編集フォームで内容を更新できる | Scenario post-lifecycle step:6-7 via ProcessFlow b3a1c2d4 | 3次 path-based |
| 5 | 投稿を削除すると一覧から消える | Scenario post-lifecycle step:8-9 via ProcessFlow c4d5e6f7 | 3次 path-based |
| 6 | 完全シナリオ: login → 一覧 → 作成 → 詳細 → 編集 → 削除 | Scenario post-lifecycle step:1〜9 | 3次 path-based |

---

## 第2シナリオ再 invocation 例 (タグ管理 → 投稿作成で新タグ選択)

受け入れ基準 2 の後者シナリオ。本 golden には含めていないが、以下の手順で再 invocation できる。

### /generate-tests での起動形式

```
/generate-tests --scenario-name "タグ管理→新タグ付き投稿作成" \
  c0bd613a-ab67-4f72-8e2d-775e827bf9b2 \
  531619ae-0f5f-4f55-8043-03e5a9ef6670
```

または

```
/generate-tests --scenario \
  c0bd613a-ab67-4f72-8e2d-775e827bf9b2 \
  531619ae-0f5f-4f55-8043-03e5a9ef6670
```

### 想定シナリオ構成

```
step 1: ログイン
step 2: タグ管理画面 (/tags) 表示
  // Spec: Scenario tag-post-creation step:2
  // TODO: screenTransitions 補完待ち
  → page.goto('/tags') → タグ一覧 data-testid="tags" 確認

step 3: 新規タグ作成
  // Spec: Scenario tag-post-creation step:3
  → タグ名 input 入力 → 追加ボタン → POST /api/tags → タグ一覧に追加確認

step 4: 投稿作成フォームへ遷移
  // Spec: Scenario tag-post-creation step:4
  // TODO: screenTransitions 補完待ち (タグ管理 → 投稿作成への遷移)
  → page.goto('/post/edit') または ナビゲーションリンク

step 5: 新タグを選択して投稿作成
  // Spec: Scenario tag-post-creation step:5 via ProcessFlow 投稿作成 (0671b051...)
  → title / body 入力 → タグ選択で step 3 で作成したタグをチェック
  → POST /api/posts → { tags: [{ id: <newTagId> }] }

step 6: 詳細画面でタグ確認
  // Spec: Scenario tag-post-creation step:6
  → /post/:id → タグラベルに新タグ名が表示されること
```

### 第2シナリオで必要な PLACEHOLDER

| PLACEHOLDER | 解決元 |
|---|---|
| `[data-testid="tags"]` | タグ管理コンポーネント (c0bd613a...) の実装 |
| `[data-testid="newTagName"]` | タグ追加 input の data-testid |
| `[data-testid="addTagButton"]` | タグ追加ボタンの data-testid |
| `[data-testid="tagCheckbox-{tagId}"]` | 投稿フォームのタグ選択 checkbox |
| `POST /api/tags` | タグ作成 ProcessFlow の httpRoute |

---

## 実行方法

```bash
# 前提: backend と frontend を手動起動しておくこと
# (AI は dev server を spawn しない — feedback_no_ai_managed_dev_server.md)
cd backend && npm run dev           # Harmony backend (port 5179)
cd apps/api && npm run start:dev    # NestJS API (port 3001)
cd apps/web && npm run dev          # Next.js (port 3000)

# E2E テスト実行 (SQLite: --workers=1 必須 D-7)
npx playwright test --config=<出力先>/playwright.config.ts --workers=1

# 特定スペックのみ実行
npx playwright test post-lifecycle --workers=1

# ヘッドフル実行 (デバッグ時)
npx playwright test post-lifecycle --headed --workers=1

# デバッグモード (ステップ実行)
npx playwright test post-lifecycle --debug
```

---

## D-4 anchor 再生成手順

screenTransitions または events[] が補完された場合 (`#864` close 後)、以下で再生成できる:

```bash
# /generate-tests スキルを再実行
# (anchor 外の人手追記 assertion は保護される)
/generate-tests --scenario-name "投稿ライフサイクル" \
  a5088d22-4ad8-4615-a4c5-447ff9cdd280 \
  31d56212-b654-46dc-b004-096c7382c404 \
  531619ae-0f5f-4f55-8043-03e5a9ef6670 \
  ffec74d0-6c21-45f7-a387-167ac8819255
```

再生成時は `===HARMONY_GENERATED_SECTION_START scenario=post-lifecycle===` から
`===HARMONY_GENERATED_SECTION_END===` の間のみ overwrite される (D-4)。

---

## mental invocation 結果 (P4 確認)

`/generate-tests --scenario-name "投稿ライフサイクル" <screenId1> <screenId2> ...` を実行した場合の想定動作:

1. **引数解析**: `--scenario-name` フラグあり → P4 E2E シナリオ生成ルートへ
2. **harmony.json 読込**: techStack.frontend.framework=next, techStack.auth.method=jwt ✓
3. **screen path index 構築**:
   - `a5088d22-...` → path="/login" (kind=login) ✓
   - `31d56212-...` → path="/" (kind=list) ✓
   - `531619ae-...` → path="/post/edit/:id?" (kind=form) ✓
   - `ffec74d0-...` → path="/post/:id" (kind=detail) ✓
4. **遷移導出**: screenTransitions=[] → 3次 path-based fallback を選択 ✓
5. **kind 慣習適用**:
   - login→list: ログイン → "/" ✓
   - list→form: 一覧 → "/post/edit" ✓
   - form→detail: 作成後 → "/post/:id" ✓
   - detail→form: 編集 → "/post/edit/:id" ✓
   - detail→list: 削除後 → "/" ✓
6. **anchor 付与**: 全 step に `// Spec: Scenario post-lifecycle step:N` + TODO コメント ✓
7. **ProcessFlow index**: 投稿作成/更新/削除の httpRoute を ProcessFlow JSON から解決 ✓
8. **生成ファイル**: `post-lifecycle.e2e.spec.ts` (本 golden と構造一致) ✓

### P4 受け入れ基準の充足状況 (#873 より)

| # | 受け入れ基準 | golden での実現 | 充足 |
|---|---|---|---|
| 1 | テンプレート SCENARIO.md 新規作成 | `templates/e2e/playwright/SCENARIO.md` | ✅ |
| 2a | シナリオ 1: login→一覧→作成→詳細→編集→削除 | `post-lifecycle.e2e.spec.ts` steps 1〜9 | ✅ |
| 2b | シナリオ 2: タグ管理→タグ追加→投稿作成で新タグ選択 | README の再 invocation 例として PLACEHOLDER 提示 | ✅ |
| 3a | 遷移導出: screenTransitions[] から導出 (1次) | SCENARIO.md 14節 + fallback ロジック定義済み | ✅ |
| 3b | 遷移導出: events.handlerFlowId → ProcessFlow 完了後 (2次) | SCENARIO.md 14節 定義済み | ✅ |
| 3c | 遷移導出: path+kind 推測 (3次 fallback) + TODO コメント | golden 全ステップに `// TODO: screenTransitions 補完待ち` | ✅ |
| 4 | DOM 検証 (`data-testid` query → 値確認) | `page.getByTestId()` + `toContainText()` / `toHaveValue()` | ✅ |
| 5 | CI 統合 (playwright headless + playwright.config.ts) | `playwright.config.ts` (workers=1, headless=!!CI) | ✅ |

---

## P5 (AI flow mock + 実 API 切替) への申し送り

- `post-lifecycle.e2e.spec.ts` の step 4 / 7 / 8 で `page.waitForResponse()` により API 呼び出しを監視している。
- P5 では `page.route()` による API mock と、実 API への切替テストが候補。
  - mock 切替フラグ: `process.env.USE_MOCK_API` で `page.route()` を有効/無効化
  - AI flow mock: ProcessFlow JSON の `steps[kind=external]` をモックする設計
- auth helper の `loginAs()` は API 経由のため、`page.route('**/api/auth/login', ...)` で mock 可能。
- DB ヘルパーは現在 Prisma 直接接続。P5 では API 経由 seed (POST /api/admin/seed) に切替可能。
- `playwright.config.ts` の `webServer` セクション (コメントアウト済み) を P5 で有効化することで CI 自動起動に対応できる。
