# Thymeleaf + Bootstrap — Page テンプレート

Screen JSON の `kind` と `items[]` から Thymeleaf HTML テンプレートを生成する。
`techStack.designer.cssFramework = "bootstrap"` の前提。

**pageLayoutId 指定時は Layout Decorate モードに自動切替** (下記「Layout Decorate モード」セクション参照)。

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

---

## Layout Decorate モード (pageLayoutId あり)

`screen.purpose === "page"` かつ `screen.pageLayoutId` が指定されている場合、通常の kind 別 HTML の代わりに **Layout Decorate モード** で生成する。

既存の kind 別パターン (search / form / complete / list 等) は**変更なし**。
pageLayoutId がある場合のみ、以下のラップ構造を適用する。

### 仕組み (Layout Dialect 標準形式)

- Page 側 `<html>` ルートに `layout:decorate="~{layouts/<pageLayoutId>}"` 宣言 + Layout Dialect 名前空間 (`xmlns:layout="http://www.ultraq.net.nz/thymeleaf/layout"`) を追加
- `<body>` 内に `<th:block layout:fragment="layout-content">` でコンテンツをラップ
- Layout 側の `layout:fragment="layout-content"` slot が同名の content を自動 inject
- `<head>` には `<title>` の上書きのみ定義 (body / layout 構造は layout 側が提供)

Layout Dialect の依存・仕組みは `LAYOUT.md` を参照。

### Thymeleaf Layout Decorate モード — 出力構造

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org"
      xmlns:layout="http://www.ultraq.net.nz/thymeleaf/layout"
      layout:decorate="~{layouts/<<pageLayoutId>>}"
      lang="ja">
<head>
  <title><<screen.name>> | システム</title>
</head>
<body>
  <th:block layout:fragment="layout-content">
    <!--
      Screen 本文 (通常の kind 別 Page 生成内容をここに配置)
      Layout: <<pageLayoutId>> (<<pageLayoutName>>)
      Screen: <<screenId>> (<<screen.name>>, kind=<<screen.kind>>)
    -->

    <!-- kind=dashboard 例: セクション構成 -->
    <h1 class="mb-4"><<screen.name>></h1>

    <!-- items[] → kind 別テンプレートパターン (search/form/list/complete/dashboard 等) をここに展開 -->
    <!-- 既存の kind 別テンプレートパターンと同内容を <th:block layout:fragment="layout-content"> 内に配置 -->

  </th:block>
