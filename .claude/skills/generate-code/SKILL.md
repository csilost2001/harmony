---
name: generate-code
description: project.techStack に基づき ProcessFlow JSON → backend code / Screen JSON → frontend code を AI が生成する。Spring Boot/Thymeleaf 系と NestJS/Next.js 系の 2 種類の techStack 組合せをカバー。
argument-hint: <flowId|screenId|pageLayoutId> | --all | --workspace <wsId> [出力先]
disable-model-invocation: true
---

<!--
  使い方:
    /generate-code f81dd9e0-794c-4539-a2a5-9cbcc0a75899
    /generate-code e6147dc0-94b7-436d-ba87-d0080ac34f44
    /generate-code f81dd9e0-794c-4539-a2a5-9cbcc0a75899 .tmp/generated-code/order-confirm
    /generate-code --all                                  (active workspace 全 entity)
    /generate-code --workspace examples/retail            (指定 wsId を active 扱いで bulk)
    /generate-code --workspace examples/retail .tmp/out/  (出力先指定)

  目的:
    project.techStack を読み取り、ProcessFlow JSON または Screen JSON から
    対応する実装コード雛形を AI が生成して出力ディレクトリに書き出す。
    ゴールデン出力 (golden-examples/) を参照してコード品質を均一化する。

  カバーする techStack 組合せ:
    1. Java Spring Boot + Thymeleaf + PostgreSQL (retail サンプル既定)
    2. TypeScript NestJS + React/Next.js + PostgreSQL

  制限事項 (本 PR スコープ外、別 ISSUE で逐次拡張):
    - 全 techStack 組合せ網羅 (Python FastAPI / Go Gin 等)
    - 認証 (techStack.auth) テンプレート
    - デプロイ (techStack.deployment) テンプレート
    - CI 自動化 (Skill 実行は AI 対話駆動のため CI に乗せない)

  発動制御:
    - `disable-model-invocation: true`: ユーザーが明示的に `/generate-code [args]` と打った時のみ起動
-->

ProcessFlow / Screen `$ARGUMENTS` から、project.techStack に基づくコード雛形を生成します。

## PageLayout / Gadget 対応の概要 (pl-7)

RFC #1021 で追加された以下の 3 種類の入力に対して、code generation を行います (pl-7 対応):

| 入力種別 | 判定条件 | 生成パス |
|---|---|---|
| Gadget | Screen.purpose === "gadget" | Step 3-C (Thymeleaf fragment + Controller / NestJS client component) |
| Page (レイアウト付き) | Screen.purpose === "page" かつ pageLayoutId あり | Step 3-B (layout decorate モード) |
| PageLayout entity | 入力 UUID が pageLayouts に存在 | Step 3-D (Thymeleaf passive layout / NestJS AppLayout) |

`purpose` フィールドが存在しない Screen は旧 schema 互換で `"page"` として扱います。
各生成パスの詳細テンプレートは `templates/frontend/{thymeleaf-bootstrap,react-tailwind-next}/` 配下に整備済 (Phase B/C 完了)。本 Step では分岐ロジックと参照リンクを定義します。

## Step 0: 引数解析

`$ARGUMENTS` を以下のいずれかの形式で解析する。

### 単発モード (従来)

```
/generate-code <flowId|screenId|pageLayoutId> [出力先]
```

- 第1引数 `<flowId|screenId|pageLayoutId>` (必須): UUID v4 形式
  - UUID でない場合は「引数エラー: UUID v4 形式で指定してください」と報告して中止
- 第2引数 `<出力先>` (任意): ディレクトリパス (default: `.tmp/generated-code/<入力UUID8桁>/`)

### bulk モード (`--all` / `--workspace`)

```
/generate-code --all [出力先]                  # active workspace の全 entity を順次生成
/generate-code --workspace <wsId> [出力先]      # 指定 wsId を active 扱いで bulk 実行
```

- `--all`: active workspace の `project.json` / `harmony.json` から `entities.processFlows[]`, `entities.screens[]`, `entities.pageLayouts[]` を全て読み、各 UUID に対して Step 1 以降を順次実行する
- `--workspace <wsId>`: 第 2 引数として workspace ID を受け取り、`workspaces/<wsId>/` (または `examples/<wsId>/`) を active 扱いで Step 1 以降を順次実行 (既存 active を変更しない)
- 出力先 (default: `.tmp/generated-code/bulk-<UTC-yyyymmdd-hhmmss>/`) は entity 種別ごとにサブディレクトリで分離する:
  ```
  <出力先>/process-flows/<flowId8桁>/   各 ProcessFlow の生成物
  <出力先>/screens/<screenId8桁>/        各 Screen の生成物
  <出力先>/page-layouts/<layoutId8桁>/   各 PageLayout の生成物
  ```
- bulk モード時の実行詳細は Step 5 「bulk モード時のループ動作」を参照

出力先ディレクトリが存在しない場合はコード生成前に作成する (PowerShell: `New-Item -ItemType Directory -Force`)。

## Step 1: 入力読込

### 1-1. active workspace の project.json から techStack を取得

MCP ツール `mcp__backend__designer__workspace_status` または `workspace_inspect` で active workspace を特定し、
その `project.json` を Read で読む。

**フォールバック**: MCP 未接続の場合は `examples/retail/project.json` を読む。

```
project.techStack:
  designer.editorKind, designer.cssFramework
  backend.language, backend.framework
  database.type, database.version
  frontend.library, frontend.framework
  auth.method
  deployment.target
```

### 1-2. 入力 UUID の種別を project.json から判定

`project.json` の `entities.processFlows[].id` と `entities.screens[].id` を照合する。

- `processFlows[].id` にマッチ → ProcessFlow → backend code 生成へ (Step 3-A)
- `screens[].id` にマッチ → Screen → frontend code 生成へ (Step 3-B)
- どちらにもマッチしない → 「ID が見つかりません (processFlows / screens を確認してください)」と報告して中止

### 1-3. 入力 JSON を Read で取得

- ProcessFlow: active workspace の `process-flows/<id>.json` / フォールバック: `examples/retail/process-flows/<id>.json`
- Screen: active workspace の `screens/<id>.json` / フォールバック: `examples/retail/screens/<id>.json`
- PageLayout: active workspace の `page-layouts/<id>.json` / フォールバック: `examples/retail/page-layouts/<id>.json`

### 1-4. PageLayout entity の検出

`project.json`(または `harmony.json`) に `entities.pageLayouts[].id` が存在する場合、入力 UUID をそこに照合する。

```
if entities.pageLayouts[].id にマッチ:
  → PageLayout entity → Step 3-D (PageLayout 生成パス) へ
  ※ Step 1-2 の processFlows / screens マッチより先に PageLayout を確認すること
     (pageLayouts が存在しない場合はスキップ)
```

## Step 1.5: Screen 種別判定の細分化

Step 1-2 で Screen ID にルーティングされた場合、Screen JSON の `purpose` フィールドを読み、以下に分岐する。

```
screen.purpose (解決順序):
  1. Screen JSON の purpose フィールド
  2. フィールドが存在しない → 旧 schema 互換で "page" とみなす

分岐:
  purpose === "gadget"
    → Step 3-C (Gadget 生成パス) へ

  purpose === "page" (または purpose 未設定)
    → step 2 (techStack 制約検証) → Step 3-B (Page frontend 生成) へ
       ただし、pageLayoutId が存在すれば Step 2.4 (PageLayout 解決) を先に実行
```

**注意**: `purpose` は Screen.kind とは独立したフィールドです。`kind: "dashboard"` の Screen でも `purpose: "page"` なら通常の page 生成パスです。

