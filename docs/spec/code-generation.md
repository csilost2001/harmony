# AI コード生成プロトコル

`project.techStack` に基づく AI コード生成の指針を定義する。

実装状況: `project.techStack` スキーマは #826 で導入済み。
`/generate-code <flowId|screenId>` スキル実装は後続 ISSUE にて対応予定。

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

## 5. AI がコード雛形を選ぶ手順 (擬似コード)

```
function selectCodeTemplate(project: Project):
  ts = project.techStack

  // 1. バックエンドテンプレートを選択
  backendTemplate = BACKEND_TEMPLATES[ts.backend.language][ts.backend.framework]
  
  // 2. フロントエンドテンプレートを選択
  frontendTemplate = FRONTEND_TEMPLATES[ts.frontend.library]
  if ts.frontend.framework:
    frontendTemplate = FRONTEND_TEMPLATES[ts.frontend.library][ts.frontend.framework]
  
  // 3. 認証コードを選択
  authCode = AUTH_TEMPLATES[ts.auth.method][ts.backend.framework]
  
  // 4. DB 設定を選択
  dbConfig = DB_CONFIGS[ts.database.type]
  if ts.database.version:
    dbConfig = dbConfig.forVersion(ts.database.version)
  
  // 5. デプロイ設定を選択
  deployConfig = DEPLOY_TEMPLATES[ts.deployment.target][ts.backend.language]
  
  // 6. 組合せ制約チェック (techStackConstraints.ts 参照)
  violations = validateTechStackConstraints(ts)
  if violations:
    raise ConstraintError(violations)
  
  return { backendTemplate, frontendTemplate, authCode, dbConfig, deployConfig }
```

---

## 6. 組合せ制約 (techStackConstraints.ts)

コード生成前に `validateTechStackConstraints(project.techStack)` を呼び出し、
違反がある場合はエラーメッセージを返す。詳細は
`designer/src/utils/techStackConstraints.ts` を参照。

主要制約:
1. `editorKind=puck` → `frontend.library="react"` 必須
2. バックエンド言語 × フレームワーク matrix (java→spring-boot のみ、等)
3. `thymeleaf | blade` → `editorKind=grapesjs` 必須
4. `vue` → `framework ∈ {nuxt, vite, none}`
5. `react` → `framework ∈ {next, vite, none}`

---

## 7. 後続予定

- `#TBD`: `/generate-code <flowId|screenId>` スキル実装
  - ProcessFlow JSON を読み取り、techStack に基づいて実装コードを生成する
  - screen.json を読み取り、対応するフロントエンドコンポーネントを生成する
