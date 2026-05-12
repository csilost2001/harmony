-- Flyway migration: V1__create_orders.sql
-- ProcessFlow: f81dd9e0-794c-4539-a2a5-9cbcc0a75899 (注文確定)
-- techStack.database.type: postgresql (version: 17)
-- 生成: /generate-code スキルにより自動生成

-- ----------------------------------------------------------
-- シーケンス (harmony.json entities.sequences[].physicalName)
-- @conv.numbering.orderNumber 規約: ORD-YYYY-NNNNNN
-- ----------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_order_number
    START 1
    INCREMENT 1
    NO MAXVALUE
    NO CYCLE;

COMMENT ON SEQUENCE seq_order_number IS '注文番号採番シーケンス (@conv.numbering.orderNumber: ORD-YYYY-NNNNNN)';

-- ----------------------------------------------------------
-- orders テーブル (physicalName: orders)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id                  BIGSERIAL PRIMARY KEY,
    -- 注文番号 (@conv.numbering.orderNumber: ORD-YYYY-NNNNNN)
    -- UNIQUE 制約: ORDER_NUMBER_CONFLICT エラーの根拠 (ProcessFlow ADR-004)
    order_number        VARCHAR(20)     NOT NULL,
    -- 顧客 ID (customers.id への FK)
    customer_id         BIGINT          NOT NULL,
    -- 注文ステータス (pending → confirmed → shipped → delivered / cancelled)
    status              VARCHAR(20)     NOT NULL DEFAULT 'pending',
    -- 合計金額 (税抜): cart_items.unit_price_snapshot * quantity の合計
    total_amount        BIGINT          NOT NULL,
    -- 消費税額: FLOOR(total_amount * @conv.tax.standard.rate = 0.10)
    tax_amount          BIGINT          NOT NULL,
    -- 配送先郵便番号 (ハイフンなし 7 桁, @conv.regex.postalCode)
    shipping_postal_code VARCHAR(7)     NOT NULL,
    -- 配送先住所 (300 文字以内)
    shipping_address    VARCHAR(300)    NOT NULL,
    -- 備考 (任意)
    note                TEXT,
    -- 支払方法 (ADR-004: credit_card / bank_transfer / cod、NULL 許容は移行前注文との互換)
    payment_method      VARCHAR(30),
    -- 注文確定日時
    ordered_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 制約
    CONSTRAINT uq_orders_order_number      UNIQUE (order_number),
    CONSTRAINT fk_orders_customer          FOREIGN KEY (customer_id) REFERENCES customers(id),
    CONSTRAINT chk_orders_payment_method   CHECK (payment_method IN ('credit_card', 'bank_transfer', 'cod'))
);

-- インデックス (よく参照される検索条件)
CREATE INDEX idx_orders_customer_id  ON orders(customer_id);
CREATE INDEX idx_orders_status       ON orders(status);
CREATE INDEX idx_orders_ordered_at   ON orders(ordered_at DESC);

-- コメント
COMMENT ON TABLE  orders                      IS '注文テーブル — ProcessFlow f81dd9e0 (注文確定)';
COMMENT ON COLUMN orders.order_number         IS '注文番号 (@conv.numbering.orderNumber: ORD-YYYY-NNNNNN)';
COMMENT ON COLUMN orders.customer_id          IS '顧客 ID (customers.id FK)';
COMMENT ON COLUMN orders.status               IS '注文ステータス: pending/confirmed/shipped/delivered/cancelled';
COMMENT ON COLUMN orders.total_amount         IS '合計金額 (税抜、単位: 円)';
COMMENT ON COLUMN orders.tax_amount           IS '消費税額 (standard rate 10%)';
COMMENT ON COLUMN orders.shipping_postal_code IS '配送先郵便番号 (ハイフンなし 7 桁)';
COMMENT ON COLUMN orders.payment_method       IS '支払方法 (credit_card / bank_transfer / cod)';

-- ----------------------------------------------------------
-- order_items テーブル (physicalName: order_items)
-- ProcessFlow step-06-03: loop INSERT
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    id                      BIGSERIAL PRIMARY KEY,
    order_id                BIGINT          NOT NULL,
    product_id              BIGINT          NOT NULL,
    -- 店舗コードスナップショット (ADR-006 multi-store inventory 整合)
    store_code_snapshot     VARCHAR(20)     NOT NULL,
    -- 商品コード・商品名スナップショット (注文時点の値を保持)
    product_code_snapshot   VARCHAR(20)     NOT NULL,
    product_name_snapshot   VARCHAR(200)    NOT NULL,
    -- 単価スナップショット (注文確定時点の値)
    unit_price_snapshot     BIGINT          NOT NULL,
    quantity                INTEGER         NOT NULL CHECK (quantity > 0),
    line_amount             BIGINT          NOT NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_order_items_order   FOREIGN KEY (order_id)   REFERENCES orders(id),
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);

COMMENT ON TABLE  order_items                          IS '注文明細テーブル — ProcessFlow f81dd9e0 (注文確定) step-06-03';
COMMENT ON COLUMN order_items.store_code_snapshot      IS '在庫減算対象店舗コード (ADR-006 multi-store)';
COMMENT ON COLUMN order_items.product_code_snapshot    IS '注文時商品コード (スナップショット)';
COMMENT ON COLUMN order_items.product_name_snapshot    IS '注文時商品名 (スナップショット)';
COMMENT ON COLUMN order_items.unit_price_snapshot      IS '注文時単価 (スナップショット)';