## Step 2: techStack 制約検証

`frontend/src/utils/techStackConstraints.ts` の `validateTechStackConstraints()` 相当チェックを実施する。
以下の制約をすべて確認し、違反があれば「techStack 制約違反: <詳細>」と報告して中止する。

### 制約 1: editorKind=puck → frontend.library="react" 必須

```
if (techStack.designer?.editorKind === "puck"):
  lib = techStack.frontend?.library
  if (lib !== undefined AND lib !== "react"):
    VIOLATION: 'Puck エディタは React 専用です。frontend.library を "react" に変更してください (現在: "{lib}")。'
```

### 制約 2: バックエンド言語 × フレームワーク matrix

```
許容組合せ:
  java       → spring-boot のみ
  typescript → nestjs, express
  python     → fastapi
  go         → gin
  kotlin     → spring-boot

if (lang !== undefined AND framework !== undefined):
  allowed = BACKEND_LANG_FRAMEWORK_MAP[lang]
  if (framework NOT IN allowed):
    VIOLATION: '言語 "{lang}" に対して "{framework}" は未対応です。使用可能: {allowed}'
```

### 制約 3: thymeleaf / blade → editorKind=grapesjs 必須

```
if (frontendLib IN ["thymeleaf", "blade"] AND editorKind === "puck"):
  VIOLATION: 'frontend.library "{frontendLib}" は Puck エディタと共存できません。editorKind を "grapesjs" に変更してください。'
```

### 制約 4: vue → frontend.framework ∈ {nuxt, vite, none}

```
if (frontendLib === "vue" AND fw !== undefined AND fw NOT IN ["nuxt", "vite", "none"]):
  VIOLATION: 'Vue.js には frontend.framework "{fw}" は使用できません。"nuxt", "vite", "none" から選択してください。'
```

### 制約 5: react → frontend.framework ∈ {next, vite, none}

```
if (frontendLib === "react" AND fw !== undefined AND fw NOT IN ["next", "vite", "none"]):
  VIOLATION: 'React には frontend.framework "{fw}" は使用できません。"next", "vite", "none" から選択してください。'
```

### editorKind 解決順序 (multi-editor-puck.md § 2.3)

```
1. screen.design.editorKind (Screen JSON 個別指定)
2. project.techStack.designer.editorKind (project default)
3. デフォルト: "grapesjs"
```

Thymeleaf テンプレート出力を行う場合、解決後の editorKind が "puck" であれば
「**この画面は Puck エディタ (React) です。Thymeleaf 出力はスキップします。**」と報告してスキップする。

## Step 2.4: PageLayout 解決 (Screen.purpose=page かつ pageLayoutId あり)

Step 1.5 で `purpose === "page"` にルーティングされ、かつ Screen JSON に `pageLayoutId` が存在する場合、以下を実行する。

```
1. active workspace の `page-layouts/<pageLayoutId>.json` を Read
   フォールバック: `examples/retail/page-layouts/<pageLayoutId>.json`

2. PageLayout JSON から以下の情報を取得:
   - id, name
   - regions[]: { id, name, order }
   - assignments: { [regionId]: gadgetScreenId }  (region → Gadget の対応)
   - design.editorKind, design.cssFramework

3. assignments の各 gadgetScreenId を解決:
   各 gadgetScreenId について `screens/<gadgetScreenId>.json` を Read し、
   Gadget の name / design / path 等を取得する。
   map 化: { "<regionId>": { gadgetId, gadgetName, gadgetDesign } }

4. 収集した PageLayout + gadget 情報を Step 3-B (layout decorate モード) に渡す。
```

pageLayouts が active workspace に存在しない (JSON が見つからない) 場合:
→ 「警告: pageLayoutId `<id>` が見つかりません。レイアウトなしで Page を生成します。」と報告し、
   通常の Step 3-B (layout なしモード) で続行する。

## Step 2.5: cssFramework ミスマッチ検出

Step 2.4 で PageLayout と Gadget 群を解決した後、以下の整合性チェックを行う。

```
収集する cssFramework:
  - PageLayout の design.cssFramework (例: "bootstrap")
  - 各 Gadget Screen の design.cssFramework (例: "tailwind")
  - 対象 Page Screen の design.cssFramework (省略時は project.techStack.designer.cssFramework)

チェック:
  if 上記のうち 2 種以上の異なる cssFramework が混在する場合:
    「⚠️ 警告: cssFramework の混在が検出されました。
     PageLayout: <framework> / Gadget(<id>): <framework> / Page: <framework>
     Thymeleaf 系では Bootstrap と Tailwind の HTML クラスが混在します。
     生成は続行しますが、CSS を統一することを推奨します (multi-editor-puck.md § 2.3 参照)。」
    と報告して続行 (生成は中止しない)
```

cssFramework が全て同一の場合、またはフィールドが存在しない場合はスキップ。

## Step 3-A: ProcessFlow → backend code 生成

ProcessFlow JSON を入力として、techStack に基づく backend code 雛形を生成する。

### テンプレート選択

| techStack.backend | 参照テンプレート |
|---|---|
| java + spring-boot | `.claude/skills/generate-code/templates/backend/java-spring-boot/` |
| typescript + nestjs | `.claude/skills/generate-code/templates/backend/typescript-nestjs/` |
| その他 | 「未対応の techStack 組合せです (本スキルは java/spring-boot と typescript/nestjs のみカバー)。別 ISSUE で対応予定。」と報告して中止 |

### step kind ごとのコード生成ルール (§8 — ProcessFlow → backend mapping)

各 step を走査して対応するコードブロックを生成する。

