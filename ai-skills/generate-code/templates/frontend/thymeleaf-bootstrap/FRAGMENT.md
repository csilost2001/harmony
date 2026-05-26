# Thymeleaf + Bootstrap — Gadget Fragment テンプレート

Gadget Screen JSON (`screens/<id>.json` の `purpose: "gadget"`) から Thymeleaf fragment HTML と Spring MVC Controller を生成する。
`techStack.designer.cssFramework = "bootstrap"` の前提。

**参照スキル**: SKILL.md の Step 3-C (Thymeleaf 系 Gadget 生成) に対応。

---

## 生成ファイル一覧

```
<出力先>/
  src/main/resources/templates/fragments/
    <gadgetId>.html                    (Thymeleaf fragment — th:fragment="gadget")
  src/main/java/com/example/<projectName>/controller/
    <GadgetName>GadgetController.java  (Spring MVC Controller、processFlowId あり時のみ)
```

processFlowId が存在しない (design-only Gadget) 場合: Controller は生成しない。

---

## フィールドマッピング

### Fragment HTML 側

| Gadget Screen JSON フィールド | Thymeleaf 出力 |
|---|---|
| `id` | ファイル名 `fragments/<id>.html`、`th:fragment="gadget"` の親 div |
| `name` | HTML コメントで `<!-- Gadget: <name> -->` |
| `processFlowId` | HTML コメントで `<!-- ProcessFlow: <processFlowId> -->` / フォーム action 先 |
| `items[].id` | `th:text="${<id>}"` / `th:name` / `name` 属性 |
| `items[].label` | `<label>` / `<span>` のテキスト |
| `items[].direction = "output"` | `<span th:text="${<id>}">` |
| `items[].direction = "input"` かつ events[] あり | `<form th:action="@{<httpRoute.path>}" method="post">` 内の `<button type="submit">` |
| `items[].direction = "input"` かつ events[] なし | ナビゲーションリンク `<a th:href="@{<path>}" class="...">` |
| `items[].events[].handlerFlowId` | フォームの action 先 (ProcessFlow の httpRoute.path) |
| `items[].events[].handlerActionId` | 対応する action ID (複数 action フロー対応) |
| `design.cssFramework` | Bootstrap クラス規約適用 |

### Controller 側

| ProcessFlow JSON フィールド | Spring MVC Controller 出力 |
|---|---|
| `meta.id` | クラスコメントで ProcessFlow ID 記載 |
| `meta.name` | クラスコメント |
| `actions[].id` | `@PostMapping` メソッド名のベース |
| `actions[].httpRoute.method` | `@PostMapping` / `@GetMapping` |
| `actions[].httpRoute.path` | `@RequestMapping` / `@PostMapping` のパス |
| `actions[].httpRoute.auth` | Spring Security コメント (`// @PreAuthorize` など) |
| `actions[].outputs[name=redirectTo]` | `return "redirect:<value>"` |

---

## Bootstrap region 規約 (Gadget)

Gadget は PageLayout の各 region に配置されるため、region 別の Bootstrap クラスを適用する:

| region | Gadget ラッパー div クラス |
|---|---|
| `header` | `d-flex align-items-center w-100 gap-3` (navbar 内に収まるフレックスレイアウト) |
| `sidebar` | `d-flex flex-column gap-2` (縦並びナビゲーション) |
| `footer` | `container-fluid` (コンテンツをセンタリング) |
| その他 / 汎用 | (クラスなし、Gadget の design に依存) |

---

## 完成テンプレート例 — グローバルヘッダ Gadget

**対象**: `screens/global-header-gadget.json` (グローバルヘッダ)
- items: storeName (output) / userName (output) / logoutButton (input, events=[click → act-logout])
- processFlowId: `header-gadget-handler` (ヘッダーガジェット処理)
- act-logout の httpRoute: POST /api/retail/auth/logout → redirectTo=/login

### Fragment HTML: `templates/fragments/global-header-gadget.html`

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org" lang="ja">
<head></head>
<body>
  <!--
    Gadget fragment: global-header-gadget
    name: グローバルヘッダ
    ProcessFlow: header-gadget-handler (ヘッダーガジェット処理)
    parent layout から th:replace="~{fragments/global-header-gadget :: gadget}" で差し込まれる
  -->
  <div th:fragment="gadget" class="d-flex align-items-center w-100 gap-3">

    <!-- ブランド / アプリ名 (左端) -->
    <a class="navbar-brand text-white fw-bold" href="/">Harmony Retail</a>

    <!-- region: storeName (direction=output) -->
    <span class="text-white-50 small"
          th:text="${storeName} != null ? ${storeName} : '店舗未選択'">店舗名</span>

    <!-- セパレータ -->
    <span class="text-white-50">|</span>

    <!-- region: userName (direction=output) -->
    <span class="text-white small"
          th:text="${userName} != null ? ${userName} : '(未ログイン)'">ユーザー名</span>

    <!-- 右端に寄せる spacer -->
    <div class="ms-auto"></div>

    <!-- region: logoutButton (direction=input, events=[click → act-logout]) -->
    <!-- ProcessFlow act-logout: POST /api/retail/auth/logout → redirect:/login -->
    <form th:action="@{/api/retail/auth/logout}" method="post" class="d-inline">
      <input type="hidden" th:name="${_csrf.parameterName}" th:value="${_csrf.token}"/>
      <button type="submit" class="btn btn-outline-light btn-sm">
        ログアウト
      </button>
    </form>

  </div>
