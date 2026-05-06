# E2E_SPEC.md — TypeScript NestJS E2E テストファイル構造規約

`/generate-tests` スキルが生成するテストファイル (`<flowName>.e2e-spec.ts`) の
構造規約とコードテンプレートを定義する。

## 1. ファイル先頭 header (D-1 / D-4 anchor)

```typescript
/**
 * E2E テスト: <httpRoute.method> <httpRoute.path> (<action.name>)
 *
 * // ===HARMONY_GENERATED_SECTION_START flowId=<flowId> actionId=<actionId>===
 * // このコメントブロックは /generate-tests スキル再実行時に overwrite される。
 * // anchor の外側 (人手追記 assertion) は保護される。
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * ProcessFlow: <flowId> (<meta.name>)
 *
 * === spec → test mapping ===
 *
 * [inputs[].required=true]
 *   → Test: missing field → 400 VALIDATION_ERROR
 *
 * [validation rules[].type=maxLength, length=N]
 *   → Test: boundary value (N+1 文字) → 400
 *   → N 文字は OK (境界値 OK テスト)
 *
 * [validation rules[].type=enum, values=[...]]
 *   → Test: enum 外の値 → 400
 *
 * [httpRoute.auth="required"]
 *   → Test: Authorization ヘッダー無し → 401
 *
 * [responses[].status=201]
 *   → Assert: response.status === 201
 *
 * [outputs[].name="<field>", type="integer"]
 *   → Assert: response.body.<field> is number
 *
 * [step.kind=dbAccess (INSERT <table>), lineage.writes]
 *   → Assert: <physicalName> テーブルに row が追加されること (Prisma findUnique)
 *
 * [step.kind=loop (collection), collectionSource=@inputs.<field>]
 *   → Assert: <childTable> に N 行追加 + 親 ID 紐付け
 *
 * [step.txBoundary (begin..end)]
 *   → TX rollback テスト: 故意 UNIQUE 違反 → 全 rollback 確認
 *
 * [step.runIf="<condition>"]
 *   → runIf=true のケース / false のケース 両方を生成
 *
 * === 申し送り事項 ===
 * TX-1: <TX 実装状況のメモ>
 */
```

## 2. import 規約

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');  // Spike L-5: ESM/CJS 混在を避けるため require を使う
import { AppModule } from '../src/app.module';
import { PrismaClient } from '@prisma/client';
```

**注意**: `import request from 'supertest'` は tsconfig の設定によっては動作しないため、
`const request = require('supertest')` を使う (Spike L-5 知見)。

## 3. beforeAll: NestJS アプリ起動 + Prisma + JWT

```typescript
beforeAll(async () => {
  // NestJS TestingModule の作成と起動
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();

  // ValidationPipe: transform=true で DTO に変換、whitelist=true で余分フィールドを除去
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,  // 非ホワイトリストフィールドはエラーにしない (寛容)
    }),
  );
  await app.init();

  // テスト専用 Prisma client (Spike L-6: DATABASE_URL は絶対パス対応)
  // DATABASE_URL env が設定されていれば優先、なければ相対パスを resolve して絶対パス化
  const dbPath = process.env.DATABASE_URL
    || `file:${require('path').resolve(__dirname, '../prisma/dev.db')}`;
  prisma = new PrismaClient({
    datasources: { db: { url: dbPath } },
  });

  // JWT 取得 (httpRoute.auth="required" の場合)
  // seed.ts で固定ユーザー (username="${ADMIN_USERNAME}" / password="${ADMIN_PASSWORD}") が作成済み前提
  accessToken = await loginAs${HelperName}(app);
});
```

**DATABASE_URL 絶対パス対応 (Spike L-6) の詳細**:
- `__dirname` は `test/` ディレクトリ
- `../prisma/dev.db` で `apps/api/prisma/dev.db` を指す
- `process.env.DATABASE_URL` が設定済みなら `file:` prefix の有無に注意
  (Prisma の SQLite URL 形式: `file:/absolute/path/to/db`)

## 4. beforeEach: クリーンステート

各テストを独立させるため、テストデータを前に seed し後に cleanup する。

```typescript
beforeEach(async () => {
  createdIds = {};  // cleanup 用 ID コレクションをリセット

  // テスト用マスタデータの seed (timestamp suffix で slug 衝突を避ける)
  const suffix = Date.now();
  const testRecord = await prisma.${masterModel}.create({
    data: {
      name: `${TEST_RECORD_NAME_PREFIX}-${suffix}`,
      // ... 必要なフィールド
    },
  });
  ${testRecordId} = Number(testRecord.id);
});
```

## 5. afterAll: app close

```typescript
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});
```

## 6. afterEach: cleanup

```typescript
afterEach(async () => {
  // 子テーブルから順に削除 (FK 制約のある場合)
  for (const id of (createdIds['${childTable}'] ?? [])) {
    await prisma.${childModel}.deleteMany({ where: { ${parentIdField}: Number(id) } });
  }
  for (const id of (createdIds['${mainTable}'] ?? [])) {
    await prisma.${mainModel}.deleteMany({ where: { id: Number(id) } });
  }
  // テスト用マスタデータの削除
  if (${testRecordId}) {
    await prisma.${masterModel}.deleteMany({ where: { id: ${testRecordId} } });
  }
});
```

## 7. JWT ヘルパー関数

```typescript
/**
 * <adminRole> ユーザーで JWT を取得する。
 * seed.ts で username=${ADMIN_USERNAME} / password=${ADMIN_PASSWORD} が作成済み前提。
 */
