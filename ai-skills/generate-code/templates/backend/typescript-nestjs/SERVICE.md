# TypeScript NestJS — Service テンプレート

ProcessFlow の `actions[]` 全体を 1 つの `@Injectable` Service クラスにマッピングする。

## フィールドマッピング

| ProcessFlow JSON フィールド | NestJS 生成物 |
|---|---|
| `meta.name` | クラス名 (PascalCase + "Service") |
| `actions[].httpRoute` | Controller 側のデコレータ (`@Post`, `@Get` 等) |
| `actions[].inputs[]` | メソッド引数 (DTO クラス) |
| `actions[].outputs[]` | メソッド戻り値の型 (Response DTO) |
| `steps` (kind=dbAccess) | ORM ごとに下の「dbAccess の対応表」(Prisma が既定。`techStack.backend.orm` が `typeorm` のときだけ TypeORM) |
| `steps` (kind=transactionScope) | ORM ごとに `steps[]` 内の全 step を 1 TX で wrap (Prisma: `prisma.$transaction(async (tx) => { ... })` / TypeORM: `dataSource.transaction(async (manager) => { ... })`)。詳細は本ファイル末尾の「transactionScope mapping」セクション (#875 / #1221 で旧 txBoundary 廃止し transactionScope に一本化) |
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

## ORM の選び方 (`techStack.backend.orm`)

| `techStack.backend.orm` | 使う ORM | DB 層の雛形 | Service が受け取るもの |
|---|---|---|---|
| `prisma` / **省略 (既定)** | Prisma | [`PRISMA_SCHEMA.md`](./PRISMA_SCHEMA.md) | `PrismaService` |
| `typeorm` | TypeORM | [`ENTITY.md`](./ENTITY.md) | `DataSource` と `Repository<Entity>` |

**1 つの生成物の中で 2 つの ORM を混ぜない。** 本ファイルは、下の「テンプレート本体」「dbAccess の対応表」「transactionScope mapping」を **ORM ごとの節** に分けて書いてある。生成するときは、選んだ ORM の節だけを読み、もう片方の節の import・constructor・API を持ち込まない (`orm: prisma` の出力に `typeorm` / `@nestjs/typeorm` / `DataSource` / `Repository` を出さない。`orm: typeorm` の出力に `@prisma/client` / `PrismaService` を出さない)。DB の種類は `techStack.database.type` から取る (ORM の節の中身は DB の種類で変わらない。`isolationLevel` だけ DB で制約が違う)。

## dbAccess の対応表

### Prisma (既定)

| `operation` | 生成するコード |
|---|---|
| `SELECT` (主キー / 一意キー) | `await this.prisma.<model>.findUnique({ where: { id } })` |
| `SELECT` (条件) | `await this.prisma.<model>.findMany({ where: { ... }, orderBy: { ... } })` / `findFirst` |
| `SELECT` (件数) | `await this.prisma.<model>.count({ where: { ... } })` |
| `INSERT` | `await this.prisma.<model>.create({ data: { ... } })` (複数行は `createMany`) |
| `UPDATE` | `await this.prisma.<model>.update({ where: { id }, data: { ... } })` (条件で複数行は `updateMany`) |
| `DELETE` | `await this.prisma.<model>.delete({ where: { id } })` (複数行は `deleteMany`) |
| 生 SQL が要るとき (`sql` が JOIN / 集計など) | `await this.prisma.$queryRaw\`SELECT ... WHERE id = ${id}\`` (バインドは `${}` で渡す。`$queryRawUnsafe` に文字列連結しない) |

`<model>` は Prisma client のプロパティ名 (`PRISMA_SCHEMA.md` の規則。`posts` → `post`)。transactionScope の中では `this.prisma` ではなく `tx` を使う。

### TypeORM (`orm: typeorm` のときだけ)

| `operation` | 生成するコード |
|---|---|
| `SELECT` (主キー / 一意キー) | `await this.<entity>Repository.findOneBy({ id })` |
| `SELECT` (条件) | `await this.<entity>Repository.find({ where: { ... }, order: { ... } })` / `findOne` |
| `SELECT` (件数) | `await this.<entity>Repository.count({ where: { ... } })` |
| `INSERT` | `await this.<entity>Repository.save(this.<entity>Repository.create({ ... }))` (複数行は `insert([...])`) |
| `UPDATE` | `await this.<entity>Repository.update({ id }, { ... })` |
| `DELETE` | `await this.<entity>Repository.delete({ id })` |
| 生 SQL が要るとき (`sql` が JOIN / 集計など) | `await this.dataSource.query('SELECT ... WHERE id = $1', [id])` (バインド変数は DB で書き方が違う: postgresql は `$1`、mysql / sqlite は `?`) |

`<entity>` は Entity クラス名の camelCase (`ENTITY.md` の規則。`posts` → `Post` → `postRepository`)。transactionScope の中では `this.<entity>Repository` ではなく `manager` (`manager.getRepository(Post)`) を使う。

## ORM に依存しない step の展開

dbAccess / transactionScope 以外の step は、ORM が何でも同じに展開する。下の 2 つのテンプレート本体 (Prisma / TypeORM) の `// [kind=...]` の行から、この表を参照する。

```typescript
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
```

## テンプレート本体 (Prisma、既定)

`techStack.backend.orm` が `prisma` または省略のとき。`PrismaService` は `PRISMA_SCHEMA.md` の `src/prisma/prisma.service.ts` (`@Global()` の `PrismaModule` 経由で注入される)。

```typescript
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';   // 出力先の位置に合わせて相対パスを調整
import { {{processFlow.meta.name | toPascalCase}}RequestDto } from './dto/{{processFlow.meta.name | toKebabCase}}-request.dto';
import { {{processFlow.meta.name | toPascalCase}}ResponseDto } from './dto/{{processFlow.meta.name | toKebabCase}}-response.dto';
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
    private readonly prisma: PrismaService,
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
    //   const rows = await this.prisma.order.findMany({ where: { customer_id: sessionCustomerId } });
    //   (生 SQL が要るとき) const rows = await this.prisma.$queryRaw`SELECT ... WHERE id = ${id}`;
    //
    // [kind=transactionScope]
    //   const result = await this.prisma.$transaction(async (tx) => {
    //     // TX 内 steps をここに展開 (this.prisma ではなく tx を使う)
    //     // ...
    //     return txResult;
    //   });
    //
    // dbAccess / transactionScope 以外の kind は、上の「ORM に依存しない step の展開」と同じ。

    throw new Error('実装してください');
  }
}
```

## テンプレート本体 (TypeORM、`orm: typeorm` のときだけ)

`techStack.backend.orm` が `typeorm` のときだけ。`orm` が省略 / `prisma` のときは、この節を使わない。Entity と接続の設定は `ENTITY.md`。`DataSource` は `TypeOrmModule.forRoot` が提供する。

```typescript
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { {{processFlow.meta.name | toPascalCase}}RequestDto } from './dto/{{processFlow.meta.name | toKebabCase}}-request.dto';
import { {{processFlow.meta.name | toPascalCase}}ResponseDto } from './dto/{{processFlow.meta.name | toKebabCase}}-response.dto';
// import { {{table.physicalName | toModelName}} } from './entity/{{table.physicalName | toKebabCase}}.entity';
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
    // @InjectRepository({{table.physicalName | toModelName}})
    // private readonly {{table.physicalName | toModelName | toCamelCase}}Repository: Repository<{{table.physicalName | toModelName}}>,
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
    //   const rows = await this.orderRepository.find({ where: { customerId: sessionCustomerId } });
    //   (生 SQL が要るとき) const rows = await this.dataSource.query('SELECT ...', [param]);
    //
    // [kind=transactionScope]
    //   const result = await this.dataSource.transaction(async (manager) => {
    //     // TX 内 steps をここに展開 (Repository ではなく manager を使う)
    //     // ...
    //     return txResult;
    //   });
    //
    // dbAccess / transactionScope 以外の kind は、上の「ORM に依存しない step の展開」と同じ。

    throw new Error('実装してください');
  }
}
```

## transactionScope mapping (#875 / #1221 — `step.kind = "transactionScope"`)

Harmony spec の TX 表現は `step.kind = "transactionScope"` に一本化されている (#1221 で旧 `txBoundary` の平坦モデルは廃止)。実装では **必ず ORM の TX API で wrap** すること (#875: 未対応で生成すると silent semantic bug になる)。Prisma は `$transaction()`、TypeORM は `dataSource.transaction()`。2 つの ORM の生成パターンは、下の ORM ごとの節に分けて書いてある。

### 識別ロジック (ORM 共通)

`step.kind === "transactionScope"` の step を見つけたら、その `steps[]` 配下にあるすべての step を 1 TX で wrap する。`rollbackOn` 指定があれば、対応する errorCode の throw のみ rollback を引き起こす (それ以外の例外は default 挙動)。

### Spec の例 (ORM 共通。diary 投稿作成 `post-create-flow` 実物)

```jsonc
"steps": [
  { "id": "step-01", "kind": "validation", ... },             // TX 外
  { "id": "step-02", "kind": "compute", ... },                // TX 外
  { "id": "step-tx", "kind": "transactionScope",
    "rollbackOn": ["UNIQUE_VIOLATION"],
    "steps": [
      { "id": "step-03", "kind": "dbAccess", "operation": "INSERT", ... },
      { "id": "step-04", "kind": "loop", ... },
      { "id": "step-05", "kind": "loop", ... },
      { "id": "step-06", "kind": "dbAccess", "operation": "UPDATE", ... }
    ]
  },
  { "id": "step-07", "kind": "return", ... }                  // TX 外
]
```

**transactionScope.steps[] 内の全 step を TX の中に展開すること**。1 つでも漏らすと TX 範囲が崩れる silent bug の元になる。

### Prisma (既定)

`techStack.backend.orm` が `prisma` または省略のとき。`techStack.database.type=sqlite|postgresql|mysql` のどれでも同じ。

#### 生成パターン

constructor で `PrismaService` を注入し、`Prisma.TransactionClient` 型を `@prisma/client` から import:

```typescript
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: number, dto: CreatePostDto) {
    // step-01 + step-02: TX 外で実行
    const publishedAt = dto.status === 'published' ? new Date() : null;

    // step-tx (kind=transactionScope) の steps[] 全部: 1 TX で wrap
    return await this.prisma.$transaction(async (tx) => {
      // step-03: dbAccess INSERT posts (tx 経由)
      const post = await tx.post.create({ data: { ... } });

      // step-04: loop INSERT photos (tx 経由)
      if (dto.photos) {
        for (const p of dto.photos) {
          await tx.photo.create({ data: { ... } });
        }
      }

      // step-05: loop INSERT post_tags + tag 解決 (tx 経由)
      if (dto.tags) {
        for (const tag of dto.tags) {
          const tagId = await this.resolveTagIdTx(tx, tag);
          await tx.postTag.create({ data: { ... } });
        }
      }

      // step-06: UPDATE tags.usage_count (tx 経由、TX commit と一体)
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

#### 重要なルール (Prisma)

1. **TX クライアント `tx` を中で使うこと**。`this.prisma.*` をうっかり使うと **TX 外の別接続** で実行され、rollback されない silent bug になる
2. **TX 内で呼ぶ private helper メソッドは `tx` (`Prisma.TransactionClient`) を引数で受ける** ように書き換える (例: `resolveTagIdTx(tx, ...)`)
3. **`@Transactional` メソッドの分離は不要** (NestJS は AOP proxy 不要、関数 closure で完結)
4. **rollbackOn 相当**: spec の `affectedRowsCheck.onViolation=throw` などで例外 throw すれば `$transaction()` が自動 rollback。Prisma は `Prisma.PrismaClientKnownRequestError` も rollback トリガー
5. **isolation level**: `this.prisma.$transaction(fn, { isolationLevel: 'ReadCommitted' })` で指定可 (PostgreSQL / MySQL / SQL Server のみ)。spec の `transactionScope.isolationLevel` が指定されている場合はそれを優先、未指定なら default。⚠️ **SQLite (`techStack.database.type=sqlite`) では `isolationLevel` オプション指定不可** — Prisma が `PrismaClientUnknownRequestError` を throw する。SQLite ターゲットでは `$transaction(fn)` をオプションなしで呼ぶこと。DB 別の default は engine 依存 (PostgreSQL: ReadCommitted、SQLite: serializable に近い WAL モード、MySQL InnoDB: RepeatableRead)

#### 検証 (#875 由来の Spike test pattern)

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

このテストが **fail する** = `/generate-code` が `transactionScope` を honor せず TX wrap を生成していない (#875 の症状、#1221 で旧 txBoundary 廃止)。skill 利用者は生成コードに対してこの種の test を最低 1 件は必ず実行することを推奨。

### TypeORM (`orm: typeorm` のときだけ)

`techStack.backend.orm` が `typeorm` のときだけ。constructor で `DataSource` (と、dbAccess 用の `Repository`) を注入する。

#### 生成パターン

```typescript
// ProcessFlow transactionScope:
//   isolationLevel: "READ_COMMITTED"
//   rollbackOn: ["UNIQUE_VIOLATION"]

@Injectable()
export class PostsService {
  constructor(private readonly dataSource: DataSource) {}

  async create(userId: number, dto: CreatePostDto) {
    // step-01 + step-02: TX 外で実行
    const publishedAt = dto.status === 'published' ? new Date() : null;

    // step-tx (kind=transactionScope) の steps[] 全部: 1 TX で wrap
    return await this.dataSource.transaction('READ COMMITTED', async (manager) => {
      // step-03: dbAccess INSERT posts (manager 経由)
      const post = await manager.save(manager.create(Post, { ... }));

      // step-04: loop INSERT photos (manager 経由)
      for (const p of dto.photos ?? []) {
        await manager.save(manager.create(Photo, { postId: post.id, ... }));
      }

      // step-06: UPDATE tags.usage_count (manager 経由、TX commit と一体)
      await manager.increment(Tag, { id: tagId }, 'usageCount', 1);

      return { postId: post.id };
    });
  }

  // TX 内で呼ぶ helper も manager (EntityManager) を引数で受ける
  private async resolveTagIdTx(manager: EntityManager, tag: { id?: number; name?: string }): Promise<number> {
    // manager.findOneBy(Tag, ...) / manager.save(...) を使う (this.dataSource は使わない)
    // ...
  }
}
```

TX の結果で分岐したいとき (`@var.action.txResult.committed` 相当) は、`rollbackOn` の errorCode を例外として throw させ、TX の外側で try/catch して `HttpException` に変換する:

```typescript
try {
  const txResult = await this.dataSource.transaction(async (manager) => { /* ... */ });
} catch (e) {
  if (e instanceof StockShortageError) {
    throw new HttpException({ code: 'STOCK_SHORTAGE', message: '在庫が不足しています。' }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  throw e;
}
```

#### 重要なルール (TypeORM)

1. **TX の `manager` を中で使うこと**。`this.dataSource.*` や、constructor で注入した `Repository` をうっかり使うと **TX 外の別接続** で実行され、rollback されない silent bug になる (TX 内では `manager.getRepository(Post)` か `manager.save(...)`)
2. **TX 内で呼ぶ private helper メソッドは `manager` を引数で受ける** ように書き換える
3. **`@Transactional` デコレータは使わない** (関数 closure で完結)
4. **rollbackOn 相当**: 例外を throw すれば `dataSource.transaction` が自動 rollback
5. **isolation level**: `dataSource.transaction('READ COMMITTED', fn)` の第 1 引数で指定 (`'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'`)。spec の `transactionScope.isolationLevel` が指定されていればそれを使う。⚠️ **SQLite (`techStack.database.type=sqlite`) は `'SERIALIZABLE'` と `'READ UNCOMMITTED'` 以外を受け付けない** ので、sqlite のときは第 1 引数を付けずに `dataSource.transaction(fn)` を呼ぶ

#### 検証 (故意失敗テスト)

```typescript
it('TX rollback: UNIQUE 違反で全 INSERT が rollback されること', async () => {
  await request(app.getHttpServer())
    .post('/api/posts')
    .send({ title: 'X', body: 'X', tags: [{id: 1}, {id: 1}] })
    .expect(500);
  // posts テーブルに行が残っていないことを確認
  expect(await dataSource.getRepository(Post).findOneBy({ title: 'X' })).toBeNull();
});
```

このテストが **fail する** = `transactionScope` を honor した TX wrap を生成していない。生成コードに対して最低 1 件は必ず実行すること。

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
