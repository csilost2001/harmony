---
name: generate-code
description: project.techStack に基づき ProcessFlow JSON → backend code / Screen JSON → frontend code を AI が生成する。Spring Boot/Thymeleaf 系と NestJS/Next.js 系の 2 種類の techStack 組合せをカバー。
argument-hint: <flowId|screenId|pageLayoutId> | --all | --workspace <wsId> [出力先]
disable-model-invocation: true
---

<!--
  使い方:
    /generate-code order-confirm
    /generate-code product-search
    /generate-code order-confirm .tmp/generated-code/order-confirm
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

  制限事項 (本 skill カバー外、各 ISSUE で trace):
    - 全 techStack 組合せ網羅 (Python FastAPI / Go Gin 等は未対応、リリース必須なら別 ISSUE 起票)
    - 認証 (techStack.auth) テンプレート: Java Spring Boot 系 session 認証は実装済 (#1035 D)、
      NestJS 系 session 認証も実装済 (#1036)
    - デプロイ (techStack.deployment) テンプレート (未着手、リリース必須なら別 ISSUE 起票)
    - CI 自動化 (Skill 実行は AI 対話駆動のため CI に乗せない方針、#889 で deferred 確定)

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
| PageLayout entity | 入力 ID が pageLayouts に存在 | Step 3-D (Thymeleaf passive layout / NestJS AppLayout) |

`purpose` フィールドが存在しない Screen は旧 schema 互換で `"page"` として扱います。
各生成パスの詳細テンプレートは `templates/frontend/{thymeleaf-bootstrap,react-tailwind-next}/` 配下に整備済 (Phase B/C 完了)。本 Step では分岐ロジックと参照リンクを定義します。

## Step 0: 引数解析

`$ARGUMENTS` を以下のいずれかの形式で解析する。

### 単発モード (従来)

```
/generate-code <flowId|screenId|pageLayoutId> [出力先]
```

- 第1引数 `<flowId|screenId|pageLayoutId>` (必須): EntityId (kebab-case) が canonical。legacy UUID 形式は移行期間 compat として受容
  - EntityId / legacy UUID のどちらにも見えない場合は「引数エラー: EntityId (kebab-case) または legacy UUID 形式で指定してください」と報告して中止
- 第2引数 `<出力先>` (任意): ディレクトリパス (default: `.tmp/generated-code/<入力ID>/`、必要なら filesystem-safe に sanitize)

### bulk モード (`--all` / `--workspace`)

```
/generate-code --all [出力先]                  # active workspace の全 entity を順次生成
/generate-code --workspace <wsId> [出力先]      # 指定 wsId を active 扱いで bulk 実行
```

- `--all`: active workspace の `project.json` / `harmony.json` から `entities.processFlows[]`, `entities.screens[]`, `entities.pageLayouts[]` を全て読み、各 ID に対して Step 1 以降を順次実行する
- `--workspace <wsId>`: 第 2 引数として workspace ID を受け取り、`workspaces/<wsId>/` (または `examples/<wsId>/`) を active 扱いで Step 1 以降を順次実行 (既存 active を変更しない)
- 出力先 (default: `.tmp/generated-code/bulk-<UTC-yyyymmdd-hhmmss>/`) は entity 種別ごとにサブディレクトリで分離する:
  ```
  <出力先>/process-flows/<flowId>/    各 ProcessFlow の生成物 (例: process-flows/order-confirm/)
  <出力先>/screens/<screenId>/        各 Screen の生成物 (例: screens/product-search/)
  <出力先>/page-layouts/<layoutId>/   各 PageLayout の生成物 (例: page-layouts/admin-shell/)
  ```
  - `<flowId>` / `<screenId>` / `<layoutId>` は **EntityId をそのまま使用** (RFC #1284 / #1332 で確定した kebab-case 英単語形式)。`[a-z0-9-]` のみ含むため sanitize 不要
  - legacy UUID compat 入力 (`--workspace` 配下に旧 UUID id を含む sample が混在する場合) は **full UUID を使う** (prefix truncation 禁止)。EntityId / UUID いずれの場合も衝突回避のため値を切り詰めない (EntityId は先頭文字列が被りやすく、prefix-only では出力先衝突を誘発するため、full sanitized ID を必須とする)
- bulk モード時の実行詳細は Step 5 「bulk モード時のループ動作」を参照

### effectiveWorkspace の解決 (CLI 指定優先、#1035 S-1 解消)

Step 0 完了時に **本 skill 実行を通じて参照する workspace** を以下で確定する:

```
effectiveWorkspace = (CLI で --workspace <wsId> が指定された場合: wsId)
                  ?? (MCP active workspace、workspace_status / workspace_inspect で取得)
                  ?? "examples/retail" (フォールバック default)
```

- **CLI 指定 (`--workspace`) が最優先**: MCP active と異なっていても CLI 指定を採用する (CLI 指定の意図を尊重)
- MCP active との不一致時は冒頭で 1 行 warning を出す:
  「警告: CLI 指定 (`--workspace=<wsId>`) と MCP active workspace (`<activeId>`) が異なります。CLI 指定を採用します。」
- Step 1 以降の `project.json` / `harmony.json` / 各 resource path / techStack 取得は **すべて `effectiveWorkspace`** を base にする
- 既存 MCP active を**変更しない** (CLI 実行は MCP 操作と独立)

出力先ディレクトリが存在しない場合はコード生成前に作成する (PowerShell: `New-Item -ItemType Directory -Force`)。

## Step 1: 入力読込

### 1-1. effectiveWorkspace の project.json / harmony.json から techStack を取得

Step 0 で確定した `effectiveWorkspace` を base に `<base>/project.json` (旧形式) または `<base>/harmony.json` (新形式 #849) を Read で読む。

base 候補 (CLI 指定有無で分岐):
- CLI `--workspace <wsId>` あり → `<wsId>/` を直接 base に (例: `examples/retail/` or `workspaces/<wsId>/`)
- CLI 指定なし → MCP `mcp__backend__designer__workspace_status` / `workspace_inspect` で active workspace path を取得して base に

**フォールバック**: 両方とも未解決の場合は `examples/retail/` を読む (default sample)。

```
project.techStack:
  designer.cssFramework
  backend.language, backend.framework
  database.type, database.version
  frontend.library, frontend.framework
  auth.method
  deployment.target
```

### 1-2. 入力 ID (EntityId または legacy UUID) の種別を harmony.json から判定

`harmony.json` の `entities.processFlows[].id` と `entities.screens[].id` を照合する。
RFC #1284 / #1332 以降は EntityId (kebab-case) が canonical、legacy UUID 形式も移行期間 compat で受容。

- `processFlows[].id` にマッチ → ProcessFlow → backend code 生成へ (Step 3-A)
- `screens[].id` にマッチ → Screen → frontend code 生成へ (Step 3-B)
- どちらにもマッチしない → 「ID が見つかりません (processFlows / screens を確認してください)」と報告して中止

### 1-3. 入力 JSON を Read で取得

- ProcessFlow: active workspace の `process-flows/<id>.json` / フォールバック: `examples/retail/process-flows/<id>.json`
- Screen: active workspace の `screens/<id>.json` / フォールバック: `examples/retail/screens/<id>.json`
- PageLayout: active workspace の `page-layouts/<id>.json` / フォールバック: `examples/retail/page-layouts/<id>.json`

### 1-4. PageLayout entity の検出

`harmony.json`(または旧 `project.json` の legacy 環境) に `entities.pageLayouts[].id` が存在する場合、入力 ID をそこに照合する。

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

### 制約 1: バックエンド言語 × フレームワーク matrix

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

### 制約 2: vue → frontend.framework ∈ {nuxt, vite, none}

```
if (frontendLib === "vue" AND fw !== undefined AND fw NOT IN ["nuxt", "vite", "none"]):
  VIOLATION: 'Vue.js には frontend.framework "{fw}" は使用できません。"nuxt", "vite", "none" から選択してください。'
```

### 制約 3: react → frontend.framework ∈ {next, vite, none}

```
if (frontendLib === "react" AND fw !== undefined AND fw NOT IN ["next", "vite", "none"]):
  VIOLATION: 'React には frontend.framework "{fw}" は使用できません。"next", "vite", "none" から選択してください。'
```

画面デザインは業務部品の木 (`screen.layout`) に一本化されており、旧エディタ (GrapesJS / Puck) の種別による制約・出力スキップは無い。
`techStack.designer` は `cssFramework` (生成する画面コードで使う CSS フレームワーク) だけを持つ。

## Step 2.4: PageLayout 解決 (Screen.purpose=page かつ pageLayoutId あり)

Step 1.5 で `purpose === "page"` にルーティングされ、かつ Screen JSON に `pageLayoutId` が存在する場合、以下を実行する。

```
1. active workspace の `page-layouts/<pageLayoutId>.json` を Read
   フォールバック: `examples/retail/page-layouts/<pageLayoutId>.json`

2. PageLayout JSON から以下の情報を取得:
   - id, name
   - regions[]: { id, name, order }
   - assignments: { [regionId]: gadgetScreenId }  (region → Gadget の対応)

3. assignments の各 gadgetScreenId を解決:
   各 gadgetScreenId について `screens/<gadgetScreenId>.json` を Read し、
   Gadget の name / layout (業務部品の木) / items / path 等を取得する。
   map 化: { "<regionId>": { gadgetId, gadgetName, gadgetLayout } }

4. 収集した PageLayout + gadget 情報を Step 3-B (layout decorate モード) に渡す。
```

pageLayouts が active workspace に存在しない (JSON が見つからない) 場合:
→ 「警告: pageLayoutId `<id>` が見つかりません。レイアウトなしで Page を生成します。」と報告し、
   通常の Step 3-B (layout なしモード) で続行する。

## Step 2.5: CSS フレームワークの決定

生成する画面コードの CSS フレームワークは `techStack.designer.cssFramework` (省略時 `bootstrap`) だけで決める。
画面・ページレイアウト・ガジェットごとの `cssFramework` 指定は廃止済みなので、混在の検出は不要。

## Step 3-A: ProcessFlow → backend code 生成

ProcessFlow JSON を入力として、techStack に基づく backend code 雛形を生成する。

### 0. designer-time alias (`@this` / `@self`) の事前展開 (#1322 Phase B-3c)

ProcessFlow JSON 内の文字列値 (sql / payload / filter / expression / condition / outputBinding.transformations 等の TemplateString) には、designer-time alias **`@this.<...>` / `@self.<...>`** が含まれることがある (`/process-flow/edit/:id` 編集時に補完される、#1308)。

これらは **runtime catalog では解決できない** ため、コード生成前に **静的 pre-resolve** する。runtime expression evaluator は `@this/@self` を直接認識しない設計とし、本 step で展開後の static ref のみ評価対象とする。

#### 展開規則 (本 step の AI 実装責務)

| 元 ref | 展開先 (canonical) | 各 target 言語での render 例 |
|---|---|---|
| `@this.action.<actionId>.<path>` | flow.actions[].id 経由の action 参照 | Java: `flow.findAction("<actionId>").<path>` / TS: `flow.actions.find(a => a.id === "<actionId>").<path>` |
| `@this.meta.<field>.<path>` | flow.meta.<field> 経由 (EntityMeta + ProcessFlow Meta 固有 field、id/name/flowType/sla 等) | Java: 定数化 / `MetaService.get("<field>")` / TS: `FLOW_META.<field>` |
| `@this.context.<path>` | flow.context (catalogs / variables / ambientVariables) | 各 catalog の type-safe getter (例: `Context.events.<topic>` / `ambient.<name>`) |
| `@this.expressionLanguage` | flow.expressionLanguage (leaf) | 通常 codegen 時に既知の constant、render skip 可 |
| `@self.<field>.<path>` (step context) | 当該 step の field 直接アクセス | Java: `this.<field>.<path>` (step メソッド内) / TS: `step.<field>.<path>` / SQL prepared param |

#### 実装ガイダンス

- 生成コード内に `@this.*` / `@self.*` の文字列を **そのまま残さない** こと。残った場合は spec 違反 (runtime 評価不能) として fail-fast にレポート
- 解決不能な ref (例: `@this.action.<unknownId>`) は **Phase B-3a validator (processFlowAntipatternValidator Check 31)** で事前検出されている前提。本 step で再検出した場合は **fatal error** として中止し、ユーザーに「先に validator を pass させてください」と報告
- 純粋関数 `findDesignerAliases(template, ctx)` (`frontend/src/utils/reference-completer/designerAliasResolve.ts`) が template 内の全 `@this/@self` を `DesignerAliasMatch[]` として返す。本 skill 実行時は AI が JSON を読みつつ同等のロジックで static ref へ展開する (utility 直接呼出しは不要、再現可能なルール docs に従って実装)
- spec: [docs/spec/process-flow-prefix-system.md §11.3](../../docs/spec/process-flow-prefix-system.md)

### テンプレート選択

| techStack.backend | 参照テンプレート |
|---|---|
| java + spring-boot | `ai-skills/generate-code/templates/backend/java-spring-boot/` |
| typescript + nestjs | `ai-skills/generate-code/templates/backend/typescript-nestjs/` (DB 層は `techStack.backend.orm` で分ける。下の「DB と ORM の読み方」) |
| その他 | 「未対応の techStack 組合せです (本スキルは java/spring-boot と typescript/nestjs のみカバー)。別 ISSUE で対応予定。」と報告して中止 |

### DB と ORM の読み方 (TypeScript NestJS。`techStack.backend.orm` / `techStack.database`)

NestJS の出力は、**ORM** と **DB の種類** の 2 つを `harmony.json` の techStack から読んで決める。読む場所はここ 1 か所に決める (他の節・雛形は、ここを参照する)。

| 決めるもの | 読む場所 | 省略時 | 使う先 |
|---|---|---|---|
| ORM | `techStack.backend.orm` (`prisma` / `typeorm`) | **`prisma`** (推奨・既定) | 生成ファイル (下の表)・Service の dbAccess / transactionScope・generate-tests の DB 検証・scaffold の `@orm` ブロック |
| DB の種類 | `techStack.database.type` (`postgresql` / `mysql` / `sqlite` / `sqlserver` / `oracle`) | schema の既定値の **`postgresql`** | Prisma の `datasource.provider`・TypeORM の `type`・scaffold の `@db` ブロック (compose.yml の DB サービス / `DATABASE_URL` / README の DB の初期化) |
| model / Entity 名 | `tables[].physicalName` | - | snake_case の語を PascalCase にし、最後の語を単数形にする (`posts` → `Post`)。generate-tests も同じ規則 |

`orm` は `language: typescript` のときだけ意味がある (`java` / `spring-boot` では読まない)。

**2 つの ORM を 1 つの生成物の中で混ぜない。**

| | `orm: prisma` (既定・省略時) | `orm: typeorm` |
|---|---|---|
| 雛形 | `PRISMA_SCHEMA.md` + `SERVICE.md` の Prisma の節 | `ENTITY.md` + `SERVICE.md` の TypeORM の節 |
| 出す | `prisma/schema.prisma`、`src/prisma/prisma.service.ts`、`src/prisma/prisma.module.ts`、依存 `@prisma/client` と `prisma` | `entity/*.entity.ts`、`src/database/typeorm.config.ts`、依存 `typeorm` と `@nestjs/typeorm` と DB ドライバ (`pg` / `mysql2` / `better-sqlite3`) |
| **一切出さない** | `typeorm`、`@nestjs/typeorm`、`*.entity.ts`、`DataSource`、`Repository`、`TypeOrmModule` | `prisma/`、`@prisma/client`、`prisma` の依存、`PrismaService`、`PrismaModule` |
| Service が受け取る | `PrismaService` | `DataSource` と `Repository<Entity>` |
| 表の作り方 (dev) | `npx prisma db push` | アプリ起動時の `synchronize` (`DB_SYNCHRONIZE=true`) |

**sqlite のときの Prisma の注意** (実機で確認した。詳細は `PRISMA_SCHEMA.md`):

- `BIGINT` の列は `BigInt` ではなく **`Int`** にする (`BigInt` の主キーは SQLite で自動採番されない)。Service の ID も `number` で書く
- `DATABASE_URL` の相対パスは `schema.prisma` のあるフォルダ (`prisma/`) からの相対。`file:./dev.db` と書く (`file:./prisma/dev.db` だと `prisma/prisma/dev.db` になる)

DB の種類が `oracle` のとき、Prisma は対応していないので生成を止めて利用者に知らせる (`orm: typeorm` に変えれば生成できる)。`sqlserver` と `oracle` は、開発コンテナの雛形に DB サービスが無い (下の「DB ごとのブロック」の対象外) ので、`@db` ブロックは全部消え、compose.yml の `volumes:` の欄が空になる。そのときは `docker-compose.yml` の `volumes:` 行と `DATABASE_URL` を利用者に確認して手で整える旨を最終レポートに書く。

### step kind ごとのコード生成ルール (§8 — ProcessFlow → backend mapping)

各 step を走査して対応するコードブロックを生成する。

| step.kind | Java Spring Boot 生成 | TypeScript NestJS 生成 |
|---|---|---|
| `dbAccess` (SELECT) | `repository.findBy...()` または `@Query native` | Prisma (既定): `prisma.<model>.findUnique()` / `findMany()`、生 SQL は `prisma.$queryRaw`。`orm: typeorm`: `repository.findOneBy()` / `find()`、生 SQL は `dataSource.query()` |
| `dbAccess` (INSERT) | `repository.save(entity)` | Prisma: `prisma.<model>.create()`。`orm: typeorm`: `repository.save()` |
| `dbAccess` (UPDATE) | `@Modifying @Query` | Prisma: `prisma.<model>.update()`。`orm: typeorm`: `repository.update()` |
| `dbAccess` (DELETE) | `@Modifying @Query` | Prisma: `prisma.<model>.delete()`。`orm: typeorm`: `repository.delete()` |
| `dbAccess` (拡張 op) | `// TODO: {{step.operation}} — 拡張操作。extensions/ 定義参照` | 同左 |
| `transactionScope` | `@Transactional` メソッド + isolation / timeout / rollbackOn を適用 (`@Transactional` は private/同クラス self-call では AOP proxy を bypass するため別 `@Service` Bean か `TransactionTemplate` 利用に注意)。`steps[]` 内全 step を 1 TX で wrap | `steps[]` 内全 step を 1 TX で wrap。**`techStack.backend.orm` で分ける**: Prisma (既定・省略時) は `prisma.$transaction(async (tx) => { ... })`、`orm: typeorm` は `dataSource.transaction(async (manager) => { ... })`。2 つを同じ生成物に混ぜない。詳細は `templates/backend/typescript-nestjs/SERVICE.md` の「transactionScope mapping」セクションの ORM ごとの節を参照 (#875 / #1221 で旧 txBoundary 廃止し本パターンに一本化) |
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
| `setGlobal` (#1322 Phase B-3e) | lifetime に応じて分岐: `application` → `@Bean` singleton (`@Service` + ConcurrentHashMap)、`session` → `HttpSession.setAttribute(globalName + "." + field, value)`、`request` → `@RequestScope` Bean に setter。field 省略時は object 全体を 1 entry として set | 同様の lifetime 分岐: `application` → DI Container 内 singleton (`@Injectable({ scope: Scope.DEFAULT })`)、`session` → `req.session[globalName] = ...` (express-session)、`request` → `@Injectable({ scope: Scope.REQUEST })` の per-request store。詳細は `templates/backend/typescript-nestjs/GLOBALS.md` 参照 |
| `other` | `// TODO: {{step.description}}` + outputSchema で型推定 (注: schema の `kind` に `other` は存在しない。extension step では `type: "other"` を使う別階層の概念であるため混同注意) | 同左 |

### setGlobal step 詳細 (#1322 Phase B-3e、globals catalog write)

`setGlobal` step は `generic-definitions/global/<globalName>.json` で定義された globals catalog instance に対する **write 操作**。`@var.global.<globalName>` / `@var.global.<globalName>.<field>` で read される値の更新 entry point。

#### 解決順序

1. step.lifetime > globals catalog の `mappingHints.scope` > default `application`
2. step.field 指定時は当該 field のみ set、省略時は globals 全体を value で上書き
3. value は TemplateString として評価 (`@var.flowParameter.x` / `@var.action.y` / `@var.step.<id>.z` 等)

#### Java Spring Boot — lifetime 別パターン

```java
// lifetime: "application" — singleton bean + ConcurrentHashMap
@Service
public class TenantContextHolder {
    private final ConcurrentHashMap<String, Object> store = new ConcurrentHashMap<>();
    public void set(String field, Object value) { store.put(field, value); }
    public Object get(String field) { return store.get(field); }
}
// generated: tenantContextHolder.set("tenantId", flowParameter.getTenantId());

// lifetime: "session" — HttpSession 直接
session.setAttribute("TenantContext." + "tenantId", flowParameter.getTenantId());

// lifetime: "request" — @RequestScope Bean
@RequestScope @Component
public class RequestContextHolder { /* same shape as application but per-request */ }
```

#### TypeScript NestJS — lifetime 別パターン

```typescript
// lifetime: "application" — DI singleton
@Injectable() // Scope.DEFAULT = singleton
export class TenantContextHolder {
  private readonly store = new Map<string, unknown>();
  set(field: string, value: unknown) { this.store.set(field, value); }
  get(field: string) { return this.store.get(field); }
}
// generated: this.tenantContextHolder.set("tenantId", flowParameter.tenantId);

// lifetime: "session" — express-session
(req.session as any).TenantContext = (req.session as any).TenantContext || {};
(req.session as any).TenantContext.tenantId = flowParameter.tenantId;

// lifetime: "request" — Scope.REQUEST DI
@Injectable({ scope: Scope.REQUEST })
export class RequestContextHolder { /* same shape */ }
```

#### 注意点

- 生成 Service 名は globals catalog name に基づく PascalCase + `Holder` suffix で安定化する
- `@var.global.<globalName>` 読み出し側 (Read) と setGlobal (Write) は同 lifetime を使う前提。lifetime mismatch は warning として記録
- TransactionScopeStep 内部での `setGlobal` は **即時反映** で実装 (TX rollback 時の globals 値巻き戻しは現状未対応、必要性は dogfood で再検証 — spec 確定: [docs/spec/process-flow-variables.md §3.6 globals write](../../docs/spec/process-flow-variables.md))

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
- `httpRoute.auth: "required"` → Spring Security の `SecurityFilterChain` で `authenticated()`、または `@UseGuards(SessionGuard)`。詳細は次節「認証 (techStack.auth) 生成ルール」参照

### 認証 (techStack.auth) 生成ルール

`techStack.auth.method` の値に応じて Security 設定を生成する。**`method` 未設定なら認証関連の生成を行わず、`httpRoute.auth="required"` は warning コメントで残す**。

#### `techStack.auth.method = "session"` (Java Spring Boot)

session ベース認証 (form login + HttpSession) を生成する。**logout stub の本格実装** (#1035 D 対応):

##### 1. pom.xml に依存追加

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
<!-- Thymeleaf テンプレ内で Spring Security ヘルパー (sec:authorize 等) を使う場合に必須。
     使わなくても login.html の form action="/login" は機能するが、Gadget で
     `sec:authorize="isAuthenticated()"` 等を使うなら依存追加必須 -->
<dependency>
    <groupId>org.thymeleaf.extras</groupId>
    <artifactId>thymeleaf-extras-springsecurity6</artifactId>
</dependency>
<!-- test 系依存 (#1035 S-4、/generate-tests 出力の compile 前提) -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
<!-- @WithMockUser / SecurityMockMvcRequestPostProcessors を使うため必須 (auth.method=session 時) -->
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-test</artifactId>
    <scope>test</scope>
</dependency>
```

##### 2. SecurityConfig.java (新規、`config/` 配下)

```java
package com.example.<projectName>.config;

import org.springframework.boot.autoconfigure.security.servlet.PathRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

/**
 * Spring Security 設定 — techStack.auth.method=session 時に生成
 *
 * - form login enabled (/login)
 * - POST <logoutPath> を logout endpoint として登録 (ProcessFlow の act-logout から派生)
 * - logout 後の redirect 先: /login?logout
 * - 静的リソース (Spring Boot の ResourceHttpRequestHandler が serve する /css/**, /js/**,
 *   /webjars/**, /images/**, /favicon.ico) は anonymous 許可
 *   (Spring Security 6 で `requestMatchers("/css/**")` は DispatcherServlet 経由のみ
 *    マッチするため、PathRequest.toStaticResources().atCommonLocations() で
 *    ResourceHttpRequestHandler 経由の path も明示許可する。PR #1041/#1037 で検出)
 * - InMemoryUserDetailsManager で demo/demo 固定ユーザー (PoC/dev 用、本番は DB 連携に置換)
 *
 * 本テンプレは UserDetailsService Bean を含む。Spring Security 6.x は
 * UserDetailsService が無いと NoSuchBeanDefinitionException で起動失敗するため、
 * 最低限の demo stub が必須 (#1039 S-2 解消)。
 *
 * Generated by Harmony /generate-code (techStack.auth.method=session).
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                // Spring Boot 静的リソース (ResourceHttpRequestHandler) を anonymous 許可
                // — PR #1041/#1037 で検出した Spring Security 6 仕様への対応
                .requestMatchers(PathRequest.toStaticResources().atCommonLocations()).permitAll()
                .requestMatchers("/login", "/css/**", "/js/**", "/webjars/**").permitAll()
                .anyRequest().authenticated()
            )
            .formLogin(form -> form
                .loginPage("/login").permitAll()
                .defaultSuccessUrl("/", true)
            )
            .logout(logout -> logout
                .logoutRequestMatcher(new AntPathRequestMatcher("<logoutPath>", "POST"))
                .logoutSuccessUrl("/login?logout")
                .invalidateHttpSession(true)
                .deleteCookies("JSESSIONID")
            );
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    /**
     * デモ用 InMemoryUserDetailsManager — **dev profile 限定** (#1035 S-6)。
     * 本番は @Profile("prod") 用の別 UserDetailsService Bean (JdbcUserDetailsManager 等) を提供すること。
     */
    @Bean
    @Profile("dev")
    public UserDetailsService demoUserDetailsService(PasswordEncoder passwordEncoder) {
        UserDetails demoUser = User.builder()
            .username("demo")
            .password(passwordEncoder.encode("demo"))
            .roles("USER")
            .build();
        return new InMemoryUserDetailsManager(demoUser);
    }
}
```

import が増えるため (上記 SecurityConfig 用):

```java
import org.springframework.context.annotation.Profile;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
```

`application.properties` (or `application.yml`) に `spring.profiles.active=dev` を default で書き込む。本番 deploy 時は環境変数 `SPRING_PROFILES_ACTIVE=prod` 等に切替え、別 UserDetailsService Bean を提供すること。

`<logoutPath>` は ProcessFlow の `act-logout` action の `httpRoute.path` (例: `/api/retail/auth/logout`)。

##### 2.5. LoginController.java (新規、`web/` 配下) — GET /login handler

Spring Security 6 は `.loginPage("/login")` を **path 宣言のみ** として扱い、GET /login を自動 serve しない。明示的な `@GetMapping("/login")` Controller を別途生成する (これがないと未認証 → /login redirect → 404 ループ。PR #1041/#1037 で検出)。

```java
package com.example.<projectName>.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Spring Security 6 は loginPage("/login") で指定した path を自動 serve しない。
 * GET /login に対する明示的なマッピングが必要 (techStack.auth.method=session 時)。
 *
 * Generated by Harmony /generate-code (techStack.auth.method=session).
 */
@Controller
public class LoginController {

    @GetMapping("/login")
    public String login() {
        return "login";
    }
}
```

##### 2.6. 静的リソース placeholder (`static/css/main.css`, `static/js/main.js`)

`SecurityConfig` の static resource 許可テストで `GET /css/main.css` 等が 200 を返すには、最低限の placeholder ファイルが存在する必要がある。`/generate-code` は以下を生成する (内容は空コメントで OK):

```
src/main/resources/static/css/main.css   # /* Generated placeholder — replace with project styles */
src/main/resources/static/js/main.js     # /* Generated placeholder — replace with project scripts */
```

ユーザー側が独自スタイルを追加する場合はこれらを上書きする。**生成しないと anonymous で 404 になり、(d) の static resource smoke が通らない** (200 期待だが file 不在で 404)。

##### 3. AuthController.java は生成しない (LogoutFilter 一本化、#1035 S-3 解消)

旧テンプレでは `AuthController.java` に `@PostMapping("<logoutPath>")` を生成し `SecurityContextLogoutHandler` でセッション破棄を行っていたが、**SecurityConfig の `.logout(...)` で同 path を登録すると Spring Security の `LogoutFilter` が DispatcherServlet より先回りで処理**するため、AuthController の実装は通常実行経路で **常に dead code** になる (Codex review #1035 S-3 指摘)。

**現行ルール**: `techStack.auth.method=session` 時:

- **AuthController.java は生成しない**
- POST `<logoutPath>` (ProcessFlow act-logout の httpRoute.path) は **SecurityConfig の `.logoutRequestMatcher(...)` 経由で LogoutFilter が処理**
- LogoutFilter が以下を実行: `SecurityContextHolder.clearContext()` + `HttpSession.invalidate()` + `JSESSIONID` cookie 削除 + `logoutSuccessUrl` (`/login?logout`) へ redirect

#### テスト方針 (auth.method=session の logout 検証)

`/generate-tests` で生成する MockMvc test は **AuthController を呼ばず、`POST <logoutPath>` を直接叩いて LogoutFilter chain の挙動を検証** する:

```java
@Test
@WithMockUser(username = "demo", roles = {"USER"})
void ログアウトすると302で_loginlogoutに_redirect() throws Exception {
    mockMvc.perform(post("<logoutPath>").with(csrf()))
        .andExpect(status().is3xxRedirection())
        .andExpect(redirectedUrl("/login?logout"));
}
```

CSRF token 付与 (`.with(csrf())`) を忘れないこと (Spring Security 6 default で CSRF 有効、POST 必須)。

#### Frontend (Gadget Fragment) 側のフォーム

Gadget HTML の logout button form は変わらず `<form th:action="@{<logoutPath>}" method="post">` を生成。Spring Security の LogoutFilter が path 一致で先に処理するため Controller 不要 ([FRAGMENT.md](templates/frontend/thymeleaf-bootstrap/FRAGMENT.md) 参照、auth.method=session 時の GadgetController logout メソッドも生成しない)。

##### 4. login.html (新規、`templates/` 配下、最小フォーム)

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org" lang="ja">
<head>
  <meta charset="UTF-8">
  <title>ログイン</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3/dist/css/bootstrap.min.css">
</head>
<body class="bg-light">
  <div class="container py-5" style="max-width: 400px;">
    <h1 class="h4 mb-3">ログイン</h1>
    <div th:if="${param.error}" class="alert alert-danger" role="alert">
      ユーザー名またはパスワードが正しくありません。
    </div>
    <div th:if="${param.logout}" class="alert alert-info" role="alert">
      ログアウトしました。
    </div>
    <form th:action="@{/login}" method="post">
      <div class="mb-3">
        <label for="username" class="form-label">ユーザー名</label>
        <input type="text" id="username" name="username" class="form-control" required autofocus>
      </div>
      <div class="mb-3">
        <label for="password" class="form-label">パスワード</label>
        <input type="password" id="password" name="password" class="form-control" required>
      </div>
      <button type="submit" class="btn btn-primary w-100">ログイン</button>
    </form>
    <!-- #1035 S-6: デモアカウント表示は dev profile 限定。本番 (SPRING_PROFILES_ACTIVE=prod)
         起動時は非表示で、login 画面に demo credential が露出しない。 -->
    <p class="text-muted small mt-3 text-center"
       th:if="${@environment.acceptsProfiles('dev')}">
      デモアカウント: <code>demo</code> / <code>demo</code>
    </p>
  </div>
</body>
</html>
```

##### 5. 生成ファイル一覧 (auth=session 追加分)

```
<出力先>/
  src/main/java/com/example/<projectName>/config/
    SecurityConfig.java
  src/main/java/com/example/<projectName>/web/
    LoginController.java                    # GET /login の handler (#2.5、必須)
  src/main/resources/templates/
    login.html
  src/main/resources/static/css/
    main.css                                # 空 placeholder (#2.6)
  src/main/resources/static/js/
    main.js                                 # 空 placeholder (#2.6)
  # AuthController.java は生成しない (#1035 S-3 解消、LogoutFilter 一本化)
```

#### `techStack.auth.method = "session"` (TypeScript NestJS)

NestJS 系は `@nestjs/passport` + `passport-local` + `express-session` で session 認証を実装する (#1036 対応)。

##### 1. package.json 依存追加

```json
{
  "dependencies": {
    "@nestjs/passport": "^11.0.5",
    "passport": "^0.7.0",
    "passport-local": "^1.0.0",
    "express-session": "^1.18.0"
  },
  "devDependencies": {
    "@types/passport-local": "^1.0.38",
    "@types/express-session": "^1.18.0"
  }
}
```

##### 2. main.ts での express-session middleware 設定

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
// express-session / passport は `export = X` (CommonJS) 形式のため、TypeScript 5.x の
// strict + esModuleInterop 下では `import * as X` だと TS2349 ("not callable") になる。
// `export =` モジュールは `import X = require(...)` で受けるのが正規パターン。
import session = require('express-session');
import passport = require('passport');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    console.warn(
      '[auth] SESSION_SECRET env var not set — using insecure dev default. ' +
      'Set SESSION_SECRET in production!'
    );
  }
  app.use(
    session({
      secret: sessionSecret ?? 'dev-secret-change-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  await app.listen(3000);
}
```

`SESSION_SECRET` を env で受ける。dev fallback は development 限定のシンプル値で警告付き。

##### 3. AuthModule + LocalStrategy + SessionSerializer + AuthService

```typescript
// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './local.strategy';
import { SessionSerializer } from './session.serializer';

@Module({
  imports: [PassportModule.register({ session: true })],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, SessionSerializer],
})
export class AuthModule {}
```

```typescript
// src/auth/auth.service.ts  — PoC: in-memory demo user (Java 系の InMemoryUserDetailsManager 相当)
import { Injectable } from '@nestjs/common';

export type AuthenticatedUser = { id: string; username: string };

@Injectable()
export class AuthService {
  async validateUser(username: string, password: string): Promise<AuthenticatedUser | null> {
    // PoC / dev 用の固定ユーザー。本番は DB 連携 (例: Prisma + bcrypt) に置換すること。
    if (username === 'demo' && password === 'demo') {
      return { id: 'demo-user-id', username: 'demo' };
    }
    return null;
  }
}
```

```typescript
// src/auth/local.strategy.ts
import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService, AuthenticatedUser } from './auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) { super(); }
  async validate(username: string, password: string): Promise<AuthenticatedUser> {
    const user = await this.authService.validateUser(username, password);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
```

```typescript
// src/auth/session.serializer.ts
import { PassportSerializer } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from './auth.service';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  serializeUser(user: AuthenticatedUser, done: (err: Error | null, payload: AuthenticatedUser) => void) {
    done(null, user);
  }
  deserializeUser(payload: AuthenticatedUser, done: (err: Error | null, user: AuthenticatedUser) => void) {
    done(null, payload);
  }
}
```

##### 4. AuthenticatedGuard (httpRoute.auth=required の Guard)

```typescript
// src/auth/authenticated.guard.ts  — httpRoute.auth=required の Guard
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    return req.isAuthenticated();
  }
}
```

**`@UseGuards(AuthenticatedGuard)` 自動付与ルール**: Java 系は `SecurityFilterChain` で一括 (`.anyRequest().authenticated()`)、**NestJS 系は Controller method 単位で `@UseGuards(AuthenticatedGuard)` を自動付与する**。`httpRoute.auth="required"` の action から生成する Controller method すべてに付与すること。

##### 5. AuthController (login + logout endpoint)

```typescript
// src/auth/auth.controller.ts
import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';

@Controller()
export class AuthController {
  @UseGuards(AuthGuard('local'))
  @Post('/login')
  login(@Res() res: Response) { res.redirect('/'); }

  /** act-logout: ProcessFlow `act-logout` action から派生。LogoutFilter 相当の処理。 */
  @Post('<logoutPath>')
  logout(@Req() req: Request, @Res() res: Response) {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/login?logout');
      });
    });
  }
}
```

`<logoutPath>` は ProcessFlow の `act-logout` action の `httpRoute.path` (例: `/api/retail/auth/logout`)。

##### 6. /login ページ (Next.js Server Component)

`techStack.cssFramework` に応じて Bootstrap か Tailwind で class を出し分ける。`error` / `logout` query string で flash 表示。

```tsx
// app/login/page.tsx
type Search = { error?: string; logout?: string };

// cssFramework=bootstrap の場合
export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { error, logout } = await searchParams;
  return (
    <div className="container py-5" style={{ maxWidth: '400px' }}>
      <h1 className="h4 mb-3">ログイン</h1>
      {error && (
        <div className="alert alert-danger" role="alert">
          ユーザー名またはパスワードが正しくありません。
        </div>
      )}
      {logout && (
        <div className="alert alert-info" role="status">
          ログアウトしました。
        </div>
      )}
      <form action="/login" method="post">
        <div className="mb-3">
          <label className="form-label">ユーザー名
            <input name="username" className="form-control" required autoFocus />
          </label>
        </div>
        <div className="mb-3">
          <label className="form-label">パスワード
            <input type="password" name="password" className="form-control" required />
          </label>
        </div>
        <button type="submit" className="btn btn-primary w-100">ログイン</button>
      </form>
    </div>
  );
}

// cssFramework=tailwind の場合 (上記と同構造、class のみ差し替え)
// container → mx-auto max-w-sm py-10
// alert alert-danger → rounded bg-red-50 border border-red-300 p-3 text-red-800 text-sm
// alert alert-info → rounded bg-blue-50 border border-blue-300 p-3 text-blue-800 text-sm
// form-control → block w-full rounded border border-gray-300 px-3 py-2 text-sm
// btn btn-primary w-100 → w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700
```

##### 7. AppModule import 追加

生成済み `src/app.module.ts` の `imports: []` に `AuthModule` を追記する:

```typescript
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [AuthModule, /* 既存 modules */],
})
export class AppModule {}
```

##### 8. 生成ファイル一覧 (NestJS auth=session 追加分)

```
<出力先>/
  src/auth/
    auth.module.ts
    auth.service.ts
    auth.controller.ts
    local.strategy.ts
    session.serializer.ts
    authenticated.guard.ts
  app/login/page.tsx                    # Next.js 側 (frontend 部分)
  src/main.ts                           # session middleware を追加 (既存生成物に inject)
  src/app.module.ts                     # AuthModule import を追加 (既存生成物に inject)
  package.json                          # 依存追加 (既存生成物に inject)