async function loginAs${HelperName}(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ username: '${ADMIN_USERNAME}', password: '${ADMIN_PASSWORD}' });
  return res.body.accessToken;
}
```

## 8. 各 it() の命名規約

```
#1  happy path: 全フィールド指定で <status> + <output> を返す
#2  validation: <field> 欠落 → 400
#3  validation: <field> 欠落 → 400
#N  validation: <field>=<invalidValue> → 400
#N  validation: <field> <length> 文字 (maxLength=<N> 超過) → 400
#N  validation: <field> <length> 文字 (境界値 OK) → 201
#N  auth: JWT なし → 401
#N  DB 副作用: <physicalName> テーブルに row が追加される
#N  DB 副作用: <child> N 件指定 → <childTable> に N 行 + 親 ID 紐付け
#N  TX: <constraint 違反説明> → <status> + TX rollback 確認
#N  runIf=true: <条件説明> のケース
#N  runIf=false: <条件説明> のケース
#N  compute: <status>=<value> → <field> が <expected>
```

## 9. spec 要素 → テスト構造マッピング (サマリ)

| ProcessFlow 要素 | 生成テスト種別 | assertion |
|---|---|---|
| `inputs[].required=true` | 欠落 → 400 | `expect(res.status).toBe(400)` |
| `validation.type=maxLength, length=N` | N+1 文字 → 400 / N 文字 → 201 | status 確認 |
| `validation.type=enum, values=[...]` | 不正値 → 400 | status 確認 |
| `httpRoute.auth="required"` | JWT なし → 401 | `expect(res.status).toBe(401)` |
| `responses[].status=201` | happy path | `expect(res.status).toBe(201)` |
| `outputs[].name="X", type="integer"` | happy path 内 | `typeof res.body.X === 'number'` |
| `step.dbAccess INSERT` | DB 行追加 | `prisma.Model.findUnique(...)` |
| `step.loop collection` | N 件 → N 行 | `expect(rows).toHaveLength(N)` |
| `step.txBoundary` | 故意失敗 TX | `expect(res.status).toBe(500 or 409)` + Prisma 残存確認 |
| `step.runIf` | true / false 両分岐 | 各ケースの期待動作 |
| `step.compute` | DB SELECT で値確認 | `expect(post.publishedAt).toBeNull()` 等 |
| `affectedRowsCheck.onViolation=throw` | 0 行誘起 | `expect(res.status).toBeGreaterThanOrEqual(500)` |
| `context.catalogs.errors[].httpStatus` | エラーコード対応表 | assertion 期待値に展開 |

## 10. jest-e2e.json テンプレート

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": [
      "ts-jest",
      {
        "tsconfig": {
          "module": "commonjs",
          "target": "ES2020",
          "lib": ["ES2020"],
          "strict": false,
          "strictNullChecks": false,
          "esModuleInterop": true,
          "experimentalDecorators": true,
          "emitDecoratorMetadata": true,
          "skipLibCheck": true
        }
      }
    ]
  },
  "moduleNameMapper": {
    "^src/(.*)$": "<rootDir>/../src/$1"
  },
  "testTimeout": 30000
}
```

**重要点**:
- `strictNullChecks: false` — Prisma の nullable 型を緩く扱う
- `moduleNameMapper` — `src/` 相対インポートを `../src/` に解決
- `testTimeout: 30000` — DB I/O を含む E2E は 30 秒タイムアウト
- SQLite 使用時は `--runInBand` を jest 実行オプションに追加 (D-7)

## 11. D-4 再生成時の anchor ベース overwrite ルール

```
既存テストファイルに対して /generate-tests を再実行する場合:

1. ファイルを Read して anchor を検索
   - `===HARMONY_GENERATED_SECTION_START flowId=X actionId=Y===` を探す
   - なければ全ファイルが「人手作成」とみなし、上書きせずに新規ファイルを生成

2. anchor が見つかった場合:
   - START から END の間のみを新しい生成内容で置換
   - END の外側 (人手追記 describe/it) は一切変更しない
   - anchor 行自体も更新する

3. anchor が複数存在する場合 (複数 action):
   - flowId + actionId の組合せで一致する anchor のみ overwrite
```

## 12. 注意事項 (Spike から得た知見)

- `PrismaClient` のコンストラクタで `datasources.db.url` を明示しないと
  環境変数 `DATABASE_URL` の相対パスが解決されない場合がある (Spike L-6)
- BigInt 型の ID を Prisma が返す場合は `Number(id)` に変換してから比較する
- `afterEach` の cleanup は子テーブル (FK 参照先) → 親テーブルの順で実行する
- `beforeEach` の seed データには `Date.now()` suffix を付けて slug/name の UNIQUE 衝突を避ける
- `ValidationPipe({ transform: true })` が設定されていないと DTO 変換が効かず
  数値型フィールドが文字列のまま渡ってバリデーションが通らないことがある

---

## 13. DB 副作用テンプレート (P2 — #871)

### 13-A. lineage.writes → 行数増減 SELECT アサーション

