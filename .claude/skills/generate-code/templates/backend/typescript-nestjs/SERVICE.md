# TypeScript NestJS — Service テンプレート

ProcessFlow の `actions[]` 全体を 1 つの `@Injectable` Service クラスにマッピングする。

## フィールドマッピング

| ProcessFlow JSON フィールド | NestJS 生成物 |
|---|---|
| `meta.name` | クラス名 (PascalCase + "Service") |
| `actions[].httpRoute` | Controller 側のデコレータ (`@Post`, `@Get` 等) |
| `actions[].inputs[]` | メソッド引数 (DTO クラス) |
| `actions[].outputs[]` | メソッド戻り値の型 (Response DTO) |
| `steps` (kind=dbAccess) | TypeORM Repository 呼び出し / `dataSource.query()` |
| `steps` (kind=transactionScope) | `dataSource.transaction(async manager => { ... })` (1 step が TX 全体を包む型) |
| `steps[i].txBoundary` (`role`∈{begin, member, end}) | **同 `txId` の全 step を `prisma.$transaction(async (tx) => { ... })` または `dataSource.transaction(async manager => ...)` で wrap** (#875)。識別: `txBoundary.txId=X` かつ `role ∈ {begin, member, end}` の全 step (`begin` / 中間の `member` 群 / `end`) を **すべて TX クライアント (`tx` / `manager`) 経由に書き換える**。`member` を見落とすと TX 範囲が崩れる silent bug の元。詳細は本ファイル末尾の「txBoundary mapping」セクション |
| `steps` (kind=branch) | if/else 文 |
| `steps` (kind=eventPublish) | `EventEmitter2.emit(topic, payload)` |
| `steps` (kind=compute) | ローカル変数計算ロジック |
| `steps` (kind=validation) | class-validator / 手動バリデーション |
| `steps` (kind=return) | `return { ... }` 文 |
| `steps` (kind=loop) | for...of / forEach 文 |
| `steps` (kind=log) | `this.logger.error(...)` / `this.logger.log(...)` |
| `steps` (kind=aiCall) | `await this.aiRuntime.invoke({ modelRef, messages, responseFormat?, tools?, ... })` (詳細は `AI_SERVICE.md`) |
| `steps` (kind=aiAgent) | `await this.aiRuntime.invoke({ modelRef, messages, tools, agent: { maxIterations, toolRunner } })` (詳細は `AI_SERVICE.md`) |
| `steps` (extension step の `type: "other"`) | // TODO コメント + outputSchema で型推定 (注: schema `kind` に `other` は存在しない。extension step 内の sub-type 概念と混同しないこと) |

## テンプレート本体

```typescript
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { {{processFlow.meta.name | toPascalCase}}RequestDto } from './dto/{{processFlow.meta.name | toKebabCase}}-request.dto';
import { {{processFlow.meta.name | toPascalCase}}ResponseDto } from './dto/{{processFlow.meta.name | toKebabCase}}-response.dto';
// import { {{table.physicalName | toPascalCase}} } from '../entity/{{table.physicalName | toKebabCase}}.entity';
// AI flow 含有時のみ:
// import { AiRuntimeService } from '../ai/ai-runtime.service';

/**
 * {{processFlow.meta.name}} サービス。
 *
 * {{processFlow.meta.description}}
 *
 * ProcessFlow ID: {{processFlow.meta.id}}
 */
@Injectable()
export class {{processFlow.meta.name | toPascalCase}}Service {
  private readonly logger = new Logger({{processFlow.meta.name | toPascalCase}}Service.name);

  constructor(
    // ProcessFlow lineage.reads / lineage.writes から導出した Repository 群
    // @InjectRepository({{table.physicalName | toPascalCase}})
    // private readonly {{table.physicalName | toCamelCase}}Repository: Repository<{{table.physicalName | toPascalCase}}>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    // AI flow 含有時のみ inject (kind=aiCall|aiAgent step がある場合):
    // private readonly aiRuntime: AiRuntimeService,
  ) {}

  /**
   * {{processFlow.actions[0].name}}。
   *
   * {{processFlow.actions[0].description}}
   *
   * @param dto 入力 DTO ({{processFlow.actions[0].inputs | map name | join ', '}})
   * @param sessionCustomerId セッション顧客 ID (ambientVariables から)
   */
  async execute(
    dto: {{processFlow.actions[0].name | toPascalCase}}RequestDto,
    sessionCustomerId: number,
  ): Promise<{{processFlow.actions[0].name | toPascalCase}}ResponseDto> {

    // Step: バリデーション (processFlow step kind=validation から展開)
    // class-validator で @IsNotEmpty(), @Matches(/^\d{7}$/) 等を DTO に付与

    // Step: メインロジック (processFlow actions[0].steps を順に展開)
    // [kind=dbAccess, operation=SELECT]
    //   const rows = await this.tableRepository.find({ where: { ... } });
    //   または
    //   const rows = await this.dataSource.query('SELECT ...', [param]);
    //
    // [kind=transactionScope]
    //   const result = await this.dataSource.transaction(async (manager) => {
    //     // TX 内 steps をここに展開
    //     // ...
    //     return txResult;
    //   });
    //
    // [kind=compute]
    //   const totalAmount = cartItems.reduce((sum, item) => sum + item.unitPriceSnapshot * item.quantity, 0);
    //
    // [kind=branch]
    //   if (condition) { throw new HttpException(..., HttpStatus.UNPROCESSABLE_ENTITY); }
    //
    // [kind=loop, loopKind=collection]
    //   for (const cartItem of cartItems) { ... }
    //
    // [kind=eventPublish]
    //   this.eventEmitter.emit('{{processFlow.context.catalogs.events | firstKey}}', { orderId, orderNumber, ... });
    //
    // [kind=return]
    //   return { orderId: ..., orderNumber: ..., totalAmount: ... };
    //
    // [kind=log]
    //   this.logger.error('TX がロールバックされました', { customerId: sessionCustomerId });
    //
    // [kind=aiCall] (Phase 2-C、詳細は AI_SERVICE.md):
    //   const {{step.outputBinding.name}} = await this.aiRuntime.invoke({
    //     modelRef: '{{step.modelRef}}',
    //     messages: [/* AiMessage[] / AiMessageSpread / AiImageSource を展開 */],
    //     responseFormat: {{step.responseFormat | json}}, // 省略時は {kind:'text'}
    //     tools: {{step.tools | json}},                    // 省略可
    //     toolChoice: {{step.toolChoice | json}},          // 省略可
    //     inferenceParameters: {{step.inferenceParameters | json}}, // catalog defaults と merge
    //   });
    //
    // [kind=aiAgent] (Phase 2-C、詳細は AI_SERVICE.md):
    //   const {{step.outputBinding.name}} = await this.aiRuntime.invoke({
    //     modelRef: '{{step.modelRef}}',
    //     messages: [...],
    //     tools: [...],          // minItems=1
    //     toolChoice: { mode: 'auto' }, // step.toolChoice (schema oneOf) を runtime 形式に変換
    //     agent: {
    //       maxIterations: {{step.maxIterations}}, // schema は AiAgentStep 直下 (default 10)
    //       toolRunner: async (call) => {
    //         switch (call.name) {
    //           case 'searchWeb': return this.searchWebTool.run(call.arguments);
    //           // ...
    //         }
    //       },
    //     },
    //   });
    //
    // [extension step, type=other] ← schema の kind ではなく extension step 内の sub-type
    //   // TODO: {{step.description}} (outputSchema: {{step.outputSchema}})

    throw new Error('実装してください');
  }
}
```

## transactionScope → dataSource.transaction マッピング

```typescript
// ProcessFlow transactionScope:
//   isolationLevel: "READ_COMMITTED"
//   propagation: "REQUIRED"
//   timeoutMs: 10000
//   rollbackOn: ["STOCK_SHORTAGE", "ORDER_NUMBER_CONFLICT"]
//   outputBinding: { name: "txResult" }

const txResult = await this.dataSource.transaction('READ COMMITTED', async (manager) => {
  // TX 内 steps を展開
  // rollbackOn のエラーは例外として throw → dataSource.transaction が自動 rollback
  return { committed: true, data: { ... } };
});

// txResult から @txResult.committed / @txResult.error.code に相当するフィールドで分岐
if (!txResult.committed) {
  if (txResult.errorCode === 'STOCK_SHORTAGE') {
    throw new HttpException({ code: 'STOCK_SHORTAGE', message: '在庫が不足しています。' }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  // ...
}
```

## txBoundary mapping (#875 — `step.txBoundary.role` ∈ {begin, member, end})

`step.kind=transactionScope` (1 step が TX 全体を内包) と並んで、Harmony spec には **複数の sequential step を `txBoundary.role` でマークして 1 TX を構成する** パターンがある (schema enum: **`["begin", "member", "end"]`**)。実装では **必ず `$transaction()` で wrap** すること (#875: 未対応で生成すると silent semantic bug になる)。

### 識別ロジック

`step.txBoundary.txId=X` を持つ全 step (`role` が `begin`/`member`/`end` のいずれであっても) を 1 TX で wrap する。`begin` のみを目印にして「end まで」と探索すると `member` の中間 step に明示的な `txBoundary` がついていた場合に混乱するので、**txId 単位での grouping** が安全。

### Spec の例 (diary 投稿作成 `0671b051` 実物)

```jsonc
"steps": [
  { "id": "step-01", "kind": "validation", ... },             // TX 外
  { "id": "step-02", "kind": "compute", ... },                // TX 外
  { "id": "step-03", "kind": "dbAccess", "operation": "INSERT",
    "txBoundary": { "role": "begin", "txId": "tx-post-create" } },
  { "id": "step-04", "kind": "loop", ...,
    "txBoundary": { "role": "member", "txId": "tx-post-create" } },   // ← member、TX 内
  { "id": "step-05", "kind": "loop", ...,
    "txBoundary": { "role": "member", "txId": "tx-post-create" } },   // ← member、TX 内
  { "id": "step-06", "kind": "dbAccess", "operation": "UPDATE",
    "txBoundary": { "role": "end", "txId": "tx-post-create" } },
  { "id": "step-07", "kind": "return", ... }                  // TX 外
]
```

**この `member` を見落とすと、step-04/05 が TX 外で実行されてしまい、UNIQUE 違反等の rollback 範囲が崩れる**。`txId="tx-post-create"` を共有する全 step (この例では step-03〜06 の 4 件) を $transaction 内に展開すること。

### 生成パターン (Prisma)

`techStack.backend.framework=nestjs` + `techStack.database.type=sqlite|postgresql|mysql` の場合は Prisma を選択 (本テンプレートのデフォルト ORM、将来 `techStack.orm` field で明示化予定)。

constructor で `PrismaService` を注入し、`Prisma.TransactionClient` 型を `@prisma/client` から import:

```typescript
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: number, dto: CreatePostDto) {
    // step-01 + step-02: TX 外で実行
    const publishedAt = dto.status === 'published' ? new Date() : null;

    // step-03 .. step-06 (txId="tx-post-create" 全 step): 1 TX で wrap
    return await this.prisma.$transaction(async (tx) => {
      // step-03 (role=begin): dbAccess INSERT posts (tx 経由)
      const post = await tx.post.create({ data: { ... } });

      // step-04 (role=member): loop INSERT photos (tx 経由)
      if (dto.photos) {
        for (const p of dto.photos) {
          await tx.photo.create({ data: { ... } });
        }
      }

      // step-05 (role=member): loop INSERT post_tags + tag 解決 (tx 経由)
      if (dto.tags) {
        for (const tag of dto.tags) {
          const tagId = await this.resolveTagIdTx(tx, tag);
          await tx.postTag.create({ data: { ... } });
        }
      }

      // step-06 (role=end): UPDATE tags.usage_count (tx 経由、TX commit と一体)
      // ...

      // step-07 (TX 外、ただし return として TX commit 後に値を返す)
      return { postId: post.id };
    });
  }

  // upsert ヘルパーも TX クライアントを受け取る (tx 経由でないと別接続になり TX に乗らない)
  private async resolveTagIdTx(
    tx: Prisma.TransactionClient,
    tag: { id?: number; name?: string },
  ): Promise<number> {
    // tx.tag.findFirst / tx.tag.create を使う (this.prisma は使わない)
    // ...
  }
}
```

### 生成パターン (TypeORM、参考)

```typescript
async create(userId: number, dto: CreatePostDto) {
  return await this.dataSource.transaction(async (manager) => {
    const post = await manager.save(Post, { ... });
    for (const p of dto.photos) {
      await manager.save(Photo, { post_id: post.id, ... });
    }
    return { postId: post.id };
  });
}
```

### 重要なルール

1. **TX クライアント (`tx` / `manager`) を中で使うこと**。`this.prisma.*` や `this.dataSource.*` をうっかり使うと **TX 外の別接続** で実行され、rollback されない silent bug になる
2. **TX 内で呼ぶ private helper メソッドは tx を引数で受ける** ように書き換える (例: `resolveTagIdTx(tx, ...)`)
3. **`@Transactional` メソッドの分離は不要** (NestJS は AOP proxy 不要、関数 closure で完結)
4. **rollbackOn 相当**: spec の `affectedRowsCheck.onViolation=throw` などで例外 throw すれば `$transaction()` が自動 rollback。Prisma は `Prisma.PrismaClientKnownRequestError` も rollback トリガー
5. **isolation level**: `prisma.$transaction(fn, { isolationLevel: 'ReadCommitted' })` で指定可 (PostgreSQL / MySQL / SQL Server のみ)。spec の `transactionScope.isolationLevel` が無い `txBoundary` の場合は default。⚠️ **SQLite (`database.type=sqlite`) では `isolationLevel` オプション指定不可** — Prisma が `PrismaClientUnknownRequestError` を throw する。SQLite ターゲットでは `$transaction(fn)` をオプションなしで呼ぶこと。ROM 別の default は engine 依存 (PostgreSQL: ReadCommitted、SQLite: serializable に近い WAL モード、MySQL InnoDB: RepeatableRead)

### 検証 (#875 由来の Spike test pattern)

TX が機能しているかは **故意失敗テスト** で検証可能:

```typescript
it('TX rollback: UNIQUE 違反で全 INSERT が rollback されること', async () => {
  // 同一タグ 2 回送信 → post_tags UNIQUE 違反
  await request(app.getHttpServer())
    .post('/api/posts')
    .send({ title: 'X', body: 'X', tags: [{id: 1}, {id: 1}] })
    .expect(500);
  // posts テーブルに行が残っていないことを確認
  expect(await prisma.post.findFirst({ where: { title: 'X' } })).toBeNull();
});
```

このテストが **fail する** = `/generate-code` が `txBoundary` を honor せず TX wrap を生成していない (#875 の症状)。skill 利用者は生成コードに対してこの種の test を最低 1 件は必ず実行することを推奨。

---

## ambientVariables → NestJS パターン

```typescript
// ProcessFlow ambientVariables: [{ name: "sessionCustomerId", type: "integer", required: true }]
// → Controller の @Req() / @Session() / カスタムデコレータ経由で取得

@Get()
async execute(
  @Body() dto: RequestDto,
  @Req() req: Request,
): Promise<ResponseDto> {
  const sessionCustomerId: number = (req.session as any).customerId;
  return this.service.execute(dto, sessionCustomerId);
}
```