```

#### `techStack.auth.method` が `"none"` / 未設定

認証関連の生成は行わない。`httpRoute.auth="required"` の action が存在する場合は
`// TODO: techStack.auth.method が未設定です。認証ガードを必要に応じて追加してください` の警告コメントを Controller に付与する。

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

  # Maven Wrapper (1 プロジェクトに 1 セット、初回 Spring Boot entity 出力時のみ、#1050):
  mvnw                                  (POSIX shell script、+x 必須)
  mvnw.cmd                              (Windows batch)
  .mvn/wrapper/maven-wrapper.properties

  # AI flow 含有時のみ (Phase 2-C、最初の AI flow 検出時に 1 セット生成):
  src/main/java/com/example/<projectName>/ai/AiRuntimeService.java
  src/main/java/com/example/<projectName>/ai/AiInvocationRequest.java
  src/main/java/com/example/<projectName>/ai/AiInvocationResult.java
  src/main/java/com/example/<projectName>/ai/AiMessage.java / AiContentBlock.java / ... (型群)
  src/main/java/com/example/<projectName>/ai/AiCatalogProvider.java / AiCatalogService.java
  src/main/java/com/example/<projectName>/ai/provider/<Provider>AiProvider.java   (利用 provider のみ)
```

#### Maven Wrapper 同梱 (#1050)

Spring Boot 出力には **必ず** Maven Wrapper を verbatim コピー同梱する (採用プロジェクト B チームが system Maven 不要で `./mvnw spring-boot:run` を打てるようにする)。

- ソース: `ai-skills/generate-code/templates/backend/java-spring-boot/maven-wrapper/` (Apache Maven Wrapper 3.3.2、Apache License 2.0 を保持)
- 配置: 出力プロジェクト root に verbatim コピー (`mvnw`, `mvnw.cmd`, `.mvn/wrapper/maven-wrapper.properties`)
- **`mvnw` には実行権限を付与する**: Write 後に `chmod +x <出力先>/mvnw` 相当の操作を行い、最終レポートに明記
- 単発モードでは既存 `mvnw` の有無を確認、無ければ生成 (上書きしない)
- bulk モードでは最初の Spring Boot entity 出力時に 1 度だけ生成、以降の entity では skip

### 生成ファイル一覧 (TypeScript NestJS)

```
<出力先>/
  <processFlowName>.service.ts           (actions → @Injectable Service)
  <processFlowName>.controller.ts        (httpRoute → @Controller)
  <processFlowName>.module.ts            (Module definition)
  dto/<actionName>-request.dto.ts        (inputs[] → DTO)
  dto/<actionName>-response.dto.ts       (outputs[] → DTO)

  # アプリの入口 (プロジェクトに 1 セット。generate-tests の E2E が `../src/app.module` を import する):
  src/main.ts                            (NestFactory.create(AppModule) → listen。`ValidationPipe` を global に登録)
  src/app.module.ts                      (各 Module と、DB 層の Module (PrismaModule / TypeOrmModule) を import)
  package.json                           (scripts に `build` = `nest build`、`start:backend` = `nest start`。devDependencies に `@nestjs/cli`)
  tsconfig.json / tsconfig.build.json / nest-cli.json  (`rootDir` は `.`、`nest-cli.json` の `sourceRoot` は `src`。業務の Service が出力先の直下、main.ts が `src/` にあるので、**ビルドの出力は `dist/src/main.js`** になる。雛形の Dockerfile と compose の起動コマンドは `node dist/src/main`)

  # DB 層 (techStack.backend.orm で分ける。下の「DB と ORM の読み方」。1 つの生成物で混ぜない):
  #   orm: prisma (既定・省略時) — プロジェクトに 1 セット。PRISMA_SCHEMA.md
  prisma/schema.prisma                   (lineage の tables → model。provider は techStack.database.type)
  src/prisma/prisma.service.ts           (PrismaClient を継承した @Injectable)
  src/prisma/prisma.module.ts            (@Global の Module。AppModule で 1 回 import)
  #   orm: typeorm — ENTITY.md。prisma/ と src/prisma/ は出さない
  entity/<tableName>.entity.ts           (lineage.writes → TypeORM Entity)
  src/database/typeorm.config.ts         (TypeOrmModule.forRoot の設定。AppModule で 1 回 import)

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

