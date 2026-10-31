---
description: "AI コード生成プロトコル (project.techStack に基づく指針。/generate-code skill)"
status: current
category: design
---

# AI コード生成プロトコル

`project.techStack` に基づく AI コード生成の指針を定義する。

実装状況: `project.techStack` スキーマは #826 で導入済み。
`/generate-code <flowId|screenId>` スキル本体は #832 で実装済 (`ai-skills/generate-code/`)。

PageLayout + Gadget の code generation 対応 (RFC #1021 pl-7、Phase 2) は #1028 で完了。
両 techStack (Spring Boot/Thymeleaf + NestJS/Next.js) で examples/retail 実機ビルド + 起動 pass 達成
(`examples/retail/generated/` 参照)。

---

## 1. 概要

業務システムデザイナーの `project.techStack` フィールドは、AI がプロジェクトの実装コードを生成する際のターゲット技術環境を明示する。AI はこのフィールドを読み取ることで:

- バックエンドコードを適切な言語/フレームワークで生成する
- フロントエンドコードをターゲットテンプレートエンジンで生成する
- 認証/デプロイ関連の設定ファイルを対応する形式で生成する

---

## 2. techStack フィールド構造

```json
{
  "techStack": {
    "designer": {
      "editorKind":   "grapesjs | puck",
      "cssFramework": "bootstrap | tailwind"
    },
    "backend": {
      "language":  "java | typescript | python | go | kotlin",
      "framework": "spring-boot | nestjs | express | fastapi | gin",
      "orm":       "prisma | typeorm (language が typescript のときだけ。省略時は prisma = 推奨)"
    },
    "database": {
      "type":    "postgresql | mysql | sqlite | oracle | sqlserver",
      "version": "バージョン文字列 (省略可)"
    },
    "frontend": {
      "library":   "react | vue | thymeleaf | blade | none",
      "framework": "next | nuxt | vite | none (省略可)"
    },
    "auth": {
      "method": "jwt | session | oauth2 | saml | none"
    },
    "deployment": {
      "target": "docker | vm | lambda | cloud-run | kubernetes"
    }
  }
}
```

---

## 3. カテゴリ別 AI 実装ガイドライン

### 3.1 デザイナー (techStack.designer)

- `editorKind: "puck"` → フロントエンドは必ず React コンポーネントを生成する
- `editorKind: "grapesjs"` → Thymeleaf / Blade テンプレートまたは React JSX を生成する
- `cssFramework: "tailwind"` → ユーティリティクラスを直接使用する、CDN 版不可
- `cssFramework: "bootstrap"` → Bootstrap 5 クラスを使用する

### 3.2 バックエンド (techStack.backend)

| 言語 | フレームワーク | 生成ファイル例 |
|------|--------------|----------------|
| java | spring-boot  | `@RestController`, `@Service`, `@Repository`, `application.yml` |
| kotlin | spring-boot | 上記の Kotlin 版 |
| typescript | nestjs | `@Controller`, `@Injectable`, `@Module`, `.module.ts` |
| typescript | express | `router.ts`, `middleware.ts` |
| python | fastapi | `@app.get`, `Pydantic model`, `requirements.txt` |
| go | gin | `gin.Context`, `main.go`, `go.mod` |

### 3.3 データベース (techStack.database)

- `type: "postgresql"` → `SERIAL` / `BIGSERIAL` 採番、`VARCHAR` / `TEXT` 型
- `type: "mysql"` → `AUTO_INCREMENT` 採番、`VARCHAR` / `LONGTEXT` 型
- `type: "oracle"` → `SEQUENCE` 採番、`VARCHAR2` / `CLOB` 型
- `version` フィールドが指定されている場合、バージョン固有の構文を優先する

### 3.4 フロントエンド (techStack.frontend)

- `library: "thymeleaf"` → `th:text`, `th:each`, `th:if` を使用
- `library: "blade"` → `{{ }}`, `@foreach`, `@if` を使用
- `library: "react"` → TSX コンポーネント、`useState`/`useEffect` hooks
- `library: "vue"` → SFC (`.vue`), `<template>/<script setup>/<style>`
- `framework: "next"` → `app/` ディレクトリルーター、Server Components 優先
- `framework: "nuxt"` → `pages/` ディレクトリルーター、`<NuxtLink>`

### 3.5 認証 (techStack.auth)

- `method: "jwt"` → `Authorization: Bearer <token>` ヘッダー、リフレッシュトークンパターン
- `method: "session"` → Cookie セッション、CSRF トークン
- `method: "oauth2"` → Authorization Code フロー、`/oauth2/authorization/{provider}`
- `method: "saml"` → SP-initiated SSO、metadata XML

### 3.6 デプロイ (techStack.deployment)

- `target: "docker"` → `Dockerfile`, `docker-compose.yml`
- `target: "kubernetes"` → `Deployment.yaml`, `Service.yaml`, `ConfigMap.yaml`
- `target: "cloud-run"` → Cloud Run `service.yaml`, `cloudbuild.yaml`
- `target: "lambda"` → Lambda function handler, `serverless.yml` / SAM テンプレート

---

## 4. 典型組合せパターン

### 4.1 Java Spring Boot + Thymeleaf (エンタープライズ標準)

```json
{
  "designer":   { "editorKind": "grapesjs", "cssFramework": "bootstrap" },
  "backend":    { "language": "java", "framework": "spring-boot" },
  "database":   { "type": "postgresql" },
  "frontend":   { "library": "thymeleaf" },
  "auth":       { "method": "session" },
  "deployment": { "target": "docker" }
}
```

生成物: Spring MVC コントローラ + Thymeleaf テンプレート + Spring Security セッション認証

### 4.2 TypeScript NestJS + React Next.js (SPA/SSR)

```json
{
  "designer":   { "editorKind": "puck", "cssFramework": "tailwind" },
  "backend":    { "language": "typescript", "framework": "nestjs" },
  "database":   { "type": "postgresql" },
  "frontend":   { "library": "react", "framework": "next" },
  "auth":       { "method": "jwt" },
  "deployment": { "target": "docker" }
}
```

生成物: NestJS REST API + Next.js App Router + JWT 認証

### 4.3 Python FastAPI + React Vite (軽量 API)

```json
{
  "designer":   { "editorKind": "puck", "cssFramework": "tailwind" },
  "backend":    { "language": "python", "framework": "fastapi" },
  "database":   { "type": "postgresql" },
  "frontend":   { "library": "react", "framework": "vite" },
  "auth":       { "method": "jwt" },
  "deployment": { "target": "cloud-run" }
}
```

### 4.4 Go Gin + なし (純 API バックエンド)

```json
{
  "designer":   { "editorKind": "grapesjs", "cssFramework": "bootstrap" },
  "backend":    { "language": "go", "framework": "gin" },
  "database":   { "type": "postgresql" },
  "frontend":   { "library": "none" },
  "auth":       { "method": "jwt" },
  "deployment": { "target": "kubernetes" }
}
```

### 4.5 Kotlin Spring Boot + Serverless (Lambda)

```json
{
  "designer":   { "editorKind": "grapesjs", "cssFramework": "bootstrap" },
  "backend":    { "language": "kotlin", "framework": "spring-boot" },
  "database":   { "type": "mysql" },
  "frontend":   { "library": "thymeleaf" },
  "auth":       { "method": "oauth2" },
  "deployment": { "target": "lambda" }
}
```

---

## 5. `/generate-code` スキルのフロー

`/generate-code <flowId|screenId> [出力先]` スキル (`SKILL.md` 参照) が実行する手順:

```
Step 0: 引数解析 — EntityId 判定、出力先デフォルト (.tmp/generated-code/<entity-id>/)
Step 1: 入力読込
  1-1. active workspace の harmony.json から techStack 取得
  1-2. EntityId を processFlows / screens / pageLayouts で照合して入力種別判定
  1-3. 入力 JSON を Read で取得
  1-4. PageLayout 入力なら Step 3-D へ (#1028 pl-7)
  1-5. Screen 入力なら purpose を判定:
       - purpose=gadget → Step 3-C へ
       - purpose=page (default) → Step 3-B へ
Step 2: techStack 制約検証 (validateTechStackConstraints 相当)
  - editorKind=puck → react 必須
  - backend lang × framework matrix
  - thymeleaf/blade → grapesjs 必須
  - vue → {nuxt, vite, none}
  - react → {next, vite, none}
  - 違反あれば中止
  2-4. PageLayout 解決 (pl-7): Screen.pageLayoutId 指定時は page-layouts/<id>.json を load + assignments の gadget を解決
  2-5. cssFramework ミスマッチ検出 (pl-7): PageLayout / 各 gadget / 各 page の cssFramework 混在を警告
Step 3: 入力種別別 dispatch
  3-A ProcessFlow → backend code 生成 (step kind ごとのマッピング)
  3-B Screen (purpose=page) → frontend code 生成 (screen.kind ごとのテンプレート分岐)
       pageLayoutId 指定時は Layout Decorate / Wrap モードで生成
  3-C Screen (purpose=gadget) → fragment + Controller / client component + Route Handler 生成 (pl-7)
  3-D PageLayout → Thymeleaf passive layout / Next.js AppLayout component 生成 (pl-7)
Step 4: テンプレート参照 (ai-skills/generate-code/templates/)
  - thymeleaf-bootstrap/: PAGE.md + LAYOUT.md (pl-7) + FRAGMENT.md (pl-7)
  - react-tailwind-next/: PAGE.md + LAYOUT.md (pl-7) + COMPONENT.md (pl-7)
Step 5: コード生成 + 出力先への書き出し
Step 6: smoke 検証 (Java 構文目視 / Thymeleaf XML パース / tsc dry)
最終レポート出力
```

詳細は `ai-skills/generate-code/SKILL.md` を参照すること。

---

## 6. 組合せ制約 (techStackConstraints.ts)

コード生成前に `validateTechStackConstraints(project.techStack)` を呼び出し、
違反がある場合はエラーメッセージを返す。詳細は
`frontend/src/utils/techStackConstraints.ts` を参照。

主要制約:
1. `editorKind=puck` → `frontend.library="react"` 必須
2. バックエンド言語 × フレームワーク matrix (java→spring-boot のみ、等)
3. `thymeleaf | blade` → `editorKind=grapesjs` 必須
4. `vue` → `framework ∈ {nuxt, vite, none}`
5. `react` → `framework ∈ {next, vite, none}`

---

## 7. ProcessFlow → backend mapping ルール

ProcessFlow JSON の step kind ごとのコード生成方針。詳細は `ai-skills/generate-code/SKILL.md` Step 3-A を参照。

| step.kind | Java Spring Boot | TypeScript NestJS |
|---|---|---|
| `dbAccess` (SELECT) | JPA Repository `findBy...()` または `@Query(nativeQuery=true)` | ORM で分ける (下の「NestJS の ORM と DB」) |
| `dbAccess` (INSERT) | `repository.save(entity)` | 同上 |
| `dbAccess` (UPDATE) | `@Modifying @Query` + affectedRowsCheck | 同上 |
| `dbAccess` (DELETE) | `@Modifying @Query deleteBy...()` | 同上 |
| `transactionScope` | `@Transactional(isolation, timeout)` + rollbackOn → 例外 throw | ORM で分ける (Prisma: `prisma.$transaction(async (tx) => …)` / TypeORM: `dataSource.transaction(async (manager) => …)`) |
| `screenTransition` | `return "redirect:/path"` (MVC Controller) / REST API では出力しない | `res.redirect('/path')` |
| `branch` | `if (condition) { ... } else { ... }` + `throw XxxException` | `if (condition) { throw new HttpException(...) }` |
| `loop` (collection) | `for (ItemType item : collection) { ... }` | `for (const item of collection) { ... }` |
| `eventPublish` | `ApplicationEventPublisher.publishEvent(new XxxEvent(...))` | `EventEmitter2.emit('topic', payload)` |
| `compute` | ローカル変数計算 (`stream().mapToLong().sum()` 等) | ローカル変数計算 (`reduce`, `map` 等) |
| `validation` | Bean Validation DTO アノテーション + `@Valid` Controller 引数 | `class-validator` DTO デコレータ |
| `return` | `ResponseEntity.<T>status(N).body(body)` | `return responseDto` または `throw new HttpException(body, status)` |
| `log` | `log.error(message, structuredData)` | `this.logger.error(message, structuredData)` |

### NestJS の ORM と DB (#1560 / #1570)

NestJS の DB 層は、`techStack.backend.orm` (`prisma` / `typeorm`。**省略時は `prisma`**) と `techStack.database.type` (**省略時は `postgresql`**) で決まる。**1 つの生成物の中で 2 つの ORM を混ぜない** (`orm: typeorm` のときは `prisma/` `@prisma/client` `PrismaService` を一切出さず、`orm: prisma` のときは `typeorm` `@nestjs/typeorm` `*.entity.ts` を一切出さない)。

| step | `orm: prisma` (既定・省略時) | `orm: typeorm` |
|---|---|---|
| 生成する DB 層 | `prisma/schema.prisma` (model は physicalName の snake_case → PascalCase の最後の語を単数形、`@@map("<physicalName>")`、`provider` は `database.type` から)、`src/prisma/prisma.service.ts` / `prisma.module.ts` | `entity/*.entity.ts`、`src/database/typeorm.config.ts` (`TypeOrmModule.forRootAsync` と全 Entity の列挙。`type` は `database.type` から) |
| Service が受け取る | `PrismaService` | `DataSource` と `Repository<Entity>` |
| `dbAccess` SELECT | `prisma.<model>.findUnique()` / `findMany()`、生 SQL は `$queryRaw` | `repository.findOneBy()` / `find()`、生 SQL は `dataSource.query()` |
| `dbAccess` INSERT / UPDATE / DELETE | `create()` / `update()` / `delete()` | `save()` / `update()` / `delete()` |
| `transactionScope` | `this.prisma.$transaction(async (tx) => { … })`。中では `tx` を使う | `this.dataSource.transaction(async (manager) => { … })`。中では `manager` を使う |
| SQL のバインド変数 | `$queryRaw` のタグ付きテンプレートの `${var}` | postgresql は `$N`、mysql / sqlite は `?` |
| 表づくり (dev) | `npx prisma db push` | アプリ起動時の `synchronize` (`DB_SYNCHRONIZE=true`) |

開発コンテナの雛形 (`templates/devcontainer/nestjs-*`) は、`database.type` (postgresql / mysql / sqlite) と `orm` ごとのブロックを持ち、写すときに合うものだけ残す。`docker-compose.yml` の DB サービスと `DATABASE_URL`、`.devcontainer/compose.yml` の開発用 DB、README の「DB 初期化」が、この選択で変わる。`.devcontainer/devcontainer.json` の `postCreateCommand` (`prisma generate`) と拡張 `Prisma.prisma` は `orm` だけで変わり、`orm: typeorm` の生成物には Prisma の記述が出ない。詳細は `ai-skills/generate-code/SKILL.md` の「DB と ORM の読み方」「DB ごとのブロック」。`database.type` が `sqlserver` / `oracle` の DB サービスは雛形の対象外。Prisma は `oracle` に対応していないので、そのときは生成を止めて知らせる。

generate-tests の DB 検証・seed も同じ ORM で書く (`ai-skills/generate-tests/SKILL.md` の「DB 検証の ORM 別の書き方」)。
| `other` | `// TODO: {{step.description}}` + outputSchema で型推定 (注: schema の `kind` に `other` は存在しない。extension step では `type: "other"` を使う別階層の概念であるため混同注意) | 同左 |

### ambientVariables → フレームワーク引数

`context.ambientVariables` で宣言された変数は、Controller / Router 層でリクエスト文脈から取得する:

| ambientVariable | Java Spring Boot | TypeScript NestJS |
|---|---|---|
| `sessionCustomerId` | `HttpSession.getAttribute("customerId")` | `(req.session as any).customerId` |
| `requestId` | `HttpServletRequest.getHeader("X-Request-ID")` | `req.headers['x-request-id']` |

### httpRoute → Controller メソッドシグネチャ

```
action.httpRoute.method: "POST"  → @PostMapping / @Post()
action.httpRoute.path: "/api/retail/orders"
  → @RequestMapping("/api/retail") + @PostMapping("/orders")
action.httpRoute.auth: "required" → Spring Security 設定 / @UseGuards(SessionGuard)
```

---

## 8. Screen → frontend mapping ルール

Screen JSON の `kind` フィールドとテンプレート分岐。詳細は `ai-skills/generate-code/SKILL.md` Step 3-B を参照。

| screen.kind | Thymeleaf テンプレートパターン | React/Next.js テンプレートパターン |
|---|---|---|
| `search` | 検索フォーム (`<form method="get">`) + `<table th:each>` 結果表示 | Client Component フォーム + Server Component テーブル |
| `list` | `<table th:each="row : ${rows}">` 一覧 | Server Component テーブル + pagination |
| `form` | `<form method="post">` + 入力コントロール群 | `<form action={serverAction}>` + 入力コントロール群 |
| `confirm` | フォーム内容確認表示 (読み取り専用) + submit | confirm ページ + Server Action |
| `complete` | 完了メッセージ + 遷移リンク (`<a th:href>`) | 完了ページ + `<Link href>` |
| `dashboard` | ダッシュボード (固定セクション配置) | ダッシュボードページ (Server Component) |
| 業界拡張 kind (例: `retail:cart`) | extensions/ 配下の定義を参照。未定義なら `list` 扱い | 同左 |

### screen.items[] → UI 要素マッピング

| direction / presentation | type | Thymeleaf | React |
|---|---|---|---|
| `in` | `string` (no options) | `<input type="text" th:value="${param.X}">` | `<input type="text" value={X} onChange={...}>` |
| `in` | `string` + options[] | `<select><option th:each="opt : ${options}">` | `<select>` + options map |
| `in` | `datetime` | `<input type="datetime-local">` | `<input type="datetime-local">` |
| `out` / `both` | scalar | `<span th:text="${X}">` | `<span>{x}</span>` |
| `out` / `both` + `presentation.kind=table` | array + `presentation.viewDefinitionId` | `<table th:each="row : ${rows}"><tr><td th:text>` | TanStack Table / データテーブルコンポーネント |

### editorKind 解決順序 (multi-editor-puck.md § 2.3)

```
1. screen.design.editorKind (画面個別指定)
2. project.techStack.designer.editorKind (project default)
3. デフォルト: "grapesjs"
```

解決後の editorKind が `"puck"` で Thymeleaf 出力をリクエストした場合はスキップして報告する
(Puck 画面は React コンポーネント生成が前提であり、Thymeleaf 非対応)。

---

## 9. 出力ディレクトリ規約

生成コードは `.tmp/generated-code/` (または `/generate-code` 第2引数) に書き出す。
プロジェクトルート直置き禁止 (AGENTS.md 一時ファイル配置ルール準拠)。

### Java Spring Boot

```
<出力先>/src/main/java/com/example/<projectName>/
  service/     — <Name>Service.java
  controller/  — <Name>Controller.java
  entity/      — <TableName>.java
  repository/  — <TableName>Repository.java
  dto/         — <ActionName>Request.java, <ActionName>Response.java
<出力先>/src/main/resources/
  db/migration/  — V1__create_<tableName>.sql (Flyway)
  templates/     — <path>/<screenName>.html (Thymeleaf)
```

### TypeScript NestJS + Next.js

```
<出力先>/
  <name>.service.ts        — NestJS Service
  <name>.controller.ts     — NestJS Controller
  <name>.module.ts         — NestJS Module
  dto/                     — <action>-request.dto.ts, <action>-response.dto.ts
  entity/                  — <table>.entity.ts
  app/<path>/page.tsx      — Next.js App Router ページ
  components/<domain>/     — React コンポーネント
```

---

## 9.5 生成の前後を支える道具 (MCP / CLI)

| 場面 | 道具 |
|---|---|
| 生成の前に、設計から情報を集める | `designer__get_generation_brief` — 処理フロー (`processFlowId`) / 画面 (`screenId`) ごとに、何を作るか・技術スタック・処理の流れ (言葉)・使うテーブルのカラム・規約の参照 (`@conv.*` の値つき)・呼び出す画面の項目・テスト観点・記録の呼び方を 1 つの文書 (Markdown) にまとめる。大きさに上限がある (テーブル 30・項目 80・観点 60 まで。超えた分は件数で知らせる) |
| 生成したら | `designer__record_generation` — 作ったファイルと元にした設計を記録する。**テストのファイルは、パスに `test` か `spec` を含める** |
| テストが観点表をどれだけ覆うか | `designer__check_test_coverage` — 記録されたテストのうち、本文に観点の ID が書かれているものを数える (割合・覆っていない観点)。ID をテスト名に書く約束は [test-viewpoints.md](test-viewpoints.md) §5。`screenIds` / `flowIds` の一方だけ指定したら、もう一方は対象にしない |
| 設計が変わったときの再生成の範囲 | `designer__check_generation_drift` → `designer__get_regeneration_diff`。変更に絞ったテスト観点は `designer__get_test_viewpoints` の `since` |
| CI・コミット前の確認 | `npm run check:generation -- <ワークスペース> [--coverage [--min <割合>]] [--require-records] [--json]` — ずれ (設計が変わった・生成物が書き換わった・消えた) か、記録の読み込みの問題があれば終了コード 1。記録が 0 件のときは何も検査していないので 0 (`--require-records` で 1 にできる)。`--coverage --min` で観点の覆い方の下限も見る |

`get_generation_brief` と `check_test_coverage` は読み取りだけ (読み取り専用モード・プロファイル `read` でも使える)。`check_test_coverage` が読むのは、記録された生成物だけ (ワークスペースか `.tmp/generated-code/` の中の通常のファイル。外へ出るパス・外を指すシンボリックリンク・2 MiB を超えるものは読まない)。

## 10. 検証方法

### `/generate-code` スキルの smoke 検証 (Step 6)

| 検証対象 | 方法 | 合否基準 |
|---|---|---|
| Java ファイル | 構文チェックポイント目視 + (javac 利用可能なら) `javac *.java` | 構文エラー 0 件 |
| Thymeleaf HTML | `[xml](Get-Content *.html)` (PowerShell XML パース) | パース成功 = well-formed |
| TypeScript ファイル | `npx tsc --noEmit` (tsc 利用可能なら) | 型エラー 0 件 |

### CI 自動化について

本スキルは AI 対話駆動のため **CI (GitHub Actions / Vitest) の自動化対象外**とする。

理由:
1. 生成コードはプロジェクト固有のパッケージ名・依存関係を必要とし、汎用 CI では build 不可
2. スキル実行は `/generate-code <id>` の明示的な呼び出しで行われ、コミット対象でない
3. golden-examples の回帰テストは `ai-skills/generate-code/golden-examples/` を手動 diff で確認する

ゴールデン出力改善時は同ディレクトリのファイルを更新し、PR diff レビューで品質を担保する。