</body>
</html>
```

### Controller: `GlobalHeaderGadgetController.java`

```java
package com.example.retail.controller;

import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.servlet.mvc.support.RedirectAttributes;
import org.springframework.ui.Model;

/**
 * Gadget Controller: グローバルヘッダ (global-header-gadget)
 * ProcessFlow: header-gadget-handler (ヘッダーガジェット処理)
 *
 * @see templates/fragments/global-header-gadget.html
 */
@Controller
@RequestMapping("/gadgets/global-header")
public class GlobalHeaderGadgetController {

    /**
     * Gadget fragment のプレビュー確認用 (デバッグ専用)。
     * Fragment 単体を GET で確認できる。
     */
    @GetMapping
    public String preview(Model model) {
        // セッション情報をモデルに設定 (本番は SessionScope Bean / @ModelAttribute で注入)
        model.addAttribute("storeName", "東京本店");
        model.addAttribute("userName", "管理者");
        return "fragments/global-header-gadget";
    }

    // ----------------------------------------------------------------------
    // 注: act-logout (POST /api/retail/auth/logout) の生成は
    //     techStack.auth.method の値に応じて分岐する
    //     (#1039 M-1 解消、#1035 S-3 で方針更新):
    //
    //  - techStack.auth.method = "session" (Spring Security 利用):
    //      → 本 GadgetController には logout メソッドを生成しない。
    //        さらに AuthController.java も生成しない (`/generate-code`
    //        SKILL.md Step 3-A §3「AuthController.java は生成しない、
    //        LogoutFilter 一本化」参照)。
    //        POST /api/retail/auth/logout は SecurityConfig の
    //        `.logoutRequestMatcher(...)` で登録された Spring Security の
    //        `LogoutFilter` が DispatcherServlet より先回りで処理し、
    //        `SecurityContextHolder.clearContext()` + `HttpSession.invalidate()` +
    //        JSESSIONID 削除 + `logoutSuccessUrl` (`/login?logout`) redirect を
    //        実行する (Controller 不要)。
    //
    //  - techStack.auth.method = "none" or 未設定 (Spring Security 不在):
    //      → 下記コメントアウトされた logout メソッドを GadgetController 側で
    //        有効化し、HttpSession.invalidate() で素朴に redirect する。
    //
    // session 時に GadgetController 側にも logout を生成すると Spring の
    // `RequestMappingHandlerMapping` が同 path の二重定義で起動失敗するため、
    // 必ず LogoutFilter 経路のみとする (Controller 二重定義禁止)。
    // ----------------------------------------------------------------------

    /*
     * // auth.method=none 時のみ有効化:
     * @PostMapping("/api/retail/auth/logout")
     * public String logout(HttpSession session,
     *                      RedirectAttributes redirectAttributes) {
     *     session.invalidate();
     *     return "redirect:/login";
     * }
     */

}
```

---

## 完成テンプレート例 — ナビゲーションサイドバー Gadget

**対象**: `screens/navigation-sidebar-gadget.json` (ナビゲーションサイドバー)
- items: navProductSearch / navOrderList / navCustomerList / navMasterManagement (全て input、events なし)
- processFlowId: なし (design-only Gadget → Controller 生成しない)

### Fragment HTML: `templates/fragments/navigation-sidebar-gadget.html`

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org" lang="ja">
<head></head>
<body>
  <!--
    Gadget fragment: navigation-sidebar-gadget
    name: ナビゲーションサイドバー
    processFlowId: なし (design-only、Controller 不要)
    parent layout から th:replace で差し込まれる
  -->
  <div th:fragment="gadget" class="d-flex flex-column gap-2">

    <p class="text-muted small fw-semibold mb-1">メニュー</p>

    <!-- navProductSearch (direction=input、ナビリンク) -->
    <a href="/products/search"
       th:classappend="${#strings.startsWith(#httpServletRequest.requestURI, '/products/search')} ? ' active' : ''"
       class="btn btn-outline-secondary btn-sm text-start">
      商品検索
    </a>

    <!-- navOrderList (direction=input、ナビリンク) -->
    <a href="/orders"
       th:classappend="${#strings.startsWith(#httpServletRequest.requestURI, '/orders')} ? ' active' : ''"
       class="btn btn-outline-secondary btn-sm text-start">
      注文一覧
    </a>

    <!-- navCustomerList (direction=input、ナビリンク) -->
    <a href="/master/customers"
       th:classappend="${#strings.startsWith(#httpServletRequest.requestURI, '/master/customers')} ? ' active' : ''"
       class="btn btn-outline-secondary btn-sm text-start">
      顧客一覧
    </a>

    <!-- navMasterManagement (direction=input、ナビリンク) -->
    <a href="/master/products"
       th:classappend="${#strings.startsWith(#httpServletRequest.requestURI, '/master/products')} ? ' active' : ''"
       class="btn btn-outline-secondary btn-sm text-start">
      マスタ管理
    </a>

  </div>
</body>
</html>
```

