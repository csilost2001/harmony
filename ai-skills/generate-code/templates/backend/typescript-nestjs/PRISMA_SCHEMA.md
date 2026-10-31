# TypeScript NestJS — Prisma schema テンプレート (既定の ORM)

`techStack.backend.orm` が `prisma` のとき、または**省略されているとき** (省略時は `prisma`) に使う。`techStack.backend.orm: typeorm` のときは本ファイルを使わず [`ENTITY.md`](./ENTITY.md) を使う。**1 つの生成物の中で Prisma と TypeORM を混ぜない** (`orm: prisma` のときは `typeorm` / `@nestjs/typeorm` / `*.entity.ts` を一切出さない)。

テーブル定義 (`tables/<tableId>.json`) から、プロジェクトに 1 つの `prisma/schema.prisma` と、`src/prisma/` の `PrismaService` / `PrismaModule` を生成する。生成する表の範囲は、**生成対象の処理フローの `lineage.reads / lineage.writes` に出る表 + その表が外部キーで参照する表 (再帰的に) + generate-tests が seed / 検証 / truncate で触る表** (E2E の前提データや認証のユーザー表など。どの flow の lineage にも出なくても含める)。それ以外の表は作らない。bulk モード (複数の flow を生成するとき) は、全 flow の分の和集合。flow を後から足したら、表が増えるので既存のファイルに追記する。Entity (`ENTITY.md`) も同じ範囲。

## 生成物

| ファイル | 内容 |
|---|---|
| `prisma/schema.prisma` | `generator` / `datasource` と、テーブルごとの `model`。プロジェクトに 1 つ (flow ごとには作らない。テーブルが増えたら追記する) |
| `src/prisma/prisma.service.ts` | `PrismaClient` を継承した `@Injectable` (下の「PrismaService / PrismaModule」) |
| `src/prisma/prisma.module.ts` | `@Global()` Module。AppModule で 1 回 import すれば、業務 Module は import せずに `PrismaService` を注入できる |

業務 Service は `constructor(private readonly prisma: PrismaService)` で受ける。TypeORM の `DataSource` / `@InjectRepository` は使わない。

## techStack からの読み方

| 欲しい値 | 読む場所 |
|---|---|
| `datasource.provider` | `techStack.database.type` (`postgresql` / `mysql` / `sqlite`)。省略時は schema の既定値の `postgresql`。`sqlserver` も Prisma が対応しているので `sqlserver`。`oracle` は Prisma が対応していないので、生成を止めて利用者に知らせる (`orm: typeorm` に変えれば作れる) |
| `datasource.url` | `env("DATABASE_URL")` 固定 (値は書かない。雛形の compose.yml / README が環境ごとに渡す) |
| model 名 | `tables[].physicalName` (下の規則) |
| カラム | `tables[].columns[]` |

## model 名・カラム名の規則

generate-tests (`ai-skills/generate-tests/SKILL.md` Step 6) が同じ規則で `prisma.<model>` を引くので、**必ず一致させる**。

- **model 名**: `physicalName` を snake_case で語に分け、各語を PascalCase にして連結し、**最後の語を単数形にする**。`posts` → `Post` / `post_tags` → `PostTag` / `categories` → `Category` / `users` → `User` / `photos` → `Photo`。 単数形の規則は下の表。
- **テーブル名**: `@@map("<physicalName>")` で物理テーブル名にそろえる (dbAccess の `sql` が書く表名と一致させるため)
- **フィールド名**: `columns[].physicalName` をそのまま (snake_case のまま) 使う。`@map` は付けない (フィールド名とカラム名が同じだから)。`prisma.post.create({ data: { user_id: 1 } })` のように、業務コードも tests も physicalName で書く。フィールド名を camelCase にしたいときは、すべてのフィールドに `@map("<physicalName>")` を付け、業務コードと tests も camelCase でそろえる (混ぜない)
- **Prisma client のプロパティ名**: model 名の先頭を小文字にしたもの (`Post` → `prisma.post`、`PostTag` → `prisma.postTag`)

**単数形の規則** (対象は最後の語だけ = snake_case の最後の `_` より後ろ。上から順に当て、最初に当たったものを使う。generate-code の `PRISMA_SCHEMA.md` と generate-tests の Step 6 で同じ文面):

| 順 | 当てはまる語 | 変え方 | 例 |
|---|---|---|---|
| 1 | 例外の語 (下) | 表のとおり | `statuses` → `Status` |
| 2 | 語尾 `ies` | `ies` → `y` | `categories` → `Category` / `stories` → `Story` / `properties` → `Property` |
| 3 | 語尾 `sses` `xes` `ches` `shes` | 末尾の `es` を落とす | `addresses` → `Address` / `boxes` → `Box` / `batches` → `Batch` |
| 4 | 語尾 `ss` `us` `is` | 変えない (すでに単数形) | `status` → `Status` / `progress` → `Progress` / `analysis` → `Analysis` |
| 5 | 語尾 `s` (上のどれにも当たらない) | 末尾の `s` を 1 つ落とす | `posts` → `Post` / `users` → `User` / `responses` → `Response` / `purchases` → `Purchase` / `databases` → `Database` / `licenses` → `License` |
| 6 | `s` で終わらない | 変えない | `inventory` → `Inventory` |

