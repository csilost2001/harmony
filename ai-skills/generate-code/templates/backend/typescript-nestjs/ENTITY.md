# TypeScript NestJS — Entity テンプレート (TypeORM、`orm: typeorm` のときだけ使う)

> **このファイルは `techStack.backend.orm: typeorm` のときだけ使う。** `orm` が省略されているとき (省略時は `prisma`) や `prisma` のときは、本ファイルではなく [`PRISMA_SCHEMA.md`](./PRISMA_SCHEMA.md) を使う。1 つの生成物の中で TypeORM と Prisma を混ぜない (`orm: typeorm` のときは `prisma/` `@prisma/client` `PrismaService` を一切出さない)。

ProcessFlow の `lineage.reads / lineage.writes` で参照されるテーブルから TypeORM Entity を生成する。

## techStack からの読み方

| 欲しい値 | 読む場所 |
|---|---|
| DB の種類 (`TypeOrmModule` の `type`) | `techStack.database.type`。省略時は schema の既定値の `postgresql` |
| Entity クラス名 | `tables[].physicalName`。generate-tests と PRISMA_SCHEMA.md の model 名と**同じ規則**: snake_case の語を PascalCase にして連結し、最後の語を単数形にする (`posts` → `Post` / `post_tags` → `PostTag` / `categories` → `Category`。単数形の規則は [`PRISMA_SCHEMA.md`](./PRISMA_SCHEMA.md) の「model 名・カラム名の規則」と同じ)。以降、`{{table.physicalName | toModelName}}` と書く |
| プロパティ名 | `columns[].physicalName` の camelCase (`order_number` → `orderNumber`)。DB のカラム名は `@Column({ name: '<physicalName>' })` で物理名にそろえる |
| ファイル名 | `entity/<physicalName の kebab-case>.entity.ts` (例: `entity/post-tags.entity.ts`) |

## テンプレート本体

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';

/**
 * {{table.name}} エンティティ。
 *
 * テーブル: {{table.physicalName}}
 * ProcessFlow 参照: {{processFlow.meta.id}}
 */
@Entity('{{table.physicalName}}')
// @Unique(['orderNumber'])  // unique 制約がある場合
export class {{table.physicalName | toModelName}} {
  @PrimaryGeneratedColumn('increment')
  id: number;