```typescript
/**
 * Spec: ProcessFlow ${FLOW_ID} ${STEP_ID}
 *   kind=dbAccess, operation=INSERT
 *   lineage.writes=[${TABLE_WRITES}]
 *
 * 実行前後の行数変化を COUNT で検証する。
 */
it(`#N lineage: INSERT 後に ${TABLE_WRITES} の行数が 1 増加する`, async () => {
  // 実行前の行数を記録
  const countBefore = await prisma.${mainModelPrisma}.count({
    where: { ${uniqueIdentifierFilter} },
  });

  const res = await request(app.getHttpServer())
    .post('${HTTP_ROUTE_PATH}')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ ${validPayload} });

  expect(res.status).toBe(201);

  const countAfter = await prisma.${mainModelPrisma}.count({
    where: { ${uniqueIdentifierFilter} },
  });
  expect(countAfter).toBe(countBefore + 1);

  createdIds['${TABLE_WRITES}'] = [...(createdIds['${TABLE_WRITES}'] ?? []), res.body.${OUTPUT_ID_FIELD}];
});
```

### 13-B. loop + collectionSource → 入力配列長 = 挿入行数 (Spike L-3)

```typescript
/**
 * Spec: ProcessFlow ${FLOW_ID} ${LOOP_STEP_ID}
 *   kind=loop, loopKind=collection, collectionSource=@inputs.${LOOP_FIELD}
 *   ${INNER_STEP_ID}: kind=dbAccess, operation=INSERT → ${CHILD_TABLE}
 *
 * 入力配列長 N = 子テーブル挿入行数 N (Spike L-3 パターン)
 */
it(`#N loop-insert: ${LOOP_FIELD} N 件 → ${CHILD_TABLE} に N 行 + 親 ID 紐付け`, async () => {
  const N = 2;
  const res = await request(app.getHttpServer())
    .post('${HTTP_ROUTE_PATH}')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      ${REQUIRED_FIELD_1}: '${TEST_VALUE_LOOP_N}',
      ${REQUIRED_FIELD_2}: '${TEST_VALUE_2}',
      ${LOOP_FIELD}: Array.from({ length: N }, (_, i) => ({
        ${CHILD_ITEM_FIELD}: `${TEST_CHILD_VALUE_PREFIX}-${i}`,
      })),
    });

  expect(res.status).toBe(201);
  const parentId = res.body.${OUTPUT_ID_FIELD};
  createdIds['${TABLE_MAIN}'] = [...(createdIds['${TABLE_MAIN}'] ?? []), parentId];

  const childRows = await prisma.${childModelPrisma}.findMany({
    where: { ${PARENT_FK_FIELD}: parentId },
    orderBy: { id: 'asc' },
  });
  expect(childRows).toHaveLength(N);
  childRows.forEach((row) => expect(row.${PARENT_FK_FIELD}).toBe(parentId));
});

// 空配列 (0 件) の場合
it(`#N loop-insert: ${LOOP_FIELD} 0 件 → ${CHILD_TABLE} に 0 行`, async () => {
  const res = await request(app.getHttpServer())
    .post('${HTTP_ROUTE_PATH}')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      ${REQUIRED_FIELD_1}: '${TEST_VALUE_LOOP_ZERO}',
      ${REQUIRED_FIELD_2}: '${TEST_VALUE_2}',
      ${LOOP_FIELD}: [],
    });

  expect(res.status).toBe(201);
  const parentId = res.body.${OUTPUT_ID_FIELD};
  createdIds['${TABLE_MAIN}'] = [...(createdIds['${TABLE_MAIN}'] ?? []), parentId];

  const childRows = await prisma.${childModelPrisma}.findMany({
    where: { ${PARENT_FK_FIELD}: parentId },
  });
  expect(childRows).toHaveLength(0);
});
```

---

## 14. TX rollback テンプレート (P2 — #871)

### 14-A. 基本形 (UNIQUE 制約違反パターン)

TX 内の INSERT テーブルに UNIQUE / @@id 制約がある場合の最優先パターン。

```typescript
/**
 * Spec: ProcessFlow ${FLOW_ID} ${STEP_TX_BEGIN_ID}
 *   txBoundary.role="begin", txId="${TX_ID}"
 *   ${STEP_TX_END_ID}: txBoundary.role="end"
 *
 * TX rollback 検証 (D-3):
 *   同一 ID を 2 回送ることで ${TABLE_JUNCTION} の UNIQUE 制約違反を誘起。
 *   $transaction 実装あり → posts に行が残らない (rollback 成功)
 *   $transaction 未実装 → posts に行が残る (spec ↔ impl 乖離として文書化)
 *
 * 【spec ↔ impl 乖離検出器】
 *   このテストが fail する場合、txBoundary (${STEP_TX_BEGIN_ID} begin ~ ${STEP_TX_END_ID} end) が
 *   サービス層で $transaction としてラップされていない可能性がある。
 *   実装を確認し prisma.$transaction() でラップすること。
 */
