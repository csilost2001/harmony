# AI コード生成プロトコル

`project.techStack` に基づく AI コード生成の指針を定義する。

実装状況: `project.techStack` スキーマは #826 で導入済み。
`/generate-code <flowId|screenId>` スキル本体は #832 で実装済 (`.claude/skills/generate-code/`)。

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
      "framework": "spring-boot | nestjs | express | fastapi | gin"
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
Step 0: 引数解析 — UUID 判定、出力先デフォルト (.tmp/generated-code/<UUID8桁>/)
Step 1: 入力読込
  1-1. active workspace の project.json から techStack 取得
  1-2. UUID を processFlows / screens で照合して入力種別判定
  1-3. 入力 JSON (ProcessFlow / Screen) を Read で取得
Step 2: techStack 制約検証 (validateTechStackConstraints 相当)
  - editorKind=puck → react 必須
  - backend lang × framework matrix
  - thymeleaf/blade → grapesjs 必須
  - vue → {nuxt, vite, none}
  - react → {next, vite, none}
  - 違反あれば中止
Step 3: 入力種別別 dispatch
  3-A ProcessFlow → backend code 生成 (step kind ごとのマッピング)
  3-B Screen → frontend code 生成 (screen.kind ごとのテンプレート分岐)
Step 4: テンプレート参照 (.claude/skills/generate-code/templates/)
Step 5: コード生成 + 出力先への書き出し
Step 6: smoke 検証 (Java 構文目視 / Thymeleaf XML パース / tsc dry)
最終レポート出力
```

詳細は `.claude/skills/generate-code/SKILL.md` を参照すること。

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

ProcessFlow JSON の step kind ごとのコード生成方針。詳細は `.claude/skills/generate-code/SKILL.md` Step 3-A を参照。

| step.kind | Java Spring Boot | TypeScript NestJS |
|---|---|---|
| `dbAccess` (SELECT) | JPA Repository `findBy...()` または `@Query(nativeQuery=true)` | TypeORM `repository.findOne()` または `dataSource.query()` |
| `dbAccess` (INSERT) | `repository.save(entity)` | `manager.save(entity)` |
| `dbAccess` (UPDATE) | `@Modifying @Query` + affectedRowsCheck | `manager.query(sql)` + 行数チェック |
| `dbAccess` (DELETE) | `@Modifying @Query deleteBy...()` | `manager.delete()` |
| `transactionScope` | `@Transactional(isolation, timeout)` + rollbackOn → 例外 throw | `dataSource.transaction('READ COMMITTED', async manager => { ... })` |
| `screenTransition` | `return "redirect:/path"` (MVC Controller) / REST API では出力しない | `res.redirect('/path')` |
| `branch` | `if (condition) { ... } else { ... }` + `throw XxxException` | `if (condition) { throw new HttpException(...) }` |
| `loop` (collection) | `for (ItemType item : collection) { ... }` | `for (const item of collection) { ... }` |
| `eventPublish` | `ApplicationEventPublisher.publishEvent(new XxxEvent(...))` | `EventEmitter2.emit('topic', payload)` |
| `compute` | ローカル変数計算 (`stream().mapToLong().sum()` 等) | ローカル変数計算 (`reduce`, `map` 等) |
| `validation` | Bean Validation DTO アノテーション + `@Valid` Controller 引数 | `class-validator` DTO デコレータ |
| `return` | `ResponseEntity.<T>status(N).body(body)` | `return responseDto` または `throw new HttpException(body, status)` |
| `log` | `log.error(message, structuredData)` | `this.logger.error(message, structuredData)` |
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

Screen JSON の `kind` フィールドとテンプレート分岐。詳細は `.claude/skills/generate-code/SKILL.md` Step 3-B を参照。

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

| direction | type | Thymeleaf | React |
|---|---|---|---|
| `input` | `string` (no options) | `<input type="text" th:value="${param.X}">` | `<input type="text" value={X} onChange={...}>` |
| `input` | `string` + options[] | `<select><option th:each="opt : ${options}">` | `<select>` + options map |
| `input` | `datetime` | `<input type="datetime-local">` | `<input type="datetime-local">` |
| `output` | any | `<span th:text="${X}">` | `<span>{x}</span>` |
| `viewer` | array + viewDefinitionId | `<table th:each="row : ${rows}"><tr><td th:text>` | データテーブルコンポーネント |

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
3. golden-examples の回帰テストは `.claude/skills/generate-code/golden-examples/` を手動 diff で確認する

ゴールデン出力改善時は同ディレクトリのファイルを更新し、PR diff レビューで品質を担保する。
