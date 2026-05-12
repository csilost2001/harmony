# Java Spring Boot — Flyway Migration SQL テンプレート

ProcessFlow の `lineage.writes` で参照されるテーブルについて、Flyway 形式の DDL を生成する。
テーブル定義 JSON から列定義を読んで CREATE TABLE 文を構築する。

## フィールドマッピング

| ProcessFlow / テーブル定義 | Flyway SQL |
|---|---|
| `tables[].physicalName` | `CREATE TABLE {{physicalName}} (...)` |
| `tables[].columns[].physicalName` | 列名 |
| `tables[].columns[].dataType` | DB 型 (`techStack.database.type` で分岐) |
| `tables[].columns[].notNull: true` | `NOT NULL` |
| `tables[].columns[].unique: true` | `UNIQUE` / `CONSTRAINT uq_... UNIQUE (...)` |
| `tables[].columns[].primaryKey: true` | `PRIMARY KEY` |
| `tables[].columns[].foreignKey` | `REFERENCES other_table(id)` |
| `tables[].constraints[]` | `CHECK`, `UNIQUE` 制約 |

## テンプレート本体 (PostgreSQL)

```sql
-- Flyway migration: V1__create_{{table.physicalName}}.sql
-- ProcessFlow: {{processFlow.meta.id}} ({{processFlow.meta.name}})
-- 生成: /generate-code スキルにより自動生成

CREATE TABLE {{table.physicalName}} (
    id          BIGSERIAL PRIMARY KEY,
    -- カラム (テーブル定義の columns[] から展開):
    -- 例: order_number  VARCHAR(20)     NOT NULL UNIQUE,
    -- 例: customer_id   BIGINT          NOT NULL REFERENCES customers(id),
    -- 例: status        VARCHAR(20)     NOT NULL DEFAULT 'pending',
    -- 例: total_amount  BIGINT          NOT NULL,
    -- 例: payment_method VARCHAR(30),
    -- 例: note          TEXT,
    -- 例: ordered_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- インデックス (よく参照される FK カラム)
CREATE INDEX idx_{{table.physicalName}}_customer_id ON {{table.physicalName}}(customer_id);

-- CHECK 制約 (tables[].constraints[] から展開)
-- 例: ALTER TABLE {{table.physicalName}}
--     ADD CONSTRAINT chk_{{table.physicalName}}_payment_method
--     CHECK (payment_method IN ('credit_card', 'bank_transfer', 'cod'));

COMMENT ON TABLE {{table.physicalName}} IS '{{table.name}} — ProcessFlow {{processFlow.meta.name}}';
```

## テンプレート本体 (MySQL — database.type=mysql)

```sql
-- Flyway migration: V1__create_{{table.physicalName}}.sql

CREATE TABLE {{table.physicalName}} (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    -- カラム:
    -- 例: order_number  VARCHAR(20)     NOT NULL,
    -- 例: customer_id   BIGINT UNSIGNED NOT NULL,
    -- 例: status        VARCHAR(20)     NOT NULL DEFAULT 'pending',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- CONSTRAINT ck_...
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## techStack.database.type 別の型変換

| 論理型 | PostgreSQL | MySQL |
|---|---|---|
| 自動連番主キー | `BIGSERIAL PRIMARY KEY` | `BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY` |
| 文字列 | `VARCHAR(n)` / `TEXT` | `VARCHAR(n)` / `LONGTEXT` |
| 整数 | `INTEGER` / `BIGINT` | `INT` / `BIGINT UNSIGNED` |
| 真偽値 | `BOOLEAN` | `TINYINT(1)` |
| 日時 | `TIMESTAMP` | `DATETIME` |
| 金額 | `BIGINT` (税込円、小数なし) / `NUMERIC(15,2)` | 同左 |

## シーケンス (sequences[] がある場合)

```sql
-- PostgreSQL シーケンス (harmony.json entities.sequences[] から展開)
CREATE SEQUENCE seq_order_number START 1 INCREMENT 1;
```

## Flyway バージョン番号規約

- `V1__create_<table>.sql` — テーブル作成 (初回)
- `V2__add_<column>_to_<table>.sql` — カラム追加
- `V3__create_index_<table>_<column>.sql` — インデックス追加
