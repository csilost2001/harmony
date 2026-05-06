package com.example.retail.repository;

import com.example.retail.entity.OrderItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 注文明細 Repository。
 *
 * テーブル: order_items
 * ProcessFlow 参照: f81dd9e0-794c-4539-a2a5-9cbcc0a75899 (step-06-03: loop INSERT)
 *
 * <p>{@link #insertOrderItem} は unit_price_snapshot * quantity を DB 側で計算して line_amount に格納する
 * ネイティブ INSERT を実行する。JPA {@code save()} を使わずネイティブ INSERT にしているのは、
 * line_amount の計算を DB に委ねることでアプリ側の計算ロジックを排除するためである。</p>
 */
@Repository
public interface OrderItemRepository extends JpaRepository<OrderItem, Long> {

    /**
     * 注文明細を 1 件 INSERT する。
     *
     * <p>ProcessFlow step-06-03 (loop INSERT) に対応。
     * 各カート明細について本メソッドを 1 回ずつ呼び出す。</p>
     *
     * @param orderId           注文 ID (orders.id)
     * @param productId         商品 ID (products.id)
     * @param storeCodeSnapshot 店舗コードスナップショット (ADR-006 multi-store)
     * @param productCodeSnapshot 商品コードスナップショット
     * @param productNameSnapshot 商品名スナップショット
     * @param unitPriceSnapshot 単価スナップショット
     * @param quantity          数量
     */
    @Modifying
    @Query(
        value = """
            INSERT INTO order_items
                (order_id, product_id, store_code_snapshot, product_code_snapshot,
                 product_name_snapshot, unit_price_snapshot, quantity, line_amount)
            VALUES
                (:orderId, :productId, :storeCodeSnapshot, :productCodeSnapshot,
                 :productNameSnapshot, :unitPriceSnapshot, :quantity,
                 :unitPriceSnapshot * :quantity)
            """,
        nativeQuery = true
    )
    void insertOrderItem(
            @Param("orderId") Long orderId,
            @Param("productId") Long productId,
            @Param("storeCodeSnapshot") String storeCodeSnapshot,
            @Param("productCodeSnapshot") String productCodeSnapshot,
            @Param("productNameSnapshot") String productNameSnapshot,
            @Param("unitPriceSnapshot") Long unitPriceSnapshot,
            @Param("quantity") Integer quantity
    );

    /**
     * 注文 ID に紐づく全明細を取得する (注文履歴表示等で利用)。
     *
     * @param orderId 注文 ID
     * @return 注文明細リスト
     */
    List<OrderItem> findByOrderIdOrderById(Long orderId);
}
