# 日記アプリ (`diary`)

個人向け日記/ブログアプリの Harmony サンプル。**AI assist 4 機能 (要約 / タグ提案 / 文章校正 / 画像 alt 自動生成) をコア機能として組み込んだ初の sample**。

## 概要

| 項目 | 値 |
|---|---|
| ドメイン | 個人向け content publishing (日記 / ブログ / レビュー等の代表) |
| ユーザー | 単一 (個人運用想定、JWT 認証) |
| AI 統合 | 4 機能 (要約 / タグ提案 / 文章校正 / 画像 alt) |
| UI モチーフ | masonry グリッド + lightbox gallery + AI assist sidebar (Tailwind) |
| 想定 techStack | NestJS + Next.js + Prisma + SQLite |

## 既存 sample との差別化

| sample | 領域 | AI 統合 | UI モチーフ |
|---|---|---|---|
| retail | 小売・在庫 | なし | フォーム + 表 (Bootstrap) |
| english-learning | 学習 | light | カード + 表 (Bootstrap) |
| english-learning-tailwind | 学習 | light | カード + 表 (Tailwind) |
| realestate | 業務 CRUD | なし | フォーム + 表 |
| **diary** | **content publishing** | **コア (4 種)** | **masonry + lightbox + AI sidebar (Tailwind)** |

## 設計データ構造

```
examples/diary/
├── harmony.json                # workspace marker (dataDir = "harmony")
├── README.md                    # 本ファイル
└── harmony/
    ├── tables/                  # 5 テーブル (User / Post / Tag / PostTag / Photo)
    ├── process-flows/           # 9 ProcessFlow (CRUD 5 + AI 4)
    ├── screens/                 # 5 screens (.json + .design.json)
    ├── conventions/
    │   └── catalog.json         # i18n / regex / limits / AI 設定 / messages
    ├── views/
    ├── view-definitions/
    ├── sequences/
    └── extensions/
```

## ProcessFlow 一覧 (9 件)

### CRUD + 検索 (5 件、kind: screen)

| ID | name | HTTP |
|---|---|---|
| `0671b051-...` | 投稿作成 | POST /api/posts |
| `b3a1c2d4-...` | 投稿更新 | PUT /api/posts/:id |
| `c4d5e6f7-...` | 投稿削除 | DELETE /api/posts/:id |
| `d5e6f7a8-...` | 投稿詳細取得 | GET /api/posts/:id |
| `e6f7a8b9-...` | 投稿検索 | GET /api/posts/search |

### AI 機能 (4 件、kind: common)

| ID | name | HTTP | 用途 |
|---|---|---|---|
| `f7a8b9c0-...` | AI要約生成 | POST /api/ai/summarize | 本文 → 3-5 文要約 |
| `a9b0c1d2-...` | AIタグ提案 | POST /api/ai/tag-suggest | title+body → tag 候補 |
| `b0c1d2e3-...` | AI画像alt生成 | POST /api/ai/alt-text | photo URL → alt text |
| `c1d2e3f4-...` | AI文章校正 | POST /api/ai/proofread | text + style → 校正結果 |

## screens 一覧 (5 件)

| ID | name | kind | path |
|---|---|---|---|
| `31d56212-...` | 投稿一覧 | list | `/` |
| `ffec74d0-...` | 投稿詳細 | detail | `/post/:id` |
| `531619ae-...` | 投稿編集 | form | `/post/edit/:id?` |
| `c0bd613a-...` | タグ管理 | list | `/tags` |
| `a5088d22-...` | ログイン | login | `/login` |

## tables 一覧 (5 件)

| name | physicalName | 主要列 |
|---|---|---|
| ユーザー | users | id, username, password_hash, display_name, avatar_url, bio |
| 投稿 | posts | id, user_id, title, body, summary, status, mood, weather, location, published_at |
| タグ | tags | id, name, slug, color, icon, usage_count |
| 投稿タグ (中間) | post_tags | post_id, tag_id, source, confidence (複合 PK) |
| 写真 | photos | id, post_id, url, thumbnail_url, alt, caption, order_index, width, height, exif_json |

## AI 機能のコスト目安 (claude-opus-4-7 想定)

| 用途 | 概算 / 投稿 |
|---|---|
| 要約 | ~$0.04 |
| タグ提案 | ~$0.03 |
| 校正 | ~$0.27 |
| 画像 alt | ~$0.03 |

**1 投稿フル使用で ~$0.4 (約 60 円)、月 30 投稿で ~$12 (約 1800 円)** (Anthropic API 課金前提)。コスト回避策は #865 (provider 抽象化、Ollama / OpenAI 切替対応) で対応予定。

## 動作確認済 (dogfood)

`/generate-code` で NestJS + Next.js コードを生成し、ローカル (port 3000 / 4000) で起動 + 全 endpoint smoke 通過 (login → 投稿 CRUD → 検索 → タグ管理) 済。

## Known limitations (follow-up ISSUE)

| 項目 | ISSUE |
|---|---|
| 写真アップロード ProcessFlow 未定義 (現状 URL 直入力モック) | #861 |
| タグ CRUD 完全化 (update/delete ProcessFlow 不在) | #862 |
| 認証フロー (login/refresh/logout) ProcessFlow として未明示 | #863 |
| screen items の `events[]` 補完 — `/generate-code` 精度向上 | #864 |
| AI provider 抽象化 (Ollama / OpenAI 切替対応) | #865 |
| `@conv.ai.*` / `@env.*` 参照 (現状リテラル文字列で迂回) | #859 (framework 改善) |

## 検証

```bash
cd frontend && npx tsx scripts/validate-samples.ts ../examples/diary
# → 1 / 9 flows / 5 tables / 5 screens / 1 conventions catalogs (All validations passed)
```
