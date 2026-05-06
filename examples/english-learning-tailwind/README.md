# english-learning-tailwind — 英会話学習アプリ (Tailwind 版)

`examples/english-learning/` (Bootstrap 版) と **同一の業務スコープ + データモデル + ProcessFlow** を持つ Tailwind 版サンプル (#793 子 7)。`design.cssFramework: "tailwind"` を指定し、theme-tailwind.css がモダンな B2C SaaS 寄りの見た目を提供する。

## 関連

- 親 ISSUE: [#793](https://github.com/csilost2001/harmony/issues/793) (CSS フレームワーク切替対応)
- 仕様書: [docs/spec/css-framework-switching.md](../../docs/spec/css-framework-switching.md)
- Bootstrap 版: [examples/english-learning/](../english-learning/) (同じ業務、Bootstrap aesthetic)
- 業務仕様: [docs/spec/examples-english-learning.md](../../docs/spec/examples-english-learning.md) (Bootstrap 版と共通)

## Bootstrap 版との違い

| 項目 | Bootstrap 版 | Tailwind 版 (本サンプル) |
|---|---|---|
| `design.cssFramework` | `"bootstrap"` | `"tailwind"` |
| canvas に注入される CSS | Bootstrap 5 + common.css | theme-tailwind.css (semantic class を @apply で utility にマップ) |
| 見た目 | 業務系の整然とした清潔感 (shadow-sm / rounded / 標準カラー) | モダン B2C SaaS 寄り (shadow-2xl / rounded-2xl / gradient / soft transition) |
| HTML 構造 | semantic class + Bootstrap modifier | semantic class + Tailwind utility (gradient / hover scale 等) |
| データモデル (tables/extensions/conventions/process-flows/views/view-definitions/sequences) | 同じ | 同じ (entity 定義は CSS フレームワーク非依存) |
| screen entity 定義 (`<id>.json`) | 同じ | 同じ (items[] / kind / path 同一) |
| screen design (`<id>.design.json`) HTML | Bootstrap aesthetic | Tailwind aesthetic ★ |

## 11 画面の Tailwind aesthetic

各画面で以下のモダン要素を取り入れている:

| 画面 | 主な Tailwind アクセント |
|---|---|
| ダッシュボード | 連続日数: `from-amber-400 to-orange-500` グラデカード / CEFR: `from-violet-500 to-purple-600` / クイックスタート: `from-indigo-600 to-violet-600` CTA |
| ストーリー一覧 | 各カードに `hover:-translate-y-1 hover:shadow-2xl` / CEFR バッジを amber/sky/emerald で色分け / アイコン付き `rounded-2xl` サムネ |
| ストーリー詳細 | `linear-gradient(135deg, #4f46e5, #7c3aed, #2563eb)` ヒーローバナー / 開始 CTA は `shadow-2xl + hover:scale-[1.02]` |
| **会話プレイ** ★ | 全体ダーク (`from-slate-900 via-indigo-950`) / セリフに半透明グラス `rgba(99,102,241,0.3)` / AI 応答に `backdrop-filter:blur` / 録音ボタンは固定フローティング |
| セッション結果 | スコアを `from-emerald-400 to-teal-500` 全面グラデカードで大表示 (font-size 5rem) / バッジ装飾つき |
| 学習履歴一覧 | 各セッションにスコアバー付きカード / カラー `from-emerald/sky/amber` でスコア視覚化 |
| 学習履歴詳細 | 左右チャット bubble (ユーザー: `from-indigo-600 to-violet-600` / AI: `bg-white`) / 習得単語はタグクラウド |
| 単語帳 | 習熟度 3 状態を `border-l-4` 色分け (emerald/amber/slate) / サマリーカードに大数字 |
| 単語詳細 | ダーク hero (`from-indigo-950`) に大見出し単語 + monospace IPA `text-indigo-200` / 例文 italic |
| コンテンツパック一覧 | 各パックに `linear-gradient` ヘッダー付きカード (indigo/sky/emerald) / 適用中バッジ vs 未適用で CTA 切替 |
| プロフィール / 設定 | Clean form + 固定フローティング保存 FAB (`from-indigo-600 to-violet-600` / `hover:scale-[1.02]`) |

## ディレクトリ構成 (Bootstrap 版と同一)

```
examples/english-learning-tailwind/
├── project.json                          # design.cssFramework: "tailwind"
├── README.md                             # 本ファイル
├── tables/                               # 10 件 (Bootstrap 版と同一)
├── extensions/english-learning.v3.json   # 拡張 (Bootstrap 版と同一)
├── conventions/catalog.json              # 規約 (Bootstrap 版と同一)
├── process-flows/                        # 5 件 (Bootstrap 版と同一)
├── views/                                # 3 件 (Bootstrap 版と同一)
├── view-definitions/                     # 5 件 (Bootstrap 版と同一)
├── sequences/                            # 2 件 (Bootstrap 版と同一)
└── screens/                              # 11 画面 × 2 ファイル
    ├── <id>.json                         # entity 定義 (Bootstrap 版と同一)
    └── <id>.design.json                  # GrapesJS HTML — ★ Tailwind aesthetic で再設計
```

## 開き方 (動作確認)

`examples/english-learning-tailwind/` は git 管理の正本サンプル。直接開くと編集が git 差分になるため、動作確認は **コピーして使う** ことを推奨します (デプロイ相当)。

### 推奨: workspaces/ にコピーして使う

```bash
# Windows PowerShell
New-Item -ItemType Directory -Force -Path workspaces\english-learning-tailwind
Copy-Item -Recurse -Force examples\english-learning-tailwind\* workspaces\english-learning-tailwind\

# backend / designer 起動 (root から)
npm run dev
```

その後ブラウザで:
1. http://localhost:5173/ にアクセス
2. ヘッダー「ワークスペース」 → 「フォルダを追加」 → `workspaces/english-learning-tailwind` 選択
3. 「画面一覧」から各画面を開いて canvas で Tailwind aesthetic を確認

### 直接開く (git tracked のため編集注意)

ヘッダー「ワークスペース」 → 「フォルダを追加」 → `examples/english-learning-tailwind` の絶対パス を指定。**編集して保存するとファイルが書き換わり git 差分が出ます (自己責任)**。本プロジェクトのサンプル更新作業以外では編集を避けてください。

## 検証 (AJV)

`examples/**/*.json` は schema 検証 test に組み込まれる。schema 進化時に本サンプルが breakage したら CI で検出。

```bash
npm --prefix designer run validate:samples -- ../examples/english-learning-tailwind
```

## 関連

- 親メタ: #793 (CSS フレームワーク切替対応)
- spec: [docs/spec/css-framework-switching.md](../../docs/spec/css-framework-switching.md)
- 業務仕様: [docs/spec/examples-english-learning.md](../../docs/spec/examples-english-learning.md) (Bootstrap 版と共通)
