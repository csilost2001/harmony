# Java Spring Boot — Repository テンプレート

ProcessFlow の `dbAccess` ステップの `tableId` と `operation` から JPA Repository を生成する。

## フィールドマッピング

| ProcessFlow JSON フィールド | Repository 生成物 |
|---|---|
| `tableId` → `harmony.json entities.tables[].physicalName` | エンティティクラス名 / テーブル物理名 |
| `operation: "SELECT"` | `findBy...()` / `@Query` native query |
| `operation: "INSERT"` | `save()` |
| `operation: "UPDATE"` | `@Modifying @Query` / `save()` |
| `operation: "DELETE"` | `deleteBy...()` / `@Modifying @Query` |
| `sql` フィールド | `@Query(value = "...", nativeQuery = true)` |
| `affectedRowsCheck` | 戻り値 `int` の行数チェック |

## テンプレート本体

```java
package com.example.{{project.meta.name | camelCase}}.repository;

import com.example.{{project.meta.name | camelCase}}.entity.{{tableName | toPascalCase}};
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * {{tableName}} リポジトリ。
 *
 * 対応テーブル: {{tablePhysicalName}}
 * ProcessFlow 参照: {{processFlow.meta.id}} ({{processFlow.meta.name}})
 */
@Repository
public interface {{tableName | toPascalCase}}Repository extends JpaRepository<{{tableName | toPascalCase}}, Long> {

    // --- SELECT 系 (operation=SELECT の dbAccess から展開) ---

    /**
     * {{dbAccessStep.description}}
     * SQL: {{dbAccessStep.sql}}
     */
    @Query(value = "{{dbAccessStep.sql | escapeJava}}", nativeQuery = true)
    List<Object[]> findBy{{queryCondition | toPascalCase}}(@Param("param") Object param);

    // --- UPDATE 系 (operation=UPDATE の dbAccess から展開) ---

    /**
     * {{dbAccessStep.description}}
     * SQL: {{dbAccessStep.sql}}
     * affectedRowsCheck: {{dbAccessStep.affectedRowsCheck.operator}} {{dbAccessStep.affectedRowsCheck.expected}}
     */
    @Modifying
    @Query(value = "{{dbAccessStep.sql | escapeJava}}", nativeQuery = true)
    int update{{operationName | toPascalCase}}(/* @Param("...") でバインド変数を定義 */);

    // --- DELETE 系 (operation=DELETE の dbAccess から展開) ---

    /**
     * {{dbAccessStep.description}}
     * SQL: {{dbAccessStep.sql}}
     */
    @Modifying
    @Query(value = "{{dbAccessStep.sql | escapeJava}}", nativeQuery = true)
    int delete{{operationName | toPascalCase}}(/* @Param("...") でバインド変数を定義 */);
}
```

## SQL バインド変数変換

ProcessFlow SQL のバインド変数 `@varName` → Spring Data JPA の `:varName` / `@Param("varName")` に変換する。

例:
- ProcessFlow: `WHERE product_id = @cartItem.productId AND store_id = @cartItem.storeId`
- JPA: `WHERE product_id = :productId AND store_id = :storeId` + `@Param("productId") Long productId, @Param("storeId") Long storeId`

## affectedRowsCheck → 実装パターン

```java
// affectedRowsCheck.operator = "=" / expected = 1 の場合
int updated = inventoryRepository.updateDecrement(productId, storeId, quantity);
if (updated != 1) {
    throw new StockShortageException("在庫不足: productId=" + productId);
}
```