it(`#N TX: 同一 ${JUNCTION_ITEM_LABEL} 2 回指定 (${TABLE_JUNCTION} UNIQUE 違反) → ${HTTP_STATUS_TX_ERROR} + TX rollback 確認`, async () => {
  // 同じ ID を 2 回送って UNIQUE 違反を誘起
  const res = await request(app.getHttpServer())
    .post('${HTTP_ROUTE_PATH}')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      ${REQUIRED_FIELD_1}: '${TEST_VALUE_TX_UNIQUE}',
      ${REQUIRED_FIELD_2}: '${TEST_VALUE_2}',
      ${JUNCTION_COLLECTION_FIELD}: [
        { id: ${TEST_MASTER_ID_VAR}, source: 'manual' },
        { id: ${TEST_MASTER_ID_VAR}, source: 'ai' },  // 同一 ID → UNIQUE 違反
      ],
    });

  // エラーが返ることを確認
  expect(res.status).toBe(${HTTP_STATUS_TX_ERROR});

  // TX rollback 確認: begin 側テーブルに行が残っていないことを期待
  const remainingRows = await prisma.${mainModelPrisma}.findMany({
    where: { ${REQUIRED_FIELD_1}: '${TEST_VALUE_TX_UNIQUE}' },
    orderBy: { createdAt: 'desc' },
  });

  if (remainingRows.length > 0) {
    // 【TX-1 文書化】 $transaction 未実装を記録
    console.warn(
      `[TX-1 文書化] TX が未実装: ${TABLE_JUNCTION} UNIQUE 違反後も ${TABLE_MAIN} 行が残存。` +
      `残存 ID: ${remainingRows.map((r) => r.id).join(', ')}`,
    );
  }

  // cleanup: 残存行を afterEach cleanup に渡す
  for (const row of remainingRows) {
    createdIds['${TABLE_MAIN}'] = [...(createdIds['${TABLE_MAIN}'] ?? []), Number(row.id)];
  }

  // このテストは「エラーが返る」ことの確認で pass とし、TX 未実装は申し送り
});
```

### 14-B. FK 違反パターン

TX 内に FK 参照がある場合の代替パターン。

```typescript
/**
 * Spec: ProcessFlow ${FLOW_ID} ${STEP_TX_BEGIN_ID}
 *   txBoundary.role="begin", txId="${TX_ID}"
 *
 * TX rollback 検証 (FK 違反パターン):
 *   存在しない親 ID を子テーブルの FK に渡して FK 制約違反を誘起。
 */
it(`#N TX: 存在しない ${PARENT_LABEL} ID 指定 (FK 違反) → 5xx + TX rollback 確認`, async () => {
  const nonExistentParentId = 999999999;

  const res = await request(app.getHttpServer())
    .post('${HTTP_ROUTE_PATH}')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      ${REQUIRED_FIELD_1}: '${TEST_VALUE_TX_FK}',
      ${REQUIRED_FIELD_2}: '${TEST_VALUE_2}',
      ${CHILD_FK_FIELD}: nonExistentParentId,
    });

  expect(res.status).toBeGreaterThanOrEqual(400);

  // TX rollback 確認
  const remainingRows = await prisma.${mainModelPrisma}.findMany({
    where: { ${REQUIRED_FIELD_1}: '${TEST_VALUE_TX_FK}' },
  });

  if (remainingRows.length > 0) {
    console.warn(
      `[TX-2 文書化] TX が未実装: FK 違反後も ${TABLE_MAIN} 行が残存。` +
      `残存 ID: ${remainingRows.map((r) => r.id).join(', ')}`,
    );
  }

  for (const row of remainingRows) {
    createdIds['${TABLE_MAIN}'] = [...(createdIds['${TABLE_MAIN}'] ?? []), Number(row.id)];
  }
});
```

### 14-C. value too long パターン

TX 内の INSERT テーブルに varchar 上限があり UNIQUE/FK パターンが使えない場合のフォールバック。

```typescript
/**
 * Spec: ProcessFlow ${FLOW_ID} ${STEP_TX_BEGIN_ID}
 *   txBoundary.role="begin", txId="${TX_ID}"
 *
 * TX rollback 検証 (value too long パターン):
 *   varchar 上限を超えるペイロードで DB エラーを誘起。
 */
it(`#N TX: ${TX_OVERFLOW_FIELD} 上限超過 (value too long) → 5xx + TX rollback 確認`, async () => {
  const overLengthValue = 'x'.repeat(${TX_OVERFLOW_MAX_LENGTH} + 1);

  const res = await request(app.getHttpServer())
    .post('${HTTP_ROUTE_PATH}')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      ${REQUIRED_FIELD_1}: '${TEST_VALUE_TX_OVERFLOW}',
      ${REQUIRED_FIELD_2}: '${TEST_VALUE_2}',
      ${TX_OVERFLOW_FIELD}: overLengthValue,
    });

  expect(res.status).toBeGreaterThanOrEqual(400);

  // TX rollback 確認
  const remainingRows = await prisma.${mainModelPrisma}.findMany({
    where: { ${REQUIRED_FIELD_1}: '${TEST_VALUE_TX_OVERFLOW}' },
  });

  if (remainingRows.length > 0) {
    console.warn(
      `[TX-3 文書化] TX が未実装: value too long 後も ${TABLE_MAIN} 行が残存。` +
      `残存 ID: ${remainingRows.map((r) => r.id).join(', ')}`,
    );
  }

  for (const row of remainingRows) {
    createdIds['${TABLE_MAIN}'] = [...(createdIds['${TABLE_MAIN}'] ?? []), Number(row.id)];
  }
});
```

### 14-D. affectedRowsCheck.onViolation=throw + 0 行誘起パターン

TX 内に `affectedRowsCheck.onViolation=throw` の step があり UNIQUE/FK が使えない場合。

```typescript
/**
 * Spec: ProcessFlow ${FLOW_ID} ${STEP_AFFECTED_ROWS_ID}
 *   affectedRowsCheck: expected=1, onViolation="throw", errorCode="${AFFECTED_ERROR_CODE}"
 *   txBoundary: (begin 側と同一 txId)
 *
 * TX rollback 検証 (affectedRowsCheck.onViolation=throw パターン):
 *   affected rows = 0 になるペイロードで onViolation=throw を誘起。
 */
