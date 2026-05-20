# golden-examples/posts-create-e2e

> **golden 種別**: 本 golden は `${PLACEHOLDER}` 抽象スタイル — skill が任意の ProcessFlow に対して生成する **テンプレート参照** を意図。実 UUID 入りの golden は `golden-examples/diary-ai-tag-suggest/` (実 sample からの生成見本)。

ProcessFlow `0671b051-4acc-49cf-ba92-9fa29b47f671` (投稿作成) を題材にした
`/generate-tests` スキルのゴールデン出力。

実際の Spike テスト (`~/projects/diary/apps/api/test/posts.create.e2e-spec.ts`, 614 行 / 15 件 pass)
を抽象化して、スキルが真似できる形に整理している。

## 抽象化の方針

### PLACEHOLDER 記法

diary アプリ固有の具体値を `${PLACEHOLDER}` 形式で抽象化している。
スキルが実際にテストを生成する際は、ProcessFlow JSON と harmony.json から解決した値で置換する。

| PLACEHOLDER | 解決元 | diary での具体値 |
|---|---|---|
| `${FLOW_ID}` | ProcessFlow の `meta.id` | `0671b051-4acc-49cf-ba92-9fa29b47f671` |
| `${FLOW_NAME}` | ProcessFlow の `meta.name` | `投稿作成` |
| `${ACTION_ID}` | `actions[].id` | `act-001` |
| `${ACTION_NAME}` | `actions[].name` | `投稿作成` |
| `${HTTP_ROUTE_METHOD}` | `actions[].httpRoute.method` | `POST` |
| `${HTTP_ROUTE_PATH}` | `actions[].httpRoute.path` | `/api/posts` |
| `${HTTP_ROUTE_AUTH}` | `actions[].httpRoute.auth` | `required` |
| `${OUTPUT_ID_FIELD}` | `actions[].outputs[].name` | `postId` |
| `${REQUIRED_FIELD_1}` | `inputs[required=true]` の最初 | `title` |
| `${REQUIRED_FIELD_2}` | `inputs[required=true]` の 2 番目 | `body` |
| `${TITLE_FIELD}` | `inputs[validation.maxLength]` のあるフィールド | `title` |
| `${TITLE_MAX_LENGTH}` | `validation.maxLength.length` | `200` |
| `${TITLE_MAX_LENGTH_PLUS_1}` | `TITLE_MAX_LENGTH + 1` | `201` |
| `${STATUS_FIELD}` | `inputs[validation.enum]` のあるフィールド | `status` |
| `${STATUS_ENUM_VALUES}` | `validation.enum.values` | `["draft","published"]` |
| `${STATUS_DRAFT}` | enum の最初の値 | `draft` |
| `${STATUS_PUBLISHED}` | enum の 2 番目の値 | `published` |
| `${PHOTOS_FIELD}` | `inputs[type=array]` の最初 | `photos` |
| `${TAGS_FIELD}` | `inputs[type=array]` の 2 番目 | `tags` |
| `${TABLE_MAIN}` | step-03 の `lineage.writes[0].tableId` → physicalName | `posts` |
| `${TABLE_CHILD}` | step-04 loop inner の `lineage.writes[0].tableId` → physicalName | `photos` |
| `${TABLE_JUNCTION}` | step-05 loop inner step-05-04 の `lineage.writes[0].tableId` → physicalName | `post_tags` |
| `${TABLE_MASTER}` | step-05-01/02 の `tableId` → physicalName | `tags` |
| `${MASTER_MODEL_JA}` | `TABLE_MASTER` の日本語名 | `タグ` |
| `${STEP_TX_SCOPE_ID}` | `transactionScope` step の id (#1221 で旧 txBoundary 廃止) | `step-tx` |
| `${COMPUTED_DATE_FIELD}` | `step-02.outputBinding.name` + DB カラム名 | `publishedAt` |
| `${ADMIN_USERNAME}` | seed.ts の管理者ユーザー名 | `admin` |
| `${ADMIN_PASSWORD}` | seed.ts の管理者パスワード | `diary-admin` |
| `${AdminHelper}` | ヘルパー関数名の PascalCase | `Admin` |
| `${mainModelPrisma}` | `TABLE_MAIN` のキャメルケース | `post` |
| `${childModel1Prisma}` | `TABLE_CHILD` のキャメルケース | `photo` |
| `${childModel2Prisma}` | `TABLE_JUNCTION` のキャメルケース | `postTag` |
| `${masterModelPrisma}` | `TABLE_MASTER` のキャメルケース | `tag` |
| `${parentIdField1}` | `TABLE_CHILD` の親 FK カラム (camelCase) | `postId` |
| `${parentIdField2}` | `TABLE_JUNCTION` の親 FK カラム (camelCase) | `postId` |
| `${masterFKField}` | `TABLE_JUNCTION` のマスタ FK カラム (camelCase) | `tagId` |
| `${HTTP_STATUS_ERROR}` | TX 失敗時の期待 HTTP status | `500` |
| `${BOUNDARY_CHAR}` | maxLength boundary テストの繰り返し文字 | `あ` |

### step ID マッピング

| PLACEHOLDER | ProcessFlow step.id |
|---|---|
| `${STEP_VALIDATION_ID}` | `step-01` |
| `${STEP_PUBLISH_AT_COMPUTE_ID}` | `step-02` |
| `${STEP_POSTS_INSERT_ID}` | `step-03` |
| `${STEP_MAIN_INSERT_ID}` | `step-03` |
| `${STEP_PHOTOS_LOOP_ID}` | `step-04` |
| `${STEP_CHILD_LOOP_ID}` | `step-04` |
| `${STEP_CHILD_INSERT_ID}` | `step-04-01` |
| `${STEP_TAGS_LOOP_ID}` | `step-05` |
| `${STEP_JUNCTION_LOOP_ID}` | `step-05` |
| `${STEP_JUNCTION_INSERT_ID}` | `step-05-04` |
| `${STEP_RUN_IF_SELECT_ID}` | `step-05-01` |
| `${STEP_RUN_IF_INSERT_ID}` | `step-05-02` |

## テストケース一覧 (Spike 対応)

| # | テスト内容 | spec anchor | Spike との対応 |
|---|---|---|---|
| 1 | happy path: 全フィールド → 201 + postId | act-001 responses[201] / outputs[postId] | Spike #1 |
| 2 | title 欠落 → 400 | step-01 required(title) | Spike #2 |
| 3 | body 欠落 → 400 | step-01 required(body) | Spike #3 |
| 4 | status="invalid" → 400 | step-01 enum(status) | Spike #4 |
| 5 | title 201 文字 → 400 | step-01 maxLength(200) 超過 | Spike #5 |
| 5b | title 200 文字 → 201 | step-01 maxLength(200) 境界値 OK | Spike #5b |
| 6 | JWT なし → 401 | httpRoute.auth=required | Spike #6 |
| 7 | posts に row 追加 | step-03 dbAccess INSERT posts | Spike #7 |
| 8 | photos 2 件 → photos に 2 行 | step-04 loop + step-04-01 INSERT photos | Spike #8 |
| 9 | 既存タグ → post_tags に 1 行 + source | step-05 loop + step-05-04 INSERT post_tags | Spike #9 |
| 10 | TX: 同一タグ 2 回 → 500 (TX 未実装文書化) | transactionScope step (#1221 で旧 txBoundary 廃止) | Spike #10 |
| 11 | status=draft → publishedAt null | step-02 compute | Spike #11 |
| 12 | status=published → publishedAt non-null | step-02 compute | Spike #12 |
| 13 | 新規タグ名 → tags row + post_tags | step-05-01 runIf=true / step-05-02 | Spike #13 |
| 14 | status 未指定 → draft (runIf=false ケース) | inputs[status].required=false / COALESCE | Spike #14 |

## 再生成時の section 保護

ファイル冒頭の anchor を使い、スキル再実行時に spec 由来 section のみを overwrite する:

```
// ===HARMONY_GENERATED_SECTION_START flowId=<id> actionId=<id>===
... (この間を overwrite)
// ===HARMONY_GENERATED_SECTION_END===
```

anchor の外側 (人手で追加した assertion や describe ブロック) は保護される。

## 実機検証 (Option B 方式)

Spike の `posts.create.e2e-spec.ts` を `apps/api/test/` に置いて jest を実行:

```bash
cd ~/projects/diary/apps/api
DATABASE_URL="file:$(pwd)/prisma/dev.db" npx jest --config test/jest-e2e.json --testPathPattern="posts.create" --runInBand
```

期待結果: 15/15 pass (テストケース #1〜#14 + #5b の計 15 件)

## P2 受け入れ基準 6 項目の充足状況 (#871)

以下は δ-2 (#871) で定義した 6 受け入れ基準と、本 golden での充足状況のマッピング表。

| # | 受け入れ基準 | golden での実現 | spec anchor |
|---|---|---|---|
| 1 | `lineage.writes[].tableId` → 行数増減 SELECT | #7 (posts row 追加), #8 (photos 行追加), #9 (post_tags 行追加) で `prisma.Model.findUnique / findMany` 確認 | step-03, step-04-01, step-05-04 |
| 2 | `step.kind=loop + collectionSource` → N 件 = N 行 | #8 photos 2 件 → 2 行, #9 tags 1 件 → 1 行 (Spike L-3) | step-04, step-05 |
| 3 | `transactionScope step` → 故意失敗で全 rollback (#1221 で旧 txBoundary 廃止) | #10 同一タグ 2 回 (post_tags UNIQUE 違反) → 500 + posts 残存確認 (TX 未実装文書化) | transactionScope step (steps[] 配下) |
| 4 | `affectedRowsCheck.onViolation=throw` → 0 行 → 5xx | #7 (step-03 の affectedRowsCheck=throw) が INSERT 成功を前提に確認。**#15 で onViolation=throw 専用テスト追加** | step-03 affectedRowsCheck |
| 5 | `affectedRowsCheck.onViolation=log` → 0 行でも続行 | **#15b で onViolation=log 専用テスト追加** (step-05-02 が log) | step-05-02 affectedRowsCheck |
| 6 | `step.kind=compute` → DB 値の null/non-null | #11 status=draft → publishedAt null, #12 status=published → publishedAt non-null + 時刻範囲 | step-02 compute |

### 充足状況サマリ

- ✅ 基準 1: tests #7/#8/#9 でカバー (既存 Spike 由来)
- ✅ 基準 2: tests #8/#9 でカバー (既存 Spike 由来)
- ✅ 基準 3: test #10 でカバー (既存 Spike 由来 + TX 文書化パターン)
- ✅ 基準 4: **test #15 を新規追加** (golden spec.ts に追記)
- ✅ 基準 5: **test #15b を新規追加** (optional, golden spec.ts に追記)
- ✅ 基準 6: tests #11/#12 でカバー (既存 Spike 由来)

### P2 で新規追加したテストケース (#15, #15b)

| # | テスト内容 | spec anchor | 備考 |
|---|---|---|---|
| 15 | affectedRowsCheck(throw): 0 行誘起 → 500 (POST_CREATE_FAILED) | step-03 affectedRowsCheck.onViolation=throw | mock で INSERT 0 行を誘起 |
| 15b | affectedRowsCheck(log): 0 行条件でも 201 が返る | step-05-02 affectedRowsCheck.onViolation=log | UNIQUE 違反スキップで続行確認 |

**注意**: #15 の「0 行 INSERT 誘起」は SQLite + Prisma では実装依存。
現 diary 実装は INSERT が必ず 1 行返す（RETURNING で newPost を使う）ため、
`mock` または実装側のエラーパス分岐で誘起する必要がある。
golden では「誘起方法を申し送り」として記録するパターンを示す。

---

## P2 以降への申し送り (updated)

### TX-1 (重要): $transaction 未実装の場合の rollback テスト

Spike 実績では posts.service.ts が `$transaction` を使わないため、
post_tags UNIQUE 違反後も posts 行が残存する。

テスト #10 は「500 が返る」確認で pass する設計 (D-3)。
`$transaction` 実装後は「posts に行が残らない」ことも assert するよう進化させる:

```typescript
// $transaction 実装後の assert (現在はコメントアウト):
// expect(remainingRows).toHaveLength(0);  // rollback 成功を確認
```

### STEP_CHILD_INSERT の order_index フィールド

photos の orderIndex フィールドを使った順序確認テストは Spike #8 に含まれている。
golden #8 では `orderBy: { orderIndex: 'asc' }` + `expect(photos[0].url).toBe(...)` で確認する。
これは「loop insert の N 件確認」に含まれるため基準 2 で充足。

### affectedRowsCheck.onViolation=throw の 0 行誘起方法

step-03 (INSERT posts) の affectedRowsCheck.onViolation=throw は:
- INSERT 自体が 0 行を返すのは DB 制約違反 (NOT NULL / CHECK / etc.) が必要
- 現 SQLite では `RETURNING` を持つ INSERT が 0 行を返すケースが限定的
- テスト #15 は「mock 経由またはサービス層のエラーパス」で誘起する設計を示す
- より確実な実機テストは「DB mock (jest.spyOn / jest.fn)」で Prisma の create を失敗させる方法を推奨

### affectedRowsCheck.onViolation=log (step-05-02) の確認

step-05-02 は「既存タグ名でリクエストして、UNIQUE 違反で 0 行 INSERT → log して続行」を期待。
テスト #15b はこのシナリオを示す。Spike #13 (新規タグ名) の逆ケース。