Controller は生成しない (processFlowId なし)。

---

## 完成テンプレート例 — グローバルフッタ Gadget

**対象**: `screens/global-footer-gadget.json` (グローバルフッタ)
- items: copyright (output) / version (output)
- processFlowId: なし

### Fragment HTML: `templates/fragments/global-footer-gadget.html`

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org" lang="ja">
<head></head>
<body>
  <!--
    Gadget fragment: global-footer-gadget
    name: グローバルフッタ
    processFlowId: なし (design-only)
  -->
  <div th:fragment="gadget" class="container-fluid">

    <!-- copyright (direction=output) -->
    <p class="mb-1 text-muted small"
       th:text="${copyright} != null ? ${copyright} : '© 2026 Harmony Retail Inc.'">
      © 2026 Harmony Retail Inc.
    </p>

    <!-- version (direction=output) -->
    <!-- 注: CommonModelAdvice は @ModelAttribute("version") で登録するため model 属性名は "version"。
         過去テンプレで `${appVersion}` を参照していたが #1039 M-2 で修正済。 -->
    <p class="mb-0 text-muted small"
       th:text="${version} != null ? ${version} : 'v1.0.0'">
      v1.0.0
    </p>

  </div>
</body>
</html>
```

---

## AI コード生成時の置換ルール

| placeholder | 置換値 |
|---|---|
| `<<gadgetId>>` | `Screen.id` |
| `<<gadgetName>>` | `Screen.name` |
| `<<processFlowId>>` | `Screen.processFlowId` (なければコメント削除) |
| `<<GadgetName>>` | `Screen.name` を PascalCase に変換 |
| `<<gadgetBasePath>>` | `/gadgets/<kebab-case-name>` |
| `<<httpRoutePath>>` | `ProcessFlow.actions[handlerActionId].httpRoute.path` |
| `<<redirectTo>>` | ProcessFlow action の outputs[name=redirectTo] から推定 (通例 `/login`) |

### Controller クラス名の変換規則

| Screen.name | Controller クラス名 |
|---|---|
| `グローバルヘッダ` | `GlobalHeaderGadgetController` |
| `ナビゲーションサイドバー` | `NavigationSidebarGadgetController` |
| `グローバルフッタ` | `GlobalFooterGadgetController` |

変換手順: Screen.name を英語 PascalCase に変換 (日本語のままの場合は transliteration または意味訳) + `GadgetController` サフィックス。

---

## processFlowId 連携パターン

### events[].handlerActionId を持つ input item → `<form>` 生成

```html
<!-- item: <itemId> (direction=input, events=[{id:"click", handlerFlowId:"<flowId>", handlerActionId:"<actionId>"}]) -->
<form th:action="@{<<httpRoute.path>>}" method="post" class="d-inline">
  <input type="hidden" th:name="${_csrf.parameterName}" th:value="${_csrf.token}"/>
  <button type="submit" class="btn btn-outline-light btn-sm"><<item.label>></button>
</form>
```

`httpRoute.path` は `ProcessFlow.actions[handlerActionId].httpRoute.path` から取得する。

### events[] が存在しない input item → ナビゲーションリンク生成

```html
<!-- item: <itemId> (direction=input、eventsなし → ナビリンク) -->
<a href="<<item.description から path を推定>>" class="btn btn-outline-secondary btn-sm text-start">
  <<item.label>>
</a>
```

items[].description に `(/path/to/page)` パターンが含まれる場合は正規表現で抽出する。

---

## Placeholder 解釈ルール (AI コード生成時必読)

本テンプレートでは **`<<...>>`** を AI が値で置換する placeholder として使用する。

| テンプレート記法 | 置換後の出力例 |
|---|---|
| `th:action="@{<<httpRoute.path>>}"` | `th:action="@{/api/retail/auth/logout}"` |
| `fragments/<<gadgetId>> :: gadget` | `fragments/global-header-gadget :: gadget` |
| `return "redirect:<<redirectTo>>"` | `return "redirect:/login"` |

`<<...>>` のまま Thymeleaf テンプレートや Java ソースに出力してはならない。

---

## 注記: Spring Boot 設定ファイルの日本語値

Gadget Controller が `@Value` で参照する設定値や、Gadget が表示する固定文言を `application.properties` に直接書くと **文字化け** する (Spring Boot の `PropertiesPropertySourceLoader` は ISO-8859-1 default。PR #1034 dogfood 検出)。

- **推奨**: Java source の `@Value("${key:日本語デフォルト}")` で hardcode (UTF-8 source)
- **代替**: `application.yml` (UTF-8 default) を採用
- **必須**: `server.servlet.encoding.charset=UTF-8` / `force=true` / `spring.thymeleaf.encoding=UTF-8` の 3 行

詳細: `ai-skills/generate-code/SKILL.md` の「Spring Boot 設定ファイル — 日本語値の取り扱い」セクションを参照。