- `ai-skills/generate-code/golden-examples/order-confirm-spring-boot/`
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

### 0. designer-time alias (`@this` / `@self`) の事前展開 (#1322 Phase B-3c)

Screen JSON 内の文字列値 (item.value / event.effects[].argumentMapping / showDialog.target 等の TemplateString) に **`@this.<...>` / `@self.<...>`** が含まれる場合がある (`/screen/items/:id` 編集時に補完される、#1301 / #1308)。

ProcessFlow と同じ方針で **生成前に静的 pre-resolve** する:

| 元 ref | 展開先 (canonical) | render 例 (React / Thymeleaf) |
|---|---|---|
| `@this.item.<itemId>.<path>` | screen.items[].id 経由の item 参照 | React: `formState.<itemId>.<path>` / Thymeleaf: `${form.<itemId>.<path>}` |
| `@this.<field>` (top-level: id / name / purpose) | screen.<field> | screen 定数 / page title 等 |
| `@self.<field>.<path>` (screenItem context) | 当該 item の field | React: `this.<field>` (component 内) / Thymeleaf: `${this.<field>}` |

generated code に `@this/@self` の文字列を **残さない**。展開ルールは [docs/spec/process-flow-prefix-system.md §11.3](../../docs/spec/process-flow-prefix-system.md) 参照、ProcessFlow と同じ semantics。

### テンプレート選択

| techStack.frontend | 参照テンプレート |
|---|---|
| thymeleaf | `ai-skills/generate-code/templates/frontend/thymeleaf-bootstrap/PAGE.md` |
| react + next | `ai-skills/generate-code/templates/frontend/react-tailwind-next/PAGE.md` |
| その他 | 「未対応の techStack 組合せです。」と報告して中止 |

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

### layout (業務部品の木) → 画面構造 (layout がある画面ではこちらが一次情報)

Screen JSON に `layout` がある場合、画面の構造はこれに従う。仕様: [docs/spec/screen-layout.md](../../docs/spec/screen-layout.md)。
`design` (旧エディタ GrapesJS / Puck の参照) は読まない。テンプレートは `techStack.frontend` だけで選ぶ。
`layout` が無い画面 (旧形式で未移行) は、Harmony の業務部品デザイナで「旧デザインから自動変換」してから生成する。
`type: "component"` の部品はプロジェクト独自部品の参照: `layout-components.json` の定義を `args` で展開した部品の木として扱い、
同じ定義を使う箇所は再利用可能なコンポーネントとして 1 回だけ生成する ([docs/spec/layout-components.md](../../docs/spec/layout-components.md))。

`layout.nodes` を上から順に、入れ子のまま次のように出力する。部品が参照する項目 (`itemRef`) の定義は `items[]` から取る。

| 部品 | Thymeleaf (Bootstrap) | React (Tailwind) |
|---|---|---|
| `heading` (level 1–3) | `<h1>`〜`<h3>` | `<h1>`〜`<h3>` |
| `text` | `<p>` (tone=muted は `text-muted small`) | `<p>` (muted は `text-slate-500 text-sm`) |
| `section` | `<section class="card">` + `card-header` (title) | `<section>` + 見出し |
| `form` | `<form method="post">` + `row` / `col-md-{12/columns}` で columns 列 | `<form>` + `grid grid-cols-{columns}` |
| `search-panel` | `<form method="get">` (検索条件)。結果一覧は同じ画面の table | `<form>` + 検索 handler |
| `columns` / `column` | `row` / `col-md-{span}` | `grid grid-cols-12` / `col-span-{span}` |
| `tabs` / `tab` | nav-tabs + tab-pane | タブ切替 state |
| `button-bar` | `d-flex gap-2 justify-content-{align}` | `flex gap-2 justify-{align}` |
| `field` | items マッピング (下表) で入力 / 表示要素 | 同左 |
| `table` | `<table th:each>`。列は `presentation.columns` または `viewDefinitionId` のビュー定義 | テーブルコンポーネント |
| `button` | `itemRef` の項目の `events[]` から送信先 (処理フロー action の httpRoute) を決める。`screenRef` は画面遷移リンク | 同左 |
| `link` | `<a th:href="@{<遷移先画面の path>}">` | `<Link href>` |
| `message-area` | 処理結果・エラー表示領域 (flash / BindingResult) | エラー / 通知表示領域 |
| `html` | `props.html` をそのまま出力 (旧形式から変換できなかった部分) | JSX に変換して出力 |

`note` (設計メモ) は生成時の補足指示として扱い、コードコメントとして必要な箇所に残す。

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

生成 `package.json` の `dependencies` は **caret prefix (`^`) を必須** とする。固定 version で hardcode すると security patch が自動追従されず `npm audit` で警告が残り続ける (PR #1034 の Phase D dogfood で発覚、#1035 E で解消)。

| dependency | 推奨レンジ | 備考 |
|---|---|---|
| `next` | `^15.5.x` 系最新 patch | Next.js 15 系最新。14 LTS では `<15.x` range の advisories が複数残存するため 15 を default 推奨 |
| `react` / `react-dom` | `^19.x` | React 19 stable (Next.js 15 default) |
| `@types/react` / `@types/react-dom` | `^19.x` | React 19 に合わせて型定義も 19 系へ |
| `typescript` | `^5.x` | TypeScript 5 系最新 patch |
| `tailwindcss` | `^3.4.x` | Tailwind 3 系最新 patch |
| `postcss` (overrides) | `^8.5.x` | next の transient で `<8.5.10` の advisories が出るため `overrides` で強制最新化 |
| `@nestjs/common` / `@nestjs/core` / `@nestjs/platform-express` / `@nestjs/testing` / `@nestjs/cli` | `^11.x` | NestJS 11 系で確かめた (12 以降は未確認) |
| `prisma` / `@prisma/client` (`orm: prisma`) | `^6.19.x` | **6 系に固定**。`latest` は 7 以降で schema の書き方が変わる (`PRISMA_SCHEMA.md`「依存パッケージ」)。`dependencies` に入れる |

**重要**: `package.json` に `"overrides": { "postcss": "^8.5.x" }` を**必ず**含めること (transient postcss の advisories を解消する唯一の方法)。これが無いと next 内部の古い postcss が pickup されて `npm audit` で moderate 警告が残る。

**npm 12 以降は、依存の install スクリプトが既定で止まる** (雛形の Dockerfile は `npm install -g npm@latest` で npm 12 を使うので、生成したアプリの `npm ci` も同じ)。生成した `package.json` に `allowScripts` を入れて、どれを許すかを決めて残す。手で書かず、npm に書かせる。

1. `npm install` のあと `npm install-scripts ls` で、止まったものを見る (止まったものは `npm install` の末尾にも警告で出る)
2. 動くのに要るものは `npm install-scripts approve <pkg>` (`allowScripts` に `"<pkg>@<版>": true` が入る)。要らないものは `npm install-scripts deny <pkg>` (`false` が入り、警告が消える)
3. 要るかどうかは、止めたまま動かして決める。確かめた例 (npm 12.2.1 / Node 26): `prisma`・`@prisma/client`・`@prisma/engines` (6.19) は止まっても `prisma generate`・`prisma db push`・クエリが動くので `deny`。`bcrypt` 6 も止まったまま動くが、`bcrypt` 5 は止まると読み込みで失敗する (`bcrypt_lib.node` が無い) ので `approve`。`orm: typeorm` で `database.type=sqlite` のときの `better-sqlite3` (12.x) は、止まると読み込みで失敗する (`Could not locate the bindings file`) ので `approve` する。**`approve` は `allowScripts` に書くだけで、その場では install スクリプトを走らせない**ので、すぐ動かすなら続けて `npm rebuild better-sqlite3` する (`approve` のあとの `npm ci` / `npm install` では、最初から走る。確かめた: node 26 / npm 12.2.1)。Prisma は `prisma` を `devDependencies` ではなく `dependencies` に入れる (本番イメージの `npm ci --omit=dev` の後で `prisma db push` / `prisma generate` を使うため)

**App Router async API 注記**: Next.js 15 では `cookies()` / `headers()` / `params` / `searchParams` が **Promise 返却** に変更。Page / Layout / Route Handler で:

```typescript
// Next.js 15 形式 (Page Component)
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const { q } = await searchParams;
  // ...
}

// Route Handler
import { cookies, headers } from 'next/headers';
export async function GET() {
  const cookieStore = await cookies();
  const headersList = await headers();
  // ...
}
```

generate-code は **Next.js 15 形式で生成** する。生成時に Page Component の `params` / `searchParams` 型を `Promise<...>` で記述し、本体で `await` する。

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
詳細テンプレートは `ai-skills/generate-code/templates/frontend/thymeleaf-bootstrap/LAYOUT.md` を参照。

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
詳細テンプレートは `ai-skills/generate-code/templates/frontend/react-tailwind-next/LAYOUT.md` を参照。

### ゴールデン出力参照

- `ai-skills/generate-code/golden-examples/product-search-thymeleaf/product-search.html`
  - Screen `product-search` (商品検索, kind=search) のゴールデン

## Step 3-C: Gadget 生成パス (Screen.purpose=gadget)

Step 1.5 で `purpose === "gadget"` にルーティングされた場合、以下の手順で Gadget コードを生成する。

詳細テンプレートは以下を参照:
- Thymeleaf 系: `ai-skills/generate-code/templates/frontend/thymeleaf-bootstrap/FRAGMENT.md`
- NestJS/Next.js 系: `ai-skills/generate-code/templates/frontend/react-tailwind-next/COMPONENT.md`

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

#### auth.method=session 時の logout action 重複回避ルール (#1039 M-1 解消、#1036 NestJS 分岐追加)

ProcessFlow の `act-logout` action (httpRoute `POST <logoutPath>`) は、**`techStack.auth.method = "session"` の場合は GadgetController / Route Handler 側で生成しない**。理由:

- Step 3-A の「認証 (techStack.auth) 生成ルール」が認証フレームワーク側で同 path を処理する
  - Java (#1035 S-3 解消後): **SecurityConfig の `.logoutRequestMatcher(...)` が `LogoutFilter` 経由で処理** (AuthController は生成しない)
  - NestJS: `src/auth/auth.controller.ts` が `req.logout()` + `req.session.destroy()` で処理
- GadgetController / Route Handler と認証フレームワークの両方が同 path を処理すると、起動時エラーまたは二重処理が発生する
  - Java: `RequestMappingHandlerMapping` の Ambiguous handler 例外、または LogoutFilter と Controller の競合で予期せぬ挙動
  - NestJS: 同 path への Route Handler と AuthController の両登録でリクエスト競合

分岐ロジック (Java + NestJS 共通):

```
For each action in processFlow.actions where action.id == "act-logout":
  if techStack.auth.method == "session":
    SKIP: GadgetController (Java) / Route Handler (NestJS) に当該 action の handler を生成しない
          - Java: SecurityConfig の LogoutFilter が path を処理 (AuthController.java も生成しない、#1035 S-3)
          - NestJS: AuthController (src/auth/auth.controller.ts) が path を req.logout で処理
          - 両 stack とも form 側 (Fragment HTML / page.tsx) の <form action="<logoutPath>"> は維持
          - Java は Spring Security の LogoutFilter が path 一致で先回りして処理する
          - NestJS は Next.js の app/api/gadgets/<gadget-id>/logout/route.ts は生成しない
  elif techStack.auth.method in ("none", undefined):
    GENERATE: 従来通り GadgetController (Java) / Route Handler (NestJS) に生成
              - Java: @PostMapping("<logoutPath>") + HttpSession.invalidate() 形式
              - NestJS: app/api/gadgets/<gadget-id>/logout/route.ts として生成
```

他の通常 action (act-* で logout 以外) は両 auth.method・両 stack で従来通り GadgetController / Route Handler に生成する。

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
- Thymeleaf 系: `ai-skills/generate-code/templates/frontend/thymeleaf-bootstrap/LAYOUT.md`
- NestJS/Next.js 系: `ai-skills/generate-code/templates/frontend/react-tailwind-next/LAYOUT.md`

### PageLayout JSON から読み取る情報

```
PageLayout JSON:
  id, name
  regions[]: { id, name, order }         — header / sidebar / main / footer 等
  assignments: { [regionId]: gadgetScreenId }  — region → Gadget 対応
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
//   <pageLayoutId> = `main-layout`, assignments[header] = `global-header-gadget` の場合:
//   import HeaderGadget from '@/app/components/gadgets/global-header-gadget';
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
ai-skills/generate-code/templates/
  backend/java-spring-boot/
    SERVICE.md    — Service クラス生成ルール
    REPOSITORY.md — Repository インターフェース生成ルール
    CONTROLLER.md — Controller クラス生成ルール
    ENTITY.md     — JPA Entity クラス生成ルール
    MIGRATION.md  — Flyway SQL DDL 生成ルール
    AI_SERVICE.md — AI runtime service 生成ルール (Phase 2-C、aiCall/aiAgent 含有時)
    maven-wrapper/  — Apache Maven Wrapper 3.3.2 canonical files (#1050、Spring Boot 出力時に verbatim コピー)
      mvnw / mvnw.cmd / .mvn/wrapper/maven-wrapper.properties / README.md
  backend/typescript-nestjs/
    SERVICE.md    — Service クラス生成ルール (dbAccess / transactionScope は ORM ごとの節)
    CONTROLLER.md — Controller + DTO 生成ルール
    PRISMA_SCHEMA.md — Prisma schema.prisma + PrismaService 生成ルール (orm: prisma、省略時の既定)
    ENTITY.md     — TypeORM Entity + Module + 接続設定の生成ルール (orm: typeorm のときだけ)
    AI_SERVICE.md — AI runtime service 生成ルール (Phase 2-C、aiCall/aiAgent 含有時)
  frontend/thymeleaf-bootstrap/
    PAGE.md       — Thymeleaf HTML テンプレート生成ルール (kind 別パターン + Layout Decorate モード)
    LAYOUT.md     — PageLayout passive layout 生成ルール (Step 3-D 用)
    FRAGMENT.md   — Gadget fragment + GadgetController 生成ルール (Step 3-C 用)
  frontend/react-tailwind-next/
    PAGE.md       — Next.js App Router ページ生成ルール (kind 別パターン + Layout Wrap モード)
    LAYOUT.md     — Custom AppLayout component 生成ルール (Step 3-D 用、default export、Server Component)
    COMPONENT.md  — Gadget client component + Route Handler 生成ルール (Step 3-C 用)
  devcontainer/                  — プロジェクト scaffold (#1048、Step 5.5 で参照)
    spring-boot-thymeleaf/       — JDK 21 + Maven + Node features 構成 (#1050 で 17→21)
    spring-boot-nextjs/          — 同上 + Next.js dev server forward
    nestjs-thymeleaf/            — Node 26 + github-cli のみの最小構成 (稀組合せ)
    nestjs-nextjs/               — Node 26 構成 + Next.js dev server forward (単一 package.json、#1050 で再構成)
```

## Step 5: コード生成 + 出力先への書き出し

各生成ファイルを Write ツールで `<出力先>/` に書き出す。

### 命名規則

| ProcessFlow / Screen 値 | ファイル名 |
|---|---|
| `meta.name: "注文確定"` | `OrderConfirmService.java` / `order-confirm.service.ts` |
| `tables[].physicalName: "orders"` | `Order.java` / `orders.entity.ts` (orm: typeorm のとき) / Prisma の `model Order` + `@@map("orders")` (orm: prisma のとき) / `V1__create_orders.sql` |
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

1. `harmony.json` (または旧 `project.json` の legacy 環境) の `entities.processFlows[]`, `entities.screens[]`, `entities.pageLayouts[]` から全 ID を抽出
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
| Screen | product-search | 商品検索 | 必須フィールド `kind` 欠落 (Step 2 validation) |

## 成功 entity (種別別カウント)

- PageLayout: 1/1
- Screen: 10/11
- ProcessFlow: 6/6
```

**bulk モード時の smoke 検証 (Step 6)**: 各 entity の smoke は同様に実行するが、結果は bulk-report.md に集計のみ記載。個別 entity 単位の詳細レポートは生成しない。

## Step 5.5: プロジェクト scaffold 生成 (Dev Containers / Docker、#1048)

### 目的

`/generate-code` の出力アプリには、採用プロジェクト B チーム (5-20 名) が `git clone && Reopen in Container` で即 dev 環境完成できる構成を含める。**entity 単位の Step 1-6 とは独立**、**1 プロジェクトに 1 回**生成する scaffold ファイル群。

### 生成タイミング

- 単発モード (`/generate-code <id> <出力先>`): ファイルごとに、まだ無いものだけ生成する (判定はステップ 3 の「既存 scaffold check」)。すでにあるファイルは飛ばし、「既存 scaffold を上書きしません」と報告
- bulk モード (`--all` / `--workspace`): 最初の entity 出力時に 1 度だけ scaffold 生成、以降の entity では skip

### ファイル責務分離

| File | 用途 | 配布対象 | techStack 依存 |
|---|---|---|---|
| `.devcontainer/devcontainer.json` | 開発時 (Reopen in Container)。compose 形式 (`dockerComposeFile: compose.yml`、`service: dev`) | B チーム (開発者) | Yes (4 組合せ) |
| `.devcontainer/compose.yml` | 開発コンテナ (`dev`) と Harmony (`harmony`、配布 image・ネットワーク共有) の 2 サービス (#1561)。Harmony の版は `image:` の既定値を書き換えて固定する (git で共有) | B チーム (開発者) | `dev` の image だけ Yes |
| `.mcp.json` | dev の AI CLI から Harmony の MCP (`http://localhost:5179/mcp`) と、ブラウザの自動操作の Playwright MCP (`playwright` / `playwright-headed`、#1573) に接続する設定 | B チーム (開発者) | No |
| `.tmp/.gitignore` | Playwright MCP の出力先 `.tmp/playwright-mcp/` を git に入れない (`*` と `!.gitignore`、#1573) | B チーム (開発者) | No |
| `Dockerfile` | 本番 image build | エンドユーザー (顧客本番) | Yes (java/node) |
| `docker-compose.yml` | 本番 stack 起動 (app + DB) | エンドユーザー (顧客本番) | Yes |
| `README.md` (scaffold セクション追記) | 開発者向け手順書 | B チーム | No (定型) |

**Harmony の同居 (#1561)**: 4 組合せすべてで、開発コンテナ (`dev`) と Harmony (`harmony`) を compose で同居させる。`harmony` は `network_mode: service:dev` (dev の localhost:5179 で届く) で、プロジェクトのフォルダを dev と同じパス `/workspaces/app` に bind mount する。これでプロジェクトのルートがそのまま Harmony のワークスペース (`harmony.json` + `design/`、ソースは同じフォルダの中) になり、`designer__record_generation` / `designer__check_generation_drift` が今のまま使える。ファイルの持ち主は dev・harmony とも uid 1000 (`node` / `vscode`) で、いまはホストのユーザー ID が 1000 のとき (WSL2 の既定のユーザー、Docker Desktop など) を前提とする。それ以外の Linux は既知の制約。手順: [docs/setup/app-devcontainer-sidecar.md](../../docs/setup/app-devcontainer-sidecar.md)

**Phase 1 では `Dockerfile.dev` を作らない** — dev container は MS 公式 base image + features + `postCreateCommand` 構成 (Harmony 本体 #847 / PR #1047 と同じ方針)。pre-build しない代わりに初回 6-12 分 (features install + ブラウザ) を許容し、`Dockerfile.dev` のメンテナンスコストを払わない。

### 境界線テンプレ (container 内 vs 別コンテナ)

- **container 内に持つ runtime**: app の起動に必要なもの (JDK / Node / Maven / npm / git / gh)
- **docker-compose.yml で別コンテナ化**: state-ful サービス (Postgres / Redis / Mail / MinIO 等)
- dev container は docker-compose の DB だけ参照する設計 (`forwardPorts` で 5432 を内部接続)
- Harmony は設計ツールで、業務アプリの runtime ではない。開発用の `.devcontainer/compose.yml` に置き、本番の `docker-compose.yml` には入れない

### techStack 組合せ別テンプレ (4 組合せ)

判定キー: `techStack.backend.framework` ∈ {`spring-boot`, `nestjs`} × `techStack.frontend.library` ∈ {`thymeleaf`, `react`}

| backend × frontend | base image | features 追加 (基本) | features 追加 (AI CLI、#1111) | docker-compose default |
|---|---|---|---|---|
| spring-boot × thymeleaf | `mcr.microsoft.com/devcontainers/java:1-21-bookworm` | `java:1` (version 21, installMaven true)、`node:1`、`github-cli:1` | `claude-code:1.0`、`copilot-cli:1.1.2` + postCreateCommand で `codex` npm 同梱 | postgres:15 |
| spring-boot × nextjs | 同上 | 同上 (Next.js dev server に Node 必須) | 同上 | 同上 |
| nestjs × thymeleaf | `mcr.microsoft.com/devcontainers/typescript-node:26` | `github-cli:1` のみ (NestJS が SSR するため Maven 不要、最小構成) | 同上 | `techStack.database.type` に従う (postgresql: `postgres:15` / mysql: `mysql:8` / sqlite: DB サービスなし)。下の「DB ごとのブロック」 |
| nestjs × nextjs | `mcr.microsoft.com/devcontainers/typescript-node:26` | `github-cli:1` | 同上 | 同上 |

> nestjs × thymeleaf 組合せは稀。当面は最小テンプレ提供で、需要が顕在化したら拡充。

### AI CLI 3 種同梱 + 永続化 4 種方針 (#1111 / #1114)

業務アプリ開発者は持っているサブスクが異なるため、**claude-code / codex / copilot-cli の 3 種を全 template にデフォルト install** する。利用者は手持ちのサブスクの CLI だけ login して使う。Harmony 本体 `.devcontainer/devcontainer.json` (#1097 / #1107 で確立) と統一したパターン:

- **claude-code**: `ghcr.io/anthropics/devcontainer-features/claude-code:1.0` feature
- **codex**: feature 未提供のため `postCreateCommand` で `npm install -g @openai/codex`
- **copilot-cli**: `ghcr.io/devcontainers/features/copilot-cli:1.1.2` feature (gh auth に依存)

認証 + session/memory 永続化用 bind mount 4 種 (Harmony 本体と統一):

- `${localEnv:HOME}/.agent-containers/${localWorkspaceFolderBasename}/.claude` → `/home/<user>/.claude` (Anthropic OAuth + sessions + memory)
- `${localEnv:HOME}/.agent-containers/${localWorkspaceFolderBasename}/.codex` → `/home/<user>/.codex` (OpenAI OAuth + sessions + history)
- `${localEnv:HOME}/.agent-containers/${localWorkspaceFolderBasename}/.copilot` → `/home/<user>/.copilot` (Copilot CLI session-state + command-history-state.json + memory、#1114 で追加) ← **Copilot CLI 公式 default、`COPILOT_HOME` で上書き可**
- `${localEnv:HOME}/.config/gh` → `/home/<user>/.config/gh` (GitHub CLI auth、Copilot CLI の認証元、`gh` 単体でも有用)

**ブラウザの自動操作 (Playwright MCP、#1573)**: 4 組合せすべてに既定で入れる。AI が画面を開いて確かめる・E2E の確認に使う。
- `.mcp.json`: `playwright` (headless。ふだん使う) と `playwright-headed` (人が「画面を見たい」と言ったときだけ)。どちらも `npx -y @playwright/mcp@latest --isolated --browser chromium --output-dir /workspaces/app/.tmp/playwright-mcp` (headless は `--headless` 付き)
- `devcontainer.json`: `postCreateCommand` の末尾で `(npx -y -p @playwright/mcp@latest playwright install --with-deps chromium || echo '<入れられなかった旨の案内>')` (依存ライブラリは初回だけ。失敗しても `|| echo` で postCreate 全体を止めない)。`postStartCommand` で起動のたびに `(playwright install chromium >/dev/null 2>&1 || echo '<案内>')` (最新の MCP に合うブラウザを入れ直す。入っていれば数秒で出力なし、失敗したときだけ案内を出す。起動は止めない。postStart の出力を捨てるのは、Playwright が依存を入れていないプロジェクトで毎回出す英語の WARNING 枠が、失敗に見えるため (#1579)。postCreate は apt の進み具合が見えるよう出力を残すので、**初回の postCreate のログだけ**にその WARNING が 1 回出る。無視してよい (ブラウザは入っている) と README にも書く)
- `compose.yml`: `dev` に WSLg の X11 (`/tmp/.X11-unix`・`/mnt/wslg`・`DISPLAY=":0"`) を渡す。headed の窓を Windows のデスクトップに出すため (Harmony 本体の開発コンテナと同じ。Windows + WSL2 + Docker Desktop 前提)。プロジェクトのフォルダは WSL の中に置いて WSL から開く (Windows 側から開くと窓が出ない)。macOS / Linux native では 4 行 (volumes の `/tmp/.X11-unix` と `/mnt/wslg` の 2 行、`environment:` と `DISPLAY` の 2 行) を消す (Docker Desktop for Mac など共有されていないパスでは、消さないと起動しないおそれがある。Linux native では空のフォルダができるだけ。NestJS の雛形は `environment:` に `DATABASE_URL` などが続くことがあるので、そのときは `environment:` の行を残して `DISPLAY` の行だけ消す)。`WAYLAND_DISPLAY` は設定しない
- `.tmp/.gitignore`: スナップショット・スクリーンショットの出力先 `.tmp/playwright-mcp/` を git に入れない
- generate-tests の E2E (`@playwright/test`) は別に `npx playwright install chromium` で自分の版のブラウザを入れる (MCP と版が違うと Chromium が 2 つ入る。そろえない)
- 自動のブラウザも Harmony の「開いている画面」(画面のつながり) に数えられる。`designer__workspace_close` のような確認では考えに入れる

`onCreateCommand` で chown (mount 先の所有権を user に揃える)、`postCreateCommand` で `~/.claude/.config.json` 空ファイル作成 (Claude wizard 抑制 workaround #1097)、`containerEnv` で `DISABLE_AUTOUPDATER=1` (rebuild ごとの自動更新を抑制)。

`<user>` は template ごとに違う (`spring-boot-*` は `vscode`、`nestjs-*` は `node`)。chown / mount target の path はそれぞれ調整。

### postCreateCommand

| techStack | postCreateCommand |
|---|---|
| spring-boot 系 | `./mvnw -B dependency:resolve 2>/dev/null \|\| mvn -B dependency:resolve \|\| true` (mvnw 優先 + Java feature 同梱 mvn fallback。Spring Boot 出力には #1050 で mvnw 同梱されるが旧出力との互換のため fallback 残置) |
| nestjs 系 | `([ -f package.json ] && npm install \|\| true) && ([ -f prisma/schema.prisma ] && npx prisma generate \|\| true)` (root 単一 package.json 構造、#1050 で確認。設計だけでまだ生成前でも止まらず、Prisma のスキーマがなければ prisma を取りに行かない)。この行は ORM のブロックで選ぶ (雛形に `orm: prisma` 用と `orm: typeorm` 用の 2 行ある)。`orm: typeorm` の行には `prisma generate` が無く、拡張 `Prisma.prisma` も入らない (Prisma の記述が TypeORM の生成物に出ないようにするため) |

### forwardPorts (default)

全組合せに Harmony の画面 `5179` (`Harmony (設計)`) を先頭に足す (#1561)。以下は業務アプリ側のポート:

| techStack 組合せ | ports |
|---|---|
| spring-boot × thymeleaf | `8080`, `5432` (Postgres aspirational) |
| spring-boot × nextjs | `8080` (Spring app), `3000` (Next.js dev), `5432` |
| nestjs × thymeleaf | `3000` (NestJS が SSR。DB は開発コンテナの中のサービスなので forward しない) |
| nestjs × nextjs | `3001` (NestJS API), `3000` (Next.js dev、english-learning-tailwind 実構造、#1050) |

### docker-compose.yml (本番用、最小構成)

```yaml
services:
  app:
    build: .
    ports: ["${APP_PORT:-8080}:8080"]
    environment:
      DATABASE_URL: postgres://app:app@db:5432/app
    depends_on: [db]
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    volumes: ["db-data:/var/lib/postgresql/data"]
volumes:
  db-data:
```

上は Spring Boot 系 (PostgreSQL 固定) の形。NestJS 系の `docker-compose.yml` は、雛形の「DB ごとのブロック」を `techStack.database.type` と `techStack.backend.orm` で選んで作る (上の例のようには固定しない)。

### README.md セクション (生成アプリ用、scaffold 一部)

`<出力先>/README.md` に以下のセクションを必ず含める (既存 README が無ければ新規作成、あれば「## 開発環境」「## 本番デプロイ」の 2 セクションを冒頭に追記):

````markdown
## 開発環境 (Dev Containers)

VSCode + Dev Containers 拡張があれば、`git clone` 後に `Reopen in Container` で即環境完成。

1. 前提: Docker Desktop + VSCode + Dev Containers 拡張 (`ms-vscode-remote.remote-containers`)
2. `code .` → 右下のポップアップで「Reopen in Container」をクリック
3. 初回は 6-12 分 (features install + 依存解決 + ブラウザ (Chromium))
4. ターミナルで起動:
   - spring-boot 系: `./mvnw spring-boot:run 2>/dev/null || mvn spring-boot:run` (Maven Wrapper 同梱 or feature 同梱 mvn いずれでも起動)
   - nestjs 系 (単一 package.json、english-learning-tailwind パターン): `npm run start:backend` + 別ターミナル `npm run start:frontend`
   - nestjs 系 (NestJS 単独 thymeleaf): `npm run start:dev`
   - nestjs 系の DB の初期化 (表づくり): 雛形の `README.snippet.md` の「DB 初期化」(ORM と `techStack.database.type` で変わる。Prisma は `npx prisma db push`、TypeORM は起動時の `synchronize`) をそのまま使う
5. ブラウザで http://localhost:<port> (port は `.devcontainer/devcontainer.json` の forwardPorts 参照)

詳細: [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json)

## 設計ツール (Harmony)

開発コンテナと同時に Harmony (設計ツール) が起動します。画面は VS Code のポート転送 `5179` (`http://localhost:5179/`)、AI CLI からは `.mcp.json` の `http://localhost:5179/mcp` で使います。初回はワークスペースを作る (`designer__workspace_open { path: "/workspaces/app", init: true, dataDir: "design" }`)。版は `.devcontainer/compose.yml` の `image:` の既定値を書き換えて固定する。詳細は Harmony の `docs/setup/app-devcontainer-sidecar.md`。

## ブラウザの自動操作 (Playwright MCP)

AI が画面を開いて確かめられます。`.mcp.json` の `playwright` (headless、ふだん使う) と `playwright-headed` (人が「画面を見たい」と言ったときだけ。Windows のデスクトップに窓が開く。Windows + WSL2 + Docker Desktop 前提で、フォルダは WSL の中に置いて WSL から開く。macOS / Linux native は `.devcontainer/compose.yml` の WSLg の 4 行 (volumes の 2 行、`environment:` と `DISPLAY` の 2 行) を消して headless だけ使う) があります。Harmony の画面 `http://localhost:5179` も業務アプリもそのまま開けます。ブラウザは起動のたびに入れ直します（出力は出さず、失敗したときだけ案内が出ます）。初回の postCreate のログに出る WARNING (`npx playwright install without first installing your project's dependencies`) は無視してよい (ブラウザは入っている)。「ブラウザが無い」と出たら `npx -y -p @playwright/mcp@latest playwright install chromium`。スナップショット・スクリーンショットは `.tmp/playwright-mcp/` (git に入りません)。E2E (`@playwright/test`) のブラウザは別に `npx playwright install chromium` で入れます。自動のブラウザも Harmony の「開いている画面」に数えられます。

## 本番デプロイ (Docker)

```bash
docker compose up --build
```

`Dockerfile` は本番用、dev は `.devcontainer/` を参照。
````

### テンプレート配置

```
ai-skills/generate-code/templates/devcontainer/
  spring-boot-thymeleaf/
    .devcontainer/devcontainer.json
    .devcontainer/compose.yml
    .mcp.json
    .tmp/.gitignore
    Dockerfile
    docker-compose.yml
    README.snippet.md
  spring-boot-nextjs/
    .devcontainer/devcontainer.json
    .devcontainer/compose.yml
    .mcp.json
    .tmp/.gitignore
    Dockerfile
    docker-compose.yml
    README.snippet.md
  nestjs-thymeleaf/
    .devcontainer/devcontainer.json
    .devcontainer/compose.yml
    .mcp.json
    .tmp/.gitignore
    Dockerfile
    docker-compose.yml
    README.snippet.md
  nestjs-nextjs/
    .devcontainer/devcontainer.json
    .devcontainer/compose.yml
    .mcp.json
    .tmp/.gitignore
    Dockerfile
    docker-compose.yml
    README.snippet.md
```

各テンプレは **静的ファイル** (placeholder は最小、必要なら `__APP_NAME__` 程度)。AI は組合せ判定後にコピーするのみで、AI 生成のブレ (memory: 決定的変換は TS script に集約) を防ぐ。**テンプレート自身が golden output を兼ねる** — 出力 scaffold ファイルはテンプレ verbatim のため、別途 `golden-examples/` への複製は行わない (二重メンテ回避)。

**例外: NestJS 系 (`nestjs-thymeleaf` / `nestjs-nextjs`) は「DB ごとのブロック」だけ消して写す。** 次の節を参照。

#### DB ごとのブロック (NestJS 系の雛形。`techStack.database.type` と `techStack.backend.orm` で選ぶ)

NestJS 系の雛形は、DB の種類 (postgresql / mysql / sqlite) と ORM (prisma / typeorm) で変わる箇所 (compose.yml の DB サービス、`DATABASE_URL`、README の「DB の初期化」、Dockerfile の Prisma の行) を、**ブロックとして雛形の中に全部入れてある**。写すときは、techStack に合うブロックを残し、合わないブロックを**中身ごと消す**。書き足し・書き換えはしない。

| ファイル | マーカーの書き方 |
|---|---|
| `docker-compose.yml`・`.devcontainer/compose.yml`・`Dockerfile` | `# @db <種別>[,<種別>]` ... `# @end-db`、`# @orm <名前>` ... `# @end-orm` |
| `.devcontainer/devcontainer.json` (JSONC。`postCreateCommand` と拡張 `Prisma.prisma` が `@orm` だけ持つ) | `// @orm <名前>` ... `// @end-orm` (`@db` は持たない) |
| `README.snippet.md` | `<!-- @db <種別>[,<種別>] -->` ... `<!-- @end-db -->`、`<!-- @orm <名前> -->` ... `<!-- @end-orm -->` |

規則 (機械的に適用する。迷う余地を残さない):

1. 種別は `techStack.database.type` (省略時 `postgresql`)、名前は `techStack.backend.orm` (省略時 `prisma`) と比べる。`@db` の種別はカンマ区切りで複数書ける (`postgresql,mysql`)
2. **一致するブロック**は、マーカー行 (開始行と終了行) だけ消して、中身を残す
3. **一致しないブロック**は、マーカー行と中身をまとめて消す
4. ブロックは入れ子になる (`@orm` の中に `@db`、またはその逆)。外側が一致しなければ、内側ごと消える
5. マーカーの行以外は、一切変えない。インデントも空行もそのまま
6. マーカーを全部処理したあと、`@db` `@orm` `@end-db` `@end-orm` のマーカー行が 1 行も残っていないこと、`docker compose -f <ファイル> config` が使えるときは通ることを確かめる

この規則で写すと、2 つの ORM は混ざらない (`orm: typeorm` の `docker-compose.yml` / `Dockerfile` / README / `devcontainer.json` に `prisma` は出ない。`orm: prisma` に `typeorm` / `DB_SYNCHRONIZE` は出ない)。`.mcp.json` はブロックを持たない (そのまま写す)。

**この方式を選んだ理由** (DB ごとに雛形のフォルダを分けない / `__DB__` のような差し替え文字にしない):

- `designer__record_scaffold` / `designer__get_scaffold_update` と、雛形の版 (組合せのフォルダの全ファイルの SHA-256) は、組合せ (`nestjs-nextjs` など 4 つ) ごとのフォルダを単位にしている。DB ごとにフォルダを分けると、組合せが 4 → 10 に増え、backend の組合せの一覧 (`SCAFFOLD_COMBOS`)・記録の形・点検・試験を変えることになる。ブロック方式なら backend は 1 行も変えず、雛形の版は今のまま「フォルダの中身のハッシュ」で決まる
- 差し替え文字は、複数行 (`depends_on` / `volumes` / DB サービス丸ごと) を AI が組み立てることになり、書き方がぶれる。ブロックは「消すだけ」なので、結果が一意に決まる
- 雛形そのもの (全ブロックが入った状態) は、そのままでは 1 つの YAML として有効でない (キーが重なる)。写した結果 (ブロックを消したあと) が有効であることを、`backend/src/generateCodeTemplates.test.ts` が組合せ × DB × ORM の全部で確かめている

**雛形の記録と更新** (`designer__record_scaffold` / `designer__get_scaffold_update`): 記録には雛形の中身 (ブロック入り) が残り、アプリのファイルはブロックを消した後の形になる。そのため、`designer__get_scaffold_update` の 3 方向の差分では、ブロックを消した部分が「利用者の手入れ」に見える。これは雛形の規則による差で、手入れではない。更新を取り込むときは、新しい雛形にも**同じ規則**でブロックを消してから、アプリのファイルと比べる。`techStack.database` や `techStack.backend.orm` を変えたときの取り込みも同じ手順で (新しい techStack で消したあとのファイルを、いまのアプリのファイルに当てる)。

### 実行手順

1. **techStack 判定**: `harmony.json` (または旧 `project.json` の legacy 環境) の `techStack.backend.framework` と `techStack.frontend.library` を Read で取得。NestJS 系 (`nestjs`) では、あわせて `techStack.database.type` と `techStack.backend.orm` も取得する (読み方は「DB と ORM の読み方」)
2. **テンプレ選択**:

   | backend.framework | frontend.library | 選択テンプレ |
   |---|---|---|
   | `spring-boot` | `thymeleaf` | `templates/devcontainer/spring-boot-thymeleaf/` |
   | `spring-boot` | `react` | `templates/devcontainer/spring-boot-nextjs/` |
   | `nestjs` | `thymeleaf` | `templates/devcontainer/nestjs-thymeleaf/` |
   | `nestjs` | `react` | `templates/devcontainer/nestjs-nextjs/` |

3. **既存 scaffold check (ファイルごとに判定する)**: 置き場所は 2 つ。ワークスペースのルート (`harmony.json` のあるフォルダ) と `<出力先>`。出力先をルート直下にしたときは同じ場所になる。
   - `.devcontainer/` (devcontainer.json・compose.yml) と `.mcp.json` は、**常にワークスペースのルート**に置く。ルートに `.devcontainer/devcontainer.json` があれば `.devcontainer/` は作らない。ルートに `.mcp.json` があれば `.mcp.json` も作らない (`mcpServers.harmony` に加えて `playwright` / `playwright-headed` (雛形の `.mcp.json` の該当項目) を足す案内だけ最終レポートに書く)。ルートに `.devcontainer/` があって飛ばしたときは、雛形の `postCreateCommand` / `postStartCommand` の Playwright の行と `compose.yml` の WSLg の 4 行 (volumes の 2 行、`environment:` と `DISPLAY` の 2 行) を足す案内も書く。`.tmp/.gitignore` もワークスペースのルートに置く (すでにあれば飛ばす)。出力先を `backend/` などにしても、`backend/.devcontainer/` を入れ子で作らない
   - `Dockerfile`・`docker-compose.yml` は**出力先**に置く。出力先にすでにある**ファイルだけ**を飛ばす (上書きしない)。無いほうは作る
   - 飛ばしたファイルは「既存のため飛ばした」と最終レポートに書く
4. **ファイルコピー**: 選択したテンプレディレクトリ配下の以下を Read → Write で verbatim コピー (改変・補完なし、AI 解釈なし)。ただし NestJS 系は、上の「DB ごとのブロック」の規則で、合わないブロックを消してから書く (`.devcontainer/devcontainer.json` は `// @orm` ブロックだけ消す。`.mcp.json`・`.tmp/.gitignore` はブロックを持たないのでそのまま)。ステップ 3 で飛ばすと決めたものは書かない:
   - `.devcontainer/devcontainer.json` → `<ワークスペースのルート>/.devcontainer/devcontainer.json`
   - `.devcontainer/compose.yml` → `<ワークスペースのルート>/.devcontainer/compose.yml`
   - `.mcp.json` → `<ワークスペースのルート>/.mcp.json`
   - `.tmp/.gitignore` → `<ワークスペースのルート>/.tmp/.gitignore` (すでにあれば飛ばす)
   - `Dockerfile` → `<出力先>/Dockerfile`
   - `docker-compose.yml` → `<出力先>/docker-compose.yml`
5. **README.md 統合**:
   - `<出力先>/README.md` 既存 → 冒頭 (最初の `# ` 見出しの直後) に `README.snippet.md` 内容を挿入。ただし README.snippet の節 (`## 開発環境 (Dev Containers)` など) がすでに入っていれば足さない
   - `<出力先>/README.md` 無し → `README.snippet.md` をベースに `# <appName>\n\n` ヘッダを付けて新規 `README.md` 作成
6. **雛形の記録 (#1577)**: コピーのあと `designer__record_scaffold` を呼ぶ。「写した雛形の版と中身」を `design/scaffold.json` に残す (雛形の中身は backend が雛形から読む。渡さない)。後で雛形が新しくなったとき、この記録が「3 方向の差分」の元になる。
   - `combo`: ステップ 2 で選んだ組合せ (techStack から決まるときは省略できる)。`outDir`: 出力先をルート直下以外にしたときだけ (ワークスペースからの相対パス。既定 ".")
   - `skipped`: ステップ 3 で飛ばした (既存のため書かなかった) ファイル、README の節を足さなかったときの `README.snippet.md`。雛形のパス (`Dockerfile`・`.devcontainer/compose.yml`・`.mcp.json` など) で渡す。飛ばしたファイルは中身を記録せず、後の更新で 2 方向 (いまの雛形とアプリ) の比較になる
   - bulk モードでは、最初の scaffold 生成のとき 1 度だけ呼ぶ
7. **最終レポート反映**: Step 5 の per-entity ファイル列挙とは別カテゴリで `### プロジェクト scaffold` セクションを追加、生成したファイルを列挙 (記録したこと・飛ばしたファイルも書く)

### 雛形の更新の取り込み (#1577)

Harmony の雛形が新しくなると、`designer__check_design` の info (section「開発コンテナの雛形」)・`designer__get_project_context` の `scaffold`・画面「連携と運用 → 版と更新」が知らせる。利用者に「開発コンテナの雛形の更新を取り込んで」と頼まれたら、次の順で行う (この手順の対象は、雛形が書くファイル全部: `.devcontainer/` の 2 つ・`.mcp.json`・`.tmp/.gitignore`・`Dockerfile`・`docker-compose.yml`・README の節)。

1. NestJS 系は、先に「DB ごとのブロック」の規則で、新しい雛形(`latest`)のブロックを、いまの `techStack.database.type` / `techStack.backend.orm` で消した形にそろえてから読む (ブロックを消した差は手入れではない)。`designer__get_scaffold_update` を呼ぶ。`status` が `outdated` (雛形が新しくなった) か `no-record` (記録が無い古いアプリ) でなければ、取り込むものは無い。`files[]` のうち `state` が `unchanged` でないものが対象 (`guide` に同じ手順が付く)
2. ファイルごとの差分は、`files[]` の **`diff` (いまのアプリ → 新しい雛形)**・`base` があるときは **`templateDiff` (雛形の変更)** と **`appChanges` (利用者の手入れ)** にある (unified diff)。**自分で差分を作らず、これを利用者に見せる** (`diffTooLarge: true` のファイルだけ、`app` と `latest` を自分で比べる。`diffTruncated` は差分が切れているので同じく自分で読み直す)。比べ方は次のとおり:
   - `base` がある (記録があり、飛ばしていない): **3 方向**。`base`→`latest` が雛形の変更、`base`→`app` が利用者の手入れ。雛形の変更を取り込み、手入れは残す
   - `base` が無い (記録が無い・飛ばしたファイル): **2 方向**。`app` と `latest` の差を、利用者に 1 つずつ見せて選んでもらう (`appEdited` が `null` = 手入れかどうか不明)
   - `state: "new-in-template"` は新しく足すファイル、`"removed-from-template"` は雛形から無くなったファイル (消すかどうかは利用者に聞く)。`kind: "section"` (README) は、`appSection` (README から切り出した節。`appSectionRange` の行) の範囲だけを `latest` の節で差し替え、README の他の部分は触らない (`appSection` が null なら README に節が無いので、`latest` の節を足す)
   - **残すもの**: Harmony の `image:` の版の指定 (`compose.yml`)・利用者が足した service・ポート・環境変数・自分で書いた設定。`truncated: true` のファイルは中身が切れているので、そのファイルは自分で読み直してから比べる
3. **書く前に、ファイルごとの差分を利用者に見せて OK を取る**。OK が無いファイルは書かない
4. 書いたら `designer__record_scaffold` を呼ぶ。書かなかった・見送ったファイルは**必ず** `skipped` に雛形のパスで渡す (省略すると前回の `skipped` のまま。渡さないと、そのファイルの記録が最新の雛形に置き換わり、次の更新で手入れと雛形の変更を取り違える)。記録の版が最新になり、お知らせが消える
5. `.devcontainer/` のファイルを変えたときは、利用者に VS Code の「Dev Containers: Rebuild Container」を頼む (作り直すまで効かない)

### 出力先の運用想定 (project-root model)

`<出力先>` は **業務アプリ project root** を指す設計。生成ファイルは canonical layout で project root 直下に配置され、scaffold (`.devcontainer/` / `.mcp.json` / `Dockerfile` / `docker-compose.yml` / `README.md`) も同じ project root に同居する。この project root が、そのまま Harmony のワークスペース (`harmony.json` + `design/`) にもなる (#1561)。

**`backend/` `frontend/` に分けたい場合**: 既定の配置はプロジェクトのルート直下。`backend/` `frontend/` などのフォルダに分けたいときは、`/generate-code` の `<出力先>` にそのフォルダを渡す。そのときも `.devcontainer/` と `.mcp.json` はワークスペースのルートに置く (`backend/.devcontainer/` のような入れ子は作らない)。本番用の `Dockerfile` / `docker-compose.yml` と README の設計ツールの節は、その出力先のフォルダに作る (すでにあるファイルだけを飛ばす)。ルート直下に出す場合も、開発コンテナの雛形を先に置いてあるだけで、本番用の雛形が作られなくなることはない。

業務アプリ開発者 (Harmony 利用者) 向けの利用者目線の解説は [`docs/user-guide/generate-code-workflow.md`](../../docs/user-guide/generate-code-workflow.md) を参照。本節は AI 実装者向けに design intent と生成後の物理 layout を記述する。

#### canonical layout: Spring Boot backend (java)

frontend は Thymeleaf (同 project root の `src/main/resources/templates/`) or Next.js (別 project root と組み合わせ可)。下例は frontend=thymeleaf の場合:

```
<出力先>/                              ← 業務アプリ project root (例: ~/projects/retail-app/)
├── .devcontainer/
│   ├── devcontainer.json              ← VS Code Dev Container 設定 (compose 形式)
│   └── compose.yml                    ← dev + harmony (設計ツール) の 2 サービス
├── .mcp.json                           ← Harmony の MCP (http://localhost:5179/mcp) + Playwright MCP
├── .tmp/.gitignore                     ← Playwright MCP の出力 (.tmp/playwright-mcp/) を git に入れない
├── Dockerfile                          ← backend container image 定義
├── docker-compose.yml                  ← backend + DB を起動する compose 定義
├── README.md                           ← project README + scaffold セクション
├── pom.xml                             ← Maven build 定義
├── mvnw / mvnw.cmd                     ← Maven Wrapper (#1050、`./mvnw spring-boot:run` で system Maven 不要)
├── .mvn/wrapper/maven-wrapper.properties
└── src/
    ├── main/
    │   ├── java/com/example/<projectName>/
    │   │   ├── controller/             ← @RestController / @Controller
    │   │   ├── service/                ← @Service (Transactional)
    │   │   ├── repository/             ← Spring Data JPA Repository
    │   │   ├── entity/                 ← @Entity (JPA)
    │   │   ├── dto/                    ← Request / Response DTO (常時)
    │   │   └── ai/                     ← AiRuntimeService / AiCatalogService (AI step あり時のみ、#§ AI step kind 検出時)
    │   └── resources/
    │       ├── application.properties  ← Spring Boot 設定 (ISO-8859-1 で日本語不可)
    │       ├── db/migration/           ← Flyway migration SQL (V1__create_*.sql)
    │       └── templates/              ← Thymeleaf HTML (frontend=thymeleaf の場合のみ)
    │           ├── layouts/            ← PageLayout (Step 3-D)
    │           ├── fragments/          ← Gadget (Step 3-C)
    │           └── <path>/
    └── test/
        └── java/com/example/<projectName>/  ← JUnit テスト (/generate-tests で出力)
```

#### canonical layout: NestJS backend + Next.js frontend (typescript)

業務 Service / Controller / Module / DTO / Entity は **project root 直下** (NestJS は src/ 強制ではなく、生成物は flat 配置)。`src/prisma/` (orm: prisma) または `src/database/` (orm: typeorm)・`src/ai/`・`src/auth/` のみ src/ 配下に scaffold (`/generate-code` 生成ファイル一覧の規約、L915-927 参照):

```
<出力先>/                              ← 業務アプリ project root (例: ~/projects/inventory-admin/)
├── .devcontainer/
│   ├── devcontainer.json
│   └── compose.yml
├── .mcp.json
├── .tmp/.gitignore
├── Dockerfile
├── docker-compose.yml
├── README.md
├── package.json                        ← caret prefix `^` 必須 (#1035)
├── tsconfig.json
├── tsconfig.build.json                 ← build 用 (test/ を除く)
├── nest-cli.json                       ← NestJS CLI 設定 (`sourceRoot: "src"`)
├── next.config.mjs                     ← Next.js 設定
├── tailwind.config.ts                  ← Tailwind (cssFramework=tailwind の場合)
├── <processFlowName>.service.ts        ← NestJS @Injectable Service (root 直下、actions → Service)
├── <processFlowName>.controller.ts     ← NestJS @Controller (root 直下、httpRoute → Controller)
├── <processFlowName>.module.ts         ← NestJS Module 定義 (root 直下)
├── dto/                                ← Request / Response DTO (root 直下、inputs[] / outputs[] → DTO)
│   ├── <actionName>-request.dto.ts
│   └── <actionName>-response.dto.ts
├── prisma/                             ← orm: prisma (既定・省略時) のときだけ。orm: typeorm では作らない
│   └── schema.prisma                   ← lineage の tables → model (provider は techStack.database.type)
├── entity/                             ← orm: typeorm のときだけ。orm: prisma では作らない
│   └── <tableName>.entity.ts           ← TypeORM Entity (root 直下、lineage.writes → Entity)
├── src/                                ← アプリの入口 (main.ts / app.module.ts) と DB 層 / AI / auth scaffold
│   ├── main.ts                         ← ビルド後は dist/src/main.js (Dockerfile の CMD は `node dist/src/main`)
│   ├── app.module.ts
│   ├── prisma/                         ← orm: prisma のときだけ (prisma.service.ts / prisma.module.ts)
│   ├── database/                       ← orm: typeorm のときだけ (typeorm.config.ts)
│   ├── ai/                             ← AI step あり時のみ (#§ AI step kind 検出時)
│   │   ├── ai-runtime.service.ts
│   │   ├── ai.module.ts
│   │   ├── ai-catalog.service.ts
│   │   └── providers/<provider>.ts
│   └── auth/                           ← auth.method 有効時のみ (scaffold)
├── app/                                ← Next.js App Router (frontend)
│   ├── components/
│   │   ├── layouts/<pageLayoutId>.tsx  ← default export Server Component (Step 3-D)
│   │   └── gadgets/<gadgetId>.tsx      ← default export ('use client' if events) (Step 3-C)
│   ├── api/gadgets/<gadgetId>/<actionId>/route.ts  ← Route Handler (processFlowId 連携時のみ)
│   └── <path>/page.tsx
└── components/<domain>/                ← 共通 UI コンポーネント
```

#### 実運用 vs dogfood の対比

| パターン | `<出力先>` 例 | folder 命名 | 想定用途 | Reopen in Container の挙動 |
|---|---|---|---|---|
| **実運用** (Harmony 利用者) | `~/projects/retail-app/` | 業務名で意味のある名前 | 業務アプリ開発の本番経路 | `${localWorkspaceFolderBasename}` = `retail-app`、AI CLI state は `~/.agent-containers/retail-app/` に分離される |
| **dogfood** (Harmony 開発) | `examples/<id>/generated/<techStack>/` | `generated` 固定 | Harmony 同梱サンプル、複数 techStack を side-by-side で比較 | `${localWorkspaceFolderBasename}` = `generated` で AI CLI state 分離が崩れる、業務開発の本番経路ではない |

`examples/<id>/generated/` は **Harmony 同梱サンプル / dogfood 参照物** であり、常用・実開発の project root として開く運用は想定しない (`${localWorkspaceFolderBasename}` が `generated` で衝突し AI CLI state 分離が崩れる)。一時 smoke で開くことはあり得るが、業務アプリ開発の本番経路ではない。

Harmony 利用者は **意味のある folder 名** (例: `retail-app/`、`inventory-admin/`) で project root を作り、その folder を `<出力先>` に指定する。VS Code でその root を開いた時の `${localWorkspaceFolderBasename}` が AI CLI state (`~/.agent-containers/<project-name>/`) の分離キーになる。

> 設定駆動の出力先指定 (`harmony.json` の `outputDir` field 等) は将来検討項目。現状は `<出力先>` を毎回明示指定する運用。`#1055` (L2 image 配布) 着手時に必要性を再評価し、必要なら新規 ISSUE を起票する。

### 検証 (Step 6 拡張 / B-4)

- `.devcontainer/devcontainer.json` が JSON valid (構文チェック)、`.mcp.json` も JSON valid (`harmony`・`playwright`・`playwright-headed` の 3 項目を持つ)
- `.devcontainer/compose.yml` が YAML valid (`docker compose -f .devcontainer/compose.yml config` が使えるときはそれで)
- `docker compose config -f docker-compose.yml` が pass (CLI 利用可能時のみ)
- B-4 retail dogfood で Reopen in Container 実機検証 (出力アプリの起動まで)

## Step 5.8: 生成の記録 (再生成の差分・乖離の検出のため)

コードを書き出したら、**必ず** `designer__record_generation` で、「どの設計から、どのファイルを作ったか」を記録する (MCP が使えないときは、最終レポートに「生成の記録: 未記録 (MCP 不可)」と書く)。

- `outputs[].path`: 書き出したファイルの、`base` からの相対パス。出力先が既定の `.tmp/generated-code/` なら `base: "generated-code"`、ワークスペースの中なら `base` を省略 (= workspace)。**それ以外の場所 (別のフォルダ) に出したファイルは、記録しても書き換えを検出できない** (警告が返る)
- `outputs[].sources`: そのファイルの元にした設計。ProcessFlow → `{ kind: "processFlow", id }`、画面 → `{ kind: "screen", id }`、テーブル定義を使ったなら `{ kind: "table", id }` も足す (テーブルが変わったときも「再生成が必要」と検出するため)
- `generator`: `generate-code`
- 再生成のとき (すでに記録のある設計を、もう一度生成するとき): 書き出す前に `designer__check_generation_drift` で状態を見る。`design-changed` なら `designer__get_regeneration_diff` で、変わった箇所だけを確かめ、その部分だけを直して書き出す。`output-changed` / `both-changed` (人が生成物を書き換えている) ときは、**上書きせず**、どちらを正とするかを利用者に確かめる

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
- ID: <entityId>
- techStack: <backend.language>/<backend.framework>/<database.type>/<frontend.library>
- PageLayout: <pageLayoutId> (Screen.purpose=page の場合のみ、解決できた場合)

### 生成ファイル
- `<出力先>/...` (各ファイルのパスを列挙)

### プロジェクト scaffold (#1048、初回 entity 出力時のみ)
- `<ワークスペースのルート>/.devcontainer/devcontainer.json`
- `<ワークスペースのルート>/.devcontainer/compose.yml`
- `<ワークスペースのルート>/.mcp.json`
- `<ワークスペースのルート>/.tmp/.gitignore`
- `<出力先>/Dockerfile`
- `<出力先>/docker-compose.yml`
- `<出力先>/README.md` (新規 or scaffold セクション追記)
- (すでにあって飛ばしたファイルは、ファイルごとに「既存のため飛ばした」と明記。例: ルートに `.devcontainer/` がある場合)

### techStack 制約検証
- 制約 1 (backend matrix): ✓ / 違反なし
- 制約 2 (vue→framework): ✓ / 違反なし
- 制約 3 (react→framework): ✓ / 違反なし

### smoke 検証
- Java 構文: ✓ / スキップ (javac 利用不可) / ❌ (エラー内容)
- Thymeleaf well-formed: ✓ / 該当なし / ❌ (エラー内容)
- TypeScript tsc: ✓ / スキップ (tsc 利用不可) / ❌ (エラー内容)

### 注意事項
- 生成コードは雛形です。実際のプロジェクト構成に合わせてパッケージ名/ファイル配置を調整してください
- ゴールデン出力: `ai-skills/generate-code/golden-examples/` を参照
- DB クエリのバインド変数は ProcessFlow SQL の `@varName` → JPA `:varName` / Prisma (`orm` 省略時を含む) の `$queryRaw` タグ付きテンプレートの `${varName}` / TypeORM (`orm: typeorm`) の `dataSource.query()` の `$N` (postgresql) または `?` (mysql / sqlite) に変換が必要
```

## 制約 (必守)

- 生成したファイルは、`designer__record_generation` で記録する (Step 5.8)。記録を省いて完了と報告しない
- `schemas/*.json` を変更しない (schema ガバナンス #511)
- `data/` ディレクトリを変更しない
- `frontend/` / `backend/` のソースコードを変更しない
- 生成コードは `.tmp/generated-code/` または指定した出力先に置く (プロジェクトルート直置き禁止)
- 未対応 techStack の場合は中止して理由を報告する (サイレント生成禁止)
- CI に組み込まない (本スキルは AI 対話駆動、CI 自動化は別 ISSUE)
