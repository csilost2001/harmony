---
name: generate-code
description: project.techStack に基づき ProcessFlow JSON → backend code / Screen JSON → frontend code を AI が生成する。Spring Boot/Thymeleaf 系と NestJS/Next.js 系の 2 種類の techStack 組合せをカバー。
argument-hint: <flowId|screenId> [出力先ディレクトリ]
disable-model-invocation: true
---

<!--
  使い方:
    /generate-code f81dd9e0-794c-4539-a2a5-9cbcc0a75899
    /generate-code e6147dc0-94b7-436d-ba87-d0080ac34f44
    /generate-code f81dd9e0-794c-4539-a2a5-9cbcc0a75899 .tmp/generated-code/order-confirm

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

## Step 0: 引数解析

`$ARGUMENTS` を以下のように解析する。

- 第1引数 `<flowId|screenId>` (必須): UUID v4 形式
  - UUID でない場合は「引数エラー: UUID v4 形式で指定してください」と報告して中止
- 第2引数 `<出力先>` (任意): ディレクトリパス (default: `.tmp/generated-code/<入力UUID8桁>/`)

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
| `aiCall` (#935) | `modelEndpoints.<modelRef>.provider` に従い SDK 切替 (anthropic-java-sdk / openai-java / langchain4j 等)。tools[] は `tool_use` block で渡す、responseFormat=structuredObject は JSON Schema 強制 | `modelEndpoints.<modelRef>.provider` に従い `@anthropic-ai/sdk` / `openai` / `langchain` 等切替。tools / structured output 同様 |
| `aiAgent` (#935) | tool call loop を SDK / 自前実装で `maxIterations` 回まで実装 (anthropic agent SDK / openai assistants → responses 移行 / langchain Runnable / langgraph 等) | 同左、JS/TS SDK で実装 |
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
```

### ゴールデン出力参照

生成コードの品質は以下のゴールデン出力を参照すること:

- `.claude/skills/generate-code/golden-examples/order-confirm-spring-boot/`
  - `OrderConfirmService.java` — 全 step kind をカバーするゴールデン
  - `OrderConfirmController.java` — REST Controller ゴールデン
  - `Order.java` — Entity ゴールデン
  - `OrderRepository.java` — Repository ゴールデン
  - `V1__create_orders.sql` — Flyway DDL ゴールデン

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

### ゴールデン出力参照

- `.claude/skills/generate-code/golden-examples/product-search-thymeleaf/product-search.html`
  - Screen `e6147dc0-94b7-436d-ba87-d0080ac34f44` (商品検索, kind=search) のゴールデン

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
  backend/typescript-nestjs/
    SERVICE.md    — Service クラス生成ルール
    CONTROLLER.md — Controller + DTO 生成ルール
    ENTITY.md     — TypeORM Entity + Module 生成ルール
  frontend/thymeleaf-bootstrap/
    PAGE.md       — Thymeleaf HTML テンプレート生成ルール (kind 別パターン)
  frontend/react-tailwind-next/
    PAGE.md       — Next.js App Router ページ生成ルール (kind 別パターン)
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

frontend (React + Next.js):
  <出力先>/app/<path>/
    page.tsx
  <出力先>/components/<domain>/
    <ComponentName>.tsx
```

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
- 種別: ProcessFlow | Screen
- ID: <uuid>
- techStack: <backend.language>/<backend.framework>/<database.type>/<frontend.library>

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
