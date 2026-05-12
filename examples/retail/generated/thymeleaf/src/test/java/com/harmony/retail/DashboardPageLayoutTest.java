package com.harmony.retail;

// Spec anchor: Screen 765c3c23-8a0e-46b0-ae8b-ce84d10be0b0 layout=17595b62-fef1-4b22-9c25-16736c772567
//
// ===HARMONY_GENERATED_SECTION_START screenId=765c3c23-8a0e-46b0-ae8b-ce84d10be0b0===
//
// Screen: 765c3c23-8a0e-46b0-ae8b-ce84d10be0b0 (ダッシュボード)
// PageLayout: 17595b62-fef1-4b22-9c25-16736c772567 (Main Layout)
//
// === spec → test mapping ===
// Step 3-X: layout 込み page rendering test
// techStack.backend.framework = "spring-boot" → Spring MockMvc rendering test
//
// regions:
//   header   → 68709449-c9e1-47db-a351-ac9c12a19046 (グローバルヘッダ)
//   sidebar  → c1cff7da-1057-4ba1-b780-2d021f6c8679 (ナビゲーションサイドバー)
//   footer   → f7daa764-4015-4ad7-8f0a-142944ea2038 (グローバルフッタ)
//   main     → Page 本文 (ダッシュボード本文コンテンツ)
//
// ===HARMONY_GENERATED_SECTION_END===

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
// #1035 S-3 解消: 認証必須 endpoint は @WithMockUser でクラス全体に認証セッションを付与
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@WithMockUser(username = "demo", roles = {"USER"})
class DashboardPageLayoutTest {

    @Autowired
    private MockMvc mockMvc;

    /**
     * Spec: Screen 765c3c23-8a0e-46b0-ae8b-ce84d10be0b0 layout integration
     *   pageLayoutId=17595b62-fef1-4b22-9c25-16736c772567
     *   regions: header, sidebar, footer, main
     */
    @Test
    void ページリクエストでPageLayoutの外枠が描画される() throws Exception {
        // Screen 765c3c23-8a0e-46b0-ae8b-ce84d10be0b0 (ダッシュボード)
        // path: /
        // auth: required → セッション認証済みの HTTP セッションを設定すること
        //   (認証設定は @WithMockUser または MockHttpSession で対応すること)
        mockMvc.perform(get("/"))
            .andExpect(status().isOk())
            // PageLayout 外枠の region が含まれることを確認
            // region: header — グローバルヘッダ gadget (68709449-c9e1-47db-a351-ac9c12a19046)
            .andExpect(xpath("//nav[contains(@class,'navbar')]").exists())
            // region: sidebar — ナビゲーションサイドバー gadget (c1cff7da-1057-4ba1-b780-2d021f6c8679)
            .andExpect(xpath("//aside").exists())
            // region: main — Page 本文 (ダッシュボード KPI コンテンツ)
            .andExpect(xpath("//main").exists())
            // region: footer — グローバルフッタ gadget (f7daa764-4015-4ad7-8f0a-142944ea2038)
            .andExpect(xpath("//footer").exists());
    }

    /**
     * Spec: Screen 765c3c23-8a0e-46b0-ae8b-ce84d10be0b0 gadget assignments
     *   pageLayoutId=17595b62-fef1-4b22-9c25-16736c772567
     */
    @Test
    void 各regionにGadgetのfragmentが含まれる() throws Exception {
        // region: header → 68709449-c9e1-47db-a351-ac9c12a19046 (グローバルヘッダ)
        // グローバルヘッダ gadget の items: storeName (店舗名), userName (ユーザー名), logoutButton (ログアウト)
        mockMvc.perform(get("/"))
            .andExpect(status().isOk())
            // header gadget の代表要素: logoutButton ラベル "ログアウト" が含まれる
            // (storeName / userName はセッション依存のため静的 label で代替)
            .andExpect(content().string(org.hamcrest.Matchers.containsString("ログアウト")));
    }

    /**
     * Spec: Screen 765c3c23-8a0e-46b0-ae8b-ce84d10be0b0 items (KPI cards)
     *   item: todaySales   — direction=output, type=integer
     *   item: ordersToday  — direction=output, type=integer
     *   item: lowStockCount — direction=output, type=integer
     *   item: dispatchPending — direction=output, type=integer
     */
    @Test
    void KPIカードの表示領域が存在する() throws Exception {
        // Screen 765c3c23-8a0e-46b0-ae8b-ce84d10be0b0 (ダッシュボード) の main 領域内に
        // KPI ラベルが含まれることを確認 (実データは API フロー依存のため label のみ確認)
        mockMvc.perform(get("/"))
            .andExpect(status().isOk())
            // item: todaySales — "今日の売上"
            .andExpect(content().string(org.hamcrest.Matchers.containsString("今日の売上")))
            // item: ordersToday — "本日の注文件数"
            .andExpect(content().string(org.hamcrest.Matchers.containsString("本日の注文件数")));
    }

    /**
     * Spec: Screen 765c3c23-8a0e-46b0-ae8b-ce84d10be0b0 sidebar navigation
     *   region: sidebar → c1cff7da-1057-4ba1-b780-2d021f6c8679 (ナビゲーションサイドバー)
     *   sidebar gadget items: navProductSearch (商品検索), navOrderList (注文一覧)
     */
    @Test
    void サイドバーのナビゲーションリンクが含まれる() throws Exception {
        mockMvc.perform(get("/"))
            .andExpect(status().isOk())
            // sidebar gadget の代表ナビリンク: "商品検索"
            .andExpect(content().string(org.hamcrest.Matchers.containsString("商品検索")));
    }
}