例外の語 (`s` を 1 つ落とすと壊れるもの): `statuses` → `Status` / `buses` → `Bus` / `aliases` → `Alias` / `analyses` → `Analysis` / `viruses` → `Virus` / `bonuses` → `Bonus` / `campuses` → `Campus` / `caches` → `Cache` / `menus` → `Menu` / `news` → `News` / `series` → `Series` / `species` → `Species`。表に無い語で壊れるものが出たら、generate-code と generate-tests の両方の表に足して一致させる。全体の例: `order_status` → `OrderStatus` / `user_word_progress` → `UserWordProgress` / `order_responses` → `OrderResponse`。単数化して他の model と同じ名前になるとき、または単数化できないときは、単数化せず PascalCase のまま。

## データ型の対応

`columns[].dataType` (UPPER) を Prisma の型にする。`@db.*` は `provider` が `postgresql` / `mysql` のときだけ付ける (`sqlite` には付けない。付けるとエラーになる)。

| `dataType` | Prisma の型 | `@db.*` (postgresql / mysql のみ) | 備考 |
|---|---|---|---|
| `VARCHAR(n)` | `String` | `@db.VarChar(n)` | |
| `CHAR(n)` | `String` | `@db.Char(n)` | |
| `TEXT` | `String` | `@db.Text` | mysql は `@db.Text` を付けないと VARCHAR(191) になる |
| `INTEGER` | `Int` | | |
| `SMALLINT` | `Int` | `@db.SmallInt` | |
| `BIGINT` | `BigInt` (`sqlite` は **`Int`**) | | `provider` ごとに Service の型が変わる。**`postgresql` / `mysql` は `BigInt` で、Prisma は JS の `bigint` で返す** (`number` ではない)。Service・テストでの扱い (変数・戻り値は `bigint`、返す直前に `Number()`、入力は `BigInt()`) は `SERVICE.md` の「BigInt の列の扱い (postgresql / mysql)」。**sqlite は `BigInt` の主キー (`autoincrement`) だと自動採番されず `Null constraint violation on the fields: (id)` で INSERT が失敗する** (実機で確認)。SQLite の INTEGER は 64 bit なので、sqlite のときは `BIGINT` 列 (主キー・外部キー) をすべて `Int` にし、Service も `bigint` ではなく `number` で書く |
| `DECIMAL(p,s)` | `Decimal` | `@db.Decimal(p, s)` | `Prisma.Decimal` で返る (**`number` ではない**。どの `provider` でも同じ。`SERVICE.md` の「BigInt の列の扱い」の末尾の表) |
| `FLOAT` | `Float` | | |
| `BOOLEAN` | `Boolean` | | |
| `DATE` | `DateTime` | `@db.Date` | |
| `TIME` | `DateTime` | `@db.Time` | |
| `TIMESTAMP` | `DateTime` | | |
| `BLOB` | `Bytes` | | |
| `JSON` | `Json` | | sqlite で `Json` が使えない版 (Prisma 6.2 より前) は `String` にして JSON 文字列で持つ |
| 拡張 (`namespace:TYPE`) | 近い型 + 先頭に `// TODO:` コメント | | 例: `postgres:JSONB` → `Json` |

## 制約・既定値・リレーション

| テーブル定義 | schema.prisma |
|---|---|
| `notNull: false` | 型の後ろに `?` (例: `String?`) |
| `primaryKey: true` (1 列) | `@id` |
| 主キーが複数列 (`constraints[].kind=primaryKey`) | `@@id([a, b])` |
| `autoIncrement: true` | `@default(autoincrement())` |
| `unique: true` | `@unique` |
| `constraints[].kind=unique` (複数列) | `@@unique([a, b])` |
| `indexes[]` | `@@index([a, b], map: "<index.physicalName>")` (`unique: true` は `@@unique`)。降順の列は `a(sort: Desc)` |
| `defaultValue` がリテラル | `@default("x")` / `@default(0)` / `@default(true)` |
| `defaultValue` が `CURRENT_TIMESTAMP` / `now()` | `@default(now())` |
| `updated_at` のような更新日時 (列名が `updated_at`) | `@updatedAt` |
| `constraints[].kind=foreignKey` | 子の model に `@relation` を持つフィールドを足す (下) |
| 同じ列の一意が重複している (列の `unique: true`・`constraints[].kind=unique`・`unique: true` の `indexes[]` の 2 つ以上) | 1 つにまとめる (列の `@unique` を残し、他は書かない)。重複して書くと、同じ一意の索引が 2 つ以上できる |
| `kind=check` | Prisma は CHECK を持てないので、フィールドに付けず `// CHECK: <式>` のコメントで残し、Service 側の検証で守る |

