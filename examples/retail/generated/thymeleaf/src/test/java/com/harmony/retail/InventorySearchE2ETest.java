package com.harmony.retail;

// E2E テスト: GET /api/retail/inventory (店舗在庫照会)
//
// ===HARMONY_GENERATED_SECTION_START flowId=efa7ac6e-e295-416e-b68d-17c4739b5097 actionId=act-001===
//
// ProcessFlow: efa7ac6e-e295-416e-b68d-17c4739b5097 (店舗在庫照会)
// Action: act-001 (在庫照会実行)
// httpRoute: GET /api/retail/inventory (auth=optional)
// techStack: java/spring-boot/postgresql
//
// === spec → test mapping ===
// inputs:
//   storeCode (string, required) → Rule A: required → 400
//   productCode (string, optional) → Rule B: regex (@conv.regex.productCode = 'P-' + 4〜6桁数字)
// outputs: items (array), totalCount (integer), rows (array)
// responses: 200-ok, 400-validation, 404-product-not-found
// steps:
//   step-01 (validation): storeCode required + productCode regex
//   step-02 (dbAccess SELECT products, runIf=productCode != null): Rule J
//   step-03 (branch): 商品なし → 404  Rule D
//   step-04 (dbAccess SELECT inventory+products+stores): Rule F
//   step-05 (branch): 在庫なし → 200 OK 空配列
//   step-06 (compute): isLowStock フラグ付与: Rule K
//   step-07 (branch): 低在庫検出イベント発行
//   step-08 (eventPublish): retail.inventory.searched
//   step-09 (compute): rows = inventoryItems
//   step-10 (return): 200-ok
//
// ===HARMONY_GENERATED_SECTION_END===

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

// #1035 S-6 解消: demo/demo ユーザーは @Profile("dev") なので test も dev profile で実行
// #1035 S-3 解消: auth=optional でも Spring Security 経由なので @WithMockUser でセッション付与
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@WithMockUser(username = "demo", roles = {"USER"})
class InventorySearchE2ETest {

    @Autowired
    private MockMvc mockMvc;

    // -----------------------------------------------------------------------
    // セットアップ / クリーンアップ
    // -----------------------------------------------------------------------
    @BeforeEach
    void setUp() {
        // テストデータのシード (実際のプロジェクトでは TestContainers や DBUnit で制御)
        // happy-path testScenario (happy-path-store-only) に基づくシードデータ:
        //   products: P-0001 (サンプル商品A, 1000円), P-0002 (サンプル商品B, 2000円)
        //   stores:   S-001 (新宿店)
        //   inventory: S-001/P-0001 qty=50, S-001/P-0002 qty=8 (低在庫閾値<=10)
        // ※実装時は INSERT SQL または JPA saveAll() に置き換える
    }

    @AfterEach
    void tearDown() {
        // テストデータのクリーンアップ
        // ※実装時は DELETE SQL または JPA deleteAll() に置き換える
    }

    // -----------------------------------------------------------------------
    // #1 Happy path (店舗コードのみ → 200 OK 在庫一覧)
    // -----------------------------------------------------------------------

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001 step-10
     *   happy path: storeCode のみ指定 → 200 OK { items, totalCount }
     *   testScenario: happy-path-store-only (totalCount=2)
     */
    @Test
    void ハッピーパス_店舗コードのみで在庫一覧が返る() throws Exception {
        // Spec: ProcessFlow efa7ac6e act-001 step-10 (return) responseId=200-ok
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", "S-001"))
            .andExpect(status().isOk())
            // outputs: totalCount (integer)
            .andExpect(jsonPath("$.totalCount").isNumber())
            // outputs: items (array)
            .andExpect(jsonPath("$.items").isArray());
    }

    // -----------------------------------------------------------------------
    // #2 Validation: storeCode 欠落 → 400
    // -----------------------------------------------------------------------

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001 step-01
     *   validation rule: storeCode required
     *   testScenario: validation-error-no-store-code
     */
    @Test
    void バリデーション_storeCode欠落で400() throws Exception {
        // Spec: ProcessFlow efa7ac6e act-001 step-01 rule: storeCode required → 400
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", ""))
            // context.catalogs.errors.VALIDATION_ERROR.httpStatus = 400
            .andExpect(status().isBadRequest());
    }

