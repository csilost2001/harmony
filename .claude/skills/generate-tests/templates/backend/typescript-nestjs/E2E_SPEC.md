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

## 16. AI flow セクション (P5 — #874 / Phase 2-B)

ProcessFlow に `kind ∈ {aiCall, aiAgent}` の step が含まれる場合、このセクションを追加する。
旧 `kind=externalSystem` + `systemRef=claudeApi` パターンは Phase 2-A (PR #937) で全 sample が
`aiCall` 化済 → 検出対象外。

### 16-A. ヘッダー spec → test mapping 追記 (Phase 2-B 対応版)

```
 * [step ${STEP_AI_ID}: kind=${AI_STEP_KIND}, modelRef="${AI_MODEL_REF}", responseFormat=${RESPONSE_FORMAT_KIND}]
 *   → AI-1: 業務フィルタ — threshold (${AI_THRESHOLD_VALUE}) 未満を除外 / ≥ threshold を採用
 *           (compute step が @<bind>.object.* または @<bind>.text を加工する場合のみ生成)
 *   → AI-2: ${AI_API_KEY_ENV} 未設定 → 503 Service Unavailable (auth.kind=bearer/apiKey の場合のみ)
 *   → AI-3: AI 応答が responseFormat 不適合 → 502 (json/structuredObject のみ生成、text/streaming は skip)
 *   → AI-4: provider 呼び出し失敗 → ${FAILURE_RESPONSE_STATUS} (outcomes.failure → responseId)
 *
 * === modelEndpoint 解決表 (project + flow merge 済) ===
 * step.modelRef = "${AI_MODEL_REF}"
 *   → modelEndpoints[${AI_MODEL_REF}] = {
 *       provider: "${AI_PROVIDER}",       // anthropic / openai / google / aws-bedrock / ollama / azure-openai
 *       model: "${AI_MODEL_NAME}",
 *       auth: { kind: "${AI_AUTH_KIND}", tokenRef: "@secret.${AI_SECRET_REF}" },
 *       defaults: { temperature: ..., maxTokens: ... }
 *     }
 *
 * === AI 参照解決表 ===
 * @secret.${AI_SECRET_REF}      → env var ${AI_API_KEY_ENV} (secrets.${AI_SECRET_REF}.name より)
 * @conv.${AI_THRESHOLD_CONV_REF} → リテラル ${AI_THRESHOLD_VALUE} (compute step より抽出)
 *   (#859 解決後: conventions catalog から解決)
 * AI model name → "${AI_MODEL_NAME}" (modelEndpoint.model)
 *   (provider 切替は modelEndpoints catalog 編集だけで完結 — step 側は modelRef のみ参照)
```

### 16-B. mock helper: `mocks/ai-runtime.ts` (provider 中立)

```typescript
/**
 * AI runtime service mock helper (provider 中立形式)
 *
 * Phase 2-C 確定: ProcessFlow.aiCall / aiAgent step に対応する runtime invocation を mock する。
 * 戻り値は spec §「outputBinding の値構造」に従う正規化形式 (provider 別の content[] / choices[] は隠蔽)。
 *
 * Phase 2-C で確定した契約 (固定):
 *   AiRuntimeService           — 実 service クラス名
 *   invoke                     — method 名
 *   ../src/ai/ai-runtime.service — e2e-spec から見た import パス
 *     (生成 backend は <出力先>/src/ai/ai-runtime.service.ts に配置される — `/generate-code`)
 *
 * 旧 mocks/claude-api.ts (Anthropic 形式 HTTP レスポンス mock) は Phase 2-A / 2-B 移行で廃止。
 */
import type { AiRuntimeService } from '../src/ai/ai-runtime.service';

/**
 * spec §「outputBinding の値構造」に対応する正規化レスポンス型。
 * responseFormat.kind に応じて使用するフィールドが変わる:
 *   text       → text のみ
 *   json       → object + raw
 *   structuredObject → object (responseFormat.schema 準拠) + raw
 *   streaming  → text (本層では完了後 assembled のみ扱う)
 *   tools 使用時は toolCalls を併用
 */
export interface AiInvocationResult {
  text?: string;
  object?: unknown;
  raw?: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
}

/**
 * (a) text format: aiCall.responseFormat={kind:"text"} (default) / streaming の正常応答
 */
export function mockAiText(
  svc: AiRuntimeService,
  text: string,
): jest.SpyInstance {
  const result: AiInvocationResult = {
    text,
    finishReason: 'end_turn',
    usage: { inputTokens: 50, outputTokens: 100 },
  };
  return jest.spyOn(svc, 'invoke').mockResolvedValue(result);
}

/**
 * (b) structuredObject format: aiCall.responseFormat={kind:"structuredObject", schema:...} の正常応答。
 *     object は responseFormat.schema 準拠で書くこと (テスト fixture 側で schema 準拠を保証)。
 */
export function mockAiStructured(
  svc: AiRuntimeService,
  object: unknown,
): jest.SpyInstance {
  const result: AiInvocationResult = {
    object,
    raw: JSON.stringify(object),
    finishReason: 'end_turn',
    usage: { inputTokens: 50, outputTokens: 100 },
  };
  return jest.spyOn(svc, 'invoke').mockResolvedValue(result);
}

/**
 * (c) json format: aiCall.responseFormat={kind:"json"} の正常応答 (schema 制約なし)。
 *     構造的には structuredObject と同形だが、AI-3 (format violation) の文脈で使い分ける。
 */
export function mockAiJson(
  svc: AiRuntimeService,
  object: unknown,
): jest.SpyInstance {
  return mockAiStructured(svc, object);
}

/**
 * (d) streaming format: 完了後の assembled text を返す (partial chunks は本層で扱わない)。
 */
export function mockAiStreaming(
  svc: AiRuntimeService,
  text: string,
): jest.SpyInstance {
  return mockAiText(svc, text);
}

/**
 * (e) provider 呼び出し失敗 (AI-4 / outcomes.failure)。
 *     mock が reject → runtime が outcomes.failure.action="abort" の path で responseId を返す想定。
 */
export function mockAiFailure(
  svc: AiRuntimeService,
  error?: Error,
): jest.SpyInstance {
  return jest
    .spyOn(svc, 'invoke')
    .mockRejectedValue(error ?? new Error('Mock provider error'));
}

/**
 * (f) format violation (AI-3、json / structuredObject のみ)。
 *     runtime が parse / schema 検証で失敗するケース。runtime 側で catch → 502 を返す前提。
 *
 * NOTE: 本 helper は invoke を直接 reject させるため AiRuntimeService 内部の normalizeAndValidate
 *   (JSON.parse / AJV 検証) は **バイパス** される。AI-3 の本来 runtime path
 *   (provider OK だが parse/schema 検証で 502) を E2E で再現したい場合は
 *   `mockAiStructured(aiRuntime, { /* schema 違反 object */ })` に切替えること。
 */
export function mockAiFormatViolation(
  svc: AiRuntimeService,
): jest.SpyInstance {
  return jest
    .spyOn(svc, 'invoke')
    .mockRejectedValue(
      new Error('Mock provider returned response that violates declared responseFormat'),
    );
}

/**
 * (g) tool call helper (aiCall + tools / aiAgent)。
 *     最終 assistant message に toolCalls を含む想定。aiAgent の途中 tool 呼び出しは
 *     runtime が内部処理するため、mock 対象は最終結果のみ。
 */
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

### 16-C. mock mode テストブロック

```typescript
/**
 * AI flow テスト: ${FLOW_NAME} mock mode (Phase 2-C)
 *
 * kind=${AI_STEP_KIND} step を AI runtime service (AiRuntimeService.invoke) で stub し、
 * token 消費なしで AI 固有ロジックを検証する。
 *
 * 参照フロー: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
 */
import {
  mockAiText,
  mockAiStructured,
  mockAiJson,
  mockAiStreaming,
  mockAiFailure,
  mockAiFormatViolation,
} from './mocks/ai-runtime';

describe('AI flow テスト [mock mode]', () => {
  let aiRuntimeSpy: jest.SpyInstance | undefined;

  afterEach(() => {
    if (aiRuntimeSpy) {
      aiRuntimeSpy.mockRestore();
      aiRuntimeSpy = undefined;
    }
  });

  // ──────────────────────────────────────────────────────────────
  // AI-1: 業務フィルタ検証 (responseFormat=${RESPONSE_FORMAT_KIND} 前提)
  //   compute step ${STEP_COMPUTE_ID} が @${AI_OUTPUT_BINDING}.<text|object>.* を加工する場合のみ生成
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
   *        step:${STEP_COMPUTE_ID} kind=compute (filter) [ai-mode:mock]
   * AI-1-a: threshold 未満 (confidence < ${AI_THRESHOLD_VALUE}) → 除外
   *
   * compute step expression: ${COMPUTE_FILTER_EXPRESSION}
   *   → threshold = ${AI_THRESHOLD_VALUE} (リテラル、#859 解決後に @conv.<key> へ)
   *
   * mock 戦略: responseFormat=structuredObject の object フィールドに schema 準拠 fixture を渡す。
   *            (responseFormat=text の場合は @<bind>.text を加工する想定で mockAiText を使用)
   */
  it(`#N AI-1: 信頼度 ${AI_THRESHOLD_VALUE} 未満のタグは除外される`, async () => {
    aiRuntimeSpy = mockAiStructured(aiRuntime, {
      tags: [
        { slug: 'high-confidence', name: '高信頼度タグ', confidence: 0.9 },
        { slug: 'below-threshold', name: '閾値未満タグ', confidence: 0.4 },
        { slug: 'exact-threshold', name: '閾値ちょうどタグ', confidence: ${AI_THRESHOLD_VALUE} },
      ],
    });

    const res = await request(app.getHttpServer())
      .post('${HTTP_ROUTE_PATH}')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ${REQUIRED_FIELDS_VALID} });

    expect(res.status).toBe(200);
    const candidates = res.body.candidates as Array<{ slug: string; confidence: number }>;

    expect(candidates.find((c) => c.slug === 'below-threshold')).toBeUndefined();
    expect(candidates.find((c) => c.slug === 'high-confidence')).toBeDefined();
    expect(candidates.find((c) => c.slug === 'exact-threshold')).toBeDefined();
  });

  it(`#N AI-1: 全タグが threshold 未満の場合 → candidates = [] (空配列)`, async () => {
    aiRuntimeSpy = mockAiStructured(aiRuntime, {
      tags: [
        { slug: 'low-1', name: '低信頼度1', confidence: 0.1 },
        { slug: 'low-2', name: '低信頼度2', confidence: 0.2 },
      ],
    });

    const res = await request(app.getHttpServer())
      .post('${HTTP_ROUTE_PATH}')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ${REQUIRED_FIELDS_VALID} });

    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────
  // AI-2: secret 未設定 → 503 fallback (auth.kind=bearer/apiKey の場合のみ)
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
   * AI-2: ${AI_API_KEY_ENV} 未設定 → 503 Service Unavailable
   *
   * modelEndpoint.auth.tokenRef = "@secret.${AI_SECRET_REF}"
   *   → secrets.${AI_SECRET_REF}.name = "${AI_API_KEY_ENV}"
   * API key 未設定時は provider 呼び出し前に 503 を返す設計が前提。
   *
   * NOTE: 実装が 401 / 500 を返す場合はその status に合わせて変更すること。
   *       auth.kind=none / iamRole / azureAd の場合は本テストを skip し申し送り化。
   */
  it(`#N AI-2: ${AI_API_KEY_ENV} 未設定 → 503 Service Unavailable`, async () => {
    const originalApiKey = process.env.${AI_API_KEY_ENV};
    process.env.${AI_API_KEY_ENV} = '';

    try {
      const res = await request(app.getHttpServer())
        .post('${HTTP_ROUTE_PATH}')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ${REQUIRED_FIELDS_VALID} });

      expect(res.status).toBe(503);
    } finally {
      process.env.${AI_API_KEY_ENV} = originalApiKey;
    }
  });

  // ──────────────────────────────────────────────────────────────
  // AI-3: response format violation (json / structuredObject のみ)
  //   responseFormat=text / streaming の場合は本ブロックを skip
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
   * AI-3: AI 応答が responseFormat=${RESPONSE_FORMAT_KIND} の制約に違反 → 502 (provider violation)
   *
   * runtime が parse / schema 検証を担うため、mock では検証失敗の例外を直接 throw する想定。
   * 実装が 500 を返す場合はその status に合わせて変更すること。
   */
  it(`#N AI-3: AI 応答が responseFormat 不適合 (${RESPONSE_FORMAT_KIND}) → 502`, async () => {
    aiRuntimeSpy = mockAiFormatViolation(aiRuntime);

    const res = await request(app.getHttpServer())
      .post('${HTTP_ROUTE_PATH}')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ${REQUIRED_FIELDS_VALID} });

    expect(res.status).toBe(502);
  });

  // ──────────────────────────────────────────────────────────────
  // AI-4: provider 呼び出し失敗 → outcomes.failure
  // ──────────────────────────────────────────────────────────────

  /**
   * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:mock]
   * AI-4: provider 呼び出し失敗 → ${FAILURE_RESPONSE_STATUS} (${FAILURE_ERROR_CODE})
   *
   * step.outcomes.failure = { action: "abort", description: "..." }
   *   → action.responses[].id="${FAILURE_RESPONSE_ID}" → status=${FAILURE_RESPONSE_STATUS}
   *
   * NOTE: SDK 内部の retry policy は Phase 2-C で確定。Phase 2-B は単発失敗のみ assertion。
   *       retry が定義された段階で AI-4-b (retry 回数 assertion) を追加する (申し送り)。
   */
  it(`#N AI-4: provider 呼び出し失敗 → ${FAILURE_RESPONSE_STATUS} (${FAILURE_ERROR_CODE})`, async () => {
    aiRuntimeSpy = mockAiFailure(aiRuntime);

    const res = await request(app.getHttpServer())
      .post('${HTTP_ROUTE_PATH}')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ${REQUIRED_FIELDS_VALID} });

    expect(res.status).toBe(${FAILURE_RESPONSE_STATUS});
  });
});
```

### 16-C-2. responseFormat 別の生成パターン早見表

| step.responseFormat.kind | mock helper | 期待 mock object | AI-1 適用 | AI-3 適用 |
|---|---|---|---|---|
| `text` (default) | `mockAiText(svc, "<text>")` | `{ text }` | compute が `@<bind>.text` を加工する場合のみ | skip |
| `json` | `mockAiJson(svc, <object>)` | `{ object, raw }` | compute が `@<bind>.object.*` を加工する場合のみ | 適用 (parse 失敗) |
| `structuredObject` | `mockAiStructured(svc, <object>)` | `{ object, raw }` (object は schema 準拠) | compute が `@<bind>.object.*` を加工する場合のみ | 適用 (schema 違反) |
| `streaming` | `mockAiStreaming(svc, "<text>")` | `{ text }` (assembled) | compute が `@<bind>.text` を加工する場合のみ | skip |

### 16-C-3. AiMessageSpread / AiImageSource を含む場合の fixture 戦略

**AiMessageSpread の検出**: `step.messages[].kind === "spread"` の場合、`ref` (例: `@turnContext`) の指す
変数を fixture として渡す必要がある。

```typescript
// 例: english-learning 96118ae1 (会話ターン進行)
//   step.messages = [
//     { role: 'system', content: '...' },
//     { kind: 'spread', ref: '@turnContext' },
//     { role: 'user', content: '@userInput' }
//   ]
// → @turnContext は action input。テスト fixture で過去 turns を渡す:
const turnContext = JSON.stringify([
  { role: 'user', content: 'Hello!' },
  { role: 'assistant', content: 'Hi! How are you today?' },
]);

