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
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 注文エンティティ。
 *
 * テーブル: orders (physicalName: orders)
 * ProcessFlow 参照: order-confirm
 *
 * <p>テーブル列:
 * <ul>
 *   <li>id: BIGSERIAL PRIMARY KEY</li>
 *   <li>order_number: VARCHAR(20) NOT NULL UNIQUE (@conv.numbering.orderNumber: ORD-YYYY-NNNNNN)</li>
 *   <li>customer_id: BIGINT NOT NULL REFERENCES customers(id)</li>
 *   <li>status: VARCHAR(20) NOT NULL DEFAULT 'pending' (pending/confirmed/shipped/delivered/cancelled)</li>
 *   <li>total_amount: BIGINT NOT NULL (税抜合計)</li>
 *   <li>tax_amount: BIGINT NOT NULL (消費税額)</li>
 *   <li>shipping_postal_code: VARCHAR(7) NOT NULL</li>
 *   <li>shipping_address: VARCHAR(300) NOT NULL</li>
 *   <li>note: TEXT</li>
 *   <li>payment_method: VARCHAR(30) — credit_card / bank_transfer / cod</li>
 *   <li>ordered_at: TIMESTAMP NOT NULL</li>
 *   <li>created_at: TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP</li>
 *   <li>updated_at: TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP</li>
 * </ul>
 * </p>
 */
@Entity
@Table(name = "orders")
@Getter
@Setter
@NoArgsConstructor
public class Order {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 注文番号。@conv.numbering.orderNumber 規約 (ORD-YYYY-NNNNNN)。UNIQUE 制約あり。 */
    @Column(name = "order_number", nullable = false, unique = true, length = 20)
    private String orderNumber;

    /** 顧客 ID (customers.id への FK)。 */
    @Column(name = "customer_id", nullable = false)
    private Long customerId;

    /**
     * 注文ステータス。
     * 初期値: 'pending'。その後 confirmed / shipped / delivered / cancelled に遷移。
     */
    @Column(name = "status", nullable = false, length = 20)
    private String status;

    /** 合計金額 (税抜)。cart_items.unit_price_snapshot * quantity の合計。 */
    @Column(name = "total_amount", nullable = false)
    private Long totalAmount;

    /** 消費税額。FLOOR(total_amount * @conv.tax.standard.rate)。 */
    @Column(name = "tax_amount", nullable = false)
    private Long taxAmount;

    /** 配送先郵便番号 (ハイフンなし 7 桁)。 */
    @Column(name = "shipping_postal_code", nullable = false, length = 7)
    private String shippingPostalCode;

    /** 配送先住所 (300 文字以内)。 */
    @Column(name = "shipping_address", nullable = false, length = 300)
    private String shippingAddress;

    /** 備考 (任意)。 */
    @Column(name = "note", columnDefinition = "TEXT")
    private String note;

    /**
     * 支払方法。ADR-004 準拠。
     * 許容値: credit_card / bank_transfer / cod。
     * NULL 許容: 移行前注文 (paymentMethod 未指定) との互換のため。
     */
    @Column(name = "payment_method", length = 30)
    private String paymentMethod;

    /** 注文確定日時。 */
    @Column(name = "ordered_at", nullable = false)
    private LocalDateTime orderedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
