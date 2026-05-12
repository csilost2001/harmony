# Java Spring Boot — Entity テンプレート

ProcessFlow の `lineage.reads / lineage.writes` で参照されるテーブルから JPA Entity を生成する。
テーブル定義 (`harmony.json entities.tables[].physicalName` と対応テーブル JSON) を読んで列定義を取得する。

## フィールドマッピング

| テーブル定義 / ProcessFlow | Entity 生成物 |
|---|---|
| `tables[].physicalName` | `@Table(name = "...")` |
| `tables[].name` (日本語) | クラスコメント |
| カラム物理名 (snake_case) | フィールド名 (camelCase)、`@Column(name = "...")` |
| カラム型 (string/integer/datetime 等) | Java 型 (String/Long/LocalDateTime 等) |
| `unique: true` | `@Column(unique = true)` |
| NOT NULL | `@Column(nullable = false)` |
| PRIMARY KEY / AUTO_INCREMENT | `@Id @GeneratedValue` |
| FOREIGN KEY | `@ManyToOne @JoinColumn(name = "...")` |

## テンプレート本体

```java
package com.example.{{project.meta.name | camelCase}}.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * {{table.name}} エンティティ。
 *
 * テーブル: {{table.physicalName}}
 * ProcessFlow 参照: {{processFlow.meta.id}}
 */
@Entity
@Table(name = "{{table.physicalName}}")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class {{table.physicalName | toPascalCase}} {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // --- カラム (テーブル定義の columns[] から展開) ---
    // 例:
    // @Column(name = "order_number", nullable = false, unique = true)
    // private String orderNumber;
    //
    // @Column(name = "customer_id", nullable = false)
    // private Long customerId;
    //
    // @Column(name = "status", nullable = false, length = 20)
    // private String status;
    //
    // @Column(name = "total_amount", nullable = false)
    // private Long totalAmount;
    //
    // @Column(name = "payment_method", length = 30)
    // private String paymentMethod;
    //
    // @CreationTimestamp
    // @Column(name = "created_at", nullable = false, updatable = false)
    // private LocalDateTime createdAt;
    //
    // @UpdateTimestamp
    // @Column(name = "updated_at", nullable = false)
    // private LocalDateTime updatedAt;
}
```

## データ型変換

| DB カラム型 | Java 型 |
|---|---|
| `VARCHAR(n)` / `TEXT` | `String` |
| `INTEGER` / `BIGINT` / `SERIAL` | `Long` (主キー) / `Integer` (通常) |
| `BOOLEAN` | `Boolean` |
| `TIMESTAMP` / `DATETIME` | `LocalDateTime` |
| `DATE` | `LocalDate` |
| `DECIMAL(p,s)` / `NUMERIC` | `BigDecimal` |

## PostgreSQL (database.type=postgresql) 固有

- SERIAL / BIGSERIAL → `@GeneratedValue(strategy = GenerationType.IDENTITY)`
- UUID 主キー → `@GeneratedValue(strategy = GenerationType.UUID)` + `private UUID id;`
- `CURRENT_TIMESTAMP` DEFAULT → `@CreationTimestamp` / `@UpdateTimestamp`
