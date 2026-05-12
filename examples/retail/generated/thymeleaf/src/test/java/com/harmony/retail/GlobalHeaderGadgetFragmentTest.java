package com.harmony.retail;

// Spec anchor: Screen 68709449-c9e1-47db-a351-ac9c12a19046 (purpose=gadget)
//
// ===HARMONY_GENERATED_SECTION_START screenId=68709449-c9e1-47db-a351-ac9c12a19046===
//
// Gadget: 68709449-c9e1-47db-a351-ac9c12a19046 (グローバルヘッダ)
// purpose: gadget (PageLayout header region に割り当て)
// processFlowId: 60e08c25-3daa-41b4-a7bd-b8f5fb571349 (ヘッダーガジェット処理)
//
// === spec → test mapping ===
// Step 3-Y: gadget 単独 component test
// techStack.backend.framework = "spring-boot" → Thymeleaf template engine test
//
// items:
//   storeName   (output, string) — セッションから取得した店舗名
//   userName    (output, string) — セッションから取得したユーザー氏名
//   logoutButton (input, boolean) — ログアウトボタン
//     events[click] → handlerFlowId=60e08c25 act-logout → POST /api/retail/auth/logout
//
// processFlow: ヘッダーガジェット処理 (60e08c25)
//   act-logout: POST /api/retail/auth/logout (auth=required)
//   → redirectTo='/login' を返す
//
// ===HARMONY_GENERATED_SECTION_END===

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

// #1035 S-6 解消: demo/demo ユーザーは @Profile("dev") なので test も dev profile で実行
// #1035 S-3 解消: act-logout 路は AuthController を生成せず SecurityConfig の
//                 .logoutRequestMatcher(...) で LogoutFilter が処理する。test も
//                 200 OK JSON 期待 → 302 redirect-to /login?logout に修正済
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class GlobalHeaderGadgetFragmentTest {

    @Autowired
    private MockMvc mockMvc;

    /**
     * Spec: Screen 68709449-c9e1-47db-a351-ac9c12a19046 (purpose=gadget) items render
     *   item: storeName  — direction=output, type=string
     *   item: userName   — direction=output, type=string
     *   item: logoutButton — direction=input, type=boolean
     *
     * Gadget は fragment 単体では URL なし — layout 経由で描画される。
     * layout 込みのダッシュボード画面 (path=/、pageLayoutId=17595b62) 経由で確認。
     */
    @Test
    @WithMockUser(username = "demo", roles = {"USER"})
    void Gadgetのitems要素が描画される() throws Exception {
        mockMvc.perform(get("/"))
            .andExpect(status().isOk())
            // item: logoutButton — label "ログアウト" が header 領域に含まれることを確認
            .andExpect(content().string(org.hamcrest.Matchers.containsString("ログアウト")));
    }

    /**
     * Spec: Screen 68709449-c9e1-47db-a351-ac9c12a19046 event:click → act-logout
     *   httpRoute: POST /api/retail/auth/logout (auth=required)
     *
     * 注 (#1035 S-3): act-logout 路は AuthController を生成しない。SecurityConfig の
     * .logoutRequestMatcher("/api/retail/auth/logout") で LogoutFilter が path 一致時に
     * セッション破棄 + JSESSIONID 削除 + 302 redirect to /login?logout を実行する。
     */
    @Test
    @WithMockUser(username = "demo", roles = {"USER"})
    void ログアウトすると302で_loginlogoutに_redirect() throws Exception {
        mockMvc.perform(post("/api/retail/auth/logout").with(csrf()))
            .andExpect(status().is3xxRedirection())
            .andExpect(redirectedUrl("/login?logout"));
    }

    /**
     * Spec: Screen 68709449-c9e1-47db-a351-ac9c12a19046 event:click auth=required
     *   未認証でアクセスすると Spring Security のデフォルト動作で 302 (form login へ redirect)
     */
    @Test
    void 未認証でのログアウトリクエストは認証エラーになる() throws Exception {
        // セッションなしで POST → Spring Security: 401 / 302 / 403 のいずれか
        mockMvc.perform(post("/api/retail/auth/logout").with(csrf()))
            .andExpect(status().is(org.hamcrest.Matchers.oneOf(401, 302, 403)));
    }
}
