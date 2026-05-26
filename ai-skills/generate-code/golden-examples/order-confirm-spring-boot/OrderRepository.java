package com.example.retail.repository;

import com.example.retail.entity.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;

/**
 * 注文リポジトリ。
 *
 * テーブル: orders (physicalName: orders)
 * ProcessFlow 参照: order-confirm (注文確定)
 *   - step-05: 注文番号採番 (seq_order_number NEXTVAL)
 *   - step-06-02: orders INSERT
 *   - step-08: TX 後の orders 再取得
 */
@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    /**
     * 注文番号を DB シーケンスから採番する。
     *
     * <p>ProcessFlow step-05 に対応。</p>
     * <p>@conv.numbering.orderNumber 規約: ORD-YYYY-NNNNNN 形式。
     * TX 外採番のため void (スキップ番号) は許容 (ADR-001)。</p>
     *
     * SQL (ProcessFlow step-05.sql):
     * SELECT 'ORD-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' ||
     *        LPAD(nextval('seq_order_number')::text, 6, '0') AS order_number
     */
    @Query(value = "SELECT 'ORD-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || " +
                   "LPAD(nextval('seq_order_number')::text, 6, '0') AS order_number",
           nativeQuery = true)
    String nextOrderNumber();

    /**
     * 注文番号で注文を取得する。
     *
     * <p>ProcessFlow step-08 に対応。TX 後の orders 再取得 (ADR-002)。
     * TX 内の insertedOrder 変数をそのまま参照するとネスト変数問題が起きるため、
     * TX 後に SELECT で再取得する。</p>
     *
     * SQL (ProcessFlow step-08.sql):
     * SELECT id, order_number AS "orderNumber", customer_id AS "customerId",
     *        status, total_amount AS "totalAmount", ordered_at AS "orderedAt"
     * FROM orders WHERE order_number = @newOrderNumber
     */
    @Query("SELECT o FROM Order o WHERE o.orderNumber = :orderNumber")
    Optional<Order> findByOrderNumber(@Param("orderNumber") String orderNumber);
}