| step.kind | Java Spring Boot 生成 | TypeScript NestJS 生成 |
|---|---|---|
| `dbAccess` (SELECT) | `repository.findBy...()` または `@Query native` | `repository.findOne()` または `dataSource.query()` |
| `dbAccess` (INSERT) | `repository.save(entity)` | `manager.save(entity)` |
| `dbAccess` (UPDATE) | `@Modifying @Query` | `manager.update()` |
| `dbAccess` (DELETE) | `@Modifying @Query` | `manager.delete()` |
| `dbAccess` (拡張 op) | `// TODO: {{step.operation}} — 拡張操作。extensions/ 定義参照` | 同左 |
| `transactionScope` | `@Transactional` メソッド + isolation / timeout / rollbackOn を適用 | `dataSource.transaction('READ COMMITTED', async manager => { ... })` |
| `step.txBoundary` (`role`∈{begin, member, end}) | `txId` が同一の **全ステップ (begin / member / end の 3 役割)** を 1 メソッドに切り出して `@Transactional` 化 (`@Transactional` は private/同クラス self-call では AOP proxy を bypass するため別 `@Service` Bean か `TransactionTemplate` 利用に注意) | `prisma.$transaction(async (tx) => { ... })` または `dataSource.transaction(async manager => { ... })` で **同 txId の全ステップ (begin / member / end) を全部包む**。識別ロジック: `txBoundary.txId=X` かつ `role ∈ {begin, member, end}` の全ステップを 1 TX で wrap。詳細は `templates/backend/typescript-nestjs/SERVICE.md` の「txBoundary mapping」セクション参照 (#875) |
| `compute` | ローカル変数計算 (stream / reduce / mapToLong 等) | ローカル変数計算 (reduce / map 等) |
| `branch` | `if (...) { ... } else { ... }` + 例外 throw | 同左 + `throw new HttpException(...)` |
| `loop` (collection) | `for (Type item : collection) { ... }` | `for (const item of collection) { ... }` |
| `eventPublish` | `eventPublisher.publishEvent(new XxxEvent(...))` | `eventEmitter.emit('topic', payload)` |
| `screenTransition` | `return "redirect:/path"` (MVC) / API では出力しない | `res.redirect('/path')` |
| `return` | `return ResponseEntity.<T>status(N).body(body)` | `throw new HttpException(body, status)` または `return response` |
| `validation` | Bean Validation DTO + `@Valid` Controller 引数 | `class-validator` DTO デコレータ |
| `log` | `log.error(message, structuredData)` | `this.logger.error(message, structuredData)` |
| `aiCall` (#935 / Phase 2-C) | `aiRuntime.invoke(new AiInvocationRequest(modelRef, messages, responseFormat?, tools?, ...))` (詳細は `templates/backend/java-spring-boot/AI_SERVICE.md`)。Spring AI starter で provider 切替、業務 Service は provider 中立 | `await this.aiRuntime.invoke({ modelRef, messages, responseFormat?, tools?, ... })` (詳細は `templates/backend/typescript-nestjs/AI_SERVICE.md`)。`AiRuntimeService` 内部で `@anthropic-ai/sdk` / `openai` / `@aws-sdk/client-bedrock-runtime` 等を dispatch、業務 Service は provider 中立 |
| `aiAgent` (#935 / Phase 2-C) | aiCall と同形 + `AiInvocationRequest.AgentSpec(maxIterations, toolRunner)` を渡す。tool 実行ループは `AiRuntimeService` 内部で完結 (業務 Service は toolRunner だけ書く) | 同左、`agent: { maxIterations, toolRunner: async (call) => ... }` を渡す |
| `other` | `// TODO: {{step.description}}` + outputSchema で型推定 (注: schema の `kind` に `other` は存在しない。extension step では `type: "other"` を使う別階層の概念であるため混同注意) | 同左 |

### affectedRowsCheck → 実装パターン

```java
// Java: affectedRowsCheck.operator="=" / expected=1
int updated = inventoryRepository.decrementStock(productId, storeId, quantity);
if (updated != 1) {
    throw new StockShortageException("在庫が不足しています。");
}
```

```typescript
// NestJS: 同等パターン
const updated: number = await manager.query(sql, [productId, storeId, quantity]);
if (updated[1] !== 1) {
  throw new HttpException({ code: 'STOCK_SHORTAGE', message: '在庫が不足しています。' }, 422);
}
```

### ambientVariables → フレームワーク引数

| ProcessFlow `ambientVariables[].name` | Java | NestJS |
|---|---|---|
| `sessionCustomerId` | `HttpSession.getAttribute("customerId")` | `(req.session as any).customerId` |
| `requestId` | `HttpServletRequest.getHeader("X-Request-ID")` | `req.headers['x-request-id']` |

### httpRoute → Controller マッピング

- `httpRoute.method: "POST"` → `@PostMapping` / `@Post()`
- `httpRoute.path: "/api/retail/orders"` → `@RequestMapping("/api/retail")` + `@PostMapping("/orders")`
- `httpRoute.auth: "required"` → Spring Security または `@UseGuards(SessionGuard)` のコメント付与

### inputs[] → DTO マッピング

```
ProcessFlow inputs[]:
  name: "shippingPostalCode" (type=string, required=true)
  → Java: @NotBlank @Pattern(regexp="\\d{7}") String shippingPostalCode;
  → TS: @IsNotEmpty() @Matches(/^\d{7}$/) shippingPostalCode: string;

  name: "paymentMethod" (type=string, required=true, enum: credit_card/bank_transfer/cod)
  → Java: @NotBlank @Pattern(regexp="^(credit_card|bank_transfer|cod)$") String paymentMethod;
  → TS: @IsIn(['credit_card', 'bank_transfer', 'cod']) paymentMethod: string;
```

### 生成ファイル一覧 (Java Spring Boot)

```
<出力先>/
  <ProcessFlowName>Service.java         (actions → @Service)
  <ProcessFlowName>Controller.java      (httpRoute → @RestController / @Controller)
  <TableName>.java                      (lineage.writes テーブル → @Entity、各テーブル 1 ファイル)
  <TableName>Repository.java            (各テーブル → @Repository、各テーブル 1 ファイル)
  V1__create_<tableName>.sql            (lineage.writes テーブル → Flyway DDL)
  dto/<ActionName>Request.java          (inputs[] → DTO)
  dto/<ActionName>Response.java         (outputs[] → DTO)

  # AI flow 含有時のみ (Phase 2-C、最初の AI flow 検出時に 1 セット生成):
  src/main/java/com/example/<projectName>/ai/AiRuntimeService.java
  src/main/java/com/example/<projectName>/ai/AiInvocationRequest.java
  src/main/java/com/example/<projectName>/ai/AiInvocationResult.java
  src/main/java/com/example/<projectName>/ai/AiMessage.java / AiContentBlock.java / ... (型群)
  src/main/java/com/example/<projectName>/ai/AiCatalogProvider.java / AiCatalogService.java
  src/main/java/com/example/<projectName>/ai/provider/<Provider>AiProvider.java   (利用 provider のみ)
```

### 生成ファイル一覧 (TypeScript NestJS)

```
<出力先>/
  <processFlowName>.service.ts           (actions → @Injectable Service)
  <processFlowName>.controller.ts        (httpRoute → @Controller)
  <processFlowName>.module.ts            (Module definition)
  dto/<actionName>-request.dto.ts        (inputs[] → DTO)
  dto/<actionName>-response.dto.ts       (outputs[] → DTO)
  entity/<tableName>.entity.ts           (lineage.writes → TypeORM Entity)

  # AI flow 含有時のみ (Phase 2-C、最初の AI flow 検出時に 1 セット生成):
  src/ai/ai-runtime.service.ts
  src/ai/ai.module.ts
  src/ai/ai-catalog.service.ts
  src/ai/types.ts                        (任意分割)
  src/ai/providers/<provider>.ts         (利用 provider のみ)
```

### AI step kind 検出時の追加処理 (Phase 2-C)

ProcessFlow の `actions[].steps[]` (および `inlineBranch.{ok,ng}` / `branches[].steps` / `elseBranch.steps`
を再帰探索) に `kind ∈ {aiCall, aiAgent}` の step が **1 件以上** 含まれる場合、業務 Service だけでは
不十分で、以下を追加生成する:

#### 1. AI runtime layer (1 プロジェクトに 1 セット、最初の AI flow 検出時のみ生成)

| 出力先 (NestJS) | 出力先 (Java Spring Boot) | 内容 |
|---|---|---|
| `<出力先>/src/ai/ai-runtime.service.ts` | `<出力先>/src/main/java/com/example/<projectName>/ai/AiRuntimeService.java` | provider 中立 service (固定契約) |
| `<出力先>/src/ai/ai.module.ts` | (Java は不要、`@Service` で自動 scan) | NestJS Module 定義 |
| `<出力先>/src/ai/types.ts` (任意分割) | `<出力先>/src/main/java/com/example/<projectName>/ai/Ai*.java` (record 群) | 型定義 |
| `<出力先>/src/ai/ai-catalog.service.ts` | `<出力先>/src/main/java/com/example/<projectName>/ai/AiCatalogService.java` | `harmony.json` + ProcessFlow から catalog merge |
| `<出力先>/src/ai/providers/<provider>.ts` | `<出力先>/src/main/java/com/example/<projectName>/ai/provider/<Provider>AiProvider.java` | 利用 provider のみ |

詳細仕様: `templates/backend/typescript-nestjs/AI_SERVICE.md` / `templates/backend/java-spring-boot/AI_SERVICE.md`

#### 2. catalog 解決 (生成時)

ProcessFlow.context.catalogs.modelEndpoints と project level catalog (`<workspace>/harmony/catalogs/external.json`)
を merge し、各 `step.modelRef` に対して `provider` を抽出する。

```
利用 provider 一覧 (生成時に決定):
  flow A の step.modelRef="tagSuggestModel" → provider="anthropic"
  flow B の step.modelRef="dialogModel"     → provider="openai"
  → AiRuntimeService に AnthropicAiProvider + OpenAiAiProvider の 2 種を生成、他は省略
```

利用しない provider の `*Provider.java` / `providers/<key>.ts` は **生成しない** (依存ライブラリも追加しない)。

#### 3. 業務 Service の constructor 拡張

AI flow を持つ業務 Service だけが `AiRuntimeService` を inject:

- NestJS: `private readonly aiRuntime: AiRuntimeService,` を constructor に追加 + `imports: [AiModule]` をモジュールに追加
- Java: `@RequiredArgsConstructor` の field に `private final AiRuntimeService aiRuntime;` を追加

#### 4. 依存追加 (package.json / build.gradle)

利用 provider に応じて以下を追加 (生成時に判定):

Spring AI artifact ID は **1.0.0 GA (2025-05) で命名規則変更** あり (`spring-ai-<provider>-spring-boot-starter` →
`spring-ai-starter-model-<provider>`)。本表は GA 以降の新 naming を採用:

| provider | NestJS 依存 | Java Spring Boot 依存 |
|---|---|---|
| `anthropic` | `@anthropic-ai/sdk` | `org.springframework.ai:spring-ai-starter-model-anthropic` |
| `openai` | `openai` | `org.springframework.ai:spring-ai-starter-model-openai` |
| `google` | `@google/generative-ai` | `org.springframework.ai:spring-ai-starter-model-vertexai-gemini` |
| `aws-bedrock` | `@aws-sdk/client-bedrock-runtime` | `org.springframework.ai:spring-ai-starter-model-bedrock-converse` |
| `azure-openai` | `openai` (Azure config) + (azureAd 時) `@azure/identity` | `org.springframework.ai:spring-ai-starter-model-azure-openai` |
| `ollama` | (fetch のみ、追加不要) | `org.springframework.ai:spring-ai-starter-model-ollama` |
| `namespace:custom` | (extension hook) | (extension hook) |

加えて、生成 backend に `aiCall` / `aiAgent` で `responseFormat=structuredObject` を 1 つでも含む場合は
**JSON Schema validator が必須** (AI-3 の runtime 検証経路で使用):

- NestJS: `ajv` (`AiRuntimeService.normalizeAndValidate` で `ajv.compile(schema)` キャッシュ)
- Java Spring Boot: `com.networknt:json-schema-validator` (`JsonSchemaFactory` でコンパイルキャッシュ)

#### 5. 環境変数注記

生成 README (もしくは `.env.example`) に以下を記載:

```
# AI provider credentials (catalog で auth.kind=bearer/apiKey の provider 利用時)
ANTHROPIC_API_KEY=sk-ant-xxx     # provider="anthropic" 利用時
OPENAI_API_KEY=sk-xxx            # provider="openai" / "azure-openai" 利用時
GOOGLE_API_KEY=xxx               # provider="google" 利用時
AWS_REGION=us-east-1             # provider="aws-bedrock" 利用時 (IAM role は別途設定)
# AZURE_AD_*                     # provider="azure-openai" + auth.kind="azureAd" 利用時
```

env var 名は **catalog の `secrets[<key>].name`** で確定する (生成時に解決して README に書き込む)。

### ゴールデン出力参照

生成コードの品質は以下のゴールデン出力を参照すること:

- `.claude/skills/generate-code/golden-examples/order-confirm-spring-boot/`
  - `OrderConfirmService.java` — 全 step kind をカバーするゴールデン
  - `OrderConfirmController.java` — REST Controller ゴールデン
  - `Order.java` — Entity ゴールデン
  - `OrderRepository.java` — Repository ゴールデン
  - `V1__create_orders.sql` — Flyway DDL ゴールデン

`aiCall` / `aiAgent` を含む sample は本 PR (Phase 2-C) では **golden 化を見送り**、
仕様は `AI_SERVICE.md` の inline 例で示す。後続でユーザーが特定 sample (例: `examples/diary` の
4 AI flow) を golden 化することを推奨。

### Spring Boot 設定ファイル — 日本語値の取り扱い (重要)

Spring Boot の `PropertiesPropertySourceLoader` は `application.properties` を **ISO-8859-1** デフォルトで読み込む (Java Properties spec)。日本語値を直接書くと文字化けする (例: `app.session.storeName=東京本店` が `æ±äº¬æ¬åº` に化ける。PR #1034 dogfood の Phase D で発覚)。

以下のいずれかで対応する:

1. **推奨**: 日本語値は Java source の `@Value` default で hardcode する。`@Value("${app.title:商品検索}")` のように **default 値を UTF-8 ソース内**に置き、`application.properties` 側には key を書かないか、ASCII 値のみ置く
2. **代替**: `application.properties` の代わりに `application.yml` を採用する。YAML は UTF-8 を default で読み込む (`spring.config.import` で別ファイルから読み込む場合も `.yml` 推奨)
3. **必須**: いずれを採用しても以下 3 行は必須 — 無いと response body も化ける:
   ```properties
   server.servlet.encoding.charset=UTF-8
   server.servlet.encoding.force=true
   spring.thymeleaf.encoding=UTF-8
   ```

`messages.properties` (i18n) も同じ制約。日本語 message 値は `messages_ja.properties` を UTF-8 で保存し、`spring.messages.encoding=UTF-8` を設定する (Spring Boot 2.2+ で default UTF-8 だが、明示推奨)。

## Step 3-B: Screen → frontend code 生成

Screen JSON を入力として、techStack に基づく frontend code 雛形を生成する。

### テンプレート選択

| techStack.frontend | techStack.designer.editorKind | 参照テンプレート |
|---|---|---|
| thymeleaf | grapesjs | `.claude/skills/generate-code/templates/frontend/thymeleaf-bootstrap/PAGE.md` |
| react + next | puck | `.claude/skills/generate-code/templates/frontend/react-tailwind-next/PAGE.md` |
| その他 | — | 「未対応の techStack 組合せです。」と報告して中止 |

**Puck 画面での Thymeleaf 出力スキップ**: editorKind が解決後 "puck" で `frontend.library=thymeleaf` の場合は制約違反 (Step 2 で検出)。

### screen.kind ごとのテンプレート分岐 (§9 — Screen → frontend mapping)

| screen.kind | Thymeleaf パターン | React/Next パターン |
|---|---|---|
| `search` | 検索フォーム + `<table th:each>` | `<form>` Client Component + Server Component テーブル |
| `list` | `<table th:each>` 一覧 | Server Component テーブル |
| `form` | `<form method="post">` + `<input>` | `<form action={serverAction}>` |
| `confirm` | フォーム内容確認表示 + submit | confirm ページ + Server Action |
| `complete` | 完了メッセージ + 遷移リンク | 完了ページ + `<Link>` |
| `dashboard` | ダッシュボード (固定セクション) | ダッシュボードページ |
| `retail:cart` 等の業界拡張 kind | extensions/ 配下の定義を参照してフォールバック (なければ `list` 扱い) | 同左 |

### items[] → UI 要素マッピング

| item.direction | item.type | Thymeleaf 生成 | React 生成 |
|---|---|---|---|
| `input` | `string` | `<input type="text" th:value="${param.X}">` | `<input type="text" value={X} onChange={...}>` |
| `input` | `string` + options[] | `<select><option th:each>` | `<select><option>` |
| `input` | `datetime` | `<input type="datetime-local">` | `<input type="datetime-local">` |
| `output` | any | `<span th:text="${X}">` | `<span>{X}</span>` |
| `viewer` | array + viewDefinitionId | `<table th:each="row : ${rows}">` | データテーブルコンポーネント |

### items[].required → バリデーション

- Thymeleaf: HTML `required` 属性 + `class="is-invalid"` + `<div class="invalid-feedback">` パターン
- React: `required` 属性 + useState + onSubmit バリデーション + エラーメッセージ表示

### items[].events[] → ボタン / フォームアクション

```
items[].events[].id = "submit" AND items[].events[].handlerFlowId = "<flowId>"
  + items[].events[].handlerActionId = "<actionId>" (#1019、複数 action フローでは必須)
→ flow.actions[handlerActionId] の httpRoute (method + path) を生成対象に取る
   handlerActionId 省略時は actions[0] (単一 action フロー前提)
→ Thymeleaf: <form th:action="@{/api/xxx}" method="post"> <button type="submit">
→ React: <form action={serverAction}> または onClick で API fetch
```

### Screen → Controller (Thymeleaf / MVC)

Screen JSON から対応する Spring MVC Controller も合わせて生成する:

```java
// Screen path="/products/search" → ProductSearchController (@Controller, not @RestController)
@Controller
@RequestMapping("/products/search")
public class ProductSearchController {
    @GetMapping
    public String show(@RequestParam(...) params, Model model, ...) {
        // 在庫照会フロー (efa7ac6e) 呼び出し
        model.addAttribute("inventoryRows", inventoryService.search(productCode, storeCode));
        model.addAttribute("inquiredAt", LocalDateTime.now());
        return "products/search";  // → templates/products/search.html
    }
}
```

### 生成ファイル一覧 (Thymeleaf)

```
<出力先>/
  <screenName | toKebabCase>.html          (Thymeleaf テンプレート)
  <ScreenName>Controller.java              (Spring MVC Controller)
```

### 生成ファイル一覧 (React + Next.js)

```
<出力先>/
  app/<path>/page.tsx                      (Next.js App Router ページ)
  components/<domain>/<ScreenName>.tsx     (サブコンポーネント)
```

### Next.js バージョン指針 (security 自動追従)

生成 `package.json` の `dependencies` は **caret prefix (`^`) を必須** とする。固定 version で hardcode すると security patch が自動追従されず `npm audit` で警告が残り続ける (PR #1034 の Phase D dogfood で発覚)。

| dependency | 推奨レンジ | 備考 |
|---|---|---|
| `next` | `^14.2.x` (LTS 系最新 patch) | Next.js 14.x は LTS。 14 系列の最新 patch を caret prefix で記載 (例: `^14.2.35`) |
| `react` / `react-dom` | `^18.3.x` | React 18 stable 系最新 (React 19 は Next.js 15 移行時に検討) |
| `typescript` | `^5.x` | TypeScript 5 系最新 patch |
| `tailwindcss` | `^3.4.x` | Tailwind 3 系最新 patch |

**注**: Next.js 14 LTS の patch を最新まで上げても、`npm audit` で moderate / high severity の警告が複数残存する (e.g. `<15.0.8` / `<15.5.10` range の advisories)。完全解消には **Next.js 15.x への migration** が必要だが App Router の async APIs (cookies/headers/params/searchParams が Promise 化) 等の breaking change を伴うため、本 skill では 14 LTS 系最新 patch までを default 推奨とし、15 系 migration は future enhancement とする。

### Layout Decorate モード (pageLayoutId あり)

Step 2.4 で PageLayout を解決した場合、生成 HTML/TSX を以下のように PageLayout でラップする。

#### Thymeleaf 系 (layout decorate モード)

```html
<!-- templates/<path>/<screenName>.html (Layout Dialect 形式) -->
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org"
      xmlns:layout="http://www.ultraq.net.nz/thymeleaf/layout"
      layout:decorate="~{layouts/<pageLayoutId>}"
      lang="ja">
<head>
  <title th:text="${screen.name}">ページタイトル</title>
</head>
<body>
  <th:block layout:fragment="layout-content">
    <!-- Screen 本文 (通常の Page 生成内容) -->
    <h1 th:text="${screen.name}">ページタイトル</h1>
    <!-- ... items[] → form/table/section ... -->
  </th:block>
</body>
</html>
```

`layouts/<pageLayoutId>.html` は Step 3-D で生成するテンプレート。
詳細テンプレートは `.claude/skills/generate-code/templates/frontend/thymeleaf-bootstrap/LAYOUT.md` を参照。

#### NestJS/Next.js 系 (layout wrap モード)

```tsx
// app/<path>/page.tsx (Layout Wrap モード)
import MainLayout from '@/app/components/layouts/<pageLayoutId>';

export default function Page() {
  return (
    <MainLayout>
      {/* Screen 本文 (通常の Page 生成内容) */}
      <h1>ページタイトル</h1>
      {/* ... items[] → input/output components ... */}
    </MainLayout>
  );
}
```

`MainLayout` (= AppLayout) は Step 3-D で生成する Server Component で **default export**。
import path は `@/app/components/layouts/<pageLayoutId>` (default import)。
詳細テンプレートは `.claude/skills/generate-code/templates/frontend/react-tailwind-next/LAYOUT.md` を参照。

### ゴールデン出力参照

- `.claude/skills/generate-code/golden-examples/product-search-thymeleaf/product-search.html`
  - Screen `e6147dc0-94b7-436d-ba87-d0080ac34f44` (商品検索, kind=search) のゴールデン

## Step 3-C: Gadget 生成パス (Screen.purpose=gadget)

Step 1.5 で `purpose === "gadget"` にルーティングされた場合、以下の手順で Gadget コードを生成する。

詳細テンプレートは以下を参照:
- Thymeleaf 系: `.claude/skills/generate-code/templates/frontend/thymeleaf-bootstrap/FRAGMENT.md`
- NestJS/Next.js 系: `.claude/skills/generate-code/templates/frontend/react-tailwind-next/COMPONENT.md`

### Thymeleaf 系 Gadget 生成

#### 生成ファイル

```
<出力先>/
  src/main/resources/templates/fragments/<gadget-id>.html    (Thymeleaf fragment)
  src/main/java/com/example/<projectName>/controller/
    <GadgetName>GadgetController.java                        (Spring MVC Controller)
```

#### Fragment HTML テンプレート

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org">
<body>
  <!--
    Gadget fragment: <gadget-id>
    ProcessFlow: <processFlowId> (連携あり時)
  -->
  <th:block th:fragment="gadget">
    <!-- Gadget items[] の HTML (Screen 生成と同様の items[] → form/span マッピング) -->
    <!-- processFlowId があれば、act-* action に対応するフォームを生成 -->
    <form th:if="${gadget.hasForm}"
          th:action="@{<httpRoute.path>}" method="post">
      <input type="hidden" th:name="${_csrf.parameterName}" th:value="${_csrf.token}"/>
      <!-- items[direction=input] → input要素 -->
      <!-- items[direction=output] → span/p 要素 -->
      <button type="submit"><th:text="${submitLabel}">送信</th:text></button>
    </form>
  </th:block>
</body>
</html>
```

#### Controller テンプレート

ProcessFlow の `processFlowId` が Gadget に紐付いている場合、各 action の httpRoute を `@PostMapping` / `@GetMapping` として生成する。

```java
@Controller
@RequestMapping("<gadgetBasePath>")
public class <GadgetName>GadgetController {

    private final <GadgetFlowName>Service gadgetService;

    public <GadgetName>GadgetController(<GadgetFlowName>Service gadgetService) {
        this.gadgetService = gadgetService;
    }

    // act-<actionId> (例: act-logout) → @PostMapping
    @PostMapping("<action.httpRoute.path>")
    public String <actionId>(@Valid @ModelAttribute <ActionName>Request req,
                              BindingResult result,
                              RedirectAttributes attrs,
                              HttpSession session) {
        gadgetService.<actionId>(req, session);
        return "redirect:<redirectTo>";
    }
}
```

ProcessFlow が存在しない場合 (design-only Gadget): Controller は生成しない。

### NestJS/Next.js 系 Gadget 生成

#### 生成ファイル

```
<出力先>/
  app/components/gadgets/<gadget-id>.tsx              (component、flat file、default export)
  app/api/gadgets/<gadget-id>/<actionId>/route.ts     (Route Handler、各 action ごと 1 ファイル、processFlowId 連携あり時のみ)
```

events ありの Gadget は `'use client'` directive 付き (client-side fetch + redirect)。
events なしの Gadget は **Server Component** で default export (purpose=output のみのナビ/フッタ等)。

#### Gadget Component テンプレート (events なし、Server Component)

```tsx
// Gadget: <gadget-id> (<gadget.name>)
// purpose=gadget, events なし → Server Component (default export)
//
// Generated by Harmony /generate-code (RFC #1021 pl-7).

type Props = {
  // items[direction=output] の prop 型 (例: copyright?: string)
};

export default function <GadgetName>Gadget(props: Props) {
  return (
    <nav className="...">{/* items[] を Tailwind class で展開 */}</nav>
  );
}
```

#### Gadget Component テンプレート (events あり、Client Component)

```tsx
'use client';

// Gadget: <gadget-id> (<gadget.name>)
// ProcessFlow: <processFlowId> ; events[].handlerActionId が連携 action ID
//
// Generated by Harmony /generate-code (RFC #1021 pl-7).

type Props = {
  // items[direction=output] の prop 型
};

export default function <GadgetName>Gadget(props: Props) {
  async function handle<EventId>() {
    const res = await fetch('/api/gadgets/<gadget-id>/<actionId>', { method: 'POST' });
    if (res.redirected) window.location.href = res.url;
  }

  return (
    <div className="...">
      {/* items[direction=input + events[].id=click] → <button onClick={handle...}>...</button> */}
    </div>
  );
}
```

#### Route Handler テンプレート (processFlowId 連携あり時、action ごと 1 ファイル)

```typescript
// app/api/gadgets/<gadget-id>/<actionId>/route.ts
// ProcessFlow: <processFlowId> action: <actionId> httpRoute: <method> <path>
//
// Generated by Harmony /generate-code (RFC #1021 pl-7).

import { NextRequest, NextResponse } from "next/server";

export async function <METHOD>(request: NextRequest) {
  // TODO: ProcessFlow Service の対応 method を invoke
  return NextResponse.redirect(new URL("<redirectTo>", request.url));
}
```

### cssFramework に応じた Gadget スタイル分岐

```
gadget.design.cssFramework (または project.techStack.designer.cssFramework):
  "bootstrap" → HTML クラス: "btn btn-primary", "form-control", "navbar navbar-expand" 等
  "tailwind"  → Tailwind クラス: "bg-blue-900 text-white", "flex items-center" 等
  未設定      → class 属性を空にし、コメントで「CSS クラスを補完してください」と記載
```

## Step 3-D: PageLayout 生成パス (PageLayout entity)

Step 1-4 で PageLayout entity にルーティングされた場合、以下の手順で Layout コードを生成する。

詳細テンプレートは以下を参照:
- Thymeleaf 系: `.claude/skills/generate-code/templates/frontend/thymeleaf-bootstrap/LAYOUT.md`
- NestJS/Next.js 系: `.claude/skills/generate-code/templates/frontend/react-tailwind-next/LAYOUT.md`

### PageLayout JSON から読み取る情報

```
PageLayout JSON:
  id, name
  regions[]: { id, name, order }         — header / sidebar / main / footer 等
  assignments: { [regionId]: gadgetScreenId }  — region → Gadget 対応
  design.editorKind, design.cssFramework
```

### Thymeleaf 系 PageLayout 生成

#### 生成ファイル

```
<出力先>/
  src/main/resources/templates/layouts/<pageLayoutId>.html    (Thymeleaf passive layout)
```

#### Layout HTML テンプレート (Bootstrap)

region 規約 (Bootstrap):
- `header` region → `<nav class="navbar navbar-expand-lg navbar-dark bg-dark">`
- `sidebar` region → `<aside class="col-md-3 col-lg-2 bg-light">`
- `main` region → `<main class="col">` (Page の `body-content` fragment を inject)
- `footer` region → `<footer class="text-center bg-light py-3">`

**任意追加 region の動的展開規約** (header/sidebar/main/footer 以外、page-layout.v3.schema.json の region 命名 `^[a-z][a-zA-Z0-9_-]*$` を許容):

| 任意 region 名 | Bootstrap タグ + class | 配置位置 (推奨) |
|---|---|---|
| `breadcrumb` | `<nav class="breadcrumb-nav mb-2" aria-label="breadcrumb">` | header の直下 (main の上) |
| `notification` / `toast` | `<div class="position-fixed top-0 end-0 p-3" style="z-index: 1080">` | body 直下 (絶対配置で全画面に被せる) |
| `subHeader` / `secondaryNav` | `<nav class="navbar bg-light">` | header の直下 (main の上) |
| `toolbar` / `actionBar` | `<div class="bg-white border-bottom p-2 d-flex gap-2">` | main の直上 |
| `aside` / `rightPanel` | `<aside class="col-md-3 bg-light">` | main の右 (sidebar が左の場合) |
| **未知 region** (フォールバック) | `<div role="region" aria-label="<regionName>" class="region-<regionName>">` | header と main の間に挿入。コメントで「TODO: <regionName> の class を必要に応じて調整してください」と注記 |

**展開順序**: `PageLayout.regions[].order` 昇順で出力する。既知 region (header/sidebar/main/footer) は固定スロット、任意 region は order の指示する位置 (header < x < main < footer の範囲) に挿入。順序が曖昧な場合は header 直下にフォールバック配置。

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org">
<head>
  <meta charset="UTF-8"/>
  <title th:text="${pageTitle}">ページタイトル</title>
  <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"/>
</head>
<body>
  <!-- PageLayout: <pageLayoutId> (<pageLayout.name>) -->
  <!-- regions: <region-ids.join(', ')> -->

  <!-- region: header (assignment → gadget fragment) -->
  <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
    <div th:replace="~{fragments/<headerGadgetId> :: gadget}"></div>
  </nav>

  <div class="container-fluid">
    <div class="row">
      <!-- region: sidebar (assignment → gadget fragment) -->
      <aside class="col-md-3 col-lg-2 bg-light">
        <div th:replace="~{fragments/<sidebarGadgetId> :: gadget}"></div>
      </aside>

      <!-- region: main (Layout Dialect の layout:fragment slot) -->
      <main class="col" layout:fragment="layout-content">
        <!-- page 側 <th:block layout:fragment="layout-content"> の content が自動 inject される -->
      </main>
    </div>
  </div>

  <!-- region: footer (assignment → gadget fragment) -->
  <footer class="text-center bg-light py-3">
    <div th:replace="~{fragments/<footerGadgetId> :: gadget}"></div>
  </footer>
</body>
</html>
```

assignment で未割り当ての region は空の `<div>` プレースホルダで生成する。

### NestJS/Next.js 系 PageLayout 生成

#### 生成ファイル

```
<出力先>/
  app/layouts/<pageLayoutId>/
    index.tsx                    (AppLayout component)
```

#### AppLayout Component テンプレート (Tailwind)

region 規約 (Tailwind):
- `header` region → `<header className="flex items-center justify-between bg-blue-900 text-white px-6 py-3">`
- `sidebar` region → `<aside className="w-64 bg-gray-100 min-h-screen p-4">`
- `main` region → `<main className="flex-1 p-6">` (children を配置)
- `footer` region → `<footer className="text-center bg-gray-50 py-4 border-t">`

**任意追加 region の動的展開規約** (header/sidebar/main/footer 以外、page-layout.v3.schema.json の region 命名 `^[a-z][a-zA-Z0-9_-]*$` を許容):

| 任意 region 名 | Tailwind タグ + className | 配置位置 (推奨) |
|---|---|---|
| `breadcrumb` | `<nav className="text-sm text-gray-600 px-4 py-2" aria-label="breadcrumb">` | header の直下 (main の上) |
| `notification` / `toast` | `<div className="fixed top-4 right-4 z-50 space-y-2">` | flex container 外 (絶対配置で全画面に被せる) |
| `subHeader` / `secondaryNav` | `<nav className="bg-gray-50 border-b px-4 py-2">` | header の直下 (main の上) |
| `toolbar` / `actionBar` | `<div className="bg-white border-b px-4 py-2 flex gap-2">` | main の直上 |
| `aside` / `rightPanel` | `<aside className="w-64 bg-gray-50 p-4">` | main の右 (sidebar が左の場合) |
| **未知 region** (フォールバック) | `<div role="region" aria-label="<regionName>" className="region-<regionName>">` | header と main の間に挿入。コメントで「TODO: <regionName> の className を必要に応じて調整してください」と注記 |

**展開順序**: `PageLayout.regions[].order` 昇順で出力する。既知 region (header/sidebar/main/footer) は固定スロット、任意 region は order の指示する位置 (header < x < main < footer の範囲) に挿入。順序が曖昧な場合は header 直下にフォールバック配置。

```tsx
// PageLayout: <pageLayoutId> (<pageLayout.name>)
// regions: <region-ids.join(', ')>
// Generated by Harmony /generate-code (RFC #1021 pl-7).
//
// assignments の各 region は default import + flat path で Gadget を解決:
//   <pageLayoutId> = `1759...`, assignments[header] = `6870...` の場合:
//   import HeaderGadget from '@/app/components/gadgets/6870...';
// assignments に主要 region (header/sidebar/footer) 以外の任意 region が含まれる場合も
// 同パターン (1 行ずつ import + 該当タグ slot 内で mount) で展開する。
import HeaderGadget from '@/app/components/gadgets/<headerGadgetId>';
import SidebarGadget from '@/app/components/gadgets/<sidebarGadgetId>';
import FooterGadget from '@/app/components/gadgets/<footerGadgetId>';

export default function <PageLayoutName>Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* region: header (assignments["header"] が指定なら mount、未指定ならコメントアウト) */}
      <header className="flex items-center justify-between bg-blue-900 text-white px-6 py-3">
        <HeaderGadget />
      </header>

      <div className="flex flex-1">
        {/* region: sidebar */}
        <aside className="w-64 bg-gray-100 min-h-screen p-4">
          <SidebarGadget />
        </aside>

        {/* region: main (Page children slot — assignments に関わらず常に出力) */}
        <main className="flex-1 p-6">
          {children}
        </main>

        {/* 任意追加 region (例: notification) もここに <aside> 等で挿入可能 */}
      </div>

      {/* region: footer */}
      <footer className="text-center bg-gray-50 py-4 border-t">
        <FooterGadget />
      </footer>
    </div>
  );
}
```

assignment で未割り当ての region は `{/* region: <name> — 未割り当て */}` コメントで示す。

### Step 4 への移行

Step 3-C / 3-D で生成したファイルは Step 5 で出力先に書き出し、Step 6 で smoke 検証を行う。
Gadget の smoke 検証は Page と同じ手順 (Thymeleaf: well-formed チェック / TypeScript: tsc)。

## Step 4: テンプレート詳細参照

各テンプレートファイルを Read で参照してコード生成品質を確認する。

```
.claude/skills/generate-code/templates/
  backend/java-spring-boot/
    SERVICE.md    — Service クラス生成ルール
    REPOSITORY.md — Repository インターフェース生成ルール
    CONTROLLER.md — Controller クラス生成ルール
    ENTITY.md     — JPA Entity クラス生成ルール
    MIGRATION.md  — Flyway SQL DDL 生成ルール
    AI_SERVICE.md — AI runtime service 生成ルール (Phase 2-C、aiCall/aiAgent 含有時)
  backend/typescript-nestjs/
    SERVICE.md    — Service クラス生成ルール
    CONTROLLER.md — Controller + DTO 生成ルール
    ENTITY.md     — TypeORM Entity + Module 生成ルール
    AI_SERVICE.md — AI runtime service 生成ルール (Phase 2-C、aiCall/aiAgent 含有時)
  frontend/thymeleaf-bootstrap/
    PAGE.md       — Thymeleaf HTML テンプレート生成ルール (kind 別パターン + Layout Decorate モード)
    LAYOUT.md     — PageLayout passive layout 生成ルール (Step 3-D 用)
    FRAGMENT.md   — Gadget fragment + GadgetController 生成ルール (Step 3-C 用)
  frontend/react-tailwind-next/
    PAGE.md       — Next.js App Router ページ生成ルール (kind 別パターン + Layout Wrap モード)
    LAYOUT.md     — Custom AppLayout component 生成ルール (Step 3-D 用、default export、Server Component)
    COMPONENT.md  — Gadget client component + Route Handler 生成ルール (Step 3-C 用)
```

## Step 5: コード生成 + 出力先への書き出し

各生成ファイルを Write ツールで `<出力先>/` に書き出す。

### 命名規則

| ProcessFlow / Screen 値 | ファイル名 |
|---|---|
| `meta.name: "注文確定"` | `OrderConfirmService.java` / `order-confirm.service.ts` |
| `tables[].physicalName: "orders"` | `Order.java` / `orders.entity.ts` / `V1__create_orders.sql` |
| `screen.path: "/products/search"` | `templates/products/search.html` / `app/products/search/page.tsx` |

### 出力ディレクトリ規約 (§10)

```
backend (Java Spring Boot):
  <出力先>/src/main/java/com/example/<projectName>/
    service/     — Service クラス
    controller/  — Controller クラス
    entity/      — JPA Entity クラス
    repository/  — Repository インターフェース
    dto/         — Request / Response DTO
  <出力先>/src/main/resources/db/migration/
    V1__create_<tableName>.sql

frontend (Thymeleaf):
  <出力先>/src/main/resources/templates/<path>/
    <screenName | toKebabCase>.html
  # PageLayout (Step 3-D):
  <出力先>/src/main/resources/templates/layouts/
    <pageLayoutId>.html
  # Gadget (Step 3-C):
  <出力先>/src/main/resources/templates/fragments/
    <gadgetId>.html
  <出力先>/src/main/java/com/example/<projectName>/controller/
    <GadgetName>GadgetController.java  (processFlowId あり時のみ)

frontend (React + Next.js):
  <出力先>/app/<path>/
    page.tsx
  <出力先>/components/<domain>/
    <ComponentName>.tsx
  # PageLayout (Step 3-D):
  <出力先>/app/components/layouts/<pageLayoutId>.tsx     (default export Server Component)
  # Gadget (Step 3-C):
  <出力先>/app/components/gadgets/<gadgetId>.tsx         (default export、events ありで 'use client')
  # Route Handler (Step 3-C、processFlowId 連携あり時のみ、action ごと 1 ファイル):
  <出力先>/app/api/gadgets/<gadgetId>/<actionId>/route.ts
```

### bulk モード時のループ動作

Step 0 で `--all` / `--workspace <wsId>` が指定された場合、Step 1〜6 を各 entity に対して順次繰り返す。

**実行ポリシー**:

1. `project.json` (または `harmony.json`) の `entities.processFlows[]`, `entities.screens[]`, `entities.pageLayouts[]` から全 ID を抽出
2. **推奨順序**: PageLayout → Screen (purpose=gadget → page の順) → ProcessFlow
   - 理由: Screen が ProcessFlow を参照 (handlerFlowId)、Page が PageLayout を参照 (pageLayoutId) するため、参照される側から先に生成すると AI のコンテキスト整合がとりやすい
3. 各 ID で Step 1〜6 を実行、出力は entity 種別サブディレクトリへ振り分け
4. **順次実行**: 1 entity ごとに Step 1〜6 を完走してから次へ。並列実行はしない (出力ディレクトリ競合とログ混線を避ける、AI の対話駆動という性質上 1 シーケンスで進める方が品質安定)
5. **エラー継続**: 1 entity の生成に失敗してもループは継続。失敗 entity は ID + エラー要約を `<出力先>/bulk-report.md` に記録
6. **進捗報告**: 各 entity 種別の境界 (PageLayout 完了 / Screen 完了 / ProcessFlow 完了) で「N / M 完了、失敗 K 件」を AI 出力として明示。10 件超のループでは 10 件ごとにも中間報告

**完了レポート** (`<出力先>/bulk-report.md`):

```markdown
# /generate-code bulk report

**実行日時**: 2026-05-12 14:30:00 〜 2026-05-12 14:45:23 (15 分 23 秒)
**入力**: --workspace examples/retail
**出力先**: .tmp/generated-code/bulk-20260512-143000/
**合計**: 18 entity (PageLayout 1 / Screen 11 / ProcessFlow 6)
**成功**: 17 / 失敗: 1

## 失敗 entity

| 種別 | ID | name | エラー要約 |
|---|---|---|---|
| Screen | abc12345-... | 商品検索 | 必須フィールド `kind` 欠落 (Step 2 validation) |

## 成功 entity (種別別カウント)

- PageLayout: 1/1
- Screen: 10/11
- ProcessFlow: 6/6
```

**bulk モード時の smoke 検証 (Step 6)**: 各 entity の smoke は同様に実行するが、結果は bulk-report.md に集計のみ記載。個別 entity 単位の詳細レポートは生成しない。

## Step 6: smoke 検証 (§11)

生成ファイルの最低限の構文健全性を確認する。

### Java ファイル (techStack.backend.language="java")

以下の構文チェックポイントを目視で確認する (javac は実行しない):

1. `package` 宣言が先頭にある
2. `import` 文がクラス本体より前にある
3. `@Service` / `@RestController` / `@Repository` 等のアノテーションがある
4. クラス本体が `public class Xxx { ... }` で正しく囲まれている
5. メソッドシグネチャの型がすべて補完されている (未解決型がないか確認)
6. `@Transactional` のある Service メソッドに `throws` 宣言または try-catch がある

javac が利用可能な場合 (PATH に存在する場合):

```bash
find <出力先> -name "*.java" -exec javac -cp . {} \; 2>&1 | head -50
```

javac が利用不可の場合はスキップし、その旨を最終レポートに明記する。

### Thymeleaf HTML ファイル (techStack.frontend.library="thymeleaf")

以下の構文チェックポイントを確認する:

1. `<!DOCTYPE html>` が先頭にある
2. `xmlns:th="http://www.thymeleaf.org"` が `<html>` タグにある
3. すべての `th:` 属性が適切なタグ上にある (例: `th:each` は繰り返し要素に)
4. `<form>` タグに `th:action` または `action` がある
5. CSRF トークン (`th:name="${_csrf.parameterName}"`) が POST フォームに含まれている
6. HTML が well-formed (タグが適切に閉じている、入れ子が正しい)

XML パース確認 (PowerShell):

```powershell
[xml](Get-Content "<出力先>/<filename>.html" -Raw)
```

パース成功 = well-formed HTML5 確認。失敗した場合はエラー箇所を特定して修正する。

### TypeScript ファイル (techStack.backend.language="typescript")

tsc がアクセス可能な場合:

```bash
cd frontend && npx tsc --noEmit --allowJs --checkJs 2>&1 | head -30
```

tsc が利用不可またはプロジェクト設定が不整合の場合はスキップし、その旨を明記する。

### CI 自動化について

`/generate-code` スキルは AI 対話駆動のため、CI (Vitest / Playwright) の自動化対象外とする。
生成コードのビルド検証は開発者が担当し、本スキルの smoke check は構文レベルに留める。

## 最終レポート

```markdown
## /generate-code 完了: <processFlow.meta.name | screen.name>

### 入力
- 種別: ProcessFlow | Screen (purpose=page|gadget) | PageLayout
- ID: <uuid>
- techStack: <backend.language>/<backend.framework>/<database.type>/<frontend.library>
- PageLayout: <pageLayoutId> (Screen.purpose=page の場合のみ、解決できた場合)

### 生成ファイル
- `<出力先>/...` (各ファイルのパスを列挙)

### techStack 制約検証
- 制約 1 (puck→react): ✓ / 違反なし
- 制約 2 (backend matrix): ✓ / 違反なし
- 制約 3 (thymeleaf→grapesjs): ✓ / 違反なし
- 制約 4 (vue→framework): ✓ / 違反なし
- 制約 5 (react→framework): ✓ / 違反なし

### smoke 検証
- Java 構文: ✓ / スキップ (javac 利用不可) / ❌ (エラー内容)
- Thymeleaf well-formed: ✓ / 該当なし / ❌ (エラー内容)
- TypeScript tsc: ✓ / スキップ (tsc 利用不可) / ❌ (エラー内容)

### 注意事項
- 生成コードは雛形です。実際のプロジェクト構成に合わせてパッケージ名/ファイル配置を調整してください
- ゴールデン出力: `.claude/skills/generate-code/golden-examples/` を参照
- DB クエリのバインド変数は ProcessFlow SQL の `@varName` → JPA `:varName` / TypeORM `$N` に変換が必要
```

## 制約 (必守)

- `schemas/*.json` を変更しない (schema ガバナンス #511)
- `data/` ディレクトリを変更しない
- `frontend/` / `backend/` のソースコードを変更しない
- 生成コードは `.tmp/generated-code/` または指定した出力先に置く (プロジェクトルート直置き禁止)
- 未対応 techStack の場合は中止して理由を報告する (サイレント生成禁止)
- CI に組み込まない (本スキルは AI 対話駆動、CI 自動化は別 ISSUE)
