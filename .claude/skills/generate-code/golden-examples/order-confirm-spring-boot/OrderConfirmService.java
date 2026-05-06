package com.example.retail.service;

import com.example.retail.dto.OrderConfirmRequest;
import com.example.retail.dto.OrderConfirmResponse;
import com.example.retail.entity.Order;
import com.example.retail.event.OrderConfirmedEvent;
import com.example.retail.exception.CartEmptyException;
import com.example.retail.repository.CartItemRepository;
import com.example.retail.repository.OrderRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * 注文確定サービス。
 *
 * <p>
 * カート内容を 1 TX (@conv.tx.orderConfirm) で確定する。
 * 在庫減算 → 注文番号採番 → orders INSERT → order_items loop INSERT → カートクリアの順に原子的に実行する。
 * 在庫減算は cart_items.store_id 単位で各店舗の inventory に対して実行する (multi-store inventory 整合)。
 * TX 失敗時は 422 を返す。TX 後に persistedOrder を再取得してから注文確定イベントを発行する。
 * </p>
 *
 * <p>
 * <strong>設計上の注意 (Spring AOP self-invocation):</strong>
 * TX メソッドは同一クラスからの self-invocation では AOP proxy を経由しないため {@code @Transactional} が
 * 無効化される。そのため TX 処理は専用 bean {@link OrderConfirmTransactionService} に委譲し、
 * proxy 経由で呼び出すことで TX 境界を正しく有効化している。
 * </p>
 *
 * ProcessFlow ID: f81dd9e0-794c-4539-a2a5-9cbcc0a75899
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderConfirmService {

    private final CartItemRepository cartItemRepository;
    private final OrderRepository orderRepository;
    private final ApplicationEventPublisher eventPublisher;

    /** TX 処理委譲先 bean (Spring AOP proxy 経由で呼び出すことで @Transactional を有効化)。 */
    private final OrderConfirmTransactionService orderConfirmTransactionService;

    /**
     * 注文確定実行。
     *
     * <p>カート確認画面の「注文確定」ボタン押下で起動。
     * 配送先情報を入力として受け取り、1 TX で在庫引き当て・注文登録・カートクリアを原子的に実行する。</p>
     *
     * @param request         リクエスト DTO (shippingPostalCode / shippingAddress / note / paymentMethod)
     * @param sessionCustomerId セッション顧客 ID (ambientVariables.sessionCustomerId)
     * @return 注文確定レスポンス DTO (orderId / orderNumber / totalAmount)
     *
     * ProcessFlow action: act-001
     * httpRoute: POST /api/retail/orders
     */
    public OrderConfirmResponse execute(OrderConfirmRequest request, Long sessionCustomerId) {

        // step-01: バリデーション (Bean Validation は @Valid で Controller に委譲)
        // shippingPostalCode は必須かつハイフンなし 7 桁数字
        // shippingAddress は必須 (300 文字以内)
        // paymentMethod は credit_card / bank_transfer / cod のいずれか

        // step-02: 顧客のアクティブカートと cart_items を取得 (multi-store inventory 整合のため store 情報も JOIN)
        List<Map<String, Object>> cartItems = cartItemRepository.findActiveCartItemsWithStore(sessionCustomerId);

        // step-03: カートが空の場合は 422 を返す
        if (cartItems == null || cartItems.isEmpty()) {
            throw new CartEmptyException("カートが空です。商品をカートに追加してから注文確定してください。");
        }

        // step-04: totalAmount 計算 (unit_price_snapshot * quantity の合計)
        long totalAmount = cartItems.stream()
                .mapToLong(item -> {
                    long unitPrice = ((Number) item.get("unitPriceSnapshot")).longValue();
                    int quantity = ((Number) item.get("quantity")).intValue();
                    return unitPrice * quantity;
                })
                .sum();

        // step-05: 注文番号採番 (DB シーケンス seq_order_number から NEXTVAL)
        // @conv.numbering.orderNumber 規約: ORD-YYYY-NNNNNN
        // TX 外採番のため void (スキップ番号) は許容 (ADR-001)
        String newOrderNumber = orderRepository.nextOrderNumber();

        // step-06: 注文確定 TX (isolationLevel=READ_COMMITTED, propagation=REQUIRED, timeoutMs=10000)
        // rollbackOn: [STOCK_SHORTAGE, ORDER_NUMBER_CONFLICT]
        // TX メソッドは OrderConfirmTransactionService (別 bean) に委譲することで、
        // Spring AOP proxy 経由の呼び出しを保証し @Transactional 境界を有効化する。
        Order persistedOrder = orderConfirmTransactionService.executeOrderConfirmTransaction(
                request, sessionCustomerId, cartItems, totalAmount, newOrderNumber);

        // step-09: retail.order.confirmed イベントを発行 (TX コミット後 + persistedOrder 再取得後)
        eventPublisher.publishEvent(new OrderConfirmedEvent(
                this,
                persistedOrder.getId(),
                persistedOrder.getOrderNumber(),
                persistedOrder.getCustomerId(),
                persistedOrder.getTotalAmount()
        ));

        // step-10: 200 OK レスポンスを返す
        return new OrderConfirmResponse(
                persistedOrder.getId(),
                persistedOrder.getOrderNumber(),
                persistedOrder.getTotalAmount(),
                persistedOrder.getOrderedAt(),
                "注文が確定しました。注文番号: " + persistedOrder.getOrderNumber()
        );
    }

}
