# `/generate-code` ワークフロー (業務アプリ開発者向け)

**目的**: Harmony で設計した処理フロー / 画面 / ページレイアウトを、業務アプリ project root にコード生成し、Dev Container で開発を続ける。

本書は **Harmony の利用者** (業務アプリ設計者・開発リーダー) 向け。`/generate-code` skill の内部仕様は [`ai-skills/generate-code/SKILL.md`](../../ai-skills/generate-code/SKILL.md) (AI 実装者向け)、設計者承認が必要な拡張は [`docs/spec/schema-governance.md`](../spec/schema-governance.md) を参照。

## 位置づけ

`/generate-code <EntityId> <出力先>` は **業務アプリ project root を作る (または更新する) コマンド** です (引数の `<EntityId>` は `<flowId>` / `<screenId>` / `<pageLayoutId>` 等、`[a-z0-9-]` のみの kebab-case)。生成されるのは「Harmony という設計ツールから派生した独立した業務アプリ」であり、Harmony 本体 repo の一部ではありません。

```
Harmony (設計)                          業務アプリ (実装)
─────────────────                       ─────────────────────────
ProcessFlow / Screen / Table   ─────▶   ~/projects/<業務名>/
PageLayout / Convention                  ├── src/
(workspace 内 JSON)                      ├── .devcontainer/
                                         ├── Dockerfile
                                         └── docker-compose.yml
```

## project-root model とは

`<出力先>` は **業務アプリの project root を直接指す** 設計です。生成ファイルは canonical layout (Maven / Next.js 標準) で project root 直下に配置され、`.devcontainer/` / `Dockerfile` / `docker-compose.yml` / `README.md` も同じ project root に同居します。

つまり生成後にやることは:

```bash
code ~/projects/retail-app/      # project root を VS Code で開く
# → 右下に "Reopen in Container" のプロンプトが出る → クリック
```

これで業務アプリの dev 環境が完成します。

### canonical layout の例 (Spring Boot backend)

```
~/projects/retail-app/                  ← 業務アプリ project root
├── .devcontainer/
│   └── devcontainer.json
├── Dockerfile
├── docker-compose.yml
├── README.md
├── pom.xml
├── mvnw / mvnw.cmd                     ← `./mvnw spring-boot:run` で system Maven 不要
└── src/
    ├── main/
    │   ├── java/com/example/retailapp/
    │   │   ├── controller/
    │   │   ├── service/
    │   │   ├── repository/
    │   │   └── entity/
    │   └── resources/
    │       ├── application.properties
    │       ├── db/migration/           ← Flyway
    │       └── templates/              ← Thymeleaf (frontend=thymeleaf の場合)
    └── test/
```

### canonical layout の例 (NestJS + Next.js)

```
~/projects/inventory-admin/             ← 業務アプリ project root
├── .devcontainer/
├── Dockerfile
├── docker-compose.yml
├── README.md
├── package.json
├── tsconfig.json
├── nest-cli.json
├── next.config.mjs
├── <processFlowName>.service.ts        ← NestJS Service (root 直下、業務ロジック)
├── <processFlowName>.controller.ts     ← NestJS Controller (root 直下、HTTP ルート)
├── <processFlowName>.module.ts         ← NestJS Module (root 直下)
├── dto/                                ← Request / Response DTO
├── entity/                             ← TypeORM Entity (DB スキーマ)
├── src/                                ← AI / auth scaffold のみ (NestJS は src/ 強制ではない)
│   ├── ai/                             ← AI step あり時のみ
│   └── auth/                           ← auth.method 有効時のみ
├── app/                                ← Next.js App Router (frontend)
│   ├── components/layouts/
│   └── components/gadgets/
└── components/<domain>/                ← 共通 UI コンポーネント
```

## 推奨ワークフロー

```
┌─ 1. 設計 (Harmony 内) ───────────────────────────────────────┐
│   designer で ProcessFlow / Screen / Table / PageLayout を作成   │
│   `/review-flow` / spec ガイドラインで品質チェック                │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌─ 2. 業務名で project root を決める ──────────────────────────┐
│   例: ~/projects/retail-app/                                      │
│   ※ `generated` のような汎用名は避ける (後述「落とし穴」)        │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌─ 3. /generate-code 実行 ─────────────────────────────────────┐
│   /generate-code <EntityId> ~/projects/retail-app/                │
│   または bulk: /generate-code --all ~/projects/retail-app/      │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌─ 4. project root を Reopen in Container ─────────────────────┐
│   VS Code で ~/projects/retail-app/ を開く                       │
│   → 右下プロンプト「Reopen in Container」をクリック              │
│   → Dev Container build (初回 5-10 分) → 業務アプリ起動可        │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌─ 5. 設計変更時は Harmony へ戻る ─────────────────────────────┐
│   designer で修正 → 再度 /generate-code 同じ <出力先> へ        │
│   → 生成ファイルは上書きされる (手動編集分は git diff で確認)   │
└──────────────────────────────────────────────────────────────┘
```