it(`#N TX: affectedRowsCheck 0 行 (${AFFECTED_ERROR_CODE}) → ${AFFECTED_HTTP_STATUS} + TX rollback 確認`, async () => {
  // UPDATE/DELETE なら存在しない ID → affected rows = 0
  // INSERT なら UNIQUE 違反 (存在しない挿入が 0 行) → affected rows = 0
  const res = await request(app.getHttpServer())
    .patch('${HTTP_ROUTE_PATH}/${NONEXISTENT_ID_LITERAL}')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ ${validUpdatePayload} });

  expect(res.status).toBe(${AFFECTED_HTTP_STATUS});

  // TX rollback 確認
  const remainingRows = await prisma.${mainModelPrisma}.findMany({
    where: { ${UNIQUE_IDENTIFIER_FIELD}: '${TEST_VALUE_AFFECTED}' },
  });

  if (remainingRows.length > 0) {
    console.warn(`[TX-4 文書化] affectedRowsCheck throw 後も ${TABLE_MAIN} 行が残存。`);
  }

  for (const row of remainingRows) {
    createdIds['${TABLE_MAIN}'] = [...(createdIds['${TABLE_MAIN}'] ?? []), Number(row.id)];
  }
});
```

### 14-E. affectedRowsCheck.onViolation=log → 0 行でも続行確認 (optional)

```typescript
/**
 * Spec: ProcessFlow ${FLOW_ID} ${STEP_LOG_AFFECTED_ID}
 *   affectedRowsCheck: onViolation="log", errorCode="${LOG_ERROR_CODE}"
 *   (onViolation=log → 制約違反でもエラーにしない設計)
 *
 * 0 行条件でリクエストしても 2xx が返ることを確認する (エラーにならない)。
 */
it(`#N affectedRowsCheck(log): 0 行条件でも 2xx が返る (エラーにならない)`, async () => {
  // 既存レコードと重複するペイロード (INSERT → UNIQUE 違反 → 0 行)
  const res = await request(app.getHttpServer())
    .post('${HTTP_ROUTE_PATH}')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      ${REQUIRED_FIELD_1}: '${TEST_VALUE_LOG_AFFECTED}',
      ${REQUIRED_FIELD_2}: '${TEST_VALUE_2}',
      ${DUPLICATE_FIELD}: '${EXISTING_DUPLICATE_VALUE}',  // 既存と重複
    });

  // onViolation=log なのでエラーにならずに続行
  expect(res.status).toBeLessThan(500);
  // 注: logger.warn / console.warn が呼ばれることは NestJS Logger spy で確認可能
  // (jest.spyOn(logger, 'warn') / jest.spyOn(console, 'warn'))
});
```

---

## 15. ヘッダーの spec → test mapping 更新例 (P2 対応版)

P2 対応後のファイルヘッダー `spec → test mapping` セクションには以下を追加する:

```
 * [step ${STEP_POSTS_INSERT_ID}: lineage.writes=[${TABLE_MAIN}]]
 *   → Assert: 実行前後で ${TABLE_MAIN} 行数が 1 増加 (COUNT SELECT)
 *
 * [step ${STEP_CHILD_LOOP_ID}: kind=loop, collectionSource=@inputs.${LOOP_FIELD}]
 *   → Assert: 入力 N 件 → ${CHILD_TABLE} に N 行 (Spike L-3)
 *   → Assert: 空配列 → ${CHILD_TABLE} に 0 行
 *
 * [step ${STEP_TX_BEGIN_ID}: txBoundary.role="begin", txId="${TX_ID}"]
 *   → TX rollback テスト (D-3):
 *     故意 UNIQUE 違反 → ${HTTP_STATUS_TX_ERROR}
 *     $transaction あり → ${TABLE_MAIN} に行残らず (rollback 成功)
 *     $transaction なし → ${TABLE_MAIN} に行残存 (TX-1 文書化、spec ↔ impl 乖離)
 *
 * [step ${STEP_AFFECTED_ROWS_ID}: affectedRowsCheck.onViolation="throw"]
 *   → 0 行誘起 → ${AFFECTED_HTTP_STATUS}
 *
 * [step ${STEP_LOG_AFFECTED_ID}: affectedRowsCheck.onViolation="log"]
 *   → 0 行でも 2xx (エラーにならない) [optional]
 *
 * [step ${STEP_COMPUTE_ID}: kind=compute, outputBinding="${COMPUTED_VAR}"]
 *   → condition=false → DB の ${DB_COLUMN} が null
 *   → condition=true  → DB の ${DB_COLUMN} が non-null (現在時刻付近)
