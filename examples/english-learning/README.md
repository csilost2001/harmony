# english-learning — 英会話学習アプリ

B2C 英会話学習アプリの **完結 業務 workspace サンプル** (#787)。ストーリー仕立ての会話練習と AI 採点 (LLM/TTS/STT) を組み合わせたアプリを本フレームワークでモデル化する。retail (B2B 店舗系) と並列の **B2C + 外部 AI 連携サンプル**。

## 業務シナリオ (4 種、画面・処理・データを連携)

| シナリオ | 概要 | 関連画面 |
|---|---|---|
| S-1 学習セッション開始 | ストーリー一覧から選択 → セッション作成 → 会話プレイへ遷移。TTS で音源プリロード。 | ストーリー一覧 / 詳細 / 会話プレイ |
| S-2 会話ターン進行 | ユーザー発話 → LLM 応答生成 → TTS 音声化 → 履歴保存。stepKind 拡張で外部 AI 表現。 | 会話プレイ |
| S-3 発音採点 | 録音送信 → STT + 評価 API → スコア保存 → セッション結果表示。 | 会話プレイ → セッション結果 |
| S-4 学習履歴 + 単語復習 | 履歴一覧 / 詳細表示、単語帳で習熟度別復習。タップで辞書詳細。 | 学習履歴 / 単語帳 / 単語詳細 |

補助画面: ダッシュボード、コンテンツパック一覧、プロフィール / 設定。

## ディレクトリ構成

```
examples/english-learning/
├── harmony.json                          # workspace marker (v3 schema、dataDir: "harmony" を内包)
├── README.md                             # 本ファイル
└── harmony/                              # dataDir 配下 (全エンティティデータ)
    ├── tables/                           # テーブル定義 (10 件)
    │   ├── c7e50462-...  users
    │   ├── 517d50a3-...  content_packs
    │   ├── b5aa3e1b-...  stories
    │   ├── 992ac5db-...  scenes
    │   ├── 246a3f13-...  dialogue_lines
    │   ├── 8db75844-...  words
    │   ├── d524cba6-...  learning_sessions
    │   ├── 4e126323-...  turn_logs
    │   ├── fefa79cf-...  pronunciation_scores
    │   └── 7ab2cf24-...  user_word_progress
    ├── extensions/
    │   └── english-learning.v3.json      # english-learning namespace 拡張定義
    ├── conventions/
    │   └── catalog.json                  # 業務規約カタログ
    ├── screens/                          # 画面定義
    ├── process-flows/                    # 処理フロー定義
    ├── view-definitions/                 # ViewDefinition
    ├── views/                            # SQL VIEW 定義
    └── sequences/                        # 採番シーケンス
```

## 採用拡張 namespace

- `english-learning` — fieldTypes / actionTriggers / dbOperations / stepKinds / responseTypes / screenKinds を v3 canonical combined format (`harmony/extensions/english-learning.v3.json`) に統合

### stepKind 拡張の肝 (本サンプルの核心)

| stepKind キー | 用途 | outputType |
|---|---|---|
| `TtsGenerate` | TTS 音声生成 | `english-learning:audioUrl` |
| `SttEvaluate` | STT + 発音評価 | `english-learning:pronunciationScore` |

外部 AI 呼び出しのうち、汎用 LLM 呼び出しは **core stepKind `aiCall` + `modelEndpoints` catalog** で表現する (#935 で 2026-05-08 に core 化、本サンプルも 2026-05-08 移行済み / #865)。TTS / STT は業務ドメイン固有のため、当面は namespace 拡張 stepKind で表現を維持する (将来 core 化する場合は `aiTts` / `aiStt` を追加候補とする / spec 12 節)。

## 開き方 (動作確認)

`examples/english-learning/` は **git 管理の正本サンプル**。直接開くと編集が git 差分になるため、動作確認は **コピーして使う** ことを推奨します (デプロイ相当)。

### 推奨: workspaces/english-learning/ にコピーして使う

```bash
# workspaces/english-learning/ ディレクトリを作成してコピー (Windows PowerShell の例)
New-Item -ItemType Directory -Force -Path workspaces\english-learning
Copy-Item -Recurse -Force examples\english-learning\* workspaces\english-learning\

# backend / designer を起動
cd backend && npm run dev   # 別ターミナル
cd frontend && npm run dev
```

`workspaces/` は gitignored なので自由に編集できます。

> **注意**: `data/` への直接 deploy は禁止 (#753)。`data/` はデザイナー本体組み込み拡張定義 (`data/extensions/`) 専用です。

### 直接開く (見るだけの動作確認)

designer UI のヘッダー「ワークスペース」 → 「フォルダを追加」 → `examples/english-learning` の絶対パス を指定。**ただし編集して保存するとファイルが書き換わり git 差分が出ます (自己責任)**。

## テスト fixture としての利用

```bash
# 固定 workspace で backend 起動 (lockdown モード)
DESIGNER_DATA_DIR=examples/english-learning npm run dev:mcp
```

## 検証 (AJV)

```bash
cd frontend && npm run validate:samples -- ../examples/english-learning
```

`examples/**/*.json` は schema 検証 test に組み込まれる。schema 進化時に english-learning サンプルが breakage したら CI で検出。

## 実装シリーズ

| 子 ISSUE | スコープ | branch |
|---|---|---|
| 子 1 | 本仕様書 (docs/spec/examples-english-learning.md) | `docs/issue-787-spec-english-learning` |
| 子 2 (本 PR) | 業務データ層 — tables / extensions / conventions / harmony.json / README | `feat/issue-787-tables-conventions` |
| 子 3 | UI 層上半分 — screens / screenTransitions | `feat/issue-787-screens` |
| 子 4 | UI 層下半分 + 業務処理 — process-flows / view-definitions / sequences / views | `feat/issue-787-flows` |
| 子 5 | dogfood 検証 — AJV + review-flow Must-fix ゼロ + smoke | `chore/issue-787-dogfood` |

## 関連

- 親メタ: #787
- spec: [docs/spec/examples-english-learning.md](../../docs/spec/examples-english-learning.md)
- 運用方針: memory `project_samples_strategy_2026_05_02.md`