    // -----------------------------------------------------------------------
    // #3 Validation: productCode パターン違反 → 400
    // -----------------------------------------------------------------------

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001 step-01
     *   validation rule: productCode regex (@conv.regex.productCode = 'P-\d{4,6}')
     *   パターン違反: "INVALID-CODE" → 400
     */
    @Test
    void バリデーション_productCode形式違反で400() throws Exception {
        // Spec: ProcessFlow efa7ac6e act-001 step-01 rule: productCode regex
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", "S-001")
                .param("productCode", "INVALID-CODE"))
            // context.catalogs.errors.VALIDATION_ERROR.httpStatus = 400
            .andExpect(status().isBadRequest());
    }

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001 step-01
     *   validation rule: productCode regex — 境界値 OK: 'P-0001' (4桁) → 200
     */
    @Test
    void バリデーション_productCode正しい形式で200() throws Exception {
        // Spec: ProcessFlow efa7ac6e act-001 step-01 productCode regex 境界値 OK (4桁)
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", "S-001")
                .param("productCode", "P-0001"))
            .andExpect(status().isOk());
    }

    // -----------------------------------------------------------------------
    // #4 404: 存在しない商品コード
    // -----------------------------------------------------------------------

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001 step-02/step-03
     *   step-02 runIf=productCode != null: products テーブルを検索
     *   step-03 branch: 商品なし → 404
     *   testScenario: product-not-found-404
     */
    @Test
    void 存在しない商品コードで404() throws Exception {
        // Spec: ProcessFlow efa7ac6e act-001 step-03 branch: 商品なし → 404-product-not-found
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", "S-001")
                .param("productCode", "P-9999"))
            // context.catalogs.errors.PRODUCT_NOT_FOUND.httpStatus = 404
            .andExpect(status().isNotFound());
    }

    // -----------------------------------------------------------------------
    // #5 runIf=false: productCode 未指定 → step-02 スキップ → 200
    // -----------------------------------------------------------------------

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001 step-02
     *   runIf="@inputs.productCode != null && @inputs.productCode !== ''"
     *   runIf=false: productCode 未指定 → products テーブルを検索しない → 200 (空配列ではなく全在庫)
     */
    @Test
    void runIfFalse_productCode未指定でstep02スキップ() throws Exception {
        // Spec: ProcessFlow efa7ac6e act-001 step-02 runIf=false (productCode 未指定)
        // step-02 をスキップして step-04 の全在庫検索へ進む
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", "S-001"))
            // runIf=false → products 存在確認をスキップして在庫を返す
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items").isArray());
    }

    // -----------------------------------------------------------------------
    // #6 低在庫フラグ: quantity_available <= lowStockThreshold → isLowStock=true
    // -----------------------------------------------------------------------

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001 step-06
     *   kind=compute: @inventoryRows.map(r => ({ ...r, isLowStock: r.quantityAvailable <= @conv.limit.lowStockThreshold }))
     *   testScenario: low-stock-flag-set (quantity_available=8, threshold=10 → isLowStock=true)
     */
    @Test
    void 低在庫フラグ_quantityAvailable10以下でisLowStockTrue() throws Exception {
        // Spec: ProcessFlow efa7ac6e act-001 step-06 compute (isLowStock フラグ)
        // quantity_available=8 <= lowStockThreshold(10) → isLowStock=true
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", "S-001")
                .param("productCode", "P-0002"))  // qty=8 の商品 (setUp データ)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].isLowStock").value(true));
    }

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001 step-06
     *   kind=compute: isLowStock フラグ
     *   quantity_available=50 > lowStockThreshold(10) → isLowStock=false
     */
    @Test
    void 低在庫フラグ_quantityAvailable10超でisLowStockFalse() throws Exception {
        // Spec: ProcessFlow efa7ac6e act-001 step-06 compute (isLowStock=false)
        // quantity_available=50 > 10 → isLowStock=false
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", "S-001")
                .param("productCode", "P-0001"))  // qty=50 の商品 (setUp データ)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].isLowStock").value(false));
    }

    // -----------------------------------------------------------------------
    // #7 在庫 0 件 → 200 OK (空配列)
    // -----------------------------------------------------------------------

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001 step-05
     *   branch: 在庫なし (inventoryRows.length === 0)
     *   → step-05-a-01 eventPublish: retail.inventory.not_found
     *   → step-05-a-02 compute: rows = []
     *   → step-05-a-03 return: 200-ok { items: [], totalCount: 0 }
     *
     * ADR-003: 在庫 0 件は 404 でなく 200 OK (items: [])
     */
    @Test
    void 在庫0件は200OKで空配列を返す() throws Exception {
        // 存在しない店舗コードで在庫 0 件を誘起
        // step-05-a-03 return: 200-ok { items: [], totalCount: 0 }
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", "S-NONEXISTENT"))
            // ADR-003: 0 件は 404 でなく 200 OK
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalCount").value(0))
            .andExpect(jsonPath("$.items").isEmpty());
    }

    // -----------------------------------------------------------------------
    // #8 outputs 型 assertion
    // -----------------------------------------------------------------------

    /**
     * Spec: ProcessFlow efa7ac6e-e295-416e-b68d-17c4739b5097 act-001
     *   outputs: totalCount (integer) → typeof === 'number'
     *   outputs: items (array) → Array.isArray
     */
    @Test
    void outputs_totalCountが整数でitemsが配列() throws Exception {
        // Rule C: outputs → response.body assertion
        mockMvc.perform(get("/api/retail/inventory")
                .param("storeCode", "S-001"))
            .andExpect(status().isOk())
            // outputs.totalCount: integer
            .andExpect(jsonPath("$.totalCount").isNumber())
            // outputs.items: array
            .andExpect(jsonPath("$.items").isArray());
    }
}