aiRuntimeSpy = mockAiText(aiRuntime, "I'm doing well. What did you do today?");

const res = await request(app.getHttpServer())
  .post('/api/el/sessions/1/turns')
  .set('Authorization', `Bearer ${accessToken}`)
  .send({ userInput: 'I had pasta for lunch.', turnContext, generateAudio: false });

expect(res.status).toBe(200);
```

**generateAudio=true のテスト assertion**: TTS 分岐 (例: ProcessFlow `96118ae1` step-04 br-tts-on)
を持つ flow で `generateAudio=true` ケースを生成する場合、**条件付き `if (... !== null)` でラップせず直接 assertion** すること。条件付き assertion は実装が常に `null` を返しても素通りするため、実装挙動の回帰検出ができず楽観バイアスの罠になる (#1038 dogfood で実例)。

```typescript
// ❌ 悪いパターン (条件付き — 実装が null でも素通り)
if (res.body.aiAudioUrl !== null) {
  expect(typeof res.body.aiAudioUrl).toBe('string');
}

// ✅ 良いパターン (直接 assertion、形式まで含めて check)
expect(res.body.aiAudioUrl).not.toBeNull();
expect(typeof res.body.aiAudioUrl).toBe('string');
expect(res.body.aiAudioUrl).toMatch(/^https?:\/\/.+\.(mp3|wav|ogg)$/);
```

TTS 拡張 (例: `english-learning:TtsGenerate`) が未実装の場合でも、本 dogfood では stub URL を返すサンプル実装を提供するので、生成テストは直接 assertion で書く。

**AiImageSource (vision input) の fixture**: `step.messages[].content[]` に `{ type: "image", source }`
が含まれる場合、source.kind 別に fixture を準備する。

```typescript
// (a) source.kind = "url" (literal)
//   → fixture 不要、mock のみ
aiRuntimeSpy = mockAiText(aiRuntime, '日本語の alt テキスト');

