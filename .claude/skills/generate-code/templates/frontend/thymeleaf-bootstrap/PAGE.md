# Thymeleaf + Bootstrap — Page テンプレート

Screen JSON の `kind` と `items[]` から Thymeleaf HTML テンプレートを生成する。
`techStack.designer.cssFramework = "bootstrap"` の前提。

## フィールドマッピング

| Screen JSON フィールド | Thymeleaf HTML 生成物 |
|---|---|
| `name` | `<title>` / `<h1>` |
| `path` | `<form action="...">` / `<a href="...">` |
| `kind` | テンプレートパターン選択 (下記参照) |
| `items[].id` | `th:field="*{fieldId}"` / `th:text="${result.fieldId}"` |
| `items[].label` | `<label>`, `<th>` ヘッダー |
| `items[].direction = "input"` | `<input>` / `<select>` / `<textarea>` |
| `items[].direction = "output"` | `<span th:text>` / `<td th:text>` |
| `items[].direction = "viewer"` | `<table th:each>` / `<div class="list-group">` |
| `items[].required = true` | `required` 属性 + Bootstrap `is-invalid` パターン |
| `items[].type` | `<input type="text/number/date/email/password">` |
| `items[].options[]` | `<select>` + `<option th:each>` |
| `items[].events[]` | `<button type="submit">` / `hx-post` (htmx 利用時) |

## kind 別テンプレートパターン

### kind=search (検索画面)

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org" lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title th:text="#{screen.title} + ' | システム名'">{{screen.name}} | システム名</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3/dist/css/bootstrap.min.css">
  <!-- Bootstrap CDN は開発用。本番は static 配置を推奨 -->
</head>
<body>
  <div th:replace="~{fragments/header :: header}"></div>

  <main class="container py-4">
    <h1 class="mb-4">{{screen.name}}</h1>

    <!-- 検索フォーム (items[].direction=input から展開) -->
    <form th:action="@{<<screen.path>>}" method="get" class="mb-4">
      <div class="row g-3">
        <!-- 例: productCode (direction=input, type=string) -->
        <div class="col-md-4">
          <label for="productCode" class="form-label">商品コード</label>
          <input type="text"
                 id="productCode"
                 name="productCode"
                 class="form-control"
                 th:value="${param.productCode}"
                 placeholder="例: P-0001"
                 maxlength="20">
          <!-- errorMessages.invalidFormat -->
          <div class="invalid-feedback" th:if="${errors?.productCode}" th:text="${errors.productCode}"></div>
        </div>

        <!-- 例: storeCode (direction=input, type=string, options あり → <select>) -->
        <div class="col-md-4">
          <label for="storeCode" class="form-label">
            店舗 <span class="text-danger">*</span>
          </label>
          <select id="storeCode" name="storeCode" class="form-select" required>
            <option value="">選択してください</option>
            <!-- items[].options[] を th:each で展開 -->
            <option value="S-001" th:selected="${param.storeCode == 'S-001'}">東京本店</option>
            <option value="S-002" th:selected="${param.storeCode == 'S-002'}">大阪支店</option>
            <option value="S-003" th:selected="${param.storeCode == 'S-003'}">名古屋支店</option>
          </select>
          <div class="invalid-feedback">店舗を選択してください。</div>
        </div>

        <div class="col-md-4 d-flex align-items-end">
          <button type="submit" class="btn btn-primary">
            在庫照会
          </button>
        </div>
      </div>
    </form>

    <!-- 照会日時 (direction=output) -->
    <p class="text-muted small" th:if="${inquiredAt}">
      照会日時: <span th:text="${#temporals.format(inquiredAt, 'yyyy/MM/dd HH:mm')}"></span>
    </p>

    <!-- 検索結果一覧 (direction=viewer, viewDefinitionId あり) -->
    <div th:if="${inventoryRows != null}">
      <h2 class="h5 mb-3">検索結果 <span class="badge bg-secondary" th:text="${inventoryRows.size()}"></span> 件</h2>
      <div class="table-responsive">
        <table class="table table-striped table-hover align-middle">
          <thead class="table-dark">
            <tr>
              <!-- ViewDefinition の columns[] から展開 -->
              <th>商品コード</th>
              <th>商品名</th>
              <th>単価</th>
              <th>在庫数</th>
              <th>低在庫</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr th:each="row : ${inventoryRows}">
              <td th:text="${row.productCode}"></td>
              <td th:text="${row.productName}"></td>
              <td th:text="${#numbers.formatDecimal(row.unitPrice, 0, 'COMMA', 0, 'POINT')} + '円'"></td>
              <td th:text="${row.quantityAvailable}"></td>
              <td>
                <!-- 低在庫バッジ: quantityAvailable <= 5 の場合 -->
                <span class="badge bg-warning" th:if="${row.quantityAvailable <= 5}">低在庫</span>
              </td>
              <td>
                <!-- カート追加ボタン → items[].events[] から展開 -->
                <form th:action="@{/cart/add}" method="post">
                  <input type="hidden" name="productId" th:value="${row.productId}">
                  <input type="hidden" name="storeId" th:value="${row.storeId}">
                  <input type="hidden" th:name="${_csrf.parameterName}" th:value="${_csrf.token}">
                  <button type="submit" class="btn btn-sm btn-outline-primary"
                          th:disabled="${row.quantityAvailable <= 0}">
                    カートに追加
                  </button>
                </form>
              </td>
            </tr>
            <!-- 結果 0 件 -->
            <tr th:if="${inventoryRows.isEmpty()}">
              <td colspan="6" class="text-center text-muted">該当する商品が見つかりませんでした。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <div th:replace="~{fragments/footer :: footer}"></div>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
