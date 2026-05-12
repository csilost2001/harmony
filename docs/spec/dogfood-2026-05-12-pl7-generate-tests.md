# Dogfood Report — /generate-tests skill 実機検証 (pl-7 対応)

**日付**: 2026-05-12
**対象**: `.claude/skills/generate-tests/SKILL.md` Step 3-X / 3-Y / Step 3 (ProcessFlow)
**入力**: examples/retail から 3 entity (Page+Layout / Gadget / ProcessFlow)
**実施者**: Sonnet sub-agent (ISSUE #1035 sub-section A)
**ブランチ**: `feat/issue-1035-codegen-followups`

## 1. dogfood 環境

- WSL Linux (6.6.114.1-microsoft-standard-WSL2): Java/Maven なし (`mvn` / `java` / `javac` 未インストール)
- frontend: vitest / playwright あり (retail は Thymeleaf 系のため frontend test は scope outside)
- docker 28.3.0 あり (本 dogfood では未使用)
- **実機 maven test run は本 dogfood scope outside** (環境準備込みで別 ISSUE 起票で trace — **ISSUE #1037 (docker maven image smoke build)** で完遂予定)
- **dogfood 方法**: SKILL.md Step 手順を AI が手動で辿り test ファイルを生成 → structure 検証 (placeholder/anchor/import/xpath/gadget marker/日本語テスト名) により「skill 手順の AI 実行可能性検証」を実施

## 2. 生成 test 一覧

### 2-1. Step 3-X: PageLayout + Page Screen ペア

**入力**:
- Screen: `765c3c23-8a0e-46b0-ae8b-ce84d10be0b0` (ダッシュボード, purpose=page, path=/)
- PageLayout: `17595b62-fef1-4b22-9c25-16736c772567` (Main Layout, regions: header/sidebar/footer/main)
- assignments: header=68709449 (グローバルヘッダ), sidebar=c1cff7da (ナビゲーションサイドバー), footer=f7daa764 (グローバルフッタ)

**生成ファイル**:
- `.tmp/dogfood-1035-A/page-layout/765c3c23/DashboardPageLayoutTest.java`
- 行数: 106行
- テスト数: 4件

**テスト一覧**:

| # | メソッド名 | spec anchor |
|---|---|---|
| 1 | ページリクエストでPageLayoutの外枠が描画される | Screen 765c3c23 layout integration regions: header/sidebar/footer/main |
| 2 | 各regionにGadgetのfragmentが含まれる | Screen 765c3c23 gadget assignments |
| 3 | KPIカードの表示領域が存在する | Screen 765c3c23 items: todaySales / ordersToday |
| 4 | サイドバーのナビゲーションリンクが含まれる | Screen 765c3c23 sidebar gadget c1cff7da |

**生成テスト抜粋** (region xpath pattern):

```java
// region: header — グローバルヘッダ gadget (68709449-c9e1-47db-a351-ac9c12a19046)
.andExpect(xpath("//nav[contains(@class,'navbar')]").exists())
// region: sidebar — ナビゲーションサイドバー gadget (c1cff7da-1057-4ba1-b780-2d021f6c8679)
.andExpect(xpath("//aside").exists())
// region: main — Page 本文 (ダッシュボード KPI コンテンツ)
.andExpect(xpath("//main").exists())
// region: footer — グローバルフッタ gadget (f7daa764-4015-4ad7-8f0a-142944ea2038)
.andExpect(xpath("//footer").exists());
```

**Checklist**:

| # | 項目 | 結果 |
|---|---|---|
| 1 | `<<...>>` placeholder が残っていない (grep 0件) | PASS |
| 2 | Spec anchor コメント (`HARMONY_GENERATED_SECTION_START`) が入っている | PASS |
| 3 | 適切な import (`@SpringBootTest`, `@AutoConfigureMockMvc`) | PASS |
| 4 | Bootstrap region 規約 xpath (`//nav[contains(@class,'navbar')]`, `//aside`, `//main`, `//footer`) | PASS |
| 5 | assignments Gadget の代表要素マッチが含まれる (`"ログアウト"`, `"商品検索"`) | PASS |
| 6 | テスト名が日本語 | PASS |

**Checklist: 6/6 PASS**

---

### 2-2. Step 3-Y: Gadget 単独

**入力**:
- Gadget Screen: `68709449-c9e1-47db-a351-ac9c12a19046` (グローバルヘッダ, purpose=gadget)
- processFlowId: `60e08c25-3daa-41b4-a7bd-b8f5fb571349` (ヘッダーガジェット処理)
- act-logout: POST /api/retail/auth/logout (auth=required)
- items: storeName (output), userName (output), logoutButton (input, events[click] → act-logout)

**生成ファイル**:
- `.tmp/dogfood-1035-A/gadget/68709449/GlobalHeaderGadgetFragmentTest.java`
- 行数: 113行
- テスト数: 4件

**テスト一覧**:

| # | メソッド名 | spec anchor |
|---|---|---|
| 1 | Gadgetのitems要素が描画される | Screen 68709449 items render (storeName/userName/logoutButton) |
| 2 | ログアウトアクションが正常に処理される | Screen 68709449 event:click → act-logout POST /api/retail/auth/logout |
| 3 | 未認証でのログアウトリクエストは認証エラーになる | httpRoute.auth="required" 未認証 → 401/302/403 |
| 4 | ログアウト成功時にredirectToがloginを返す | ProcessFlow 60e08c25 act-logout step-02 (return) redirectTo="/login" |

**生成テスト抜粋** (ログアウト成功時の body assertion):

```java
// Spec: ProcessFlow 60e08c25 act-logout step-02 (return) responseId=200-ok
//   bodyExpression: { redirectTo: @redirectTo }
//   step-01 compute: redirectTo = '/login'
.andExpect(jsonPath("$.redirectTo").value("/login"));
```

**Checklist: 6/6 PASS**

---

### 2-3. Step 3 (ProcessFlow): 店舗在庫照会

**入力**:
- ProcessFlow: `efa7ac6e-e295-416e-b68d-17c4739b5097` (店舗在庫照会)
- action act-001: GET /api/retail/inventory (auth=optional)
- inputs: storeCode (required), productCode (optional, regex)
- techStack: java/spring-boot/postgresql

**生成ファイル**:
- `.tmp/dogfood-1035-A/process-flow/efa7ac6e/InventorySearchE2ETest.java`
- 行数: 264行
- テスト数: 9件

**テスト一覧**:

| # | メソッド名 | spec anchor |
|---|---|---|
| 1 | ハッピーパス_店舗コードのみで在庫一覧が返る | act-001 step-10 return 200-ok |
| 2 | バリデーション_storeCode欠落で400 | act-001 step-01 rule: required |
| 3 | バリデーション_productCode形式違反で400 | act-001 step-01 rule: regex |
| 4 | バリデーション_productCode正しい形式で200 | act-001 step-01 boundary OK (4桁) |
| 5 | 存在しない商品コードで404 | act-001 step-03 branch: 商品なし → 404 |
| 6 | runIfFalse_productCode未指定でstep02スキップ | act-001 step-02 runIf=false |
| 7 | 低在庫フラグ_quantityAvailable10以下でisLowStockTrue | act-001 step-06 compute isLowStock |
| 8 | 低在庫フラグ_quantityAvailable10超でisLowStockFalse | act-001 step-06 compute isLowStock=false |
| 9 | 在庫0件は200OKで空配列を返す | act-001 step-05 branch: 在庫なし → ADR-003 |
| 10 | outputs_totalCountが整数でitemsが配列 | act-001 outputs assertion |

**Checklist: 6/6 PASS**

---

## 3. skill 修正候補と対処

### 3-1. 発見した改善点

#### 修正 A: Step 3-X テンプレートに auth=required の注記を追加 (実施済み)

**問題**: Step 3-X の Spring MockMvc テンプレートで `mockMvc.perform(get("<screen.path>"))` が
auth=required の Screen に対して認証なしで実行されるテンプレートになっており、
実際に run すると Spring Security フィルタで 302/401 が返りテストが fail する。

**修正**: SKILL.md Step 3-X テンプレートの `mockMvc.perform(get(...))` 直前に
`@WithMockUser` または `mockMvc.perform(...with(user("testUser")))` の注記コメントを追加。

#### 修正 B: Step 3-X の PLACEHOLDER 解決ガイドを拡充 (実施済み)

**問題**: `<headerGadgetMarker>` の解決ガイドが「label から選んでください」の 1 行のみで、
- `<screen.path>` の置き換えガイドが無い
- セッション依存の動的テキスト (storeName/userName) をどう扱うか説明がない
- auth=required 画面での Spring Security 挙動が言及されていない

**修正**: PLACEHOLDER 解決ガイドを 5 点箇条書きに拡充。

#### 修正 C: Step 3-Y テンプレートに `未認証テスト` パターンを追加 (実施済み)

**問題**: Gadget の processFlowId に紐づく action が `httpRoute.auth="required"` の場合、
未認証テスト (401/302/403 確認) のパターンがテンプレートに無く、AI が自力で追加するか
見落とすかの判断が曖昧になる。

**修正**: Step 3-Y テンプレートに `// httpRoute.auth="required" の場合のみ生成` コメント付きで
`未認証でのGadgetアクションは認証エラーになる` テストパターンを追加。

### 3-2. 修正完了 (本 PR 吸収 / 別 ISSUE 起票で trace)

#### 候補 D-X: Spring Security 認証済みセッションでの MockMvc テストヘルパ → **本 PR 吸収済**

`@WithMockUser` / `SecurityMockMvcRequestPostProcessors.user()` を使った認証済みセッション設定の
具体的なテンプレート例を `.claude/skills/generate-tests/SKILL.md` Step 3-X 内
「Spring Security 認証済みセッションでの MockMvc テストヘルパ」セクションとして追加 (本 PR 内)。
3 パターン (`@WithMockUser` annotation / `SecurityMockMvcRequestPostProcessors.user(...)` /
クラスレベル annotation) + 必要 `pom.xml` 依存も明示。

**注**: ISSUE #1035 sub-section D (Spring Security 本体実装) と混同しないこと。

#### 候補 E: `<gadgetActionName>` の変数名解決ガイド (NestJS 系 vitest テンプレート) → **ISSUE #1038 で trace**

NestJS/Next.js 系の Step 3-Y テンプレートで `<gadgetActionName>` が processFlowId / actionId
からどう命名するかのガイドが不明確。本 dogfood は Thymeleaf 系のみ実行したため、NestJS 系の
実機 dogfood は **ISSUE #1038 (NestJS/Next.js 系 dogfood)** で trace。

## 4. 実機 maven test 実行 (smoke 検証)

**結果**: 本 dogfood では未実行 (WSL 環境に Java 21 / Maven 未インストール、docker setup 別工程)

**trace**: **ISSUE #1037 (docker maven image で smoke build + Spring Security 実機検証)** で完遂予定

**推奨コマンド** (#1037 内で実行):
```bash
cd examples/retail/generated/thymeleaf
docker run --rm -v "$(pwd)":/app -w /app maven:3.9-eclipse-temurin-21 mvn -B clean compile
docker run --rm -v "$(pwd)":/app -w /app maven:3.9-eclipse-temurin-21 mvn -B test
```

## 5. 関連 ISSUE で trace される分

| 領域 | ISSUE | スコープ |
|---|---|---|
| 実機 maven test + Spring Security 動作検証 | **#1037** | docker maven image で `examples/retail/generated/thymeleaf/` smoke build + login/logout 動作確認 |
| NestJS 系 session 認証テンプレ | **#1036** | SKILL.md に passport + express-session ベースの NestJS 認証テンプレ追加 |
| NestJS/Next.js 系での `/generate-tests` 実機 dogfood | **#1038** | examples/english-learning-tailwind 等で vitest/Playwright 実機 run + skill 修正 |

「将来対応」「future enhancement」「follow-up」表現は本 PR で全消去済。trace されない放置項目は無い。
