/**
 * renameScreenItemId / checkScreenItemRefs の単体テスト (#332)。
 *
 * projectStorage をインメモリ実装でモックして実行する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CheckRefsResult, RenameResult } from "./renameScreenItem.js";

// ── インメモリストレージ ──────────────────────────────────────────────────

const store: {
  screenItems: Record<string, unknown>;
  screens: Record<string, unknown>;
  processFlows: Record<string, unknown>;
} = {
  screenItems: {},
  screens: {},
  processFlows: {},
};

function resetStore() {
  store.screenItems = {};
  store.screens = {};
  store.processFlows = {};
}

// #700 R-2: mocks accept `root` as ignored extra arg (signatures now require root)
vi.mock("./projectStorage.js", () => ({
  readScreenItems:  (id: string, _root?: string) => Promise.resolve(store.screenItems[id] ?? null),
  writeScreenItems: (id: string, data: unknown, _root?: string) => { store.screenItems[id] = data; return Promise.resolve(); },
  readScreen:       (id: string, _root?: string) => Promise.resolve(store.screens[id] ?? null),
  writeScreen:      (id: string, data: unknown, _root?: string) => { store.screens[id] = data; return Promise.resolve(); },
  listProcessFlows: (_root?: string) => Promise.resolve(Object.values(store.processFlows)),
  readProcessFlow:  (id: string, _root?: string) => Promise.resolve(store.processFlows[id] ?? null),
  writeProcessFlow: (id: string, data: unknown, _root?: string) => { store.processFlows[id] = data; return Promise.resolve(); },
}));

import { checkScreenItemRefs, renameScreenItemId } from "./renameScreenItem.js";

const TEST_ROOT = "/test-root";

// ── フィクスチャ ─────────────────────────────────────────────────────────

const SCREEN_ID = "screen-001";

const BASE_SCREEN_ITEMS = () => ({
  screenId: SCREEN_ID,
  version: "0.1.0",
  updatedAt: "2026-01-01T00:00:00.000Z",
  items: [
    { id: "userName", label: "ユーザー名", type: "string" },
    { id: "password", label: "パスワード",  type: "string" },
  ],
});

const BASE_SCREEN_HTML = () => ({
  pages: [{
    frames: [{
      component: {
        components: `<input name="userName" id="userName" data-item-id="uid-001"><input name="password" id="password" data-item-id="uid-002">`,
      },
    }],
  }],
});

const BASE_PROCESS_FLOW = () => ({
  id: "ag-001",
  name: "ログイン処理",
  type: "screen",
  screenId: SCREEN_ID,
  actions: [{
    id: "act-001",
    name: "ログイン",
    trigger: "click",
    inputs: [
      {
        name: "userName",
        label: "ユーザー名",
        type: "string",
        screenItemRef: { screenId: SCREEN_ID, itemId: "userName" },
      },
      {
        name: "password",
        label: "パスワード",
        type: "string",
        screenItemRef: { screenId: SCREEN_ID, itemId: "password" },
      },
    ],
  }],
  updatedAt: "2026-01-01T00:00:00.000Z",
});

beforeEach(() => resetStore());

// ---------------------------------------------------------------------------
// checkScreenItemRefs
// ---------------------------------------------------------------------------
describe("checkScreenItemRefs", () => {
  it("ProcessFlow なし → totalRefs=0", async () => {
    store.screenItems[SCREEN_ID] = BASE_SCREEN_ITEMS();
    const result = await checkScreenItemRefs(SCREEN_ID, "userName", TEST_ROOT);
    expect(result.totalRefs).toBe(0);
    expect(result.affectedProcessFlows).toHaveLength(0);
  });

  it("1 AG に 1 参照 → 正しくカウント", async () => {
    store.screenItems[SCREEN_ID] = BASE_SCREEN_ITEMS();
    store.processFlows["ag-001"] = BASE_PROCESS_FLOW();
    const result = await checkScreenItemRefs(SCREEN_ID, "userName", TEST_ROOT);
    expect(result.totalRefs).toBe(1);
    expect(result.affectedProcessFlows[0].id).toBe("ag-001");
    expect(result.affectedProcessFlows[0].refCount).toBe(1);
  });

  it("別画面への参照は無視される", async () => {
    store.screenItems[SCREEN_ID] = BASE_SCREEN_ITEMS();
    store.processFlows["ag-other"] = {
      id: "ag-other",
      name: "別画面",
      actions: [{
        inputs: [{
          screenItemRef: { screenId: "other-screen", itemId: "userName" },
        }],
      }],
    };
    const result = await checkScreenItemRefs(SCREEN_ID, "userName", TEST_ROOT);
    expect(result.totalRefs).toBe(0);
  });

  it("参照していない項目 → 0", async () => {
    store.screenItems[SCREEN_ID] = BASE_SCREEN_ITEMS();
    store.processFlows["ag-001"] = BASE_PROCESS_FLOW();
    const result = await checkScreenItemRefs(SCREEN_ID, "address", TEST_ROOT);
    expect(result.totalRefs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// renameScreenItemId — バリデーション
// ---------------------------------------------------------------------------
describe("renameScreenItemId バリデーション", () => {
  beforeEach(() => { store.screenItems[SCREEN_ID] = BASE_SCREEN_ITEMS(); });

  it("newId が空 → エラー", async () => {
    await expect(renameScreenItemId(SCREEN_ID, "userName", "", TEST_ROOT)).rejects.toThrow("newId");
  });

  it("数字始まり → エラー", async () => {
    await expect(renameScreenItemId(SCREEN_ID, "userName", "123abc", TEST_ROOT)).rejects.toThrow("識別子");
  });

  it("ハイフン含む → エラー", async () => {
    await expect(renameScreenItemId(SCREEN_ID, "userName", "has-hyphen", TEST_ROOT)).rejects.toThrow("識別子");
  });

  it("スペース含む → エラー", async () => {
    await expect(renameScreenItemId(SCREEN_ID, "userName", "has space", TEST_ROOT)).rejects.toThrow("識別子");
  });

  it("存在しない oldId → エラー", async () => {
    await expect(renameScreenItemId(SCREEN_ID, "nonExistent", "newName", TEST_ROOT)).rejects.toThrow("見つかりません");
  });

  it("newId が既存 id と衝突 → エラー", async () => {
    await expect(renameScreenItemId(SCREEN_ID, "userName", "password", TEST_ROOT)).rejects.toThrow("既に");
  });

  it("JS 予約語 (let/const 等) → 警告付きで成功", async () => {
    const result = await renameScreenItemId(SCREEN_ID, "userName", "let", TEST_ROOT);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/予約語/);
    expect(result.screenItemsUpdated).toBe(true);
  });

  it("通常識別子 → 警告なし", async () => {
    const result = await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// renameScreenItemId — 正常系
// ---------------------------------------------------------------------------
describe("renameScreenItemId 正常系", () => {
  beforeEach(() => { store.screenItems[SCREEN_ID] = BASE_SCREEN_ITEMS(); });

  it("screen-items の id が更新される", async () => {
    await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    const updated = store.screenItems[SCREEN_ID] as { items: Array<{ id: string }> };
    expect(updated.items.map((i) => i.id)).toContain("loginId");
    expect(updated.items.map((i) => i.id)).not.toContain("userName");
  });

  it("他の項目は変更されない", async () => {
    await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    const updated = store.screenItems[SCREEN_ID] as { items: Array<{ id: string }> };
    expect(updated.items.map((i) => i.id)).toContain("password");
  });

  it("screenItemsUpdated=true を返す", async () => {
    const result = await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    expect(result.screenItemsUpdated).toBe(true);
  });

  it("HTML の name/id 属性が更新される", async () => {
    store.screens[SCREEN_ID] = BASE_SCREEN_HTML();
    const result = await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    expect(result.screenHtmlUpdated).toBe(true);
    const html = (store.screens[SCREEN_ID] as { pages: [{ frames: [{ component: { components: string } }] }] })
      .pages[0].frames[0].component.components;
    expect(html).toContain(`name="loginId"`);
    expect(html).toContain(`id="loginId"`);
    expect(html).not.toContain(`name="userName"`);
    // 他の項目の属性は変わらない
    expect(html).toContain(`name="password"`);
  });

  it("画面ファイルなし → screenHtmlUpdated=false で成功", async () => {
    const result = await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    expect(result.screenItemsUpdated).toBe(true);
    expect(result.screenHtmlUpdated).toBe(false);
  });

  it("AG の screenItemRef.itemId が更新される", async () => {
    store.processFlows["ag-001"] = BASE_PROCESS_FLOW();
    const result = await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    expect(result.processFlowsUpdated).toContain("ag-001");
    expect(result.refsRenamed).toBe(1);
    const ag = store.processFlows["ag-001"] as {
      actions: [{ inputs: [{ screenItemRef: { itemId: string } }] }]
    };
    expect(ag.actions[0].inputs[0].screenItemRef.itemId).toBe("loginId");
  });

  it("同一 AG 内の別項目参照は変更しない", async () => {
    store.processFlows["ag-001"] = BASE_PROCESS_FLOW();
    await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    const ag = store.processFlows["ag-001"] as {
      actions: [{ inputs: Array<{ screenItemRef: { itemId: string } }> }]
    };
    expect(ag.actions[0].inputs[1].screenItemRef.itemId).toBe("password");
  });

  it("別画面への screenItemRef は変更しない", async () => {
    const otherAg = {
      id: "ag-other",
      name: "別画面",
      actions: [{
        inputs: [{
          screenItemRef: { screenId: "other-screen", itemId: "userName" },
        }],
      }],
    };
    store.processFlows["ag-other"] = otherAg;
    store.processFlows["ag-001"] = BASE_PROCESS_FLOW();
    const result = await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    expect(result.processFlowsUpdated).not.toContain("ag-other");
    expect((otherAg.actions[0].inputs[0].screenItemRef as { itemId: string }).itemId).toBe("userName");
  });

  it("AG がない場合でも正常に完了する", async () => {
    const result = await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    expect(result.refsRenamed).toBe(0);
    expect(result.processFlowsUpdated).toHaveLength(0);
  });

  it("連続リネーム (A→B → B→C) が正しく動作する", async () => {
    await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    const result2 = await renameScreenItemId(SCREEN_ID, "loginId", "userId", TEST_ROOT);
    expect(result2.screenItemsUpdated).toBe(true);
    const updated = store.screenItems[SCREEN_ID] as { items: Array<{ id: string }> };
    expect(updated.items.map((i) => i.id)).toContain("userId");
  });
});

// ---------------------------------------------------------------------------
// renameInHtmlString (HTML 属性置換の edge cases)
// ---------------------------------------------------------------------------
describe("HTML 属性置換 edge cases", () => {
  beforeEach(() => { store.screenItems[SCREEN_ID] = BASE_SCREEN_ITEMS(); });

  it("GrapesJS component オブジェクトの attributes.name / id も更新される", async () => {
    store.screens[SCREEN_ID] = {
      pages: [{
        frames: [{
          component: {
            type: "wrapper",
            components: [
              {
                tagName: "input",
                attributes: { name: "userName", id: "userName", "data-item-id": "uid-001", type: "text" },
              },
            ],
          },
        }],
      }],
    };
    const result = await renameScreenItemId(SCREEN_ID, "userName", "loginId", TEST_ROOT);
    expect(result.screenHtmlUpdated).toBe(true);
    const comp = (store.screens[SCREEN_ID] as {
      pages: [{ frames: [{ component: { components: [{ attributes: { name: string; id: string } }] } }] }]
    }).pages[0].frames[0].component.components[0];
    expect(comp.attributes.name).toBe("loginId");
    expect(comp.attributes.id).toBe("loginId");
  });

  it("部分一致は置換しない (textInput は textInput1 を置換しない)", async () => {
    // screen-items に textInput / textInput1 を追加したフィクスチャ
    store.screenItems[SCREEN_ID] = {
      ...BASE_SCREEN_ITEMS(),
      items: [
        { id: "textInput",  label: "テキスト",   type: "string" },
        { id: "textInput1", label: "テキスト1", type: "string" },
      ],
    };
    store.screens[SCREEN_ID] = {
      pages: [{
        frames: [{
          component: {
            components: `<input name="textInput1" id="textInput1"><input name="textInput" id="textInput">`,
          },
        }],
      }],
    };
    // textInput だけリネーム、textInput1 は変わらないはず
    await renameScreenItemId(SCREEN_ID, "textInput", "myField", TEST_ROOT);
    const html = (store.screens[SCREEN_ID] as {
      pages: [{ frames: [{ component: { components: string } }] }]
    }).pages[0].frames[0].component.components;
    expect(html).toContain(`name="textInput1"`);
    expect(html).toContain(`name="myField"`);
    expect(html).not.toContain(`name="textInput"`);
  });
});