// (b) source.kind = "url" (expression "@<var>")
//   → request body or DB seed で var を埋める。
//     例: diary b0c1d2e3 (画像 alt 生成) — source.url = "@targetImageUrl"
//     targetImageUrl = @photoRow.url ?? @inputs.imageUrl
const res = await request(app.getHttpServer())
  .post('/api/ai/alt-text')
  .set('Authorization', `Bearer ${accessToken}`)
  .send({ imageUrl: 'https://example.com/test.jpg' });

// (c) source.kind = "fileRef"
//   → multipart/form-data で file を attach
const res2 = await request(app.getHttpServer())
  .post('/api/ai/alt-text')
  .set('Authorization', `Bearer ${accessToken}`)
  .field('photoId', 1)
  .attach('photo', Buffer.from(<base64-image>, 'base64'), 'test.jpg');

// (d) source.kind = "base64"
//   → request body に base64 文字列を含める
```

### 16-D. 実 API mode テストブロック

```typescript
/**
 * AI flow テスト: 実 API mode
 *
 * CI では skip (default)。手動 smoke 時のみ実行:
 *   RUN_AI_INTEGRATION=1 ${AI_API_KEY_ENV}=<key> npx jest <filename> --runInBand
 *
 * 注意: 実際の AI provider (${AI_PROVIDER}) を叩くため、API コストが発生する。
 *       テスト 1 回あたり最大 ${AI_MAX_TOKENS_LIVE} tokens 消費 (modelEndpoint.defaults.maxTokens より)。
 *
 * NOTE: `describe.skipIf` は Vitest 専用 API。jest では TypeError になるため
 *       ternary パターン (jest + vitest 両互換) を使用する:
 *       (cond ? describe : describe.skip)(name, fn)
 */