## `<出力先>` の指定方針

| 状況 | 推奨 `<出力先>` |
|---|---|
| 業務アプリ開発の本番 | `~/projects/<業務名>/` (Harmony repo の外) |
| ad-hoc な smoke 確認 | `.tmp/generated-code/<入力 EntityId>/` (単発モード default) / `.tmp/generated-code/bulk-<UTC タイムスタンプ>/` (bulk モード default) |
| Harmony 同梱サンプル更新 (Harmony 本体開発者のみ) | `examples/<id>/generated/<techStack>/` (dogfood パターン) |

業務アプリの本番開発では **Harmony repo の外** に project root を作るのが基本です。Harmony repo 内に出力すると以下の不利益があります:

- Harmony の git 履歴と業務アプリの git 履歴が混在する
- Harmony の build 系 (Vite / TypeScript) が業務アプリのファイルを巻き込む
- VS Code で開いた時の `${localWorkspaceFolderBasename}` が `harmony` 固定になり、AI CLI state (`~/.agent-containers/<project-name>/`) が business app 単位に分離されない

## よくある落とし穴

### 1. folder 名に `generated` を使わない

`~/projects/generated/` のような汎用名で project root を作ると、VS Code Dev Container の `${localWorkspaceFolderBasename}` が `generated` になり、複数の業務アプリで AI CLI state (Claude Code / Codex / Copilot の OAuth・session・memory) が衝突します。**業務名で意味のある folder 名** (例: `retail-app`、`inventory-admin`、`payroll-2026`) を付けてください。

### 2. Harmony repo 内 (`workspaces/` / `examples/` / `data/`) に出力しない

これらは Harmony 本体のディレクトリです。業務アプリの本番開発で出力すると Harmony 側 git 履歴に巻き込まれます。**Harmony repo の外**に出力してください。

`examples/<id>/generated/<techStack>/` は **Harmony 同梱サンプル / dogfood 参照物** であり、複数 techStack を side-by-side で比較するための場所です。常用開発の project root として開く運用は想定していません。

### 3. 再生成時は手動修正が上書きされる

`/generate-code` は同じ `<出力先>` への再実行で生成ファイルを上書きします。生成後に手で加えた修正は `git diff` で確認 → 必要に応じてマージしてください。設計駆動でやり直したい変更は Harmony designer 側で行い、再生成するのが原則です。

scaffold (`.devcontainer/` / `Dockerfile` / `docker-compose.yml` / `README.md`) は既存があれば上書きせずスキップされます (#1048)。

### 4. 日本語値を `application.properties` に直書きしない (Spring Boot 系のみ)

`application.properties` は ISO-8859-1 デフォルトで読まれるため、`app.session.storeName=東京本店` のような直書きは文字化けします。`/generate-code` は適切にエスケープを生成しますが、生成後に手書きで日本語値を追加する際は注意してください。

### 5. `package.json` の依存は caret prefix を維持 (NestJS / Next.js 等 Node 系のみ)

`package.json` の `dependencies` は caret prefix (`^`) 必須です (#1035)。固定 version で hardcode すると `npm audit` 警告が残り続けます。

## bulk モード (`--all` / `--workspace`)

active workspace の全 entity を一括生成する場合:

```bash
/generate-code --all ~/projects/retail-app/
```

出力構造は entity 種別ごとにサブディレクトリで分離されます:

```
~/projects/retail-app/
├── process-flows/<flowId>/
├── screens/<screenId>/
└── page-layouts/<layoutId>/
```

`<flowId>` / `<screenId>` / `<layoutId>` は EntityId (kebab-case 英単語、例: `order-confirm` / `product-search` / `admin-shell`) をそのまま使用します (RFC #1284 / #1332)。legacy UUID 形式の resource が残っている場合は full UUID を使い、prefix を切り詰めません。

bulk モードは初期立ち上げ・一括再生成向け。日常的な部分更新は単発モード (`/generate-code <EntityId> <出力先>`) を推奨します。

## /generate-tests との対応

`/generate-tests <EntityId> <出力先>` は同じ `<出力先>` を指定することで、`src/test/` (Spring Boot) や `__tests__/` (NestJS / Next.js) など canonical なテスト配置に出力されます (`ai-skills/generate-tests/SKILL.md` 参照)。

## 関連ドキュメント

- [`/generate-code` skill 仕様](../../ai-skills/generate-code/SKILL.md) — AI 実装者向け詳細
- [処理フロー編集ワークフロー](process-flow-workflow.md) — 上流 (設計) フェーズの進め方
- [マルチエディタ / Puck デザイナ](multi-editor-puck-guide.md) — 画面エディタの選択
- [Dev Containers セットアップ](../setup/dev-containers.md) — Harmony 本体側の dev 環境 (業務アプリ側 Dev Container は `/generate-code` が自動同梱)