  // --- カラム (テーブル定義の columns[] から展開) ---
  // 例:
  // @Column({ name: 'order_number', type: 'varchar', length: 20, nullable: false, unique: true })
  // orderNumber: string;
  //
  // @Column({ name: 'customer_id', type: 'bigint', nullable: false })
  // customerId: number;
  //
  // @Column({ name: 'status', type: 'varchar', length: 20, nullable: false, default: 'pending' })
  // status: string;
  //
  // @Column({ name: 'total_amount', type: 'bigint', nullable: false })
  // totalAmount: number;
  //
  // @Column({ name: 'payment_method', type: 'varchar', length: 30, nullable: true })
  // paymentMethod: string | null;
  //
  // @Column({ name: 'note', type: 'text', nullable: true })
  // note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

## データ型変換 (TypeORM)

| DB カラム型 | TypeORM `type` | TypeScript 型 |
|---|---|---|
| `VARCHAR(n)` | `'varchar'` | `string` |
| `TEXT` | `'text'` | `string` |
| `INTEGER` | `'int'` | `number` |
| `BIGINT` | `'bigint'` | `number` / `string` (big int 注意) |
| `BOOLEAN` | `'boolean'` | `boolean` |
| `TIMESTAMP` | `'timestamp'` | `Date` |
| `DATE` | `'date'` | `Date` |
| `DECIMAL(p,s)` | `'decimal'` | `string` (TypeORM は string で返す) |
| `JSON` | `'json'` (sqlite は `'simple-json'`) | `unknown` / 型を決めた interface |

DB が `sqlite` のときの差: `TIMESTAMP` は `'datetime'` にする (`'timestamp'` は sqlite の型に無い)。`DATE` / `TIME` は `'date'` / `'time'` のまま。

## 業務 Module テンプレート (TypeORM)

```typescript
// {{processFlow.meta.name | toKebabCase}}.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { {{processFlow.meta.name | toPascalCase}}Controller } from './{{processFlow.meta.name | toKebabCase}}.controller';
import { {{processFlow.meta.name | toPascalCase}}Service } from './{{processFlow.meta.name | toKebabCase}}.service';
// import { {{table.physicalName | toModelName}} } from './entity/{{table.physicalName | toKebabCase}}.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      // ProcessFlow lineage.writes のテーブルエンティティを列挙
      // {{table.physicalName | toModelName}},
    ]),
  ],
  controllers: [{{processFlow.meta.name | toPascalCase}}Controller],
  providers: [{{processFlow.meta.name | toPascalCase}}Service],
  exports: [{{processFlow.meta.name | toPascalCase}}Service],
})
export class {{processFlow.meta.name | toPascalCase}}Module {}
```

## 接続の設定 (`TypeOrmModule.forRoot`)

プロジェクトに 1 つ。`src/database/typeorm.config.ts` を作り、`AppModule` の `imports` に `TypeOrmModule.forRoot(typeOrmOptions())` を 1 回足す。業務 Module は `forFeature` だけでよい。`DataSource` は `TypeOrmModule.forRoot` が全 Module に提供するので、Service は `private readonly dataSource: DataSource` をそのまま注入できる ([`SERVICE.md`](./SERVICE.md) の TypeORM の節)。

**`techStack.database.type` に合う 1 つの分岐だけを書く** (下の 4 つを全部並べない)。接続先は `DATABASE_URL` から取る (値は雛形の compose.yml / README が環境ごとに渡す)。

```typescript
// src/database/typeorm.config.ts
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function typeOrmOptions(): TypeOrmModuleOptions {
  return {
    // --- database.type=postgresql のとき (パッケージ: pg) ---
    type: 'postgres',
    url: process.env.DATABASE_URL,
    // --- database.type=mysql のとき (パッケージ: mysql2) ---
    // type: 'mysql',
    // url: process.env.DATABASE_URL,
    // --- database.type=sqlite のとき (パッケージ: better-sqlite3) ---
    // type: 'better-sqlite3',
    // database: (process.env.DATABASE_URL ?? 'file:./data/dev.db').replace(/^file:/, ''),
    autoLoadEntities: true,   // forFeature に登録した Entity を自動で読む
    // 初回の表づくり。dev と、雛形の docker-compose.yml (DB_SYNCHRONIZE=true) だけ有効。運用が始まったらマイグレーションに切り替える
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
  };
}
```

`sqlserver` は `type: 'mssql'` (パッケージ: mssql)、`oracle` は `type: 'oracle'` (パッケージ: oracledb)。この 2 つは雛形の compose.yml に DB サービスが無いので、利用者に接続先を確認する (SKILL.md の「DB と ORM の読み方」)。

## 依存パッケージ

`package.json` の `dependencies` に `typeorm`、`@nestjs/typeorm`、上の DB ドライバ 1 つ (`pg` / `mysql2` / `better-sqlite3`)。`prisma` / `@prisma/client` は入れない。`better-sqlite3` はネイティブのビルドがあるので、npm 12 以降の既定 (install スクリプトが止まる) では動かない。`npm install-scripts approve better-sqlite3` で許す (SKILL.md の「npm 12 以降」参照)。

## DB の初期化 (dev)

コマンドは要らない。`DB_SYNCHRONIZE=true` のとき、アプリの起動時に Entity から表を作る。接続先は `DATABASE_URL` (sqlite は `file:./data/dev.db`、postgresql / mysql は開発コンテナの環境変数に設定済み)。
