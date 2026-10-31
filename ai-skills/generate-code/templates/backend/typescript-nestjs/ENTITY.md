# TypeScript NestJS — Entity テンプレート (TypeORM、`orm: typeorm` のときだけ使う)

> **このファイルは `techStack.backend.orm: typeorm` のときだけ使う。** `orm` が省略されているとき (省略時は `prisma`) や `prisma` のときは、本ファイルではなく [`PRISMA_SCHEMA.md`](./PRISMA_SCHEMA.md) を使う。1 つの生成物の中で TypeORM と Prisma を混ぜない (`orm: typeorm` のときは `prisma/` `@prisma/client` `PrismaService` を一切出さない)。

テーブル定義 (`tables/<tableId>.json`) から TypeORM Entity を生成する。生成する表の範囲は、**生成対象の処理フローの `lineage.reads / lineage.writes` に出る表 + その表が外部キーで参照する表 (再帰的に) + generate-tests が seed / 検証 / truncate で触る表** (E2E の前提データや認証のユーザー表など。どの flow の lineage にも出なくても含める)。それ以外の表は作らない。bulk モード (複数の flow を生成するとき) は、全 flow の分の和集合。flow を後から足したら、表が増えるので既存のファイルに追記する。**Prisma の model と同じ範囲** (どの業務 Module の `forFeature` にも入らない Entity も、`synchronize` で表を作るには `entities` に入れる必要がある。下の「接続の設定」)。

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
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';   // 使わないものは import から外す (未使用 import は lint の警告になる)

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

## 主キーの書き方

| 表の主キー | 書き方 |
|---|---|
| 自動採番の 1 列 (`id`) | `@PrimaryGeneratedColumn('increment') id: number;` (上のテンプレート) |
| 自動採番でない 1 列 (自然キー) | `@PrimaryColumn({ name: '<physicalName>', type: '...' })` |
| 複数列 (中間テーブルなど) | 主キーの列ごとに `@PrimaryColumn({ name: '<physicalName>', type: '...' })` を付ける (`@PrimaryGeneratedColumn` の `id` は作らない) |

**主キーを自分で渡す表 (自然キー・複数列) への INSERT は `repository.save()` ではなく `insert()` を使う** ([`SERVICE.md`](./SERVICE.md) の TypeORM の節)。`save()` は同じ主キーの行があると UPDATE にしてしまい、重複で失敗しない (実機で確認)。

## 制約・既定値・リレーション (TypeORM)

PRISMA_SCHEMA.md の「制約・既定値・リレーション」と同じテーブル定義を、TypeORM ではデコレータで書く。**プロパティ名は camelCase、`@Column` の `name` で物理名にそろえる**。`@Unique` / `@Index` の列の指定は、DB のカラム名ではなく**プロパティ名** (`order_number` → `'orderNumber'`)。

| テーブル定義 | Entity |
|---|---|
| `notNull: false` | `@Column({ ..., nullable: true })`、型は `string \| null` |
| `primaryKey: true` (1 列、自動採番) / 自然キー / 主キーが複数列 | 上の「主キーの書き方」 |
| `unique: true` (1 列) | `@Column({ ..., unique: true })` |
| `constraints[].kind=unique` (複数列) | クラスに `@Unique('<constraint.physicalName>', ['colA', 'colB'])` |
| `indexes[]` | クラスに `@Index('<index.physicalName>', ['colA', 'colB'])` (`unique: true` は `{ unique: true }` を第 3 引数に) |
| `defaultValue` がリテラル | `@Column({ ..., default: 'x' })` / `default: 0` / `default: true` |
| `defaultValue` が `CURRENT_TIMESTAMP` / `now()` | `@Column({ ..., default: () => 'CURRENT_TIMESTAMP' })`。作成日時・更新日時の列 (`created_at` / `updated_at`) は `@CreateDateColumn` / `@UpdateDateColumn` |
| `kind=check` | クラスに `@Check('<constraint.physicalName>', '<式>')` (式は DB の SQL。sqlite / postgresql / mysql 8 で使える) |
| `constraints[].kind=foreignKey` | 外部キーの列を `@Column` で持ったうえで、`@ManyToOne(() => Parent, { onDelete: '...' })` + `@JoinColumn({ name: '<外部キーの列の physicalName>' })` の関連を足す (下) |
| 同じ列の一意が重複している (列の `unique: true`・`constraints[].kind=unique`・`unique: true` の `indexes[]` の 2 つ以上) | 1 つにまとめる (列の `unique: true` を残し、他は書かない) |

### リレーション

外部キー (`kind=foreignKey`) ごとに、**子の Entity** に次の 2 つを書く。親の Entity には `@OneToMany` を足さなくてよい (業務コードは Repository で子を引くので不要。足すと循環 import になりやすい)。

```typescript
// 子 (外部キーを持つ側)。列そのもの (値で読み書きする) と、関連 (JOIN 用) の両方を同じ列名で書く
@Column({ name: 'user_id', type: 'int', nullable: false })
userId: number;

@ManyToOne(() => User, { onDelete: 'CASCADE', onUpdate: 'NO ACTION' })
@JoinColumn({ name: 'user_id' })
user: User;
```

