package com.example.retail.service;

import com.example.retail.dto.OrderConfirmRequest;
import com.example.retail.entity.Order;
import com.example.retail.exception.OrderConfirmFailedException;
import com.example.retail.exception.StockShortageException;
import com.example.retail.repository.CartItemRepository;
import com.example.retail.repository.CartRepository;
import com.example.retail.repository.InventoryRepository;
import com.example.retail.repository.OrderItemRepository;
import com.example.retail.repository.OrderRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 注文確定 TX サービス。
 *
 * <p>
 * {@link OrderConfirmService} から呼び出される専用 bean。
 * Spring AOP proxy 経由での呼び出しを保証するために別クラスとして分離する (self-invocation 回避)。
 * {@code @Transactional} は proxy 経由でのみ有効であるため、同一クラス内からの self-invocation では
 * TX 境界が有効化されない。本クラスを独立 bean として {@code @Autowired} することで、AOP proxy を経由させる。
 * </p>
 *
 * <p>
 * 在庫減算 → orders INSERT → order_items loop INSERT → カートクリアを原子的に実行し、
 * TX コミット後に orders を再取得して返す (ADR-002 準拠)。
 * </p>
 *
 * ProcessFlow ID: f81dd9e0-794c-4539-a2a5-9cbcc0a75899
 * ProcessFlow step: step-06 (transactionScope, isolationLevel=READ_COMMITTED, timeoutMs=10000)
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderConfirmTransactionService {

    private final CartRepository cartRepository;
    private final CartItemRepository cartItemRepository;
    private final InventoryRepository inventoryRepository;
    private final OrderRepository orderRepository;
    private final OrderItemRepository orderItemRepository;

    /**
     * 注文確定 TX を実行する。
     *
     * <p>在庫減算 → orders INSERT → order_items loop INSERT → カートクリアの順に原子的に実行し、
     * TX コミット後に orders を再取得して返す。</p>
     *
     * @param request           リクエスト DTO (shippingPostalCode / shippingAddress / note / paymentMethod)
     * @param sessionCustomerId セッション顧客 ID
     * @param cartItems         カート明細 (store 情報を JOIN 済)
     * @param totalAmount       合計金額 (税抜)
     * @param newOrderNumber    採番済み注文番号
     * @return TX コミット後に再取得した Order エンティティ
     * @throws StockShortageException             在庫不足 (rollbackOn: STOCK_SHORTAGE)
     * @throws DataIntegrityViolationException    注文番号 UNIQUE 制約違反 (rollbackOn: ORDER_NUMBER_CONFLICT)
     * @throws OrderConfirmFailedException        TX 後の re-fetch 失敗
     */
    @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 10)
    public Order executeOrderConfirmTransaction(
            OrderConfirmRequest request,
            Long sessionCustomerId,
            List<Map<String, Object>> cartItems,
            long totalAmount,
            String newOrderNumber) {

        // step-06-01: カート明細を 1 件ずつ在庫減算 (loop, kind=dbAccess, operation=retail:DECREMENT_STOCK)
        // store_id は cart_items から引き継ぎ (step-02 で取得済)
        for (Map<String, Object> cartItem : cartItems) {
            long productId = ((Number) cartItem.get("productId")).longValue();
            long storeId = ((Number) cartItem.get("storeId")).longValue();
            int quantity = ((Number) cartItem.get("quantity")).intValue();

            // step-06-01-a: 在庫減算 (affectedRowsCheck = 1 行、0 件なら STOCK_SHORTAGE)
            int updated = inventoryRepository.decrementStock(productId, storeId, quantity);
            if (updated != 1) {
                log.warn("在庫不足: productId={}, storeId={}, requestedQty={}", productId, storeId, quantity);
                throw new StockShortageException("在庫が不足しています。");
            }
        }

        // step-06-02: orders テーブルに注文レコードを INSERT
        // affectedRowsCheck = 1 行、order_number UNIQUE 制約違反は DataIntegrityViolationException として伝播
        Order order = new Order();
        order.setOrderNumber(newOrderNumber);
        order.setCustomerId(sessionCustomerId);
        order.setStatus("pending");
        order.setTotalAmount(totalAmount);
        order.setTaxAmount((long) Math.floor(totalAmount * 0.10));  // @conv.tax.standard.rate = 0.10
        order.setShippingPostalCode(request.getShippingPostalCode());
        order.setShippingAddress(request.getShippingAddress());
        order.setNote(request.getNote());
        order.setPaymentMethod(request.getPaymentMethod());
        order.setOrderedAt(LocalDateTime.now());
        orderRepository.save(order);

        // step-06-03: order_items に 1 行ずつ INSERT (loop, kind=dbAccess, operation=INSERT)
        // 単価・商品名はスナップショットとしてコピー (ADR-006 multi-store 整合: store_code_snapshot を含む)
        for (Map<String, Object> cartItem : cartItems) {
            orderItemRepository.insertOrderItem(
                    order.getId(),
                    ((Number) cartItem.get("productId")).longValue(),
                    (String) cartItem.get("storeCode"),
                    (String) cartItem.get("productCode"),
                    (String) cartItem.get("productName"),
                    ((Number) cartItem.get("unitPriceSnapshot")).longValue(),
                    ((Number) cartItem.get("quantity")).intValue()
            );
        }

        // step-06-04-a: cart_items を全削除 (CLEAR_CART step 1/2)
        cartItemRepository.deleteByCustomerActiveCart(sessionCustomerId);

        // step-06-04-b: carts.status を 'ordered' に更新 (CLEAR_CART step 2/2)
        cartRepository.updateStatusToOrdered(sessionCustomerId);

        // step-08: TX コミット後に orders を再取得 (ADR-002: TX 内変数ネスト参照回避)
        // @Transactional メソッドがリターンした時点で TX がコミットされるため、
        // 呼び出し元 (OrderConfirmService.execute) の時点では既にコミット済みとなる。
        return orderRepository.findByOrderNumber(newOrderNumber)
                .orElseThrow(() -> {
                    // step-08b: persistedOrder == null ガード (ADR-005)
                    log.error("注文確定後の再取得失敗: orderNumber={}, customerId={}", newOrderNumber, sessionCustomerId);
                    return new OrderConfirmFailedException(
                            "注文の登録は完了しましたが、注文情報の取得に失敗しました。しばらく経ってから注文履歴を確認してください。");
                });
    }
}
