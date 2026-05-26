package com.example.retail.controller;

import com.example.retail.dto.OrderConfirmRequest;
import com.example.retail.dto.OrderConfirmResponse;
import com.example.retail.exception.CartEmptyException;
import com.example.retail.exception.StockShortageException;
import com.example.retail.service.OrderConfirmService;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 注文確定コントローラ。
 *
 * <p>ProcessFlow ID: order-confirm</p>
 * <p>httpRoute: POST /api/retail/orders</p>
 * <p>auth: required (Spring Security でセッション認証)</p>
 *
 * responses[]:
 *   - 200-ok: 注文確定成功 (retail:OrderConfirmResponse)
 *   - 400-validation: バリデーションエラー (retail:ApiError)
 *   - 422-cart-empty: カートが空 (retail:ApiError)
 *   - 422-stock-shortage: 在庫不足 (retail:ApiError)
 *   - 422-order-confirm-failed: 注文確定 TX 失敗 (retail:ApiError)
 */
@RestController
@RequestMapping("/api/retail")
@RequiredArgsConstructor
@Slf4j
public class OrderConfirmController {

    private final OrderConfirmService orderConfirmService;

    /**
     * 注文確定実行。
     *
     * <p>ProcessFlow action: act-001 (注文確定実行)。</p>
     *
     * @param request リクエスト DTO
     * @param session HTTP セッション (sessionCustomerId 取得用)
     * @return 注文確定レスポンス DTO
     */
    @PostMapping("/orders")
    public ResponseEntity<OrderConfirmResponse> confirmOrder(
            @Valid @RequestBody OrderConfirmRequest request,
            HttpSession session) {

        // ambientVariables: sessionCustomerId (セッションから取得)
        Long sessionCustomerId = (Long) session.getAttribute("customerId");
        if (sessionCustomerId == null) {
            // セッション未認証 — Spring Security で通常は事前にブロックされる
            return ResponseEntity.status(401).build();
        }

        OrderConfirmResponse response = orderConfirmService.execute(request, sessionCustomerId);
        // responses[0]: 200-ok
        return ResponseEntity.ok(response);
    }

    // --- 例外ハンドラ ---

    /**
     * 400 バリデーションエラー (responses[]: 400-validation)。
     *
     * <p>ProcessFlow step-01 の validation errors に対応。</p>
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidationError(
            MethodArgumentNotValidException ex) {
        Map<String, String> fieldErrors = new java.util.LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(fe ->
                fieldErrors.put(fe.getField(), fe.getDefaultMessage()));
        return ResponseEntity.badRequest().body(Map.of(
                "code", "VALIDATION_ERROR",
                "message", "入力値が不正です。",
                "details", fieldErrors
        ));
    }

    /**
     * 422 カートが空 (responses[]: 422-cart-empty)。
     *
     * <p>ProcessFlow step-03 の CART_EMPTY エラーに対応。</p>
     */
    @ExceptionHandler(CartEmptyException.class)
    public ResponseEntity<Map<String, Object>> handleCartEmpty(CartEmptyException ex) {
        return ResponseEntity.unprocessableEntity().body(Map.of(
                "code", "CART_EMPTY",
                "message", ex.getMessage()
        ));
    }

    /**
     * 422 在庫不足 (responses[]: 422-stock-shortage)。
     *
     * <p>ProcessFlow step-06-01-a の STOCK_SHORTAGE エラーに対応。</p>
     */
    @ExceptionHandler(StockShortageException.class)
    public ResponseEntity<Map<String, Object>> handleStockShortage(StockShortageException ex) {
        return ResponseEntity.unprocessableEntity().body(Map.of(
                "code", "STOCK_SHORTAGE",
                "message", ex.getMessage()
        ));
    }
}