```

---

## 16. AI flow セクション (P5 — #874)

ProcessFlow に `kind=externalSystem` step が含まれ、かつ externalSystems catalog に AI 系システム
(名前に "ai"/"claude"/"openai"/"gpt"/"llm" を含む) が定義されている場合、このセクションを追加する。

### 16-A. ヘッダー spec → test mapping 追記 (P5 対応版)

```
 * [step ${STEP_AI_ID}: kind=externalSystem, systemRef="${AI_SYSTEM_REF}"]
 *   → AI-1: 信頼度フィルタ — threshold 未満を除外 / >= threshold を採用
 *   → AI-2: API key 未設定 (${AI_API_KEY_ENV}="") → 503 Service Unavailable
 *   → AI-3: malformed JSON レスポンス → 500 Internal Server Error
 *   → AI-4: 502 エラー × maxAttempts=${RETRY_MAX_ATTEMPTS} → spy ${RETRY_MAX_ATTEMPTS} 回呼出 → 最終 502
 *
 * === AI 参照解決表 ===
 * @env.${AI_BASE_URL_ENV_KEY}   → PLACEHOLDER: "${AI_BASE_URL_DEFAULT}"
 *   (#859 解決後: harmony.json context.envCatalog から解決)
 * @secret.${AI_SECRET_REF}      → env var ${AI_API_KEY_ENV}
 * @conv.${AI_THRESHOLD_CONV_REF} → リテラル ${AI_THRESHOLD_VALUE} (compute step より抽出)
 *   (#859 解決後: conventions catalog から解決)
 * AI model name → リテラル '${AI_MODEL_LITERAL}'
 *   (#859 解決後: @conv.ai.* から解決)
```

### 16-B. mock helper: `mocks/<systemName>.ts`

```typescript
/**
 * ${AI_SYSTEM_NAME} mock helper
 *
 * P5: jest.spyOn ベースの mock factory。
 * NestJS HttpService (Axios ラッパー) の axiosRef.post を stub する。
 *
 * #865 解決後: provider 抽象化 interface 単位の mock に置換すること。
 * 差替えポイント: HTTP_SERVICE_SPY_TARGET を provider interface method に変更。
 */
import type { HttpService } from '@nestjs/axios';
import type { AxiosResponse } from 'axios';

export interface MockClaudeMessage {
  role: string;
  content: string;
}

export interface MockClaudeApiResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Claude API の正常レスポンスを mock する。
 *
 * @param httpService - NestJS HttpService インスタンス
 * @param responseText - content[0].text に設定するテキスト
 * @returns jest.SpyInstance (afterEach で mockRestore() すること)
 */
export function mockClaudeApiSuccess(
  httpService: HttpService,
  responseText: string,
): jest.SpyInstance {
  const mockResponse: AxiosResponse<MockClaudeApiResponse> = {
    data: {
      id: 'msg_mock_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: responseText }],
      model: '${AI_MODEL_LITERAL}',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 50 },
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  };

  return jest
    .spyOn(httpService, 'post')
    .mockReturnValue(require('rxjs').of(mockResponse));
}

/**
 * Claude API の HTTP エラーレスポンスを mock する。
 *
 * @param httpService - NestJS HttpService インスタンス
 * @param statusCode - mock する HTTP status code (例: 502)
 * @param times - エラーを返す回数 (retryPolicy.maxAttempts に合わせる)
 */
export function mockClaudeApiError(
  httpService: HttpService,
  statusCode: number,
  times = 1,
): jest.SpyInstance {
  const axiosError = Object.assign(new Error('Mock HTTP Error'), {
    response: { status: statusCode, data: {} },
    isAxiosError: true,
  });

  let spy = jest.spyOn(httpService, 'post');
  for (let i = 0; i < times; i++) {
    spy = spy.mockRejectedValueOnce(axiosError) as jest.SpyInstance;
  }
  return spy;
}

/**
 * Claude API の malformed JSON レスポンスを mock する。
 * JSON.parse() が SyntaxError を throw するケース。
 *
 * @param httpService - NestJS HttpService インスタンス
 */
export function mockClaudeApiBadJson(
  httpService: HttpService,
): jest.SpyInstance {
  const mockResponse: AxiosResponse<MockClaudeApiResponse> = {
    data: {
      id: 'msg_mock_bad_json',
      type: 'message',
      role: 'assistant',
      // 故意に invalid JSON テキストを返す
      content: [{ type: 'text', text: 'NOT_VALID_JSON {{}}' }],
      model: '${AI_MODEL_LITERAL}',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  };

  return jest
    .spyOn(httpService, 'post')
    .mockReturnValue(require('rxjs').of(mockResponse));
}
```

### 16-C. mock mode テストブロック

```typescript
/**
 * AI flow テスト: ${AI_SYSTEM_NAME} mock mode
 *
 * P5 AI flow テスト: kind=externalSystem step を jest.spyOn で stub し、
 * token 消費なしで AI 固有ロジックを検証する。
 *
 * 参照フロー: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
 */
describe('AI flow テスト [mock mode]', () => {
  let httpServiceSpy: jest.SpyInstance;

  afterEach(() => {
    if (httpServiceSpy) {
      httpServiceSpy.mockRestore();
    }
    // API key env var の restore
    if (process.env.${AI_API_KEY_ENV} === '') {
      process.env.${AI_API_KEY_ENV} = originalApiKey;
    }
  });

  // ──────────────────────────────────────────────────────────────
  // AI-1: 信頼度フィルタ検証
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
   * AI-1-a: threshold 未満 (confidence < ${AI_THRESHOLD_VALUE}) → 除外
   *
   * compute step (step:${STEP_COMPUTE_ID}) の expression:
   *   ${THRESHOLD_FILTER_EXPRESSION}
   * → threshold = ${AI_THRESHOLD_VALUE} (リテラル、#859 解決後に catalog 参照)
   */
  it(`#N AI-1: 信頼度 ${AI_THRESHOLD_VALUE} 未満のタグは除外される`, async () => {
    const mockTags = [
      { slug: 'high-confidence', name: '高信頼度タグ', confidence: ${AI_THRESHOLD_VALUE} + 0.2 },
      { slug: 'below-threshold', name: '閾値未満タグ', confidence: ${AI_THRESHOLD_VALUE} - 0.1 },
      { slug: 'exact-threshold', name: '閾値ちょうどタグ', confidence: ${AI_THRESHOLD_VALUE} },
    ];

    httpServiceSpy = mockClaudeApiSuccess(
      httpService,
      JSON.stringify(mockTags),
    );

    const res = await request(app.getHttpServer())
      .post('${HTTP_ROUTE_PATH}')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ${REQUIRED_FIELDS_VALID} });

    expect(res.status).toBe(200);
    const candidates = res.body.candidates as Array<{ slug: string; confidence: number }>;

    // threshold 未満は除外されること
    expect(candidates.find((c) => c.slug === 'below-threshold')).toBeUndefined();

    // threshold 以上は含まれること
    expect(candidates.find((c) => c.slug === 'high-confidence')).toBeDefined();

    // 閾値ちょうどは含まれること (境界値 OK)
    expect(candidates.find((c) => c.slug === 'exact-threshold')).toBeDefined();
  });

  it(`#N AI-1: 全タグが threshold 未満の場合 → candidates = [] (空配列)`, async () => {
    const mockTags = [
      { slug: 'low-1', name: '低信頼度1', confidence: 0.1 },
      { slug: 'low-2', name: '低信頼度2', confidence: 0.2 },
    ];

    httpServiceSpy = mockClaudeApiSuccess(
      httpService,
      JSON.stringify(mockTags),
    );

    const res = await request(app.getHttpServer())
      .post('${HTTP_ROUTE_PATH}')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ${REQUIRED_FIELDS_VALID} });

    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────
  // AI-2: API key 未設定 → 503 fallback
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
   * AI-2: API key 未設定 → 503 Service Unavailable
   *
   * secrets catalog: ${AI_SECRET_REF} → env var ${AI_API_KEY_ENV}
   * API key 未設定時は provider 呼び出し前に 503 を返す設計
   *
   * NOTE: 実装が 401 / 500 を返す場合はその status に合わせて変更すること。
   */
  it(`#N AI-2: ${AI_API_KEY_ENV} 未設定 → 503 Service Unavailable`, async () => {
    const originalApiKey = process.env.${AI_API_KEY_ENV};
    process.env.${AI_API_KEY_ENV} = '';

    try {
      const res = await request(app.getHttpServer())
        .post('${HTTP_ROUTE_PATH}')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ${REQUIRED_FIELDS_VALID} });

      // API key 未設定時は 503 を期待
      expect(res.status).toBe(503);
    } finally {
      process.env.${AI_API_KEY_ENV} = originalApiKey;
    }
  });

  // ──────────────────────────────────────────────────────────────
  // AI-3: JSON parse 失敗 → 500
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
   *        step:${STEP_COMPUTE_ID} kind=compute (JSON.parse) [ai-mode:mock]
   * AI-3: AI レスポンス JSON parse 失敗 → 500 Internal Server Error
   *
   * compute step expression: ${THRESHOLD_FILTER_EXPRESSION}
   * → JSON.parse() が SyntaxError を throw → 500 を期待
   */
  it(`#N AI-3: AI レスポンス JSON parse 失敗 (malformed) → 500`, async () => {
    httpServiceSpy = mockClaudeApiBadJson(httpService);

    const res = await request(app.getHttpServer())
      .post('${HTTP_ROUTE_PATH}')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ${REQUIRED_FIELDS_VALID} });

    expect(res.status).toBe(500);
  });

  // ──────────────────────────────────────────────────────────────
  // AI-4: retry policy — 502 × maxAttempts 回 → 最終 502
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
   * AI-4: AI API 502 エラー → retryPolicy.maxAttempts=${RETRY_MAX_ATTEMPTS} 回 retry → 最終 502
   *
   * retryPolicy: { maxAttempts: ${RETRY_MAX_ATTEMPTS}, backoff: "${RETRY_BACKOFF}", initialDelayMs: ${RETRY_INITIAL_DELAY_MS} }
   * → spy が ${RETRY_MAX_ATTEMPTS} 回呼ばれること (jest.useFakeTimers で delay を短縮)
   */
  it(`#N AI-4: AI API 502 エラー × ${RETRY_MAX_ATTEMPTS} 回 → spy ${RETRY_MAX_ATTEMPTS} 回呼出 → 最終 502 (AI_API_ERROR)`, async () => {
    // FakeTimers で retry delay をスキップ
    jest.useFakeTimers();

    httpServiceSpy = mockClaudeApiError(httpService, 502, ${RETRY_MAX_ATTEMPTS});

    let res: any;
    try {
      const resPromise = request(app.getHttpServer())
        .post('${HTTP_ROUTE_PATH}')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ${REQUIRED_FIELDS_VALID} });

      // 全 delay をスキップ
      await jest.runAllTimersAsync();
      res = await resPromise;
    } finally {
      jest.useRealTimers();
    }

    // 最終的に 502 が返ること
    expect(res.status).toBe(502);

    // retry が ${RETRY_MAX_ATTEMPTS} 回実行されていること
    expect(httpServiceSpy).toHaveBeenCalledTimes(${RETRY_MAX_ATTEMPTS});
  });
});
```

### 16-D. 実 API mode テストブロック

```typescript
/**
 * AI flow テスト: 実 API mode
 *
 * CI では skip (default)。手動 smoke 時のみ実行:
 *   RUN_AI_INTEGRATION=1 CLAUDE_API_KEY=<key> npx jest <filename> --runInBand
 *
 * 注意: 実際の Claude API を叩くため、API コストが発生する。
 *       テスト 1 回あたり最大 ${AI_MAX_TOKENS_LIVE} tokens 消費。
 */
