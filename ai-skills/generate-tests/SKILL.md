---
name: generate-tests
description: project.techStack に基づき ProcessFlow JSON → backend integration test (E2E spec)、または Screen JSON → frontend component test (vitest + @testing-library/react)、または Playwright E2E シナリオテスト (multi-screen) を AI が生成する。P1/P2 は TypeScript NestJS + jest、P3 は React + Next.js + vitest、P4 は Playwright E2E (画面遷移シナリオ)、P5 は AI flow mock + 実 API 切替をカバー。
argument-hint: <flowId|screenId> [出力先] / --scenario <fromScreenId> <toScreenId> / --scenario-name "<name>" <screenId-1> ... <screenId-N>
disable-model-invocation: true
---

<!--
  使い方:
    # ProcessFlow ID (backend E2E テスト生成 — P1/P2)
    /generate-tests 0671b051-4acc-49cf-ba92-9fa29b47f671
    /generate-tests 0671b051-4acc-49cf-ba92-9fa29b47f671 apps/api/test/generated

    # Screen ID (frontend component テスト生成 — P3)
    /generate-tests 31d56212-b654-46dc-b004-096c7382c404
    /generate-tests 31d56212-b654-46dc-b004-096c7382c404 apps/web/src/__tests__

  目的:
    ProcessFlow JSON / Screen JSON を読み取り、spec → test の体系的な変換ルールに従い
    テストファイルを生成する。ゴールデン出力 (golden-examples/) を参照してテスト品質を均一化する。

    test runner の使い分け (D-6 確定):
      Backend NestJS     → jest (@nestjs/testing + supertest)    [P1/P2]
      Frontend React/Next → vitest + @testing-library/react       [P3]
      E2E (全体)         → Playwright                            [P4 以降]

  設計判断 (D-1〜D-7、#870 で確定):
    D-1: 各 it() に "Spec: ProcessFlow/Screen <id> <step-id|item-id>" コメントでトレース anchor
    D-2: tableId → Prisma model 名の解決は harmony/tables/<id>.json の physicalName を参照
    D-3: transactionScope step 配下に故意失敗 TX rollback テストを生成 (#1221 で txBoundary 廃止、transactionScope に一本化)
    D-4: section コメント anchor ベースで spec 由来 section のみ overwrite、人手 assertion section は保護
    D-5: runIf 条件分岐は true / false 両方のテストを生成 (Screen の showIf も同様)
    D-6: test runner の使い分け (確定):
           NestJS backend → jest (@nestjs/testing + supertest)
           React/Next frontend → vitest + @testing-library/react
           E2E → Playwright (P4 以降)
    D-7: SQLite では --runInBand 必須 (backend のみ)、Postgres/MySQL なら並列可

  カバーするスコープ:

    P1 (backend E2E — #870):
      - techStack.backend.framework = "nestjs" のみ
      - ProcessFlow inputs / validation / httpRoute / outputs / responses から test 生成
      - runIf 分岐の両側テスト
      - context.catalogs.errors → httpStatus assertion

    P2 (backend DB 副作用 + TX — #871):
      - DB 副作用 (dbAccess INSERT/UPDATE/DELETE) の Prisma SELECT 検証
      - loop collectionSource の配列 N 件 assertion
      - transactionScope 故意失敗テスト (TX 未実装の場合は文書化テストとして生成、#1221 で旧 txBoundary は廃止)
      - affectedRowsCheck.onViolation=throw/log テスト
      - step.kind=compute → DB 値の null/non-null アサーション

    P3 (frontend component — #872):
      - techStack.frontend.framework = "next" + library = "react" のみ
      - Screen items[direction=input] → type 別 state 更新テスト
      - Screen items[direction=output, valueFrom.kind=flowVariable] → msw mock → 表示 assert
      - Screen events[].handlerFlowId → button click → fetch 発火テスト
      - events[] 空配列の場合は skip テスト + 乖離検出ノートのみ生成
      - renderWithProviders (useRouter / auth context wrap)

    P4 (E2E multi-screen — #873):
      - Playwright headless (D-6 確定)
      - SQLite --workers=1 必須 (D-7)
      - screenTransitions[] / events.handlerFlowId / path-based の 3段 fallback 遷移導出
      - 起動形式: /generate-tests --scenario <from> <to> または --scenario-name "<name>" <id1>...<idN>
      - auth helper (loginAs API 経由 / loginViaUI UI 経由)
      - DB seed/truncate helper (Prisma)
      - playwright.config.ts 雛形 (webServer はコメントアウト — AI は dev server を spawn しない)

    P5 (AI flow mock + 実 API 切替 — #874 / Phase 2-B + 2-C):
      - kind ∈ {aiCall, aiAgent} の step 検出 → modelEndpoints catalog (project + flow merge) 参照
      - mock target: `AiRuntimeService.invoke` (Phase 2-C 確定、`<出力先>/src/ai/ai-runtime.service.ts` 配置)
      - mock 戻り値は spec の outputBinding 正規化形式: { text?, object?, raw?, finishReason?, usage?, toolCalls? }
      - mock mode: jest.spyOn / vi.spyOn で AI runtime service を stub (token 消費なし)
      - 実 API mode: RUN_AI_INTEGRATION=1 env で ternary (jest+vitest 両互換)、CI default skip
      - responseFormat 別の mock 戦略 (P5-3):
          text         → { text }
          json         → { object, raw }   (object は schema 制約なし)
          structuredObject → { object, raw } (object は responseFormat.schema 準拠、テスト fixture も schema 準拠で書く)
          streaming    → { text } (完了後 assembled、partial chunks は本層で扱わない)
      - AiMessageSpread 検出 → ref (例: @turnContext) を辿り fixture 用変数を生成
      - AiImageSource: fileRef / url(literal) / url(@-expression) / base64 を別々に fixture 化
      - 4 観点変換ルール (responseFormat-aware):
          AI-1: 業務フィルタ (compute step が @<bind>.object.* に filter / map 等を適用) → mock object でフィルタ検証
          AI-2: secret 未設定 → 503 fallback (modelEndpoint.auth.tokenRef → secrets.<key>.name → env var)
          AI-3: response format violation (json/structuredObject のみ) → runtime parse / schema 失敗 → 502
                text / streaming は AI-3 を skip (parse step が無いため)
          AI-4: provider 呼び出し失敗 → outcomes.failure.action=abort → step responses[] の失敗 responseId を返す
      - tools / aiAgent: functionRef は context.catalogs.functions 参照、aiAgent は最終 assistant message のみ受け取る
      - 旧 externalSystem + systemRef=claudeApi パターンは Phase 2-A (PR #937) で全 sample が aiCall 化済 → 検出対象外

  P5 スコープ外 (別 ISSUE で逐次拡張):
    - Spring Boot / Python FastAPI 等の他 backend techStack
    - CI 自動化 (本スキルは AI 対話駆動のため CI に乗せない)
-->

`$ARGUMENTS` から、テストコードを生成します。

## Step 0: 引数解析

`$ARGUMENTS` を以下のように解析する。

### 0-A. フラグ検出 (P4 E2E ルーティング)

`$ARGUMENTS` 先頭に以下のフラグが含まれる場合、P4 E2E シナリオ生成ルートへ直接ルーティングする:

```
--scenario <screenId-from> <screenId-to>
  → P4 E2E シナリオ生成 (2 画面間)
  → シナリオ ID: "scenario-<screenId-from の8桁>-<screenId-to の8桁>"

--scenario-name "<name>" <screenId-1> ... <screenId-N>
  → P4 E2E シナリオ生成 (N 画面、名前付き)
  → シナリオ ID: "<name>" を kebab-case 化 (例: "投稿ライフサイクル" → "post-lifecycle")

上記フラグが含まれる → Step P4 へ直接ジャンプ (Step 1-2 の UUID ルーティングをスキップ)
```

### 0-B. 通常引数解析 (P1/P2/P3)

フラグなしの場合:

- 第1引数 `<id>` (必須): UUID v4 形式
  - UUID でない場合は「引数エラー: UUID v4 形式で指定してください」と報告して中止
- 第2引数 `<出力先>` (任意): ディレクトリパス (default: `.tmp/generated-tests/<入力UUID8桁>/`)

出力先ディレクトリが存在しない場合はテスト生成前に作成する。

入力 UUID のルーティング (Step 1-2 で決定):
- ProcessFlow ID にマッチ → backend E2E test 生成 (Step 1 → Step 3)
- Screen ID にマッチ → frontend component test 生成 (Step 1 → Step P3)
- どちらにもマッチしない → エラー報告して中止

### 0-C. 出力先ディレクトリの決定

| 起動形式 | デフォルト出力先 |
|---|---|
| `--scenario <from> <to>` | `.tmp/generated-tests/scenario-<8桁>-<8桁>/` |
| `--scenario-name "<name>" ...` | `.tmp/generated-tests/<kebab-case-name>/` |
| `<UUID>` (通常) | `.tmp/generated-tests/<UUID8桁>/` |

## Step 1: 入力読込

### 1-1. active workspace の harmony.json から techStack を取得

MCP ツール `workspace_status` または `workspace_inspect` で active workspace を特定し、
その `harmony.json` を Read で読む。

**フォールバック**: MCP 未接続の場合は `examples/diary/harmony.json` を読む。

```
harmony.techStack:
  backend.language, backend.framework
  database.type, database.version
  auth.method
```

### 1-2. 入力 UUID のルーティング (ProcessFlow vs Screen)

`harmony.json` の `entities.processFlows[].id` と `entities.screens[].id` を照合する。

```
if entities.processFlows[].id にマッチ:
  → ProcessFlow → backend test 生成へ (Step 2: techStack 検証 → Step 3)

elif entities.screens[].id にマッチ:
  → Screen → Step 1.5 (purpose 別分岐) へ

else:
  「ID が見つかりません: harmony.json の entities.processFlows / entities.screens を確認してください」
  と報告して中止
```

**重要**: 同じ UUID が ProcessFlow と Screen 両方に存在する可能性は実際にはないが、
processFlows を先にチェックし、マッチしない場合のみ screens をチェックする。

## Step 1.5: Screen purpose 別分岐 (pl-7 対応)

Step 1-2 で Screen ID にルーティングされた場合、Screen JSON を Read して `purpose` フィールドを確認し、以下に分岐する。

```
Screen JSON の purpose (解決順序):
  1. Screen JSON の purpose フィールド
  2. フィールドが存在しない → 旧 schema 互換で "page" とみなす

分岐:
  purpose === "gadget"
    → Step 3-Y (gadget 単独 component test 生成) へ

  purpose === "page" (または purpose 未設定) かつ pageLayoutId あり
    → Step 3-X (layout 込み page rendering test 生成) へ

  purpose === "page" (または purpose 未設定) かつ pageLayoutId なし
    → 既存の Step P3-1 (Screen component test 生成) へ (従来パス)
```

**注意**: `purpose === "gadget"` の Screen は画面フロー上に現れない独立コンポーネントです。
P4 (E2E multi-screen シナリオ) の遷移チェーンには含めません。

### 1-3. ProcessFlow JSON を Read で取得

- active workspace: `<workspace>/process-flows/<id>.json`
- フォールバック: `examples/<project-id>/harmony/process-flows/<id>.json`

### 1-4. tableId → physicalName index の構築 (D-2)

ProcessFlow に登場する tableId を収集し、各テーブルの physicalName を解決する。

```
テーブル index 構築手順:
1. ProcessFlow JSON 全体から tableId 値をすべて収集 (steps の lineage.writes / lineage.reads)
2. 各 tableId について harmony/tables/<tableId>.json を Read
3. physicalName を取得して map 化: { "<tableId>": "<physicalName>" }
   例: { "79d2c08c-...": "posts", "d8fc5f8a-...": "photos" }
4. Prisma model 名は physicalName の snake_case → PascalCase 変換
   例: "posts" → Post, "post_tags" → PostTag, "photos" → Photo
```

## Step 2: techStack 制約検証

ルーティング結果に応じて対応する検証を行う。

### 2-A. ProcessFlow モード (backend test)

以下を確認し、対象外の場合は中止する。

```
if techStack.backend.framework !== "nestjs":
  「P1 スコープ外: /generate-tests P1/P2 は NestJS + jest のみサポートします。
   現在の techStack.backend.framework: "<value>"。
   他 techStack は別 ISSUE で対応予定。」と報告して中止

if techStack.backend.language !== "typescript":
  「P1 スコープ外: /generate-tests P1/P2 は TypeScript のみサポートします。
   現在の techStack.backend.language: "<value>"。」と報告して中止
```

→ 検証 OK → Step 3 (backend E2E test 生成) へ

### 2-B. Screen モード (frontend component test)

以下を確認し、対象外の場合は中止する。

```
if techStack.frontend.framework !== "next":
  「P3 スコープ外: /generate-tests P3 は Next.js + React のみサポートします。
   現在の techStack.frontend.framework: "<value>"。」と報告して中止

if techStack.frontend.library !== "react":
  「P3 スコープ外: /generate-tests P3 は React のみサポートします。
   現在の techStack.frontend.library: "<value>"。」と報告して中止
```

→ 検証 OK → Step P3-1 (Screen component test 生成) へ

---

## Step 3: ProcessFlow → backend E2E test 生成

ゴールデン出力 (`ai-skills/generate-tests/golden-examples/posts-create-e2e/`) を参照しながら、以下の変換ルールに従いテストファイルを生成する。

テンプレート規約: `ai-skills/generate-tests/templates/backend/typescript-nestjs/E2E_SPEC.md` を Read して参照すること。

### 3-1. テストファイルの構造

```typescript
/**
 * E2E テスト: <httpRoute.method> <httpRoute.path> (<action.name>)
 *
 * // Spec anchor header (D-1 / D-4): skill 生成セクションの開始マーカー
 * // ===HARMONY_GENERATED_SECTION_START flowId=<id> actionId=<actionId>===
 *
 * ProcessFlow: <id> (<meta.name>)
 *
 * === spec → test mapping ===
 * (生成ルールのサマリを記述)
 *
 * // ===HARMONY_GENERATED_SECTION_END===
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
const request = require('supertest');  // Spike L-5: require で import
import { AppModule } from '../src/app.module';
import { PrismaClient } from '@prisma/client';
```

### 3-2. describe / beforeAll / afterAll / beforeEach / afterEach の命名

```typescript
describe('<httpRoute.method> <httpRoute.path> (<action.name> E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let accessToken: string;  // httpRoute.auth="required" の場合のみ
  let createdIds: { [table: string]: (number | string)[] } = {};  // cleanup 用

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }));
    await app.init();

    // DATABASE_URL 絶対パス対応 (Spike L-6)
    const dbPath = process.env.DATABASE_URL || `file:${require('path').resolve(__dirname, '../prisma/dev.db')}`;
    prisma = new PrismaClient({ datasources: { db: { url: dbPath } } });

    // JWT 取得 (httpRoute.auth="required" の場合)
    accessToken = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    // test data の seed (テスト間の独立性確保)
  });

  afterEach(async () => {
    // 作成データの cleanup (createdIds を走査)
  });

  // テストケース群 ...
});
```

### 3-3. spec → test 変換ルール (コア知識)

各ルールで生成する `it()` には必ず `Spec: ProcessFlow <flowId> <step-id>` コメントを付与すること (D-1)。

#### A. inputs[].required=true → missing field → 400

```
ProcessFlow:
  inputs[].name="<field>", required=true

生成テスト:
  /**
   * Spec: ProcessFlow <flowId> <actionId> step-<N> validation rule
   *   field=<field>, type=required
   */
  it('#N validation: <field> 欠落 → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('<path>')
      .set('Authorization', `Bearer ${accessToken}`)  // auth=required の場合
      .send({ /* <field> を除いた必須フィールドのみ */ });
    expect(res.status).toBe(400);
  });
```

#### B. validation rules[].type ごとの boundary テスト

```
maxLength, length=N:
  → N+1 文字 → 400 (超過)
  → N 文字 → 201 (境界値 OK)

minLength, length=N:
  → N-1 文字 → 400 (不足)
  → N 文字 → 201 (境界値 OK)

enum, values=[...]:
  → enum 外の値 (例: "invalid") → 400

pattern, regexp="...":
  → pattern 違反の値 → 400
  → pattern に合致する値 → 201

range, min=M, max=N:
  → N+1 → 400
  → M-1 → 400
  → M / N → 201 (boundary OK)
```

#### C. outputs[].name → response.body assertion

```
ProcessFlow:
  outputs[].name="<field>", type="integer"

生成テスト (happy path の中に含める):
  expect(res.body).toHaveProperty('<field>');
  expect(typeof res.body.<field>).toBe('number');  // integer → number
```

type ↔ JS/TS assertion 対応:
| ProcessFlow type | assertion |
|---|---|
| integer | `typeof res.body.X === 'number'` |
| string | `typeof res.body.X === 'string'` |
| boolean | `typeof res.body.X === 'boolean'` |
| array | `Array.isArray(res.body.X)` |
| object | `typeof res.body.X === 'object' && res.body.X !== null` |

#### D. responses[].status → status code テスト

各 response に対して status code assertion を生成する。
正常系 (2xx) は happy path it() の中で確認。
エラー系 (4xx/5xx) は専用の it() として生成。

context.catalogs.errors[] の httpStatus を assertion 期待値として使う:
```
errors.VALIDATION_ERROR.httpStatus=400 → expect(res.status).toBe(400)
errors.UNAUTHORIZED.httpStatus=401 → expect(res.status).toBe(401)
```

#### E. httpRoute.auth="required" → JWT なし → 401

```
ProcessFlow:
  httpRoute.auth="required"
  context.catalogs.errors.UNAUTHORIZED.httpStatus=401

生成テスト:
  /**
   * Spec: ProcessFlow <flowId> act-001 httpRoute.auth="required"
   *   context.catalogs.errors.UNAUTHORIZED.httpStatus=401
   */
  it('#N auth: JWT なし → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('<path>')
      .send({ /* 有効なボディ */ });
    expect(res.status).toBe(401);
  });
```

#### F. step.kind=dbAccess (INSERT) → DB 行追加 assertion

```
ProcessFlow:
  step.kind="dbAccess", operation="INSERT"
  lineage.writes[].tableId="<tableId>"

生成テスト:
  /**
   * Spec: ProcessFlow <flowId> <stepId>
   *   kind=dbAccess, operation=INSERT, lineage.writes=[<physicalName>]
   *   affectedRowsCheck: expected=1
   */
  it('#N DB 副作用: <physicalName> テーブルに row が追加される', async () => {
    const res = await request(...).post(...).send({...});
    expect(res.status).toBe(201);
    const id = res.body.<outputId>;
    createdIds['<physicalName>'] = [...(createdIds['<physicalName>'] ?? []), id];

    // Prisma で直接確認
    const row = await prisma.<ModelName>.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.<field>).toBe(<expectedValue>);
  });
```

#### G. step.kind=loop + collectionSource → 配列 N 件 assertion (D-5, Spike L-3)

```
ProcessFlow:
  step.kind="loop", loopKind="collection", collectionSource="@inputs.<field>"
  inner step: dbAccess INSERT <childTable>

生成テスト:
  /**
   * Spec: ProcessFlow <flowId> <loopStepId>
   *   kind=loop, collectionSource=@inputs.<field>
   *   <innerStepId>: dbAccess INSERT <childTable>
   */
  it('#N DB 副作用: <field> N 件指定 → <physicalName> に N 行 + 親 ID 紐付け', async () => {
    const res = await request(...).post(...).send({
      ...,
      <field>: [item1, item2],
    });
    expect(res.status).toBe(201);
    const parentId = res.body.<id>;

    const rows = await prisma.<ChildModel>.findMany({ where: { <parentIdField>: parentId } });
    expect(rows).toHaveLength(2);
    expect(rows[0].<parentIdField>).toBe(parentId);
  });
```

#### H. step.kind="transactionScope" → 故意失敗テスト (D-3、#1221 で旧 txBoundary 廃止)

```
ProcessFlow:
  step.kind="transactionScope" で steps[] 配下に DB 書込が複数ある場合

生成テスト:
  /**
   * Spec: ProcessFlow <flowId> <transactionScopeStepId>
   *   kind="transactionScope", steps[]=<innerSteps>
   *
   * TX rollback 検証: 故意に UNIQUE/CHECK 制約違反を誘起して TX 全体が rollback されるか確認。
   * 注: $transaction を使わない実装では rollback が保証されないため「rollback なし」を文書化テストとして生成。
   */
  it('#N TX: <constraint 違反説明> → <expectedStatus> + TX rollback 確認', async () => {
    // TX 失敗を誘起する入力 (UNIQUE 違反等)
    const res = await request(...).post(...).send({ <failurePayload> });
    expect(res.status).toBe(500);  // or 409 depending on error handling

    // TX rollback の検証:
    //   $transaction 実装あり → 親テーブルに row が残らないこと
    //   $transaction 未実装 → 親テーブルに row が残ることを文書化
    const remainingRows = await prisma.<MainModel>.findMany({ where: { <identifierFilter> } });
    if (remainingRows.length > 0) {
      console.warn('[TX 文書化] TX が未実装: <stepId> 失敗後も <physicalName> 行が残存している。');
    }
    // cleanup
  });
```

#### I. affectedRowsCheck.onViolation="throw" → 0 行誘起 → 5xx テスト

```
ProcessFlow:
  step.affectedRowsCheck.operator="=", expected=1, onViolation="throw"

生成テスト:
  /**
   * Spec: ProcessFlow <flowId> <stepId>
   *   affectedRowsCheck: expected=1, onViolation=throw, errorCode=<errorCode>
   */
  it('#N affectedRowsCheck: 0 行 UPDATE → 5xx', async () => {
    // 存在しない ID を指定して affected rows = 0 を誘起
    const res = await request(...).patch('/<path>/999999').send({...});
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
```

#### J. step.runIf → true / false 両分岐のテスト (D-5)

```
ProcessFlow:
  step.runIf="@tag.id == null"  (例: step-05-01)

生成テスト (true 分岐: runIf が truthy のケース):
  /**
   * Spec: ProcessFlow <flowId> <stepId> runIf="@tag.id == null"
   *   runIf=true: tag.id が未指定 → name で既存タグを検索
   */
  it('#N runIf=true: <条件説明> のケース', async () => { ... });

生成テスト (false 分岐: runIf が falsy のケース):
  /**
   * Spec: ProcessFlow <flowId> <stepId> runIf="@tag.id == null"
   *   runIf=false: tag.id が指定済み → name 検索をスキップ
   */
  it('#N runIf=false: <条件説明> のケース', async () => { ... });
```

#### K. step.kind=compute → DB 値で結果を確認 (Spike L-2)

```
ProcessFlow:
  step.kind="compute", expression="@inputs.status == 'published' ? new Date().toISOString() : null"
  outputBinding.name="publishedAt"

生成テスト (DB SELECT で null/non-null を assert):
  /**
   * Spec: ProcessFlow <flowId> <computeStepId>
   *   kind=compute, outputBinding.name="publishedAt"
   *   expression="@inputs.status == 'published' ? new Date().toISOString() : null"
   */
  // status="draft" → publishedAt=null
  it('#N compute: status="draft" → <computedField> が null', async () => {
    const res = await request(...).post(...).send({ ..., status: 'draft' });
    expect(res.status).toBe(201);
    const row = await prisma.<ModelName>.findUnique({ where: { id: res.body.<outputId> } });
    expect(row!.<computedField>).toBeNull();
  });

  // status="published" → publishedAt が non-null かつ現在時刻付近
  it('#N compute: status="published" → <computedField> が non-null', async () => {
    const before = new Date();
    const res = await request(...).post(...).send({ ..., status: 'published' });
    expect(res.status).toBe(201);
    const after = new Date();
    const row = await prisma.<ModelName>.findUnique({ where: { id: res.body.<outputId> } });
    expect(row!.<computedField>).not.toBeNull();
    const val = row!.<computedField> as Date;
    expect(val.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(val.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
```

---

## P2 追加変換ルール (DB 副作用 + TX 検証) — #871

### 3-P2-1. lineage.writes[].tableId → 行数増減 SELECT アサーション (D-2)

`step.lineage.writes` を持つ step は全て「実行前後で行数が変化するか」を SELECT で確認するテストを生成する。

```
ProcessFlow:
  step.kind="dbAccess", operation="INSERT" | "UPDATE" | "DELETE"
  lineage.writes[].tableId="<tableId>"
  (D-2 で tableId → physicalName 解決済)

生成テスト (INSERT):
  /**
   * Spec: ProcessFlow <flowId> <stepId>
   *   kind=dbAccess, operation=INSERT
   *   lineage.writes=[<physicalName>]
   */
  it('#N lineage: INSERT 後に <physicalName> の行数が 1 増加する', async () => {
    const countBefore = await prisma.<ModelName>.count({ where: { <filterCondition> } });
    const res = await request(...).post(...).send({ <payload> });
    expect(res.status).toBe(201);
    const countAfter = await prisma.<ModelName>.count({ where: { <filterCondition> } });
    expect(countAfter).toBe(countBefore + 1);
  });

生成テスト (DELETE):
  it('#N lineage: DELETE 後に <physicalName> の行数が 1 減少する', async () => {
    const countBefore = await prisma.<ModelName>.count({ where: { <filterCondition> } });
    const res = await request(...).delete('/<path>/<id>').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const countAfter = await prisma.<ModelName>.count({ where: { <filterCondition> } });
    expect(countAfter).toBe(countBefore - 1);
  });
```

tableId → physicalName 解決が失敗した場合:
- physicalName が取得できなかった tableId は「解決不能: tableId=<id>」として申し送りに記載
- テスト生成は一部スキップして続行する (全件未生成にはしない)

### 3-P2-2. step.kind=loop + collectionSource → 入力配列長 = 挿入行数 (Spike L-3)

loop ステップは、入力配列の要素数が内側 dbAccess INSERT の実行回数と一致することを確認する。

```
ProcessFlow:
  step.kind="loop", loopKind="collection", collectionSource="@inputs.<field>"
  collectionItemName="<itemName>"
  inner step: kind="dbAccess", operation="INSERT"
  inner step lineage.writes[].tableId → <childPhysicalName>

生成テスト:
  /**
   * Spec: ProcessFlow <flowId> <loopStepId>
   *   kind=loop, loopKind=collection, collectionSource=@inputs.<field>
   *   <innerStepId>: kind=dbAccess, operation=INSERT → <childPhysicalName>
   *
   * 入力配列長 N = <childPhysicalName> 挿入行数 N (Spike L-3)
   */
  it('#N loop-insert: <field> N 件 → <childPhysicalName> に N 行 + 親 ID 紐付け', async () => {
    const N = 2;  // 任意、2 で十分
    const res = await request(...).post(...).send({
      ...,
      <field>: Array.from({ length: N }, (_, i) => ({ <childItemField>: `value-${i}` })),
    });
    expect(res.status).toBe(201);
    const parentId = res.body.<outputIdField>;

    const childRows = await prisma.<childModelPrisma>.findMany({ where: { <parentFKField>: parentId } });
    expect(childRows).toHaveLength(N);
    childRows.forEach(row => expect(row.<parentFKField>).toBe(parentId));
  });
```

N = 0 のケース (空配列) も生成する:
```
  it('#N loop-insert: <field> 0 件 → <childPhysicalName> に 0 行', async () => {
    const res = await request(...).post(...).send({ ..., <field>: [] });
    expect(res.status).toBe(201);
    const parentId = res.body.<outputIdField>;
    const childRows = await prisma.<childModelPrisma>.findMany({ where: { <parentFKField>: parentId } });
    expect(childRows).toHaveLength(0);
  });
```

### 3-P2-3. transactionScope step → 故意失敗で全 rollback テスト (D-3、#1221 で旧 txBoundary 廃止)

`kind: "transactionScope"` step の `steps[]` 配下に DB 書込が複数ある場合、TX の途中で
失敗を誘起し、scope 内で書き込まれた行が全て rollback されることを確認するテストを生成する。

```
ProcessFlow:
  step.kind="transactionScope", id="<txStepId>"
  (steps[] 内に dbAccess INSERT が複数存在する)

生成テスト:
  /**
   * Spec: ProcessFlow <flowId> <txStepId>
   *   kind="transactionScope", rollbackOn=[...]
   *
   * TX rollback 検証 (D-3):
   *   故意に <故意失敗パターン> を起こして TX 全体が rollback されるか確認。
   *
   * 【spec ↔ impl 乖離検出器として機能】
   *   $transaction が実装されていない場合、内部 step の INSERT が rollback されずに残る。
   *   この場合テストは「rollback なし」として文書化し、spec ↔ impl 乖離として申し送る。
   */
  it('#N TX: <故意失敗説明> → <expectedStatus> + TX rollback 確認', async () => {
    // 故意失敗ペイロード (<故意失敗パターン> に従う)
    const res = await request(...).post(...).send({ <failPayload> });

    // エラー status を確認
    expect(res.status).toBe(<expectedHttpStatus>);

    // TX rollback 確認: begin 側テーブルに行が残っていないこと
    const remainingRows = await prisma.<beginTableModel>.findMany({
      where: { <uniqueIdentifierFilter> },
    });

    if (remainingRows.length > 0) {
      // 【TX-1 文書化】 $transaction 未実装を記録
      console.warn(
        `[TX-1 文書化] TX が未実装: <失敗ステップ>失敗後も <beginTablePhysical> 行が残存。` +
        `残存 ID: ${remainingRows.map((r) => r.id).join(', ')}`,
      );
    }
    // このテストは「エラーが返る」ことの確認で pass とし、TX 未実装は申し送り
    // cleanup
    for (const row of remainingRows) {
      createdIds['<beginTablePhysical>'] = [...(createdIds['<beginTablePhysical>'] ?? []), Number(row.id)];
    }
  });
```

#### 故意失敗パターンの選択ロジック

TX 内の step 構造を解析して、以下の優先順で「故意失敗パターン」を決定する:

| 優先度 | パターン | 選択条件 | ペイロード例 |
|---|---|---|---|
| 1 | UNIQUE 制約違反 | TX 内の INSERT テーブルに UNIQUE/@@id 制約がある | 同じ ID を 2 回送る |
| 2 | NOT NULL 違反 | TX 内の dbAccess step に必須 JOIN がある | null を渡す |
| 3 | FK 違反 | TX 内に FK 参照がある | 存在しない ID を参照 |
| 4 | value too long | TX 内の INSERT に varchar 上限がある | maxLength+1 文字 |
| 5 | affectedRowsCheck.onViolation=throw | TX 内 step に該当設定あり | DB に存在しない ID |
| 6 | (フォールバック) | 上記が特定できない | mock 経由の失敗を申し送り |

ProcessFlow の `lineage.writes / tableId / affectedRowsCheck / sql` から解析する。
spec に `UNIQUE_VIOLATION` errorCode があれば UNIQUE 制約パターンを優先する。

#### 運用ノート: $transaction 未実装 → テストは fail する、それが正しい動作

> D-3 の設計意図: TX rollback テストは、`$transaction` が実装されていない実装バグを検出する
> **spec ↔ impl 乖離検出器** として意図的に設計されている。
>
> - `$transaction` 実装あり → TX rollback テスト pass (spec と実装が一致)
> - `$transaction` 未実装 → TX rollback テスト fail (spec が定義する TX 境界が実装されていない)
>
> テスト fail = バグ検出成功。テスト pass のために実装を改ざんするのは禁止。
> fail の場合は「実装側の修正が必要: transactionScope step <id> の steps[] を $transaction でラップする」を
> 申し送りとして最終レポートに記載する。

### 3-P2-4. affectedRowsCheck.onViolation=throw → 0 行誘起シナリオ → 5xx

```
ProcessFlow:
  step.affectedRowsCheck.operator="=", expected=N, onViolation="throw"
  errorCode="<errorCode>" (context.catalogs.errors.<errorCode>.httpStatus で status 解決)

生成テスト:
  /**
   * Spec: ProcessFlow <flowId> <stepId>
   *   affectedRowsCheck: operator="=", expected=<N>, onViolation="throw"
   *   errorCode="<errorCode>" → httpStatus=<httpStatus>
   *
   * 0 行誘起 (affected rows が expected を満たさない) → <httpStatus>
   */
  it('#N affectedRowsCheck(throw): 0 行誘起 → <httpStatus>', async () => {
    // 「存在しない ID」「DB に入らない条件」等で affected rows = 0 を誘起する
    // 誘起方法は operation 種別で決定:
    //   UPDATE/DELETE → 存在しない ID を指定 (例: id=999999999)
    //   INSERT → DB 制約違反 (UNIQUE 等) が起きるペイロード
    const res = await request(app.getHttpServer())
      .<method>('<path>/<nonexistentId>')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ <validPayload> });

    expect(res.status).toBe(<httpStatus>);  // errorCode → httpStatus
  });
```

0 行を誘起する方法の判断ロジック:
- `operation=UPDATE` or `DELETE` → path param / query に存在しない ID (999999999)
- `operation=INSERT` → UNIQUE 違反ペイロード (既存レコードと重複)
- 判断できない場合 → 「0 行誘起方法が未決: 手動でペイロードを調整してください」コメント付きで生成

### 3-P2-5. affectedRowsCheck.onViolation=log → 0 行/多行を許容、log 出力確認 (optional)

> `onViolation=log` のステップは「違反しても続行する」設計のため、テスト生成は任意 (optional)。
> ただし skill ドキュメントとして挙動を明記し、生成する場合は以下のテンプレを使う。

```
ProcessFlow:
  step.affectedRowsCheck.onViolation="log", errorCode="<errorCode>"

生成テスト (optional):
  /**
   * Spec: ProcessFlow <flowId> <stepId>
   *   affectedRowsCheck: onViolation="log", errorCode="<errorCode>"
   *   (onViolation=log なので 0 行でもエラーにならない設計)
   *
   * 検証方針:
   *   1. 0 行になる条件でリクエスト → 200/201 が返る (エラーにならないこと)
   *   2. 可能であれば console.warn / logger.warn が呼ばれることを確認
   *      (jest の spyOn(console, 'warn') または NestJS Logger spy)
   */

  // シナリオ A: 0 行でも 201 が返る (エラーにならない)
  it('#N affectedRowsCheck(log): 0 行でも 201 が返る', async () => {
    // 既存レコードと重複するペイロード (UNIQUE 違反 → INSERT 0 行)
    const res = await request(...).post(...).send({ <duplicatePayload> });
    // onViolation=log なのでエラーにならずに続行
    expect(res.status).toBeLessThan(500);
  });

  // シナリオ B: 複数行の場合も許容
  it('#N affectedRowsCheck(log): 複数行でも 201 が返る (想定範囲外だが log のみ)', async () => {
    const res = await request(...).post(...).send({ <multiRowPayload> });
    expect(res.status).toBeLessThan(500);
  });
```

### 3-P2-6. step.kind=compute → DB 値の null/non-null アサーション (Spike L-2 の完全版)

`K` ルールは compute 全般のテンプレ、本ルールは「DB に永続化される compute 結果」に特化した
詳細版。特に `NEW Date()` 系の時刻フィールドに対する安全な assertion を定義する。

```
ProcessFlow:
  step.kind="compute"
  outputBinding.name="<computedVar>"
  expression="<condition> ? <valueA> : <valueB>"
  (次の dbAccess INSERT/UPDATE の sql で @<computedVar> が参照される)

生成テスト (null ケース):
  /**
   * Spec: ProcessFlow <flowId> <computeStepId>
   *   kind=compute, outputBinding.name="<computedVar>"
   *   expression="<condition> ? <valueA> : null"
   *   condition が false → DB の <dbColumn> が null
   */
  it('#N compute(<computedVar>): <condition>=false → <dbColumn> が null', async () => {
    const res = await request(...).post(...).send({ ..., <conditionFalseField>: '<conditionFalseValue>' });
    expect(res.status).toBe(201);
    const row = await prisma.<ModelName>.findUnique({ where: { id: res.body.<outputId> } });
    expect(row).not.toBeNull();
    expect(row!.<dbColumn>).toBeNull();
  });

生成テスト (non-null / 時刻ケース):
  /**
   * Spec: ProcessFlow <flowId> <computeStepId>
   *   kind=compute, outputBinding.name="<computedVar>"
   *   expression="<condition> ? new Date().toISOString() : null"
   *   condition が true → DB の <dbColumn> が現在時刻付近の Date
   */
  it('#N compute(<computedVar>): <condition>=true → <dbColumn> が non-null (現在時刻付近)', async () => {
    const before = new Date();
    const res = await request(...).post(...).send({ ..., <conditionTrueField>: '<conditionTrueValue>' });
    expect(res.status).toBe(201);
    const after = new Date();
    const row = await prisma.<ModelName>.findUnique({ where: { id: res.body.<outputId> } });
    expect(row).not.toBeNull();
    expect(row!.<dbColumn>).not.toBeNull();
    // 時刻範囲確認 (1 秒の clock ずれを許容)
    const val = row!.<dbColumn> as Date;
    expect(val.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(val.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
```

非時刻 compute (例: 数値演算、文字列変換) の場合:
```
  // expression の結果を DB で直接確認 (時刻範囲チェックなし)
  expect(row!.<dbColumn>).toBe(<expectedComputedValue>);
```

---

### 3-4. テストケース番号付け規約

- `#1` Happy path (全フィールド指定の正常系 201)
- `#2〜` validation エラー系 (required → maxLength/minLength → enum → pattern → range の順)
- `#N` auth エラー (JWT なし → 401)
- `#N+` DB 副作用確認 (INSERT → loop → TX)
- `#N+` runIf 分岐
- `#N+` compute 結果確認 (publishedAt 等)
- `#N+` その他特殊ケース

## Step 4: テンプレート詳細参照

テスト生成の品質を担保するため以下のテンプレートを Read で参照すること:

```
ai-skills/generate-tests/templates/
  backend/typescript-nestjs/
    E2E_SPEC.md   — テストファイル全体の構造規約 + コードテンプレート
```

ゴールデン出力も参照:

```
ai-skills/generate-tests/golden-examples/
  posts-create-e2e/
    posts.create.e2e-spec.ts   — 投稿作成フロー (0671b051) のゴールデン (抽象化済)
    jest-e2e.json              — jest 設定テンプレート
    README.md                  — golden の使い方、人手 section 保護方針
  screens-list-component/
    posts-list.component.test.tsx — 投稿一覧 Screen のゴールデン
    vitest.config.ts              — vitest 設定
    README.md                     — PLACEHOLDER 解決表、mental invocation 結果
  diary-post-lifecycle-e2e/       ← P4 (Playwright E2E) ゴールデン
    post-lifecycle.e2e.spec.ts    — 投稿ライフサイクルシナリオ (9 steps, 6 tests)
    playwright.config.ts          — SQLite workers=1 設定
    helpers/auth.ts               — loginAs() / loginViaUI() helper
    helpers/db.ts                 — seedTestData() / truncateTestData() helper
    README.md                     — PLACEHOLDER 解決表、遷移導出フロー、再 invocation 例
```

## Step 5: spec トレースコメント規約 (D-1 / D-4)

### section anchor (D-4)

ファイル冒頭の doc コメントに以下の anchor を必ず含める:

```
// ===HARMONY_GENERATED_SECTION_START flowId=<flowId> actionId=<actionId>===
// (自動生成セクション: skill 再実行時に flowId / actionId が一致するセクションを overwrite)
// ===HARMONY_GENERATED_SECTION_END===
```

再生成時のルール:
1. 既存ファイルに anchor が存在する場合、`HARMONY_GENERATED_SECTION_START` から `HARMONY_GENERATED_SECTION_END` の間のみ overwrite
2. anchor の外 (人手追記 assertion 等) は保護

### it() コメント規約 (D-1)

各 `it()` の直前に JSDoc コメントとして spec の参照先を明記:

```typescript
/**
 * Spec: ProcessFlow <flowId> <actionId> <stepId>
 *   <spec 要素の説明 (field / rule type / operation 等)>
 */
it('#N <test description>', async () => { ... });
```

## Step 6: tableId → Prisma model 名解決 (D-2)

Step 1-4 で構築した tableId → physicalName map を使い、Prisma model 名を導出する。

```
snake_case → PascalCase 変換ルール:
  "posts"      → Post
  "post_tags"  → PostTag
  "photos"     → Photo
  "users"      → User
  "tags"       → Tag

Prisma client 呼び出し形式:
  prisma.post.findUnique(...)
  prisma.postTag.findMany(...)
  prisma.photo.findMany(...)
```

Prisma client プロパティ名は camelCase (PascalCase の先頭を小文字化):
  `Post` → `prisma.post`
  `PostTag` → `prisma.postTag`

## Step 7: 出力検証

生成したテストファイルを jest で実行して pass を確認する。

### 7-1. jest 実行コマンド

```bash
# SQLite の場合は --runInBand 必須 (D-7)
cd <project_root>/apps/api && npx jest --config test/jest-e2e.json --testPathPattern="<generated-filename>" --runInBand 2>&1 | tail -30
```

### 7-2. pass 確認

- 全テストケース pass → 完了
- fail の場合:
  1. エラーメッセージを確認し原因を特定
  2. 実装 (service / DTO) の不備か、テストの記述誤りかを判断
  3. テスト記述誤りならテストを修正して再実行
  4. 実装の不備なら「実装側の修正が必要: <詳細>」として申し送り

### 7-3. 実行不可の場合

jest 実行環境が整っていない場合 (DB 未起動等) はスキップし、最終レポートに以下を記載:
```
smoke 検証: スキップ (<理由>)
推奨コマンド: cd <project>/apps/api && npx jest --config test/jest-e2e.json --runInBand
```

## 制約 (必守)

- `schemas/*.json` を変更しない (schema ガバナンス #511)
- `data/` ディレクトリを変更しない
- `examples/` 配下の既存ファイルを変更しない
- `frontend/` / `backend/` のソースコードを変更しない
- 生成テストは `.tmp/generated-tests/` または指定した出力先に置く (プロジェクトルート直置き禁止)
- diary `apps/api/` は test ファイル追加 OK、本体実装変更不可
- CI に組み込まない (本スキルは AI 対話駆動、CI 自動化は別 ISSUE)

## Playwright E2E トラブルシューティング (#980-A 由来の汎用知見)

各プロダクトでも Playwright E2E を書く際に類似の問題が起きうる。発生時のパターン化された解法:

### 症状 1: `locator.click()` が timeout (intercepts pointer events)

```text
TimeoutError: locator.click: Timeout 30000ms exceeded.
  - <div class="parent-class">…</div> intercepts pointer events
```

**真因**: 親要素 (badge container, label wrapper 等) が `document.elementFromPoint` で先に
返されるため Playwright は「button が前面でない」と判定して click を待ち続ける。
button 内の `<span>` (icon + text) が hit test を捕捉している場合や、親 div が
button と同サイズで stacking 上 button を覆ってしまう場合に発生する。

**対処順**:

1. **production CSS fix (推奨)**: button 内の icon / label `<span>` に
   `pointer-events: none` を CSS で当てる。button 自身は capture できるよう残す。
2. **`force: true` を試す**: `locator.click({ force: true })` で actionability check を
   bypass。ただし Playwright は依然座標経由で click するため、親 div が前面の場合は
   親の onClick が呼ばれて button onClick に届かない (Designer の `.esd-root` がこれ)。
3. **`page.evaluate` で直接 dispatch (最終手段)**: actionability check を完全 bypass。
   ```ts
   await page.evaluate((sel) => (document.querySelector(sel) as HTMLButtonElement | null)?.click(), `[data-testid="${id}"]`);
   ```
   React の onClick は確実に発火する。helper 関数化して spec 全体で共有するのが望ましい
   (Harmony の `frontend/e2e/helpers/editSessionDropdown.ts` 参照)。

### 症状 2: Modal backdrop が click を遮蔽する

```text
TimeoutError: locator.click: Timeout 30000ms exceeded.
  - <div class="modal-backdrop"> intercepts pointer events
```

**真因**: ResumeOrDiscardDialog 等の modal が前面に出て backdrop が click を遮る。
test setup 時に modal を dismiss し忘れた / 別タブから出た modal が想定外に閲覧 tab
にも出ている。

**対処**:

1. **明示 dismiss loop を spec setup に入れる**:
   ```ts
   for (let i = 0; i < 3; i++) {
     if (await page.locator('.modal-backdrop').isVisible().catch(() => false)) {
       await page.evaluate(() => (document.querySelector('[data-testid="modal-cancel"]') as HTMLButtonElement | null)?.click());
       await page.locator('.modal-backdrop').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
     } else { break; }
   }
   ```
2. **production fix**: modal を出すべきでないシーンで出ているなら filter ロジック修正
   (例: 「自分の draft」だけ出すべき modal が「全 active session」で出ていた → 自分が
   participant の session のみ filter する)。Harmony の ResumeOrDiscardDialog は
   `participants[mySessionId]` filter で多重 tab 検証時に modal が出ない設計。

### 症状 3: 多重 browser context テストが timeout

**真因**: 2 ブラウザ context を使う test (collab / take-over 系) は 1 つのページでは
出ない問題が複合する。よくある落とし穴:

- 両 context で同じ data seed を実行する必要がある (片方だけだと UI 状態が異なる)
- broadcast 反映に時間がかかるため `await waitForTimeout(1500)` 程度入れる
- `window.confirm` override は **同期 evaluate 内で click と一緒に行う**
  (`page.on("dialog", ...)` は async race で取りこぼす)
- `finally` で context.close() に任せる (明示 discard は state race で hang する)

```ts
// ✓ 同期 evaluate で confirm + click
await page.evaluate(() => {
  window.confirm = () => true;
  (document.querySelector('[data-testid="action-btn"]') as HTMLButtonElement | null)?.click();
});
```

### 症状 4: WS 切断時に presence / heartbeat / SessionBadge が残る

**真因**: backend の `ws.on("close")` で session 関連の cleanup を呼んでいない。

**対処**: WS 切断ハンドラで該当 session の presence / lock / draft 等を即時 cleanup +
broadcast する。Harmony 側は `presenceUnregisterAllForSession(clientId)` を
`wsBridge.ts:close` で実行している (#980-A の追加 fix)。各プロダクトが独自 WS を
持つ場合は同パターンを参照。

## 最終レポート

### ProcessFlow モード (P1/P2)

```markdown
## /generate-tests 完了: <processFlow.meta.name>

### 入力
- ProcessFlow ID: <uuid>
- ProcessFlow 名: <name>
- techStack: <backend.language>/<backend.framework>/<database.type>

### 生成ファイル
- `<出力先>/<flowName>.e2e-spec.ts` (N 行, M テストケース)
- `<出力先>/jest-e2e.json` (jest 設定)

### 生成テストケース一覧
| # | description | spec anchor |
|---|---|---|
| 1 | happy path: 全フィールド指定 → 201 | act-001 responses[id="201-created"] |
| 2 | validation: title 欠落 → 400 | act-001 step:step-01 required |
| ...

### smoke 検証
- jest 実行: ✓ N/N pass / スキップ (<理由>) / ❌ (<エラー詳細>)

### 申し送り (P2 以降)
- TX-1: <TX 実装状況>
- その他
```

### Screen モード (P3)

```markdown
## /generate-tests 完了: <Screen.name> (component test)

### 入力
- Screen ID: <uuid>
- Screen 名: <name>
- Screen kind: <kind>
- techStack: <frontend.library>/<frontend.framework>

### 生成ファイル
- `<出力先>/<screenName>.component.test.tsx` (N 行, M テストケース)
- `<出力先>/vitest.config.ts` (vitest 設定)

### items index
| item.id | direction | type | valueFrom | msw mock URL |
|---|---|---|---|---|
| searchQuery | input | string | なし | — |
| posts | output | array | flowVariable (e6f7a8b9-...) | GET /api/posts/search |
| totalCount | output | integer | flowVariable (e6f7a8b9-...) | GET /api/posts/search (同上) |
| ...

### 生成テストケース一覧
| # | description | spec anchor | Section |
|---|---|---|---|
| 1 | searchQuery が DOM に存在 | Screen <id> item:searchQuery | render |
| ... | ... | ... | ... |
| N (skip) | events テスト (#864 補完待ち) | Screen <id> events[] 空配列 | events |

### smoke 検証
- vitest 実行: ✓ N/N pass, M skip / スキップ (<理由>) / ❌ (<エラー詳細>)

### 申し送り
- EVENTS-1: events[] が空。#864 (events[] 補完) 完了後に再生成すること。
- COMPONENT-1: 実際のコンポーネントパスは PLACEHOLDER。<推測パス> に配置想定。
- その他
```

---

## Step P3-1: Screen component test 生成 (P3)

Step 1-2 で Screen ID にルーティングされた場合、以下の手順で frontend component test を生成する。

テンプレート規約: `ai-skills/generate-tests/templates/frontend/react-tailwind-next/COMPONENT_SPEC.md` を Read して参照すること。

ゴールデン出力も参照: `ai-skills/generate-tests/golden-examples/screens-list-component/`

### P3-1. Screen JSON を Read で取得

- active workspace: `<workspace>/screens/<id>.json`
- フォールバック: `examples/<project-id>/harmony/screens/<id>.json`

取得する情報:
```
Screen:
  id, name, kind, path, auth, maturity
  items[]:
    id, label, type, direction
    valueFrom.kind, valueFrom.processFlowId, valueFrom.variableName  (output の場合)
    options[]  (enum の場合)
    defaultValue, required, placeholder
  events[]:
    id, trigger.kind, trigger.itemId, handlerFlowId, description
```

### P3-2. processFlowId → httpRoute index の構築

items[direction=output, valueFrom.kind=flowVariable] の processFlowId を収集し、各フローの httpRoute を解決する。

```
processFlowId 解決手順:
1. output items から valueFrom.processFlowId を収集 (重複除去)
2. 各 processFlowId について process-flows/<id>.json を Read
3. actions[0].httpRoute.method + actions[0].httpRoute.path を取得
4. map 化: { "<processFlowId>": { method: "GET", path: "/api/posts/search" } }

解決失敗 (httpRoute が空 / JSON が見つからない):
  → PLACEHOLDER "<API_BASE>/PLACEHOLDER_PATH" でテンプレ提示
  → README.md の PLACEHOLDER 解決表に未解決として記録
```

### P3-3. events[].handlerFlowId (+ handlerActionId) → httpRoute 解決

events 配列が空でない場合、各 event の handlerFlowId + handlerActionId (#1019) で対象 action を特定し、その action の httpRoute を解決する。

```
handlerFlowId + handlerActionId 解決手順:
  1. processFlowId 解決 (Step P3-2 の map を再利用) で flow JSON を取得
  2. flow.actions[] から id == handlerActionId の action を見つける
     - handlerActionId 未指定時: actions が 1 件のみ前提で actions[0] を使う
       (multi-action フローで未指定なら AMBIGUOUS、Section 4 skip + 乖離ノート)
  3. 該当 action の httpRoute (method + path) を取得
```

events 配列が空の場合:
→ Section 4 は skip テスト + 乖離検出ノートのみ生成する (P3 受け入れ基準 d)

### P3-4. Screen → component test 変換ルール (4〜6 件)

各ルールで生成する `it()` には必ず `// Spec: Screen <screenId> item:<item.id>` コメントを付与すること (D-1)。

#### SC-A. 全 items → render テスト (DOM 存在確認)

```
Screen:
  items[].id="<itemId>", items[].direction=any

生成テスト (全 items):
  /**
   * Spec: Screen <screenId> item:<itemId>
   *   direction=<direction>, type=<type>
   */
  it('#N <label> (data-testid="<itemId>") が表示される', () => {
    renderWithProviders(<COMPONENT_NAME />);
    expect(screen.getByTestId('<itemId>')).toBeInTheDocument();
  });
```

**実装前提**: コンポーネント側は各 item に `data-testid={item.id}` を付与する。
`data-testid` は `data-item-id` と等価な意味を持つが、@testing-library/react では `getByTestId` が `data-testid` をデフォルトで解釈する。

#### SC-B. items[direction=input] → type 別 state 更新テスト

type に応じて以下のスニペットを選択する:

| items[].type | DOM element | テスト手法 |
|---|---|---|
| string | `<input type="text">` | `userEvent.type()` |
| integer / number | `<input type="number">` | `fireEvent.change()` |
| enum (options あり) | `<select>` | `userEvent.selectOptions()` |
| array (複数選択) | checkbox 群 / `<select multiple>` | `userEvent.click()` / `userEvent.selectOptions()` |
| boolean | `<input type="checkbox">` / toggle | `userEvent.click()` |
| date | `<input type="date">` | `fireEvent.change()` |
| text (長文) | `<textarea>` | `userEvent.type()` |

各 input item について 1〜2 件の it() を生成する (通常の値変更 + defaultValue の初期値確認)。

#### SC-C. items[direction=output, valueFrom.kind=flowVariable] → msw mock → 表示 assert

```
Screen:
  items[].direction="output"
  items[].valueFrom.kind="flowVariable"
  items[].valueFrom.processFlowId="<processFlowId>"
  items[].valueFrom.variableName="<variableName>"

(Step P3-2 で解決済み: processFlowId → httpRoute)

生成テスト:
  /**
   * Spec: Screen <screenId> item:<outputItemId>
   *   direction=output, valueFrom.kind=flowVariable
   *   processFlowId=<processFlowId>, variableName=<variableName>
   *
   * msw で <HTTP_METHOD> <HTTP_PATH> をインターセプト → mock レスポンス → 表示 assert
   */
  it('#N <label> が API レスポンスから表示される', async () => {
    renderWithProviders(<COMPONENT_NAME />);
    await waitFor(() => {
      // PLACEHOLDER: mock レスポンスのフィールドが表示されること
      expect(screen.getByText('<mock_response_field_value>')).toBeInTheDocument();
    });
  });
```

同一 processFlowId を参照する複数の output items は、msw handler 1 個で対応する (重複追加しない)。

#### SC-D. items[direction=output, valueFrom なし] → DOM 存在確認のみ

```
Screen:
  items[].direction="output"
  (valueFrom なし、または valueFrom.kind != "flowVariable")

生成テスト:
  /**
   * Spec: Screen <screenId> item:<outputItemId>
   *   direction=output (valueFrom なし: コンポーネント内部 state or props)
   */
  it('#N <label> (data-testid="<outputItemId>") が DOM に存在する', () => {
    renderWithProviders(<COMPONENT_NAME />);
    expect(screen.getByTestId('<outputItemId>')).toBeInTheDocument();
  });
```

**SC-D の msw handler 方針** (pl-7 dogfood #1038 で確認):

valueFrom がない output items が多い画面 (例: ダッシュボード) では、実際にはコンポーネント内部で
API を呼ぶケースが多い。この場合の msw handler は以下のように生成する:

- items 全体が valueFrom なしで、かつ Screen.kind が "dashboard" / "detail" / "list" 等 API 依存が明らかな場合:
  → PLACEHOLDER msw handler を生成し、実際の API エンドポイントが判明したら差し替えを案内する
  → handlers 配列に `// PLACEHOLDER: GET /api/<resource>/<id> → データ取得 API エンドポイントを確認すること` を挿入

- items 全体が valueFrom なしで、かつ Screen.kind が "form" / "confirm" 等 UI 起動時の API 不要が明らかな場合:
  → msw handler なし (SC-D のテストのみ生成)

判断不明確な場合は PLACEHOLDER 形式で msw handler を生成し、README の PLACEHOLDER 解決表に記録する。

#### SC-E. events[].handlerFlowId → click → fetch 発火テスト

events 配列が空でない場合のみ生成する。

```
Screen:
  events[].trigger.kind="click"
  events[].trigger.itemId="<triggerItemId>"
  events[].handlerFlowId="<handlerFlowId>"
  (Step P3-3 で解決済み: handlerFlowId → httpRoute)

生成テスト:
  /**
   * Spec: Screen <screenId> events[<N>]
   *   trigger.kind=click, trigger.itemId=<triggerItemId>
   *   handlerFlowId=<handlerFlowId> → <HTTP_METHOD> <HTTP_PATH>
   */
  it('#N <イベント説明> ボタンをクリックすると <HTTP_METHOD> <HTTP_PATH> が呼ばれる', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWithProviders(<COMPONENT_NAME />);

    const button = screen.getByTestId('<triggerItemId>');
    await user.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('<HTTP_PATH>'),
        expect.objectContaining({ method: '<HTTP_METHOD>' }),
      );
    });

    vi.unstubAllGlobals();
  });
```

#### SC-F. events[] 空配列 → skip テスト + 乖離検出ノート

```
Screen:
  events[] = []  (空配列)

生成テスト:
  /**
   * NOTICE: Screen <screenId> の events[] は現在空配列です。
   * events[] 補完 (#864) が完了したら再生成してください:
   *   /generate-tests <screenId>
   *
   * 【spec ↔ impl 乖離検出ノート】
   * events 未定義の状態では、コンポーネントのボタン/アクションが
   * 特定の ProcessFlow を呼ぶことを spec で追跡できない。
   * 補完後に Section 4 を自動更新する。
   */
  it.skip('#N events テストは events[] 補完 (#864) 完了後に生成予定', () => {});
```

### P3-5. テストケース番号付け規約 (Screen)

- `#1〜#N` render: 全 items の DOM 存在確認 (items[] の順序通り)
- `#N+1〜` input: direction=input の type 別 state 更新
- `#M+1〜` output: direction=output の API 反映確認
- `#L+1〜` events: click → fetch 発火 (または skip)

### P3-6. テストファイルの構造

```typescript
/**
 * コンポーネントテスト: <Screen.name> (<Screen.kind>)
 *
 * // ===HARMONY_GENERATED_SECTION_START screenId=<screenId>===
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * Screen: <screenId> (<Screen.name>)
 * (mapping summary)
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderWithProviders } from '@/test/renderWithProviders';
// import <COMPONENT_NAME> from '<COMPONENT_PATH>';  // PLACEHOLDER

// ===HARMONY_GENERATED_SECTION_START screenId=<screenId>===
const handlers = [/* msw handlers */];
// ===HARMONY_GENERATED_SECTION_END===

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

describe('<Screen.name> コンポーネント', () => {

  describe('Section 1: render', () => { /* SC-A */ });

  describe('Section 2: input', () => { /* SC-B */ });

  describe('Section 3: output', () => { /* SC-C / SC-D */ });

  describe('Section 4: events', () => { /* SC-E or SC-F */ });

});
```

### P3-7. 出力ファイル

```
<出力先>/
  <screenName>.component.test.tsx   (本体テストファイル)
  vitest.config.ts                  (最小 vitest 設定)
```

### P3-8. smoke 検証 (vitest)

```bash
# frontend プロジェクトルートで実行
# vitest は positional filename で対象を絞る (--testPathPattern は Jest 専用 option)
# run を明示して watch mode を避ける
cd apps/web && npx vitest run --reporter=verbose <generated-filename>
```

実行環境が整っていない場合はスキップし、最終レポートに以下を記載:
```
smoke 検証: スキップ (vitest 未設定 / npm install 未実施)
推奨コマンド: cd apps/web && npx vitest <filename>.component.test
```

---

## Step 3-X: layout 込み page rendering test (pl-7 対応)

Step 1.5 で `purpose === "page"` かつ `pageLayoutId` ありにルーティングされた場合、以下の手順でテストを生成する。

### 前提情報の収集

```
1. Screen JSON から取得:
   - id, name, kind, path, purpose, pageLayoutId

2. page-layouts/<pageLayoutId>.json を Read して取得:
   - id, name
   - regions[]: { id, name }
   - assignments: { [regionId]: gadgetScreenId }
   - design.cssFramework

3. assignments の各 gadgetScreenId について screens/<gadgetScreenId>.json を Read:
   - name, path (gadget fragment の識別用)
```

### Thymeleaf 系: Spring MockMvc rendering test

techStack.backend.framework = "spring-boot" の場合に生成する。

```java
// <出力先>/<screenName>PageLayoutTest.java
// Spec anchor: Screen <screenId> layout=<pageLayoutId>

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class <ScreenName>PageLayoutTest {

    @Autowired
    private MockMvc mockMvc;

    /**
     * Spec: Screen <screenId> layout integration
     *   pageLayoutId=<pageLayoutId>
     *   regions: <region-ids.join(', ')>
     */
    @Test
    void ページリクエストでPageLayoutの外枠が描画される() throws Exception {
        // Screen <screenId> (<screen.name>)
        // ※ screen.auth="required" の場合は認証設定が必要:
        //   @WithMockUser アノテーション、または mockMvc.perform(...with(user("testUser"))) を追加すること
        mockMvc.perform(get("<screen.path>"))
            .andExpect(status().isOk())
            // PageLayout 外枠の region が含まれることを確認
            // region: header — Gadget fragment <headerGadgetId>
            .andExpect(xpath("//nav[contains(@class,'navbar')]").exists())
            // region: sidebar — Gadget fragment <sidebarGadgetId>
            .andExpect(xpath("//aside").exists())
            // region: main — Page 本文 (body-content fragment)
            .andExpect(xpath("//main").exists())
            // region: footer — Gadget fragment <footerGadgetId>
            .andExpect(xpath("//footer").exists());
    }

    /**
     * Spec: Screen <screenId> gadget assignments
     *   pageLayoutId=<pageLayoutId>
     */
    @Test
    void 各regionにGadgetのfragmentが含まれる() throws Exception {
        // region: header → <headerGadgetId> が th:replace で include される
        mockMvc.perform(get("<screen.path>"))
            .andExpect(status().isOk())
            // header gadget の代表要素 (items[] から生成)
            .andExpect(content().string(org.hamcrest.Matchers.containsString("<headerGadgetMarker>")));
            // ↑ PLACEHOLDER: 実際の Gadget items[] の label / text から選ぶこと
    }
}
```

**PLACEHOLDER 解決ガイド**:
- `<headerGadgetMarker>` は Gadget の items[] の label や output テキストから選択してください。
  例: items[direction=output] の label が "ログアウト" であれば `containsString("ログアウト")` に置き換える。
  セッション依存の動的テキスト (storeName / userName 等) は label 文字列で代替してください。
- `<screen.path>` は Screen JSON の `path` フィールド値で置き換えてください (例: `"/"`, `"/dashboard"`)。

#### Spring Security 認証済みセッションでの MockMvc テストヘルパ

`screen.auth="required"` または PageLayout で参照される Gadget の `httpRoute.auth="required"` がある場合、認証済みセッションで MockMvc を呼び出さないと 302 (login へリダイレクト) になる。以下の 3 パターンから選択する:

##### パターン 1: `@WithMockUser` (最も簡潔、ユーザー名/権限を annotation で指定)

```java
import org.springframework.security.test.context.support.WithMockUser;

@SpringBootTest
@AutoConfigureMockMvc
class <ScreenName>PageLayoutTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @WithMockUser(username = "demo", roles = {"USER"})
    void ページリクエストでPageLayoutの外枠が描画される() throws Exception {
        mockMvc.perform(get("<screen.path>"))
            .andExpect(status().isOk());
        // ...
    }
}
```

##### パターン 2: `SecurityMockMvcRequestPostProcessors.user(...)` (test ごとにユーザー切替)

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;

@Test
void ページリクエストでPageLayoutの外枠が描画される() throws Exception {
    mockMvc.perform(get("<screen.path>").with(user("demo").roles("USER")))
        .andExpect(status().isOk());
}
```

##### パターン 3: `@WithMockUser` をクラスレベル (全 test を認証済み扱い)

```java
@SpringBootTest
@AutoConfigureMockMvc
@WithMockUser(username = "demo", roles = {"USER"})  // 全 test に適用
class <ScreenName>PageLayoutTest { /* ... */ }
```

**pom.xml 依存**: 上記ヘルパは `spring-boot-starter-test` 経由で標準提供される `spring-security-test` で利用可能 (`@WithMockUser` / `SecurityMockMvcRequestPostProcessors`):

```xml
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-test</artifactId>
    <scope>test</scope>
</dependency>
```

### NestJS/Next.js 系: Playwright layout mount test

techStack.frontend.framework = "next" の場合に生成する。

```typescript
// <出力先>/<screenName>-layout.e2e.spec.ts
// Spec anchor: Screen <screenId> layout=<pageLayoutId>

import { test, expect } from '@playwright/test';

test.describe('<screen.name> — layout 込み描画 (<pageLayoutId>)', () => {

  /**
   * Spec: Screen <screenId> layout integration
   *   pageLayoutId=<pageLayoutId>
   *   regions: <region-ids.join(', ')>
   */
  test('AppLayout が描画され、全 region に Gadget が表示される', async ({ page }) => {
    // Screen <screenId> (<screen.name>) に直接アクセス
    await page.goto('<screen.path>');

    // PageLayout 外枠 region の存在確認
    // region: header — <headerGadgetId>
    await expect(page.locator('header')).toBeVisible();
    // region: sidebar — <sidebarGadgetId>
    await expect(page.locator('aside')).toBeVisible();
    // region: main — Page 本文 (children)
    await expect(page.locator('main')).toBeVisible();
    // region: footer — <footerGadgetId>
    await expect(page.locator('footer')).toBeVisible();
  });

  /**
   * Spec: Screen <screenId> gadget content in regions
   */
  test('header region に Gadget の代表要素が含まれる', async ({ page }) => {
    await page.goto('<screen.path>');
    // header gadget の代表要素 (items[] から選択)
    // PLACEHOLDER: 実際の Gadget items[] の label / text に置き換える
    await expect(page.locator('header').getByText('<headerGadgetLabel>')).toBeVisible();
  });
});
```

### 生成ファイル

```
techStack.backend.framework = "spring-boot":
  <出力先>/<ScreenName>PageLayoutTest.java

techStack.frontend.framework = "next":
  <出力先>/<screenName>-layout.e2e.spec.ts
```

両 techStack が設定されている場合は両方を生成する。

---

## Step 3-Y: gadget 単独 component test (pl-7 対応)

Step 1.5 で `purpose === "gadget"` にルーティングされた場合、以下の手順で Gadget 単独テストを生成する。

### 前提情報の収集

```
1. Gadget Screen JSON から取得:
   - id, name, items[], events[], processFlowId

2. processFlowId がある場合、process-flows/<processFlowId>.json を Read:
   - actions[].httpRoute (POST path の解決用)
```

### Thymeleaf 系: Thymeleaf template engine test

techStack.backend.framework = "spring-boot" の場合に生成する。

```java
// <出力先>/<GadgetName>GadgetFragmentTest.java
// Spec anchor: Screen <gadgetId> (purpose=gadget)

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class <GadgetName>GadgetFragmentTest {

    @Autowired
    private MockMvc mockMvc;

    /**
     * Spec: Screen <gadgetId> (purpose=gadget) items render
     */
    @Test
    void Gadgetのitems要素が描画される() throws Exception {
        // Gadget は fragment 単体では URL なし — layout 経由で描画される
        // layout 込みの Page (<any page with pageLayoutId>) 経由で確認
        // PLACEHOLDER: pageLayoutId を持つ任意の Page の path に置き換える
        mockMvc.perform(get("<pageWithThisLayoutPath>"))
            .andExpect(status().isOk())
            // items[direction=output] の label/text が含まれることを確認
            // Spec: Screen <gadgetId> item:<item.id>
            .andExpect(content().string(org.hamcrest.Matchers.containsString("<itemLabel>")));
    }

    // processFlowId あり、action.id != "act-logout" の場合のみ生成
    /**
     * Spec: Screen <gadgetId> event:<eventId> → ProcessFlow <processFlowId> act-<actionId>
     *   httpRoute: <action.httpRoute.method> <action.httpRoute.path>
     *   auth: <action.httpRoute.auth>
     */
    @Test
    @WithMockUser(username = "demo", roles = {"USER"})  // auth=required の場合
    void Gadgetアクションが正常に処理される() throws Exception {
        mockMvc.perform(post("<action.httpRoute.path>").with(csrf())
                // inputs[] → form params
                .param("<inputName>", "<testValue>"))
            .andExpect(status().is3xxRedirection())  // screenTransition / redirectTo
            .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("<redirectPath>")));
    }

    // action.id == "act-logout" かつ techStack.auth.method == "session" の場合のみ生成 (#1035 S-3)
    /**
     * Spec: Screen <gadgetId> event:<eventId> → act-logout (LogoutFilter 経由)
     *   httpRoute: POST <logoutPath>
     *
     * 注: techStack.auth.method=session の場合、本 path は SecurityConfig の
     * .logoutRequestMatcher(...) で LogoutFilter が処理する。GadgetController / AuthController
     * は生成されないため、LogoutFilter chain 挙動を直接検証する。
     */
    @Test
    @WithMockUser(username = "demo", roles = {"USER"})
    void ログアウトすると302で_loginlogoutに_redirect() throws Exception {
        mockMvc.perform(post("<logoutPath>").with(csrf()))
            .andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/login?logout"));
        // LogoutFilter が SecurityContext クリア + HttpSession invalidate + JSESSIONID 削除を実行済み
    }

    // httpRoute.auth="required" の場合のみ生成
    /**
     * Spec: Screen <gadgetId> event:<eventId> httpRoute.auth="required"
     *   未認証でアクセスした場合の認証エラー確認
     */
    @Test
    void 未認証でのGadgetアクションは認証エラーになる() throws Exception {
        // セッションなしで POST → Spring Security: 401 または 302 (ログインページへリダイレクト)
        mockMvc.perform(post("<action.httpRoute.path>").with(csrf()))
            .andExpect(status().is(org.hamcrest.Matchers.oneOf(401, 302, 403)));
    }
}
```

ProcessFlow が存在しない Gadget (design-only): アクションテストを生成しない。

### NestJS/Next.js 系: vitest + React Testing Library

techStack.frontend.framework = "next" の場合に生成する。

```typescript
// <出力先>/<gadgetId>.component.test.tsx
// Spec anchor: Screen <gadgetId> (purpose=gadget)

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { <GadgetName>Gadget } from '@/app/components/gadgets/<gadgetId>';

// processFlowId あり: server action を mock
vi.mock('@/app/components/gadgets/<gadgetId>/actions', () => ({
  <gadgetActionName>Action: vi.fn().mockResolvedValue(undefined),
}));

describe('<GadgetName>Gadget (purpose=gadget)', () => {

  /**
   * Spec: Screen <gadgetId> item:<item.id>
   *   direction=output, type=<type>
   */
  it('output items が表示される', () => {
    // Spec: Screen <gadgetId> items render
    render(<GadgetName>Gadget />);

    // items[direction=output] → getByText / getByRole
    expect(screen.getByText('<outputItemLabel>')).toBeInTheDocument();
    // ↑ PLACEHOLDER: 実際の output item の label に置き換える
  });

  // items[direction=input] がある場合のみ生成
  /**
   * Spec: Screen <gadgetId> item:<inputItem.id>
   *   direction=input, type=<type>
   */
  it('input items が入力可能', () => {
    render(<GadgetName>Gadget />);
    const input = screen.getByRole('textbox', { name: '<inputItemLabel>' });
    // ↑ PLACEHOLDER: 実際の input item の label に置き換える
    expect(input).toBeInTheDocument();
  });

  // processFlowId あり かつ events[] に handlerFlowId がある場合のみ生成
  /**
   * Spec: Screen <gadgetId> event:<eventId>
   *   handlerFlowId=<processFlowId>, handlerActionId=<actionId>
   */
  it('submit イベントで server action が発火する', async () => {
    const { <gadgetActionName>Action } = await import(
      '@/app/components/gadgets/<gadgetId>/actions'
    );
    render(<GadgetName>Gadget />);

    const button = screen.getByRole('button', { name: '<submitButtonLabel>' });
    // ↑ PLACEHOLDER: 実際の submit ボタンの label に置き換える
    fireEvent.click(button);

    expect(<gadgetActionName>Action).toHaveBeenCalledOnce();
  });
});
```

### 生成ファイル

```
techStack.backend.framework = "spring-boot":
  <出力先>/<GadgetName>GadgetFragmentTest.java

techStack.frontend.framework = "next":
  <出力先>/<gadgetId>.component.test.tsx
```

両 techStack が設定されている場合は両方を生成する。

---

## Step P4: E2E シナリオテスト生成 (Playwright, multi-screen) — #873

Step 0 で `--scenario` / `--scenario-name` フラグが検出された場合、または
フラグなし UUID が ProcessFlow / Screen どちらにもマッチしない場合にこのパスに入る。

**D-6 確定**: E2E は常に Playwright (vitest / jest ではない)
**D-7 確定**: SQLite 環境では `--workers=1` 必須 (playwright.config.ts で設定)

テンプレート規約: `ai-skills/generate-tests/templates/e2e/playwright/SCENARIO.md` を Read して参照すること。

ゴールデン出力も参照:
```
ai-skills/generate-tests/golden-examples/diary-post-lifecycle-e2e/
  post-lifecycle.e2e.spec.ts   — 投稿ライフサイクルシナリオ (全 6 テスト, 9 steps)
  playwright.config.ts         — SQLite workers=1 設定
  helpers/auth.ts              — loginAs() / loginViaUI() helper
  helpers/db.ts                — seedTestData() / truncateTestData() helper
  README.md                    — PLACEHOLDER 解決表 + 遷移導出フロー + 再 invocation 例
```

### P4-0. 引数解析 (--scenario フラグ)

`$ARGUMENTS` に以下のフラグが含まれる場合、P4 E2E シナリオ生成へルーティングする:

```
フラグ形式:
  --scenario <screenId-from> <screenId-to>
  --scenario-name "<name>" <screenId-1> ... <screenId-N>

ルーティング判定:
  --scenario あり      → P4 へ (2 画面間シナリオ)
  --scenario-name あり → P4 へ (N 画面シナリオ、名前付き)
  フラグなし + UUID    → 既存の ProcessFlow / Screen 判定 (P1/P2/P3) へ
```

シナリオ ID の生成: `--scenario-name` の値を kebab-case 化 (例: "投稿ライフサイクル" → "post-lifecycle")。
フラグなしの場合は `scenario-<8桁UUID>` 形式で自動生成。

### P4-1. harmony.json 読込 + screen path index 構築

Step 1-1 と同様に active workspace の `harmony.json` を Read する。

以下の情報を取得:
- `entities.screens[]` → screen path index を構築:
  ```
  screenPathIndex[screen.id] = { name, path, kind }
  ```
- `entities.screenTransitions[]` → 遷移チェーン index を構築 (1次ソース)
- `techStack.auth.method` → auth helper の方式を決定 (jwt / session / none)

### P4-2. 画面遷移導出 (3段 fallback)

引数の screenId 群から遷移チェーンを導出する。

```
遷移導出アルゴリズム:

★ 1次ソース: screenTransitions[]
  if entities.screenTransitions.length > 0:
    指定 screenId に関連する screenTransition を収集し、
    from → trigger → to のチェーンを構築する。
    anchor: // Spec: Screen <fromId> via screenTransition <transitionId>

★ 2次ソース: screen.events[].handlerFlowId → ProcessFlow → next screen
  elif 各 screen の events[] に handlerFlowId あり:
    handlerFlowId → ProcessFlow JSON を Read
    ProcessFlow 完了後の遷移先 (nextScreen / httpRoute.redirectTo) から導出。
    anchor: // Spec: Scenario <id> step:<N> via events[].handlerFlowId

★ 3次ソース: path-based 推測 (kind 慣習)
  else (screenTransitions=[] かつ events 未補完):
    screen.kind の慣習から遷移先を推測:
      "login"  → "list"   (ログイン成功 → トップの一覧画面)
      "list"   → "form"   (一覧の "新規作成" → フォーム)
      "list"   → "detail" (一覧の item クリック → 詳細)
      "detail" → "form"   (詳細の "編集" → フォーム)
      "detail" → "list"   (詳細の "削除" → 一覧)
      "form"   → "detail" (作成/更新 → 詳細)
      "form"   → "list"   (キャンセル / 削除後 → 一覧)
    anchor 必須:
      // TODO: screenTransitions 補完待ち
      // ⚠️ 推測で生成: screenTransitions[] または events[] を補完後に再生成すること
```

### P4-3. ProcessFlow → httpRoute index 構築

各 screen に関連する ProcessFlow の httpRoute を収集する (API verify 用)。

```
ProcessFlow index 構築手順:
1. 引数の screenId に関連する ProcessFlow を収集
   - screenTransitions の trigger.processFlowId
   - screen.events[].handlerFlowId
   - meta.name から推測 (例: "投稿作成" → 投稿フォームの submit)
2. 各 ProcessFlow JSON を Read して httpRoute を取得
3. map 化: { "<processFlowId>": { method, path } }

解決失敗 (ProcessFlow JSON が見つからない / httpRoute が空):
  → PLACEHOLDER "<HTTP_METHOD> <PLACEHOLDER_PATH>" で生成
  → README の PLACEHOLDER 解決表に記録
```

### P4-4. テストファイル構造

```typescript
/**
 * E2E シナリオテスト: <シナリオ名>
 *
 * // ===HARMONY_GENERATED_SECTION_START scenario=<scenarioId>===
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * (Section 2 の header テンプレートに従う)
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { seedTestData, truncateTestData } from './helpers/db';

test.describe('<シナリオ名> E2E', () => {
  let context: BrowserContext;
  let page: Page;

  // beforeAll: context 作成 + seedTestData()
  // afterAll: truncateTestData() + context.close()
  // beforeEach: loginAs() (auth=required の screen が含まれる場合)

  // step 2〜N の test() ブロック
  // 最後に「完全シナリオ (通しテスト)」を追加
});
```

### P4-5. step anchor 付与規約 (D-1)

各 `test()` 内の各操作に以下のコメントを付与する:

```typescript
/**
 * Spec: Scenario <scenarioId> step:<N>
 *   <操作内容の説明>
 *
 * (遷移が screenTransitions 由来の場合):
 * Spec: Screen <screenId> via screenTransition <transitionId>
 *
 * (遷移が path-based fallback の場合):
 * TODO: screenTransitions 補完待ち
 * ⚠️ 推測で生成: <from.kind>→<to.kind> 慣習
 */
```

### P4-6. auth-flow 生成ルール

`techStack.auth.method` に応じて auth helper を選択する:

```
auth.method = "jwt":
  → loginAs(page, { username, password }) — API 経由 (helpers/auth.ts)
  → PLACEHOLDER: /api/auth/login エンドポイントを確認すること

auth.method = "session":
  → loginViaUI(page, { username, password }) — UI 経由 (helpers/auth.ts)

auth.method = "none":
  → auth step は生成しない
```

`screen.auth` が `"required"` の screen が含まれる場合、beforeEach で loginAs() を呼ぶ。

### P4-7. DOM assertion 生成ルール

screen の `items[]` から DOM assertion を生成する:

```
items[direction=output]:
  → await expect(page.getByTestId('<itemId>')).toBeVisible()
  → valueFrom.kind=flowVariable かつ API が判明している場合:
     → page.waitForResponse() で API 呼び出しを確認

items[direction=input]:
  → await page.fill('[data-testid="<itemId>"]', '<testValue>')
  → await page.selectOption('[data-testid="<itemId>"]', '<option>') (enum の場合)

items[] が空 / items なし:
  → // PLACEHOLDER: Screen の items が未定義。コンポーネント実装確認後に data-testid を設定すること
```

### P4-8. SQLite --workers=1 設定 (D-7)

生成する `playwright.config.ts` には必ず以下を設定する:

```typescript
export default defineConfig({
  // D-7: SQLite --workers=1 必須
  fullyParallel: false,
  workers: 1,
  // ...
});
```

`database.type = "sqlite"` 以外 (Postgres / MySQL) の場合は `fullyParallel: true` でよい。

### P4-9. 出力ファイル

```
<出力先>/
  <scenarioName>.e2e.spec.ts   — E2E スペックファイル (本体)
  playwright.config.ts         — Playwright 設定 (SQLite workers=1)
  helpers/
    auth.ts                    — loginAs() / loginViaUI() helper
    db.ts                      — seedTestData() / truncateTestData() helper
  README.md                    — PLACEHOLDER 解決表 + 遷移導出フロー + 再 invocation 例
```

### P4-10. smoke 検証 (playwright headless)

```bash
# 前提: backend と frontend を手動起動しておくこと
# (AI は dev server を spawn しない — feedback_no_ai_managed_dev_server.md)
npx playwright test --config=<出力先>/playwright.config.ts --workers=1 2>&1 | tail -30
```

実行環境が整っていない場合はスキップし、最終レポートに以下を記載:
```
smoke 検証: スキップ (dev server 未起動 / playwright install 未実施)
推奨コマンド: npx playwright test --config=<出力先>/playwright.config.ts --workers=1
```

### P4-11. 最終レポート (P4 モード)

```markdown
## /generate-tests 完了: <シナリオ名> (E2E シナリオ)

### 入力
- シナリオ: <シナリオ名>
- 対象 screens: <id1> (<name1>, <path1>) → ... → <idN> (<nameN>, <pathN>)
- 遷移導出: <1次/2次/3次> (<理由>)

### screen path index
| screenId | name | path | kind |
|---|---|---|---|
| <id1> | <name1> | <path1> | <kind1> |

### 生成ファイル
- `<出力先>/<scenarioName>.e2e.spec.ts` (N 行, M テスト)
- `<出力先>/playwright.config.ts` (workers=1)
- `<出力先>/helpers/auth.ts`
- `<出力先>/helpers/db.ts`
- `<出力先>/README.md`

### シナリオステップ一覧
| step | 画面 | 操作 | spec anchor | 遷移導出 |
|---|---|---|---|---|
| 1 | ログイン | loginAs() API 経由 | Scenario <id> step:1 | — |
| 2 | <name1> | page.goto('<path1>') | Screen <id1> step:2 | 3次 |
| ...

### smoke 検証
- playwright 実行: ✓ N/N pass / スキップ (<理由>)

### 申し送り
- SCENARIO-1: screenTransitions 空 → path-based fallback。#864 close 後に再生成推奨。
- PLACEHOLDER: <未解決の PLACEHOLDER 一覧>
```

---

## Step P5: AI flow mock + 実 API 切替テスト生成 — #874 / Phase 2-B

ProcessFlow に `kind ∈ {aiCall, aiAgent}` の step が含まれる場合、P5 ルートが自動的に有効化される。
P5 は P1/P2 と並列して生成する (P1/P2 の happy path / validation テストに加えて AI 固有テストを追加)。

> **Phase 2-A (PR #937, 2026-05-08) の前提**: 旧 `kind=externalSystem` + `systemRef=claudeApi` /
> 旧 `english-learning:LlmDialog` パターンは全 sample で `aiCall` に移行済。本 skill は
> aiCall / aiAgent のみを認識する。旧パターンが残るフローは Phase 2-A 移行漏れなので spec 側で起票。

> **Phase 2-C (`/generate-code`) との関係**: 実 backend 実装の AI runtime / SDK 切替は
> `/generate-code` Phase 2-C (PR #944 想定) で確定した `AiRuntimeService.invoke` を使う。
> mock target は固定契約として: type=`AiRuntimeService` / method=`invoke` /
> import path=`../src/ai/ai-runtime.service` (e2e-spec から見た相対パス)。
> 旧 PLACEHOLDER 形式 (`AI_RUNTIME_SERVICE_*`) は廃止。

テンプレート規約: `ai-skills/generate-tests/templates/backend/typescript-nestjs/E2E_SPEC.md` の Section 16 (AI flow セクション) を Read して参照すること。

ゴールデン出力も参照:
```
ai-skills/generate-tests/golden-examples/diary-ai-tag-suggest/
  ai-tag-suggest.e2e-spec.ts   — AIタグ提案 (aiCall + structuredObject) mock + 実 API テスト
  mocks/ai-runtime.ts          — AI runtime service mock helper (provider 中立形式)
  README.md                    — PLACEHOLDER 解決表 + 再 invocation 例
```

### P5-1. AI flow 検出アルゴリズム

ProcessFlow JSON を読み込み、以下の条件で AI flow かどうかを判定する:

```
AI flow 判定条件:
  actions[].steps[] (および inlineBranch.{ok,ng} / branches[].steps / elseBranch.steps を再帰探索)
  に step.kind ∈ { "aiCall", "aiAgent" } が 1 件以上含まれる場合 → AI flow

旧パターンの扱い (Phase 2-A 完了後):
  - kind="externalSystem" + systemRef がモデル系名 (claudeApi 等) は P5 検出対象外。
    Phase 2-A で全 sample 移行済み。残存は移行漏れとして report に warning を出力する。

aiCall vs aiAgent の差分:
  - aiCall:  single-shot 呼び出し。tools 任意。outputBinding は最終 assistant message。
  - aiAgent: tools 必須 (minItems=1) + maxIterations。tool call ループはランタイムが内部処理し、
             outputBinding には最終 assistant message のみが入る。途中の tool 呼び出しは
             個別 step として現れない (spec §「outputBinding の値構造」)。
             → テスト観点は aiCall と同じ 4 観点 + agent 特有テスト (P5-3 補足) を追加する。
```

### P5-2. modelEndpoints catalog 解決 → mock target 決定

```
catalog merge ルール (#939 提案 C, 2026-05-08):
  1. project level catalog: examples/<project-id>/harmony/catalogs/external.json
       (workspace モードでは <workspace>/catalogs/external.json)
  2. flow level catalog:    <flow>.context.catalogs.modelEndpoints
  3. merge: 同一キーなら flow level が project level を override
  4. step.modelRef → merged.modelEndpoints[modelRef] = ModelEndpointEntry を取得

ModelEndpointEntry から抽出する情報:
  - provider:   anthropic / openai / google / aws-bedrock / ollama / azure-openai / namespace:custom
  - model:      provider 固有 model ID (例: 'claude-opus-4-7')
  - endpoint:   API base URL (省略時 provider default)
  - auth:       { kind: bearer/basic/apiKey/oauth2/iamRole/azureAd/none, tokenRef?: '@secret.<key>' }
  - defaults:   { temperature, maxTokens, topP, topK, stopSequences } (推論パラメータ)
  - fallback:   primary 失敗時の別 modelEndpoint key (任意)

secrets 解決:
  auth.tokenRef = "@secret.<secretKey>" → merged.secrets[secretKey] を取得
    secrets.<key>.source = "env" の場合: secrets.<key>.name が env var 名 (例: ANTHROPIC_API_KEY)
    Phase 2-B 時点では env source のみ想定 (vault 等は別 ISSUE)

mock target の決定 (Phase 2-C 確定後):
  - 実装側 service: AiRuntimeService (固定契約)
      type:   AiRuntimeService
      method: invoke
      import: ../src/ai/ai-runtime.service (e2e-spec から見た相対パス)
  - mock 対象 method の戻り値型は spec §「outputBinding の値構造」に従う正規化形式:
      AiInvocationResult = {
        text?: string;                          // text / streaming / json (人間可読部)
        object?: unknown;                       // json / structuredObject (parse 済み)
        raw?: string;                           // json / structuredObject (provider 生 JSON 文字列)
        finishReason?: string;
        usage?: { inputTokens?: number; outputTokens?: number };
        toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
      }
  - jest: jest.spyOn(aiRuntime, 'invoke').mockResolvedValue(<AiInvocationResult>)
  - vitest (P3 採用、ただし AI flow は P1/P2 backend なので jest 固定): 同パターン
  - mockResolvedValue / mockResolvedValueOnce の選択: 1 テスト 1 mock が原則 (afterEach で
    mockRestore() する前提)。Once 系は 1 リクエスト中に複数回 invoke される将来パターン (retry
    sequence 等) でのみ使用。

@env.* / @secret.* 参照の扱い (Phase 2-B 時点):
  @secret.<secretKey> → merged.secrets[secretKey].name から env var 名を抽出
                        テスト内では process.env.<env-name> を直接参照 (#859 未解決)
  @env.<envKey>       → harmony.json の context.envCatalog (#859 解決後) から取得予定。
                        現状は PLACEHOLDER + literal fallback。
  @conv.<key>         → conventions catalog から解決 (#859 解決後)。現状は compute step
                        expression からリテラル抽出 (例: 0.6)。
```

### P5-3. step.kind=aiCall|aiAgent → テスト変換ルール

AI flow 検出後、以下の 4 観点 (AI-1〜AI-4) でテストを自動生成する。各 `it()` には D-1 anchor
`// Spec: ProcessFlow <flowId> step:<step-id> [ai-mode:mock|live]` を必ず付与する。

#### responseFormat 別の mock 戻り値構造

`step.responseFormat.kind` を見て mock の戻り値を分岐する。未指定は `text` 扱い。

| responseFormat.kind | mock 戻り値 | 後続 step での参照 |
|---|---|---|
| `text` (default) | `{ text: '<生成テキスト>', finishReason: 'end_turn', usage: {...} }` | `@<bind>.text` |
| `json` | `{ object: <任意 JSON>, raw: '<JSON 文字列>', ...meta }` | `@<bind>.object` / `@<bind>.raw` |
| `structuredObject` | `{ object: <responseFormat.schema 準拠>, raw: '<JSON.stringify(object)>', ...meta }` | `@<bind>.object.<field>` |
| `streaming` | `{ text: '<完了後 assembled>', ...meta }` (本テスト層では partial chunks を扱わない) | `@<bind>.text` |

`tools` を含む aiCall / aiAgent で tool call が発生したパスを mock する場合は上記に加え:
```ts
{ toolCalls: [{ id, name, arguments }] }
```
を返す。aiAgent は最終 assistant message を上記正規化形式で返す (途中の tool 呼び出しは
ランタイムが処理するため mock 対象外)。

#### AI-1: 業務フィルタ / map 検証 (responseFormat-aware)

対象: `step.kind=compute` で `@<aiBinding>.object.*` または `@<aiBinding>.text` を加工する step。

```
変換ルール:
  1. 後続 compute step の expression を解析:
     - aiCall.responseFormat=structuredObject → "@aiResponse.object.<field>.filter(...).map(...)" 形式
       例 (diary タグ提案): "@aiResponse.object.tags.filter(t => t.confidence >= @conv.limit.tagSuggestThreshold)..."
     - aiCall.responseFormat=text/streaming → "@aiResponse.text" を文字列加工する
     - aiCall.responseFormat=json → "@aiResponse.object.*" (構造制約なし)
  2. filter 条件 (例: confidence >= threshold) を抽出。
     - リテラル比較 → 値を直接使用
     - @conv.* 参照 → conventions catalog から解決 (Phase 2-B 時点: PLACEHOLDER + 補助 const)
  3. mock の object に境界値を含む fixture を構築 (responseFormat.schema 準拠で書く):
     - 閾値超過 (採用期待) / 閾値未満 (除外期待) / 閾値ちょうど (採用期待、境界値)
  4. 生成テスト:
     - aiResponse.object に閾値未満を含む fixture → response から除外されていること
     - aiResponse.object に閾値以上を含む fixture → response に含まれていること
     - 境界値ちょうど → 含まれていること
  5. AI-1 該当 compute が見つからない場合は AI-1 を skip し、申し送りに記録する。

注: 旧版 (externalSystem) の "JSON.parse(@aiResponse.content[0].text).filter(...)" は廃止。
    aiCall (structuredObject) では runtime が JSON parse 済み → user code は @<bind>.object.* を直接参照する。
```

#### AI-2: secret 未設定 → 503 fallback

```
変換ルール:
  1. step.modelRef → merged.modelEndpoints[modelRef].auth.tokenRef ('@secret.<key>') を取得
  2. merged.secrets[<key>].name を env var 名として抽出 (例: ANTHROPIC_API_KEY)
  3. mock で API key 未設定状態を再現:
     const originalKey = process.env.ANTHROPIC_API_KEY;
     process.env.ANTHROPIC_API_KEY = '';
     try {
       // リクエスト実行
       expect(res.status).toBe(503);
     } finally {
       process.env.ANTHROPIC_API_KEY = originalKey;  // 必ず restore
     }
  4. 期待 HTTP status: 503 (Service Unavailable)
     注: API key 未設定時は provider 呼び出し前に 503 を返す実装が前提。
         実装が 401 / 500 を返す場合はその status に合わせて修正する旨をコメントに明記。

生成テスト:
  #N AI-2: <ENV_VAR_NAME> 未設定 → 503 Service Unavailable

modelEndpoint.auth.kind が "none" / "iamRole" / "azureAd" の場合の扱い:
  - "none":    AI-2 を skip (env secret 不要のため)
  - "iamRole": AI-2 を skip + 申し送りに「IAM ロール解決失敗テストは別 ISSUE 候補」と記載
  - "azureAd": 同上 (Azure AD 認証失敗テストは別 ISSUE)
```

#### AI-3: response format violation (responseFormat-aware)

旧版 (externalSystem) の「JSON.parse 失敗 → 500」は user code 側で parse していた前提。
aiCall では runtime が parse / schema 検証を担うため、AI-3 の生成可否は responseFormat に依存する。

```
分岐ルール:
  responseFormat.kind = "text"            → AI-3 を skip (parse / 検証ステップが無い)
  responseFormat.kind = "streaming"       → AI-3 を skip (assembled text のみ受け取る)
  responseFormat.kind = "json"            → AI-3 生成: provider が malformed JSON を返した想定
                                            mock で raw=invalid を返し、runtime parse 失敗 → 502 期待
  responseFormat.kind = "structuredObject" → AI-3 生成: provider 出力が schema 違反の想定
                                            mock で object=schema 違反値 (例: required field 欠落) を返し、
                                            runtime schema 検証失敗 → 502 期待

mock 例 (structuredObject、schema 違反):
  jest.spyOn(aiRuntime, 'invoke').mockResolvedValue({
    object: { tags: [{ slug: 'x' }] },  // confidence 必須が欠落 → schema violation
    raw: '{"tags":[{"slug":"x"}]}',
  });

生成テスト (該当時):
  #N AI-3: AI 応答が responseFormat 不適合 (<kind>) → 502 (provider violation)

注:
  - 旧 AI-3 の HTTP 500 は user code parse エラー由来。runtime parse / 検証失敗は仕様上 502
    (provider 側エラー) として扱う。実装が 500 を返す場合は申し送り + コメント上書き。
  - aiAgent は最終 assistant message のみで判定 (途中 tool call の format violation は対象外)。
```

#### AI-4: provider 呼び出し失敗 → outcomes.failure

```
変換ルール:
  1. step.outcomes.failure を取得 (#937 移行後の標準形):
     { action: "abort" | "continue" | "compensate", description?, jumpTo?, sideEffects?, sameAs? }
     注: 本フィールドに responseId は直接含まれない。間接解決 (step 2) で求める。
  2. action="abort" の場合の responseId 解決パス (間接):
     (a) catalog.errors 経由: context.catalogs.errors[<errorCode>].responseId を引き、
         action.responses[responseId].status を期待値とする
         例: errors.AI_API_ERROR.responseId="502-ai-error" → responses["502-ai-error"].status=502
     (b) AI 系の慣例 (catalog に該当 errors entry / responseId が無い場合): 502 をデフォルト
     (c) action.responses[] が空 / 未定義の場合: 502 をデフォルト
     → いずれの場合も最終的な期待 status は 502 が典型 (provider 失敗を反映)。
  3. mock で provider 呼び出しが reject するよう設定:
     jest.spyOn(aiRuntime, 'invoke').mockRejectedValue(
       new Error('Mock provider error')
     );
     ※ retry policy は Phase 2-B 時点では modelEndpoint に未定義。SDK 内部の retry は
        Phase 2-C で確定するため、AI-4 は単発失敗のみテストし「retry 回数」は assertion しない。
        retry が定義された段階で AI-4-b としてサブテストを追加する (申し送り)。
  4. 期待 HTTP status: 上記 (a)/(b)/(c) で解決した値。

生成テスト:
  #N AI-4: provider 呼び出し失敗 → <statusCode> (<errorCode>)

aiAgent 補足:
  - maxIterations 超過パスは現状 outcomes.failure として未確定 (spec 拡張候補)。
    Phase 2-B では mock 1 回失敗のみテスト、agent loop は申し送り。
```

### P5-4. AiMessageSpread の検出と fixture 化

```
検出:
  step.messages[] を走査し、各要素について oneOf を判定:
    - { role, content } 型     → 通常メッセージ (AiMessage)
    - { kind: "spread", ref }  → 動的展開 (AiMessageSpread) ★ 検出対象

fixture 化:
  ref が "@<varName>" 形式の場合:
    1. ref から varName を抽出 (例: "@turnContext" → "turnContext")
    2. varName の出所を解決:
       - actions[0].inputs[].name == varName → request body / query から渡る
       - 直前の compute / dbAccess の outputBinding.name == varName → 直前 step が値を生成
       - context.ambientVariables[].name == varName → JWT / session から取得
    3. テスト fixture: AiMessage 互換配列 [{ role: 'user'|'assistant'|'system', content: string }, ...]
       を input として渡す (typical: 過去 turns 2〜3 件)

mock 戻り値への影響:
  spread item は LLM への input 側のみに影響。mock の戻り値 (AiInvocationResult) は responseFormat 通り。
  mock 内で input を assert する場合は AI runtime service の引数を spy するが、AiMessageSpread が
  正しく展開されたかの検証は本層では skip し、Phase 2-C の runtime ユニットテスト側に委ねる。

例: english-learning 96118ae1 (会話ターン進行)
  step-03 messages:
    [
      { role: 'system', content: '...' },
      { kind: 'spread', ref: '@turnContext' },
      { role: 'user', content: '@userInput' }
    ]

  → action.inputs[] に turnContext (string) があるが、spec 上は "DialogTurn[] の JSON 文字列 (暫定)"
     と書かれている (#939 提案 A 移行で type を AiMessage[] に変えるのが理想だが、現状は string)。
     テスト fixture では JSON.parse 後に AiMessage[] になる文字列を渡す。

     **fixture 変数の定義 (ファイル先頭で const として定義すること)**:
     ```typescript
     // AiMessageSpread fixture: @turnContext (DialogTurn[] の JSON 文字列)
     // Spec: step-<N> messages[<M>] kind="spread", ref="@turnContext"
     const turnContextFixture = JSON.stringify([
       { role: 'user', content: 'Hello!' },
       { role: 'assistant', content: 'Hi, how are you?' }
     ]);
     ```
     request body には `turnContext: turnContextFixture` として渡す。
     2〜3 ターン分を含めると会話コンテキストの spread 動作が検証できる。
```

### P5-5. AiImageSource variant の生成例

`step.messages[].content[]` に `{ type: "image", source: ... }` がある場合、source.kind 別に fixture を生成する。

```
source.kind = "fileRef":
  source = { kind: "fileRef", ref: "@inputs.photo" }
  → action.inputs[] に "photo" (file 型) がある前提
  → テスト fixture:
       const photoFile = Buffer.from(<test image data>);
       request(...).field('title', '...').attach('photo', photoFile, 'test.jpg')
     または upload helper 経由で fileRef を obtain して payload に渡す。
  → mock 側は photo の内容を検証しない (provider が実際に画像を解釈しないため)。

source.kind = "url" (literal):
  source = { kind: "url", url: "https://cdn.example.com/photo.jpg" }
  → 固定 URL のため fixture は不要。リクエスト body に追加情報は要らない。
  → mock は無条件で AI 応答を返す (URL の到達性は本層では検証しない)。

source.kind = "url" (expression "@<var>"):
  source = { kind: "url", url: "@photoRow.url" }
  → @photoRow が直前の dbAccess outputBinding か、@inputs.imageUrl が action input か等を解析:
       photoRow = SELECT 結果 → seed data で photos.url が解決される必要あり (P2 連携)
       inputs.imageUrl = string → request body に imageUrl を含める
  → テスト fixture: request body / DB seed で URL 値を埋める。
     必要に応じて HEAD 200 を返す mock URL を選ぶ (例: https://example.com/test.jpg。
     本層では URL 到達は検証せず、provider mock が応答を返すだけ)。

source.kind = "base64":
  source = { kind: "base64", data: "<base64>", mediaType: "image/jpeg" }
  → mock 入力に base64 データが含まれる。テスト fixture で短い base64 (1x1 透明 PNG 等) を準備し、
     リクエスト body に含めるか step input に直書きする。

例: diary b0c1d2e3 (画像 alt 生成)
  step-05 messages[1].content[0].source = { kind: "url", url: "@targetImageUrl" }
  step-04 で targetImageUrl = @photoRow.url ?? @inputs.imageUrl と算出
  → test fixture (2 通り):
     (a) photoId 指定 → DB seed で photos に該当 row + url を入れる → @photoRow.url が解決される
     (b) imageUrl 指定 → request body に imageUrl: 'https://example.com/test.jpg' を直接含める
```

### P5-6. mock helper の構造 (provider 中立)

旧版の `mocks/claude-api.ts` (Anthropic 形式の HTTP レスポンス mock) は廃止。Phase 2-B では
**provider 中立な AI runtime service mock** を生成する。

```typescript
// mocks/ai-runtime.ts
//
// AI runtime service mock helper (provider 中立形式)
// Phase 2-B / 2-C: ProcessFlow.aiCall / aiAgent step に対応する runtime invocation を mock する。
// 戻り値は spec §「outputBinding の値構造」に従う正規化形式 (provider 別の content[] / choices[] は隠蔽)。
//
// Phase 2-C 確定: AiRuntimeService.invoke (provider 中立、SDK dispatch は service 内部)
//   type / method / import path は固定契約 (`/generate-code` Phase 2-C で生成される実装と一致)

import type { AiRuntimeService } from '../src/ai/ai-runtime.service';

export interface AiInvocationResult {
  text?: string;
  object?: unknown;
  raw?: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
}

// (a) text format helper
export function mockAiText(svc: AiRuntimeService, text: string): jest.SpyInstance {
  const result: AiInvocationResult = {
    text,
    finishReason: 'end_turn',
    usage: { inputTokens: 50, outputTokens: 100 },
  };
  return jest.spyOn(svc, 'invoke').mockResolvedValue(result);
}

// (b) structuredObject helper (schema 準拠の object を渡す)
export function mockAiStructured(svc: AiRuntimeService, object: unknown): jest.SpyInstance {
  const result: AiInvocationResult = {
    object,
    raw: JSON.stringify(object),
    finishReason: 'end_turn',
    usage: { inputTokens: 50, outputTokens: 100 },
  };
  return jest.spyOn(svc, 'invoke').mockResolvedValue(result);
}

// (c) json helper (free-form JSON、object 制約なし)
export function mockAiJson(svc: AiRuntimeService, object: unknown): jest.SpyInstance {
  // structuredObject と同形だが、AI-3 (schema violation) の文脈で使い分ける
  return mockAiStructured(svc, object);
}

// (d) streaming helper (完了後の assembled text)
export function mockAiStreaming(svc: AiRuntimeService, text: string): jest.SpyInstance {
  return mockAiText(svc, text); // 本層では text と同一 (partial chunks は別層)
}

// (e) failure helper (provider 呼び出し失敗 — AI-4 / AI-3)
export function mockAiFailure(svc: AiRuntimeService, error?: Error): jest.SpyInstance {
  return jest.spyOn(svc, 'invoke').mockRejectedValue(error ?? new Error('Mock provider error'));
}

// (f) format violation helper (AI-3、structuredObject schema 違反 / json malformed)
export function mockAiFormatViolation(svc: AiRuntimeService): jest.SpyInstance {
  // runtime が parse / schema 検証で失敗するケース。raw を invalid JSON にする。
  // または object を schema 違反 (required field 欠落) にする。
  return jest.spyOn(svc, 'invoke').mockRejectedValue(
    new Error('Mock provider returned response that violates declared responseFormat'),
  );
}

// (g) tool call helper (aiCall + tools / aiAgent、最終 assistant message に toolCalls を含む想定)
export function mockAiWithToolCalls(
  svc: AiRuntimeService,
  text: string,
  toolCalls: Array<{ id: string; name: string; arguments: unknown }>,
): jest.SpyInstance {
  const result: AiInvocationResult = {
    text,
    toolCalls,
    finishReason: 'tool_use',
    usage: { inputTokens: 50, outputTokens: 100 },
  };
  return jest.spyOn(svc, 'invoke').mockResolvedValue(result);
}
```

### P5-7. mock mode vs 実 API mode の切替ロジック

> **ternary パターン (jest + vitest 両互換)**: 条件付き skip には `describe.skipIf` (Vitest 専用) ではなく
> ternary `(cond ? describe : describe.skip)(name, fn)` を使う。jest 環境では `describe.skipIf` が
> 存在せず `TypeError` になるため。本 skill の Backend mode は jest 固定 (D-6) だが、vitest でも
> 動作するこのパターンを推奨形とする。

```typescript
import { mockAiStructured, mockAiFailure } from './mocks/ai-runtime';

describe('POST <httpRoute.path> (<action.name> E2E) [mock mode]', () => {
  let aiRuntimeSpy: jest.SpyInstance | undefined;

  afterEach(() => {
    if (aiRuntimeSpy) {
      aiRuntimeSpy.mockRestore();
      aiRuntimeSpy = undefined;
    }
  });

  // AI-1: structuredObject の filter (responseFormat=structuredObject の場合)
  it('#N AI-1: confidence < threshold は除外', async () => {
    aiRuntimeSpy = mockAiStructured(aiRuntime, {
      tags: [
        { slug: 'high', name: '高', confidence: 0.9 },
        { slug: 'low',  name: '低', confidence: 0.4 }, // threshold 0.6 未満
      ],
    });
    // ...
  });

  // AI-4: provider 失敗
  it('#N AI-4: provider 失敗 → 502', async () => {
    aiRuntimeSpy = mockAiFailure(aiRuntime);
    // ...
  });
});

// 実 API mode (CI default skip)
(process.env.RUN_AI_INTEGRATION === '1' ? describe : describe.skip)(
  'POST <httpRoute.path> (<action.name> E2E) [live API]',
  () => {
    // 実 API テスト (AI-5 happy path / AI-6 非決定論的 assertion)
    // 必要 env var: secrets catalog から解決した API key (例: ANTHROPIC_API_KEY)
  },
);
```

### P5-8. 参照解決 index (Phase 2-B 時点)

P5 テスト生成時に参照する外部依存の解決方法を統一する:

```
@secret.<key>
  → modelEndpoint.auth.tokenRef = "@secret.<key>" → secrets[<key>].name = "<ENV_VAR_NAME>"
  → テスト内記録: process.env.<ENV_VAR_NAME>
  → 例: @secret.anthropicApiKey → ANTHROPIC_API_KEY
  → 例: @secret.openaiApiKey   → OPENAI_API_KEY (将来 provider 切替時)

@env.<key>
  → harmony.json の context.envCatalog (#859 解決後) から取得予定。
  → 現状: PLACEHOLDER + literal fallback。

@conv.<dotted.path>
  → conventions catalog から解決 (#859 解決後)。
  → 現状: compute step の expression からリテラル値を抽出 (例: 0.6)。
  → const 化して PLACEHOLDER として README に記録。

@<varName> (action input / step output / ambient variable)
  → action.inputs[] / step.outputBinding / context.ambientVariables から解決。
  → AiMessageSpread.ref / AiImageSource (url=expression) で頻出。
```

### P5-9. ai-specific PLACEHOLDER 解決表 (README 必須項目)

P5 golden 生成時の README には以下の PLACEHOLDER 解決表を含めること。**完全リスト** (テンプレート展開用 16 項目)
は `templates/backend/typescript-nestjs/E2E_SPEC.md` の Section 16-E を参照。本表は README 必須記載項目の主要抜粋。

| PLACEHOLDER | 解決元 | 例 | 差替えポイント |
|---|---|---|---|
| AI runtime service クラス名 | **Phase 2-C 確定 (固定契約)** | `AiRuntimeService` | — |
| AI runtime service method | **Phase 2-C 確定 (固定契約)** | `invoke` | — |
| import path (e2e-spec から) | **Phase 2-C 確定 (固定契約)** | `../src/ai/ai-runtime.service` | — |
| `AI_STEP_KIND` | `step.kind` | `aiCall` / `aiAgent` | — |
| `AI_MODEL_REF` | `step.modelRef` | `tagSuggestModel` | — |
| `AI_PROVIDER` | `merged.modelEndpoints[modelRef].provider` | `anthropic` | provider 切替時は catalog 編集で完結 |
| `AI_MODEL_NAME` | `merged.modelEndpoints[modelRef].model` | `claude-opus-4-7` | 同上 |
| `AI_AUTH_KIND` | `merged.modelEndpoints[modelRef].auth.kind` | `bearer` | — |
| `AI_SECRET_REF` | `auth.tokenRef` から `@secret.` 除去 | `anthropicApiKey` | — |
| `AI_API_KEY_ENV` | `merged.secrets[AI_SECRET_REF].name` | `ANTHROPIC_API_KEY` | — (env var は解決不要) |
| `RESPONSE_FORMAT_KIND` | `step.responseFormat.kind` (default `text`) | `structuredObject` | — |
| `AI_OUTPUT_BINDING` | `step.outputBinding.name` | `aiResponse` | — |
| `AI_THRESHOLD_VALUE` | compute step の filter expression リテラル | `0.6` | `#859` 解決後: `@conv.<...>` catalog 参照 |
| `STEP_AI_ID` / `STEP_COMPUTE_ID` | step.id (aiCall|aiAgent / 後続 compute) | `step-03` / `step-04` | — |
| `COMPUTE_FILTER_EXPRESSION` | compute step の `expression` | `@aiResponse.object.tags.filter(...)` | — |
| `FAILURE_RESPONSE_ID` | catalog.errors[<code>].responseId (間接解決、AI-4 step 2 参照) | `502-ai-error` | — |
| `FAILURE_RESPONSE_STATUS` | `action.responses[FAILURE_RESPONSE_ID].status` (catalog 不在時 502 default) | `502` | — |
| `FAILURE_ERROR_CODE` | catalog `errors[].code` (responseId と紐付く) | `AI_API_ERROR` | — |
| `AI_MAX_TOKENS_LIVE` | `merged.modelEndpoints[modelRef].defaults.maxTokens` | `512` | — |

### P5-10. 出力ファイル

```
<出力先>/
  <flowName>.e2e-spec.ts   — AI flow テスト (mock mode + 実 API mode)
  mocks/
    ai-runtime.ts          — AI runtime service mock helper (provider 中立)
  README.md                — PLACEHOLDER 解決表 + CI 設定例 + 再 invocation 例
```

### P5-11. 最終レポート (P5 モード)

```markdown
## /generate-tests 完了: <flowName> (AI flow mock + 実 API 切替、Phase 2-B)

### 入力
- ProcessFlow: <flowId> (<meta.name>)
- 検出 AI steps: <step-id> (kind=<aiCall|aiAgent>, modelRef=<key>, responseFormat=<kind>)
- modelEndpoint: provider=<...>, model=<...>, auth.kind=<...>

### AI flow 検出結果
| step.id | kind | modelRef | responseFormat | tools | 備考 |
|---|---|---|---|---|---|
| <step-id> | aiCall | <modelRef> | structuredObject | — | — |

### 4 観点変換結果
| 観点 | 生成テスト | assertion | 備考 |
|---|---|---|---|
| AI-1: 業務フィルタ | #N threshold 未満 → 除外 / ≥ threshold → 含まれる | length / 個別要素 | compute step が無い場合は skip |
| AI-2: secret 未設定 | #N <ENV>="" → 503 | status | auth.kind=none/iam/azureAd は skip |
| AI-3: format violation | #N runtime 検証失敗 → 502 | status | text/streaming は skip |
| AI-4: provider 失敗 | #N reject → <failureStatus> | status | retry は Phase 2-C で再評価 |

### catalog 解決結果
| 参照 | 解決元 | 解決値 | 備考 |
|---|---|---|---|
| step.modelRef | merged.modelEndpoints | <provider> / <model> | project + flow merge 済 |
| auth.tokenRef | merged.secrets | env var <ENV_NAME> | source=env 前提 |
| AiMessageSpread.ref (該当時) | action.inputs / outputBinding | <fixture 生成方法> | — |
| AiImageSource (該当時) | source.kind 別 | <fileRef|url|base64> | source.kind=url(@<var>) は変数解決済 |

### 生成ファイル
- `<出力先>/<flowName>.e2e-spec.ts` (N 行, M テスト)
- `<出力先>/mocks/ai-runtime.ts`
- `<出力先>/README.md`

### smoke 検証
- jest 実行: 推奨 (Phase 2-C 確定後は AiRuntimeService が `/generate-code` で生成されるため)
- 推奨コマンド: cd apps/api && npx jest <flowName>.e2e-spec.ts --runInBand

### 申し送り
- AI runtime: AiRuntimeService.invoke は固定契約 (Phase 2-C 確定)
- PLACEHOLDER: AI_THRESHOLD_VALUE = <値> → #859 解決後に @conv.<key> 参照へ
- live API テスト: RUN_AI_INTEGRATION=1 <ENV_VAR>=<key> npx jest --runInBand で実行
- aiAgent の場合: maxIterations 超過パスは Phase 2-B では未対応 (spec 拡張候補、別 ISSUE)
```