### リレーション

外部キー (`kind=foreignKey`) ごとに、子の model と親の model の両方にフィールドを足す。

```prisma
// 子 (外部キーを持つ側)
user  User  @relation(fields: [user_id], references: [id], onDelete: Cascade)
// 親 (参照される側)。子の physicalName をそのまま使った配列
transactions Transaction[]
```

- 子のフィールド名: 親 model 名の snake_case (`User` → `user`)。同じ親への外部キーが 2 つ以上あるときは `@relation("<constraint.physicalName>")` で名前を付け、親側も同じ名前にする
- `onDelete` / `onUpdate`: `cascade` → `Cascade`、`setNull` → `SetNull`、`setDefault` → `SetDefault`、`restrict` → `Restrict`、`noAction` → `NoAction`。省略時は書かない
- `noConstraint: true` (DB の外部キー制約を張らない) は `@relation` を作らず、列だけ残す

## テンプレート本体

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "{{techStack.database.type}}"   // postgresql | mysql | sqlite | sqlserver
  url      = env("DATABASE_URL")
}

/// {{table.name}}
model {{table.physicalName | toModelName}} {
  id         Int      @id @default(autoincrement())
  // --- カラム (テーブル定義の columns[] から展開) ---
  // login_id   String   @unique @db.VarChar(50)        // @db.* は postgresql / mysql のみ
  // user_id    Int
  // status     String   @default("pending")
  // total_amount Decimal @db.Decimal(12, 2)
  // note       String?  @db.Text
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  // --- リレーション (constraints[].kind=foreignKey から) ---
  // user         User          @relation(fields: [user_id], references: [id], onDelete: Cascade)
  // transactions Transaction[]

  // --- テーブル単位の指定 ---
  // @@unique([user_id, name])
  // @@index([status])
  @@map("{{table.physicalName}}")
}
```

`{{table.physicalName | toModelName}}` は上の「model 名の規則」(PascalCase + 最後の語を単数形)。

## PrismaService / PrismaModule

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

```typescript
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

`AppModule` の `imports` に `PrismaModule` を 1 回足す。業務 Module には `PrismaModule` を足さない (`@Global()` のため)。

## 業務 Module テンプレート (Prisma)

```typescript
// {{processFlow.meta.name | toKebabCase}}.module.ts
import { Module } from '@nestjs/common';
import { {{processFlow.meta.name | toPascalCase}}Controller } from './{{processFlow.meta.name | toKebabCase}}.controller';
import { {{processFlow.meta.name | toPascalCase}}Service } from './{{processFlow.meta.name | toKebabCase}}.service';

// imports は不要: PrismaService は @Global() の PrismaModule から注入される
@Module({
  controllers: [{{processFlow.meta.name | toPascalCase}}Controller],
  providers: [{{processFlow.meta.name | toPascalCase}}Service],
  exports: [{{processFlow.meta.name | toPascalCase}}Service],
})
export class {{processFlow.meta.name | toPascalCase}}Module {}
```

## 依存パッケージ

`package.json` の `dependencies` に `@prisma/client`、`prisma` を **`^6.19.0`** で入れる (本番の `npm ci --omit=dev` の後でも `prisma generate` / `prisma db push` を使うため devDependencies ではなく dependencies に入れる)。**6 系に固定する理由**: 上の schema の書き方 (`generator client { provider = "prisma-client-js" }`・`datasource` の `url = env("DATABASE_URL")`) は 6 系のもの。`latest` は 7 以降で、`datasource` の `url` の置き場などが変わっている (7 以降は未確認。対応するときは本ファイルから直す)。`typeorm` / `@nestjs/typeorm` は入れない。`prisma` と `@prisma/client` は npm 12 以降の既定 (依存の install スクリプトが止まる) のままでも `prisma generate` / `prisma db push` が動くので、`allowScripts` は `deny` でよい (SKILL.md の「npm 12 以降」参照)。`prisma generate` は `postCreateCommand` (開発コンテナ) と Dockerfile が呼ぶ。

## DB の初期化 (dev)

- `npx prisma db push` で `schema.prisma` から表を作る (マイグレーション履歴を持たない。設計途中向け)
- 接続先は `DATABASE_URL` (sqlite は `file:./dev.db`、postgresql / mysql は開発コンテナの環境変数に設定済み)。**sqlite の相対パスは、プロジェクトのルートではなく `schema.prisma` のあるフォルダ (`prisma/`) からの相対**。`file:./prisma/dev.db` と書くと `prisma/prisma/dev.db` に作られ、テスト (generate-tests) が補う絶対パス `prisma/dev.db` と別のファイルになる (実機で確認)。`prisma db push` も実行時の PrismaClient も同じ規則なので、環境変数を書き分けなければ食い違わない。
- 雛形: `templates/devcontainer/nestjs-*/` (SKILL.md の「DB と ORM の読み方」)