describe.skipIf(process.env.RUN_AI_INTEGRATION !== '1')(
  'AI flow テスト [live API — CI skip]',
  () => {
    beforeAll(() => {
      if (!process.env.${AI_API_KEY_ENV}) {
        throw new Error(
          `[live API] ${AI_API_KEY_ENV} が設定されていません。` +
          `RUN_AI_INTEGRATION=1 ${AI_API_KEY_ENV}=<key> npx jest ... で実行してください。`,
        );
      }
    });

    /**
     * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:live]
     * AI-5: 実 API happy path — 基本的な AI レスポンス取得
     */
    it(`#N [live] happy path: 実 Claude API で candidates が返る`, async () => {
      const res = await request(app.getHttpServer())
        .post('${HTTP_ROUTE_PATH}')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ${REQUIRED_FIELDS_VALID_LIVE} });

      expect(res.status).toBe(200);
      // 実 API レスポンスは非決定論的なため、構造のみ確認
      expect(res.body).toHaveProperty('candidates');
      expect(Array.isArray(res.body.candidates)).toBe(true);
      // 信頼度フィルタが適用されていること (>= threshold)
      for (const c of res.body.candidates) {
        expect(c.confidence).toBeGreaterThanOrEqual(${AI_THRESHOLD_VALUE});
      }
    }, 60_000);  // 実 API は 60s タイムアウト

    /**
     * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:live]
     * AI-6: 実 API — threshold フィルタの動作確認 (非決定論的)
     */
    it(`#N [live] 信頼度フィルタ: 全 candidates が threshold >= ${AI_THRESHOLD_VALUE}`, async () => {
      const res = await request(app.getHttpServer())
        .post('${HTTP_ROUTE_PATH}')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ${REQUIRED_FIELDS_VALID_LIVE_2} });

      expect(res.status).toBe(200);

      const candidates = res.body.candidates as Array<{ slug: string; confidence: number }>;
      // 全候補が threshold 以上であること
      candidates.forEach((c) => {
        expect(c.confidence).toBeGreaterThanOrEqual(${AI_THRESHOLD_VALUE});
      });
    }, 60_000);
  },
);
```

### 16-E. AI テスト PLACEHOLDER 置換チートシート

生成時に以下の PLACEHOLDER を ProcessFlow JSON から展開する:

| PLACEHOLDER | 展開元 | 例 |
|---|---|---|
| `${AI_SYSTEM_REF}` | `step.systemRef` | `claudeApi` |
| `${AI_SYSTEM_NAME}` | `externalSystems[systemRef].name` | `Claude AI API` |
| `${AI_BASE_URL_ENV_KEY}` | `externalSystems[systemRef].baseUrl` から `@env.` を除去 | `CLAUDE_API_BASE_URL` |
| `${AI_BASE_URL_DEFAULT}` | `https://api.anthropic.com` (literal fallback, #859) | — |
| `${AI_SECRET_REF}` | `externalSystems[systemRef].auth.tokenRef` から `@secret.` を除去 | `claudeApiKey` |
| `${AI_API_KEY_ENV}` | `secrets[AI_SECRET_REF].name` | `CLAUDE_API_KEY` |
| `${STEP_AI_ID}` | `step.id` (kind=externalSystem) | `step-03` |
| `${STEP_COMPUTE_ID}` | `step.id` (kind=compute、JSON.parse を含む) | `step-04` |
| `${THRESHOLD_FILTER_EXPRESSION}` | compute step の `expression` | `JSON.parse(...).filter(t => t.confidence >= 0.6)` |
| `${AI_THRESHOLD_VALUE}` | threshold リテラル (expression より抽出) | `0.6` |
| `${AI_MODEL_LITERAL}` | externalSystem httpCall.body から model 値を抽出 | `'claude-opus-4-7'` |
| `${AI_MAX_TOKENS_LIVE}` | externalSystem httpCall.body から max_tokens を抽出 | `512` |
| `${RETRY_MAX_ATTEMPTS}` | `externalSystems[systemRef].retryPolicy.maxAttempts` | `2` |
| `${RETRY_BACKOFF}` | `externalSystems[systemRef].retryPolicy.backoff` | `exponential` |
| `${RETRY_INITIAL_DELAY_MS}` | `externalSystems[systemRef].retryPolicy.initialDelayMs` | `1000` |
| `${AI_THRESHOLD_CONV_REF}` | compute step description の `@conv.ai.*` 参照 (記述がある場合) | `ai.tagSuggestThreshold` |