</body>
</html>
```

### 完成例 — kind=dashboard + Main Layout

**対象**:
- Screen: `kind=dashboard`, `purpose=page`, `pageLayoutId=17595b62-fef1-4b22-9c25-16736c772567`
- PageLayout: `17595b62-fef1-4b22-9c25-16736c772567` (Main Layout)

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org"
      xmlns:layout="http://www.ultraq.net.nz/thymeleaf/layout"
      layout:decorate="~{layouts/17595b62-fef1-4b22-9c25-16736c772567}"
      lang="ja">
<head>
  <!-- title のみ上書き (Bootstrap/共通 CSS は layout 側が提供) -->
  <title th:text="#{screen.title} + ' | Harmony Retail'">ダッシュボード | Harmony Retail</title>
</head>
<body>
  <th:block layout:fragment="layout-content">
    <!--
      Screen 本文: ダッシュボード (kind=dashboard)
      Layout: 17595b62-fef1-4b22-9c25-16736c772567 (Main Layout)
      ヘッダ・サイドバー・フッタは Layout 側が提供する
    -->

    <h1 class="mb-4">ダッシュボード</h1>

    <!-- サマリカード行 (items[] → kind=dashboard パターン) -->
    <div class="row g-4 mb-4">
      <div class="col-md-4">
        <div class="card text-bg-primary">
          <div class="card-body">
            <h6 class="card-title">本日の売上</h6>
            <p class="card-text display-6" th:text="${dailySales != null} ? ${#numbers.formatDecimal(dailySales, 0, 'COMMA', 0, 'POINT')} + '円' : '---'">---</p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card text-bg-success">
          <div class="card-body">
            <h6 class="card-title">本日の注文数</h6>
            <p class="card-text display-6" th:text="${dailyOrderCount != null} ? ${dailyOrderCount} + '件' : '---'">---</p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card text-bg-warning">
          <div class="card-body">
            <h6 class="card-title">低在庫商品数</h6>
            <p class="card-text display-6" th:text="${lowStockCount != null} ? ${lowStockCount} + '品' : '---'">---</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 最近の注文一覧 (direction=viewer) -->
    <h2 class="h5 mb-3">最近の注文</h2>
    <div class="table-responsive">
      <table class="table table-striped table-hover align-middle">
        <thead class="table-dark">
          <tr>
            <th>注文番号</th>
            <th>顧客名</th>
            <th>金額</th>
            <th>ステータス</th>
            <th>注文日時</th>
          </tr>
        </thead>
        <tbody>
          <tr th:each="order : ${recentOrders}">
            <td><a th:href="@{/orders/{id}(id=${order.orderId})}" th:text="${order.orderId}"></a></td>
            <td th:text="${order.customerName}"></td>
            <td th:text="${#numbers.formatDecimal(order.totalAmount, 0, 'COMMA', 0, 'POINT')} + '円'"></td>
            <td><span class="badge bg-secondary" th:text="${order.status}"></span></td>
            <td th:text="${#temporals.format(order.orderedAt, 'yyyy/MM/dd HH:mm')}"></td>
          </tr>
          <tr th:if="${recentOrders == null or recentOrders.isEmpty()}">
            <td colspan="5" class="text-center text-muted">注文データがありません。</td>
          </tr>
        </tbody>
      </table>
    </div>

  </th:block>
</body>
</html>
```

### Layout Decorate モード時の Controller 生成差分

Controller の `@GetMapping` は通常の Screen → Controller 生成と同じ。追加変更なし。
Layout 側の model attribute (storeName, userName, copyright など) は Layout の各 Gadget Controller が
`@ModelAttribute` または Interceptor 経由で設定する想定 (生成コードにコメントで注記する)。

```java
// Layout を使う Controller での model attribute 注意書き (コメントとして生成)
// Gadget (グローバルヘッダ) が参照する storeName / userName は SessionScope Bean または
// HandlerInterceptor で自動付与してください (GlobalHeaderGadgetController 参照)
```

### AI コード生成時の置換ルール (Layout Decorate モード)

| placeholder | 置換値 |
|---|---|
| `<<pageLayoutId>>` | `Screen.pageLayoutId` |
| `<<pageLayoutName>>` | 解決済み PageLayout の name |
| `<<screenId>>` | `Screen.id` |
| `<<screen.name>>` | `Screen.name` |
| `<<screen.kind>>` | `Screen.kind` |

`th:replace="~{layouts/<<pageLayoutId>> :: ...}"` の `<<...>>` は必ず実際の PageLayout ID に置換してから出力する。

---

## 注記: Spring Boot 設定ファイルの日本語値

Page 生成と一緒に Spring Boot の `application.properties` や Controller を生成する際、画面タイトル / メッセージ / 店舗名 などの**日本語値を `application.properties` に直接書くと文字化け**する (Spring Boot の `PropertiesPropertySourceLoader` は ISO-8859-1 default。PR #1034 dogfood 検出)。

- **推奨**: Java source の `@Value("${key:日本語デフォルト}")` で hardcode (UTF-8 source)
- **代替**: `application.yml` (UTF-8 default) を採用
- **必須**: `server.servlet.encoding.charset=UTF-8` / `force=true` / `spring.thymeleaf.encoding=UTF-8` の 3 行 (これらが無いと response body も化ける)
- **i18n**: `messages_ja.properties` は UTF-8 保存 + `spring.messages.encoding=UTF-8` 明示

詳細: `.claude/skills/generate-code/SKILL.md` の「Spring Boot 設定ファイル — 日本語値の取り扱い」セクションを参照。