```

### kind=form (フォーム画面)

```html
<!-- POST フォーム。Screen.path = "/cart/confirm" などに対応 -->
<form th:action="@{<<screen.path>>}" method="post" novalidate>
  <input type="hidden" th:name="${_csrf.parameterName}" th:value="${_csrf.token}">

  <!-- items[].direction=input を展開 -->
  <!-- ... -->

  <div class="d-flex gap-2 mt-4">
    <button type="submit" class="btn btn-primary">確定</button>
    <a th:href="@{<<backPath>>}" class="btn btn-outline-secondary">戻る</a>
  </div>
</form>
```

### kind=complete (完了画面)

```html
<div class="alert alert-success" role="alert">
  <h4 class="alert-heading">注文が完了しました</h4>
  <p>注文番号: <strong th:text="${orderNumber}"></strong></p>
  <hr>
  <a th:href="@{/orders}" class="btn btn-outline-success">注文履歴を確認する</a>
</div>
```

### kind=list (一覧画面)

```html
<!-- 一覧テーブル: items[].direction=viewer, viewDefinitionId から展開 -->
<table class="table table-striped">
  <thead><tr><!-- ViewDefinition.columns[] から th を展開 --></tr></thead>
  <tbody>
    <tr th:each="row : ${rows}">
      <!-- ViewDefinition.columns[] から td を展開 -->
    </tr>
  </tbody>
</table>
```

## 命名規則

| Screen JSON 値 | Thymeleaf パス |
|---|---|
| `path: "/products/search"` | `src/main/resources/templates/products/search.html` |
| `path: "/cart/confirm"` | `src/main/resources/templates/cart/confirm.html` |
| `path: "/order/complete"` | `src/main/resources/templates/order/complete.html` |

## Fragment テンプレート

```html
<!-- fragments/header.html -->
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org">
<head></head>
<body>
<header th:fragment="header" class="navbar navbar-dark bg-dark">
  <div class="container">
    <a class="navbar-brand" href="/">業務システム</a>
    <div class="d-flex">
      <a class="btn btn-outline-light btn-sm" href="/logout">ログアウト</a>
    </div>
  </div>
</header>
</body>
</html>
```

## Placeholder 解釈ルール (AI コード生成時必読)

本テンプレートでは **`<<...>>`** を AI が値で置換する placeholder として使用する。

Thymeleaf URL 式 `@{...}` の内側に `<<...>>` が現れる場合、AI は必ず placeholder を実際のパス値に置換してから出力すること。`<<...>>` のまま Thymeleaf テンプレートに出力してはならない。

| テンプレート記法 | 置換後の出力例 (`screen.path = "/products/search"`) |
|---|---|
| `th:action="@{<<screen.path>>}"` | `th:action="@{/products/search}"` |
| `th:href="@{<<backPath>>}"` | `th:href="@{/cart}"` |
| `th:action="@{<<screen.path>>}"` (form POST) | `th:action="@{/cart/confirm}"` |

**なぜ `<<...>>` を使うか**: Thymeleaf の URL 式構文は `@{...}` であり、mustache 形式の `{{...}}` をそのままネストすると `@{{{screen.path}}}` のような三重括弧になり、AI が Thymeleaf 出力の一部として誤ってコピーするリスクがある。`<<...>>` はどの主要テンプレートエンジンとも構文衝突しない明示的 placeholder 記法である。

ゴールデン例 (`product-search.html`) では既に実際のパス値に展開されており、`<<...>>` placeholder は登場しない。
