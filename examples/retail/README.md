# retail — リテール総合 (EC + 店舗 POS + 在庫管理)

リリース時 examples 候補の **完結 業務 workspace サンプル** (#680 / #706 / #759)。EC・店舗 POS・在庫管理を統合したリテール業態をモデルにした中規模アプリ。

## 業務シナリオ (4 種、画面・処理・データを連携)

| シナリオ | 概要 | 関連画面 |
|---|---|---|
| 店舗在庫照会 | 商品コード・店舗で在庫数を検索表示。閾値以下は警告。 | 商品検索、在庫一覧 |
| カート追加 | 商品検索結果からカートに追加。重複排除 / null 区別。 | カート画面、追加モーダル |
| 注文確定 (TX) | カート → 確認 → 完了。在庫引き当て + 注文登録 + 採番をトランザクション保証。 | カート、確認、完了 |
| 配送指示 | バックオフィスで注文一覧を確認、配送指示登録。外部キャリア API 連携。 | 注文一覧、配送指示 |

補助画面: ダッシュボード、商品マスター、顧客マスター、店舗マスター。

## ディレクトリ構成

```
examples/retail/
├── project.json              # workspace ルート定義 (v3 schema)
├── README.md                 # 本ファイル
├── screens/                  # 画面 (entity + GrapesJS design、画面項目定義 items[] を内包)
├── tables/                   # テーブル定義
├── process-flows/            # 処理フロー
├── views/                    # SQL VIEW 定義
├── view-definitions/         # 一覧 UI viewer 定義
├── sequences/                # 採番シーケンス
├── extensions/retail.v3.json # retail namespace 拡張定義 (v3 canonical combined format)
└── conventions/              # 業務規約カタログ (retail 拡張含む)
```

## 採用拡張 namespace

- `retail` — fieldTypes / actionTriggers / dbOperations / stepKinds / responseTypes を v3 canonical combined format (`extensions/retail.v3.json`) に統合

## 開き方 (動作確認)

`examples/retail/` は **git 管理の正本サンプル**。直接開くと編集が git 差分になるため、動作確認は **コピーして使う** ことを推奨します (デプロイ相当)。

### 推奨: workspaces/retail/ にコピーして使う (試行錯誤・編集 OK)

```bash
# workspaces/retail/ ディレクトリを作成してコピー (Windows PowerShell の例)
New-Item -ItemType Directory -Force -Path workspaces\retail
Copy-Item -Recurse -Force examples\retail\* workspaces\retail\

# backend / designer を起動
cd backend && npm run dev   # 別ターミナル
cd frontend && npm run dev
```

`workspaces/` は gitignored なので自由に編集できます。

> **注意**: `data/` への直接 deploy は禁止 (#753)。`data/` はデザイナー本体組み込み拡張定義 (`data/extensions/`) 専用です。

### 直接開く (見るだけの動作確認)

designer UI のヘッダー「ワークスペース」 → 「フォルダを追加」 → `examples/retail` の絶対パス を指定。**ただし編集して保存するとファイルが書き換わり git 差分が出ます (自己責任)**。本プロジェクトのサンプル更新作業以外では編集を避けてください。

## テスト fixture としての利用

```bash
# 固定 workspace で backend 起動 (lockdown モード = workspace 切替禁止)
DESIGNER_DATA_DIR=examples/retail npm run dev:mcp
```

注: lockdown モードは「workspace 切替を禁止する固定モード」であり、データの read-only モードではありません。データ編集は通常通り可能なので、test 終了後に `git restore examples/retail/` で戻すか、別フォルダにコピーしてから fixture 化することを推奨します。

## 検証 (AJV)

`examples/**/*.json` は schema 検証 test に組み込まれる。schema 進化時に retail サンプルが breakage したら CI で検出。

## 関連

- 親メタ: #680
- 起票: #706
- spec: [docs/spec/examples-retail.md](../../docs/spec/examples-retail.md)
- 運用方針: memory `project_samples_strategy_2026_05_02.md`