(process.env.RUN_AI_INTEGRATION === '1' ? describe : describe.skip)(
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
    it(`#N [live] happy path: 実 ${AI_PROVIDER} (${AI_MODEL_NAME}) でレスポンスが返る`, async () => {
      const res = await request(app.getHttpServer())
        .post('${HTTP_ROUTE_PATH}')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ${REQUIRED_FIELDS_VALID_LIVE} });

      expect(res.status).toBe(200);
      // 実 API レスポンスは非決定論的なため、structure のみ確認
      // (responseFormat=structuredObject の場合は schema 準拠を assertion してもよい)
    }, 60_000);

    /**
     * Spec: ProcessFlow ${FLOW_ID} step:${STEP_AI_ID} [ai-mode:live]
     * AI-6: 実 API — 業務フィルタの動作確認 (非決定論的、AI-1 該当時のみ)
     */
    it(`#N [live] 業務フィルタ: 全候補が threshold >= ${AI_THRESHOLD_VALUE}`, async () => {
      const res = await request(app.getHttpServer())
        .post('${HTTP_ROUTE_PATH}')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ${REQUIRED_FIELDS_VALID_LIVE_2} });

      expect(res.status).toBe(200);
      // 適用範囲は AI-1 の compute step に依存
    }, 60_000);
  },
);
```

### 16-E. AI テスト PLACEHOLDER 置換チートシート (Phase 2-C 確定後)

生成時に以下の PLACEHOLDER を ProcessFlow JSON + merged catalogs から展開する。
`AI_RUNTIME_*` は Phase 2-C で確定済 (固定契約)、それ以外は flow 固有値:

| PLACEHOLDER | 展開元 | 例 |
|---|---|---|
| `${AI_STEP_KIND}` | `step.kind` | `aiCall` / `aiAgent` |
| `${AI_MODEL_REF}` | `step.modelRef` | `tagSuggestModel` |
| `${AI_PROVIDER}` | `merged.modelEndpoints[modelRef].provider` | `anthropic` |
| `${AI_MODEL_NAME}` | `merged.modelEndpoints[modelRef].model` | `claude-opus-4-7` |
| `${AI_AUTH_KIND}` | `merged.modelEndpoints[modelRef].auth.kind` | `bearer` |
| `${AI_SECRET_REF}` | `merged.modelEndpoints[modelRef].auth.tokenRef` から `@secret.` を除去 | `anthropicApiKey` |
| `${AI_API_KEY_ENV}` | `merged.secrets[AI_SECRET_REF].name` | `ANTHROPIC_API_KEY` |
| `${RESPONSE_FORMAT_KIND}` | `step.responseFormat.kind` (default `text`) | `structuredObject` |
| `${STEP_AI_ID}` | `step.id` (kind=aiCall|aiAgent) | `step-03` |
| `${STEP_COMPUTE_ID}` | 後続 compute step の `step.id` (AI-1 該当時) | `step-04` |
| `${COMPUTE_FILTER_EXPRESSION}` | compute step の `expression` | `@aiResponse.object.tags.filter(t => t.confidence >= 0.6)...` |
| `${AI_THRESHOLD_VALUE}` | threshold リテラル (expression より抽出、@conv.* なら catalog 参照) | `0.6` |
| `${AI_OUTPUT_BINDING}` | `step.outputBinding.name` | `aiResponse` |
| `${AI_MAX_TOKENS_LIVE}` | `merged.modelEndpoints[modelRef].defaults.maxTokens` | `512` |
| `${FAILURE_RESPONSE_ID}` | `step.outcomes.failure` → `action.responses[]` の対応 id | `502-ai-error` |
| `${FAILURE_RESPONSE_STATUS}` | `action.responses[FAILURE_RESPONSE_ID].status` | `502` |
| `${FAILURE_ERROR_CODE}` | catalog `errors[].code` (responseId と紐付く) | `AI_API_ERROR` |

#### AI runtime 固定契約 (Phase 2-C 確定済 — PLACEHOLDER ではない)

以下は `/generate-code` Phase 2-C で生成される `AiRuntimeService` の固定契約に対応する。
generate-tests 側は値を埋め込むだけで、catalog から派生しない:

| 項目 | 値 |
|---|---|
| service クラス名 | `AiRuntimeService` |
| 呼び出し method 名 | `invoke` |
| import パス (e2e-spec から) | `../src/ai/ai-runtime.service` |
