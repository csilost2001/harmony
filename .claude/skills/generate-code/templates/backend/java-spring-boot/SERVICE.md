# Java Spring Boot — Service テンプレート

ProcessFlow の `actions[]` 全体を 1 つの `@Service` クラスにマッピングする。

## フィールドマッピング

| ProcessFlow JSON フィールド | Java 生成物 |
|---|---|
| `meta.name` | クラス名 (PascalCase + "Service"、例: `OrderConfirmService`) |
| `actions[*].httpRoute.method` | HTTP メソッド (Spring MVC は呼び出し側 Controller に反映) |
| `actions[*].inputs[]` | メソッド引数 (DTO クラスまたは個別引数) |
| `actions[*].outputs[]` | メソッド戻り値の型 (ResponseBody DTO) |
| `steps` (kind=dbAccess) | JPA Repository 呼び出し or native query |
| `steps` (kind=transactionScope) | `@Transactional` アノテーション |
| `steps` (kind=branch) | if/else 文 |
| `steps` (kind=eventPublish) | `ApplicationEventPublisher.publishEvent()` |
| `steps` (kind=screenTransition) | redirect 文 (Controller 側: `return "redirect:/path"`) |
| `steps` (kind=compute) | ローカル変数計算ロジック |
| `steps` (kind=validation) | Bean Validation アノテーション or 手動バリデーション |
| `steps` (kind=return) | `return ResponseEntity.<T>...` 文 |
| `steps` (kind=loop) | for / forEach 文 |
| `steps` (kind=log) | `log.error(...)` / `log.info(...)` |
| `steps` (kind=その他 / extension step の `type: "other"`) | TODO コメント + outputSchema で型推定 (注: schema `kind` に `other` は存在しない。extension step 内の sub-type 概念と混同しないこと) |

## テンプレート本体

```java
package com.example.{{project.meta.name | camelCase}}.service;

import com.example.{{project.meta.name | camelCase}}.repository.*;
import com.example.{{project.meta.name | camelCase}}.entity.*;
import com.example.{{project.meta.name | camelCase}}.dto.*;
import com.example.{{project.meta.name | camelCase}}.event.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {{processFlow.meta.name}} サービス。
 * <p>
 * {{processFlow.meta.description}}
 * </p>
 *
 * ProcessFlow ID: {{processFlow.meta.id}}
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class {{processFlow.meta.name | toPascalCase}}Service {

    // --- repositories (ProcessFlow lineage.reads / lineage.writes から導出) ---
    {{#each processFlow.actions[0].steps | flattenSteps | filter kind=dbAccess}}
    private final {{tableId | toEntityName}}Repository {{tableId | toEntityName | toCamelCase}}Repository;
    {{/each}}

    private final ApplicationEventPublisher eventPublisher;

    /**
     * {{processFlow.actions[0].name}}。
     * <p>
     * {{processFlow.actions[0].description}}
     * </p>
     *
     * @param request 入力 DTO ({{processFlow.actions[0].inputs | map name | join ", "}})
     * @return 処理結果 DTO
     * {{#if processFlow.actions[0].httpRoute.auth == "required"}}
     * @throws UnauthorizedException 認証なし
     * {{/if}}
     */
    {{#if processFlow.actions[0].steps | hasKind transactionScope}}
    @Transactional
    {{/if}}
    public {{processFlow.actions[0].name | toPascalCase}}Response execute(
            {{processFlow.actions[0].name | toPascalCase}}Request request,
            Long sessionCustomerId) {

        // Step: バリデーション (processFlow step kind=validation から展開)
        // TODO: Bean Validation は @Valid で呼び出し元 Controller に委譲する
        // - {{processFlow.actions[0].inputs | filter required=true | map name | join ", "}} は必須

        // Step: メインロジック (processFlow actions[0].steps を順に展開)
        // [各 step は kind に応じて以下のパターンで展開する]
        //
        // [kind=dbAccess, operation=SELECT]
        //   List<Entity> rows = repository.findBy...();
        //
        // [kind=dbAccess, operation=INSERT]
        //   repository.save(entity);
        //
        // [kind=dbAccess, operation=UPDATE]
        //   int updated = repository.updateBy...(...);
        //
        // [kind=dbAccess, operation=DELETE]
        //   repository.deleteBy...(...);
        //
        // [kind=compute]
        //   long totalAmount = cartItems.stream().mapToLong(i -> i.getUnitPrice() * i.getQuantity()).sum();
        //
        // [kind=branch]
        //   if (condition) { ... } else { ... }
        //
        // [kind=loop, loopKind=collection]
        //   for (CartItem cartItem : cartItems) { ... }
        //
        // [kind=transactionScope]
        //   → @Transactional を付与 (メソッドレベル)
        //
        // [kind=eventPublish]
        //   eventPublisher.publishEvent(new OrderConfirmedEvent(orderId, orderNumber, customerId, totalAmount));
        //
        // [kind=return]
        //   return new {{processFlow.actions[0].name | toPascalCase}}Response(orderId, orderNumber, totalAmount);
        //
        // [extension step, type=other] ← schema の kind ではなく extension step 内の sub-type
        //   // TODO: {{step.description}} (outputSchema: {{step.outputSchema}})
        //
        // [kind=log]
        //   log.error("{{step.message}}", structuredData);

        throw new UnsupportedOperationException("実装してください");
    }
}
```

## 命名規則

| ProcessFlow 値 | Java 変換規則 | 例 |
|---|---|---|
| `meta.name` (日本語) | PascalCase (ローマ字変換 or 意味翻訳) | `注文確定` → `OrderConfirm` |
| `tableId` UUID | `project.json entities.tables` で物理名を引く | `10d555e2-...` → `orders` → `Orders` |
| `inputs[].name` (camelCase) | そのまま Java 引数名 | `shippingPostalCode` |
| `outputs[].name` (camelCase) | そのまま DTO フィールド名 | `orderId` |

## transactionScope → @Transactional マッピング

| ProcessFlow フィールド | Spring アノテーション |
|---|---|
| `isolationLevel: "READ_COMMITTED"` | `@Transactional(isolation = Isolation.READ_COMMITTED)` |
| `propagation: "REQUIRED"` | `@Transactional(propagation = Propagation.REQUIRED)` (デフォルト) |
| `timeoutMs: 10000` | `@Transactional(timeout = 10)` |
| `rollbackOn: ["STOCK_SHORTAGE"]` | ロジック内で該当例外 throw 時の comment で注記 |