- `onDelete` / `onUpdate`: `cascade` → `'CASCADE'`、`setNull` → `'SET NULL'`、`setDefault` → `'SET DEFAULT'`、`restrict` → `'RESTRICT'`、`noAction` → `'NO ACTION'`。省略時は書かない
- 関連のプロパティ名: 親の Entity 名の camelCase (`User` → `user`)。同じ親への外部キーが 2 つ以上あるときは、外部キーの列名から付ける (`author_id` → `author`)
- `noConstraint: true` (DB の外部キー制約を張らない) は `@ManyToOne` / `@JoinColumn` を作らず、`@Column` だけ残す
- 親の Entity は `entities` に入っている必要がある (上の「生成する表の範囲」。FK の参照先は含める)

## データ型変換 (TypeORM)

| DB カラム型 | TypeORM `type` | TypeScript 型 |
|---|---|---|
| `VARCHAR(n)` | `'varchar'` (`length: n`) | `string` |
| `CHAR(n)` | `'char'` (`length: n`) | `string` |
| `TEXT` | `'text'` | `string` |
| `INTEGER` | `'int'` | `number` |
| `SMALLINT` | `'smallint'` | `number` |
| `BIGINT` | `'bigint'` | `number` と書く。ただし **postgresql (`pg`) は実行時に文字列で返す** (sqlite の `better-sqlite3` は数値)。比較や返却の前に `Number(row.userId)` を通す。自動採番の主キー (`@PrimaryGeneratedColumn`) は `int` の列になるので数値のまま |
| `BOOLEAN` | `'boolean'` | `boolean` |
| `TIMESTAMP` | `'timestamp'` | `Date` |
| `DATE` | `'date'` | `Date` |
| `DECIMAL(p,s)` | `'decimal'` | `string` (TypeORM は string で返す) |
| `FLOAT` | `'float'` | `number` |
| `TIME` | `'time'` | `string` (`'HH:MM:SS'`) |
| `BLOB` | `'blob'` (postgresql は `'bytea'`) | `Buffer` |
| `JSON` | `'json'` (sqlite は `'simple-json'`) | `unknown` / 型を決めた interface |
| 拡張 (`namespace:TYPE`) | 近い型 + 先頭に `// TODO:` コメント | 例: `postgres:JSONB` → `'jsonb'` (postgresql のとき) |

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

## 接続の設定 (`TypeOrmModule.forRootAsync`)

プロジェクトに 1 つ。`src/database/typeorm.config.ts` を作り、`AppModule` の `imports` に `TypeOrmModule.forRootAsync({ useFactory: typeOrmOptions })` を 1 回足す。**`forRoot(typeOrmOptions())` と書かない**: `@Module` のデコレータは `app.module.ts` を import した時点で評価されるので、`DATABASE_URL` を import のあとで入れるテスト (generate-tests の E2E) が効かなくなる。`forRootAsync` の factory は Nest が起動 (`compile()`) するときに呼ぶので、その前に設定した環境変数を読める。業務 Module は `forFeature` だけでよい。`DataSource` は `TypeOrmModule.forRoot` が全 Module に提供するので、Service は `private readonly dataSource: DataSource` をそのまま注入できる ([`SERVICE.md`](./SERVICE.md) の TypeORM の節)。

**`techStack.database.type` に合う 1 つの分岐だけを書く** (下の 4 つを全部並べない)。接続先は `DATABASE_URL` から取る (値は雛形の compose.yml / README が環境ごとに渡す)。

```typescript
// src/database/typeorm.config.ts
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Post } from '../../entity/posts.entity';   // 生成した Entity を全部 import する
// ...

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
    // 生成した Entity を全部列挙する。`autoLoadEntities` だけだと、業務 Module の forFeature に入れない Entity
    // (どの flow も触らない表、E2E が seed する表) は登録されず、synchronize でも表が作られない (実機で確認)
    entities: [Post /* , ... */],
    // 初回の表づくり。dev と、雛形の docker-compose.yml (DB_SYNCHRONIZE=true) だけ有効。運用が始まったらマイグレーションに切り替える
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
  };
}
```

`sqlserver` は `type: 'mssql'` (パッケージ: mssql)、`oracle` は `type: 'oracle'` (パッケージ: oracledb)。この 2 つは雛形の compose.yml に DB サービスが無いので、利用者に接続先を確認する (SKILL.md の「DB と ORM の読み方」)。

## 依存パッケージ

`package.json` の `dependencies` に `typeorm`、`@nestjs/typeorm`、上の DB ドライバ 1 つ (`pg` / `mysql2` / `better-sqlite3`)。`prisma` / `@prisma/client` は入れない。`better-sqlite3` はネイティブのビルドがあるので、npm 12 以降の既定 (install スクリプトが止まる) では動かない (`Could not locate the bindings file`)。`npm install-scripts approve better-sqlite3` で許し、すぐ動かすなら `npm rebuild better-sqlite3` する (SKILL.md の「npm 12 以降」参照。実機で確認)。`pg` / `mysql2` は純 JavaScript なので、この手順は要らない。

## DB の初期化 (dev)

コマンドは要らない。`DB_SYNCHRONIZE=true` のとき、アプリの起動時に `entities` の Entity から表を作る。接続先は `DATABASE_URL` (sqlite は `file:./data/dev.db`、postgresql / mysql は開発コンテナの環境変数に設定済み)。sqlite のファイルは、起動したフォルダ (cwd) からの相対パスで、`data/` のフォルダが無くても TypeORM が作る (Prisma の `file:` は `schema.prisma` のフォルダからの相対で、決まりが違う)。
