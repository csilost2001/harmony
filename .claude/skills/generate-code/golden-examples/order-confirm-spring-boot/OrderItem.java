package com.example.retail.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 注文明細エンティティ。
 *
 * テーブル: order_items (physicalName: order_items)
 * ProcessFlow 参照: f81dd9e0-794c-4539-a2a5-9cbcc0a75899 (step-06-03: loop INSERT)
 *
 * <p>テーブル列:
 * <ul>
 *   <li>id: BIGSERIAL PRIMARY KEY</li>
 *   <li>order_id: BIGINT NOT NULL REFERENCES orders(id)</li>
 *   <li>product_id: BIGINT NOT NULL REFERENCES products(id)</li>
 *   <li>store_code_snapshot: VARCHAR(20) NOT NULL — 在庫減算対象店舗コード (ADR-006 multi-store)</li>
 *   <li>product_code_snapshot: VARCHAR(20) NOT NULL — 注文時商品コード (スナップショット)</li>
 *   <li>product_name_snapshot: VARCHAR(200) NOT NULL — 注文時商品名 (スナップショット)</li>
 *   <li>unit_price_snapshot: BIGINT NOT NULL — 注文時単価 (スナップショット)</li>
 *   <li>quantity: INTEGER NOT NULL CHECK (quantity > 0)</li>
 *   <li>line_amount: BIGINT NOT NULL — unit_price_snapshot * quantity</li>
 *   <li>created_at: TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP</li>
 * </ul>
 * </p>
 */
@Entity
@Table(name = "order_items")
@Getter
@Setter
@NoArgsConstructor
public class OrderItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 注文 ID (orders.id への FK)。 */
    @Column(name = "order_id", nullable = false)
    private Long orderId;

    /** 商品 ID (products.id への FK)。 */
    @Column(name = "product_id", nullable = false)
    private Long productId;

    /**
     * 店舗コードスナップショット。
     * 注文確定時点で在庫を減算した店舗コード (ADR-006 multi-store inventory 整合)。
     */
    @Column(name = "store_code_snapshot", nullable = false, length = 20)
    private String storeCodeSnapshot;

    /** 商品コードスナップショット (注文時点の値を保持)。 */
    @Column(name = "product_code_snapshot", nullable = false, length = 20)
    private String productCodeSnapshot;

    /** 商品名スナップショット (注文時点の値を保持)。 */
    @Column(name = "product_name_snapshot", nullable = false, length = 200)
    private String productNameSnapshot;

    /** 単価スナップショット (注文確定時点の値)。 */
    @Column(name = "unit_price_snapshot", nullable = false)
    private Long unitPriceSnapshot;

    /** 数量 (1 以上)。 */
    @Column(name = "quantity", nullable = false)
    private Integer quantity;

    /** 行合計 (unit_price_snapshot * quantity)。 */
    @Column(name = "line_amount", nullable = false)
    private Long lineAmount;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
}
