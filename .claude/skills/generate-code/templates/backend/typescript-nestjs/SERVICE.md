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
| `steps` (kind=transactionScope) | `dataSource.transaction(async manager => { ... })` |
| `steps` (kind=branch) | if/else 文 |
| `steps` (kind=eventPublish) | `EventEmitter2.emit(topic, payload)` |
| `steps` (kind=compute) | ローカル変数計算ロジック |
| `steps` (kind=validation) | class-validator / 手動バリデーション |
| `steps` (kind=return) | `return { ... }` 文 |
| `steps` (kind=loop) | for...of / forEach 文 |
| `steps` (kind=log) | `this.logger.error(...)` / `this.logger.log(...)` |
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
