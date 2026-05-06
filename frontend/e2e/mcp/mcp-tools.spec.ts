/**
 * MCP WebSocket ブリッジ E2E テスト
 *
 * 視点: ブラウザが wsBridge 経由でファイル操作を行う
 * 前提: backend サーバーが ws://localhost:5179 で起動済みであること
 *
 * プロトコルの向き:
 *   ブラウザ → wsBridge: { type: "request", id, method, params }
 *   wsBridge → ブラウザ: { type: "response", id, result } | { type: "broadcast", event, data }
 *
 *   ※ タブ操作コマンド (openTab, switchTab 等) は逆向き (MCP stdio → wsBridge → ブラウザ) なので
 *     このテストスイートでは扱わない。Claude Code 経由でのみ呼び出し可能。
 */

import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { isMcpRunning, sendBrowserRequest } from "./_helpers";


// ─── テスト ─────────────────────────────────────────────────────────────────

test.describe("wsBridge ファイル操作", () => {
  test.beforeEach(async () => {
    const running = await isMcpRunning();
    if (!running) test.skip();
  });

  test("loadProject でプロジェクトデータが返る", async () => {
    const result = await sendBrowserRequest("loadProject");
    // null (ファイルなし) または object (プロジェクトデータ) が返る
    expect(result === null || typeof result === "object").toBe(true);
  });

  test("saveScreen / loadScreen でデータが往復する", async () => {
    const screenId = "e2e-test-screen-001";
    const testData = {
      pages: [{ frames: [{ component: { type: "wrapper", components: [] } }] }],
      styles: [],
      assets: [],
    };

    // 保存
    const saveResult = await sendBrowserRequest("saveScreen", { screenId, data: testData });
    expect((saveResult as { success: boolean }).success).toBe(true);

    // 読み込み
    const loadResult = await sendBrowserRequest("loadScreen", { screenId });
    expect(loadResult).toMatchObject(testData);

    // 後片付け: テスト用ファイルを削除
    const dataDir = path.resolve("../data/screens");
    const filePath = path.join(dataDir, `${screenId}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  test("saveProject / loadProject でデータが往復する", async () => {
    // 既存プロジェクトを退避
    const original = await sendBrowserRequest("loadProject");

    const testProject = {
      version: 1,
      name: "E2Eテスト用プロジェクト",
      screens: [],
      groups: [],
      edges: [],
      updatedAt: new Date().toISOString(),
    };

    const saveResult = await sendBrowserRequest("saveProject", { project: testProject });
    expect((saveResult as { success: boolean }).success).toBe(true);

    const loadResult = await sendBrowserRequest("loadProject");
    expect((loadResult as { name: string }).name).toBe("E2Eテスト用プロジェクト");

    // 元のプロジェクトを復元
    if (original) {
      await sendBrowserRequest("saveProject", { project: original });
    }
  });

  test("deleteScreen でファイルが削除される", async () => {
    const screenId = "e2e-test-screen-del-001";

    // まず保存
    await sendBrowserRequest("saveScreen", { screenId, data: { pages: [] } });

    // 削除
    const deleteResult = await sendBrowserRequest("deleteScreen", { screenId });
    expect((deleteResult as { success: boolean }).success).toBe(true);

    // 存在しない場合は null が返る
    const loadResult = await sendBrowserRequest("loadScreen", { screenId });
    expect(loadResult).toBeNull();
  });

  /**
   * getFileMtime は本 PR で追加した新しい MCP メソッド。
   * backend が古いビルドで起動していると「未知のメソッド」エラーが返るため、
   * 本テストスイートはその場合は skip する。
   */
  async function supportsGetFileMtime(): Promise<boolean> {
    try {
      await sendBrowserRequest("getFileMtime", { kind: "project" });
      return true;
    } catch (e) {
      if (String(e).includes("未知のリクエストメソッド")) return false;
      return true;
    }
  }

  test.describe("getFileMtime", () => {
    test.beforeEach(async () => {
      const supported = await supportsGetFileMtime();
      if (!supported) test.skip(true, "backend に getFileMtime が実装されていません。再起動してください");
    });

    test("既存スクリーンの mtime が取得できる", async () => {
      const screenId = "e2e-test-mtime-001";
      await sendBrowserRequest("saveScreen", { screenId, data: { pages: [] } });

      const result = (await sendBrowserRequest("getFileMtime", {
        kind: "screen",
        id: screenId,
      })) as { mtime: number | null };
      expect(result.mtime).not.toBeNull();
      expect(typeof result.mtime).toBe("number");

      await sendBrowserRequest("deleteScreen", { screenId });
    });

    test("存在しないファイルは null が返る", async () => {
      const result = (await sendBrowserRequest("getFileMtime", {
        kind: "screen",
        id: "nonexistent-screen-xyz",
      })) as { mtime: number | null };
      expect(result.mtime).toBeNull();
    });

    test("未知の kind は null が返る", async () => {
      const result = (await sendBrowserRequest("getFileMtime", {
        kind: "unknown-kind",
      })) as { mtime: number | null };
      expect(result.mtime).toBeNull();
    });

    test("saveScreen 後の mtime は以前の mtime 以上", async () => {
      const screenId = "e2e-test-mtime-increment-001";
      await sendBrowserRequest("saveScreen", { screenId, data: { pages: [] } });
      const r1 = (await sendBrowserRequest("getFileMtime", {
        kind: "screen",
        id: screenId,
      })) as { mtime: number };

      await new Promise((resolve) => setTimeout(resolve, 50));
      await sendBrowserRequest("saveScreen", {
        screenId,
        data: { pages: [{ frames: [] }] },
      });
      const r2 = (await sendBrowserRequest("getFileMtime", {
        kind: "screen",
        id: screenId,
      })) as { mtime: number };

      expect(r2.mtime).toBeGreaterThanOrEqual(r1.mtime);
      await sendBrowserRequest("deleteScreen", { screenId });
    });
  });

  // ─── Table 操作 ────────────────────────────────────────────────────────────

  test.describe("table ファイル操作", () => {
    test("saveTable / loadTable でデータが往復する", async () => {
      const tableId = "e2e-test-table-001";
      const testData = {
        id: tableId,
        physicalName: "test_users",
        name: "テストユーザー",
        description: "E2E 用",
        columns: [
          { id: "c1", physicalName: "id", name: "ID", dataType: "INTEGER", notNull: true, primaryKey: true },
        ],
        indexes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const saveResult = await sendBrowserRequest("saveTable", { tableId, data: testData });
      expect((saveResult as { success: boolean }).success).toBe(true);

      const loadResult = await sendBrowserRequest("loadTable", { tableId });
      expect(loadResult).toMatchObject(testData);

      // 後片付け
      const filePath = path.resolve("../data/tables", `${tableId}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    test("deleteTable でファイルが削除される", async () => {
      const tableId = "e2e-test-table-del-001";
      await sendBrowserRequest("saveTable", {
        tableId,
        data: { id: tableId, physicalName: "tmp", name: "tmp", columns: [], indexes: [] },
      });

      const deleteResult = await sendBrowserRequest("deleteTable", { tableId });
      expect((deleteResult as { success: boolean }).success).toBe(true);

      const loadResult = await sendBrowserRequest("loadTable", { tableId });
      expect(loadResult).toBeNull();
    });

    test("存在しない tableId の loadTable は null", async () => {
      const loadResult = await sendBrowserRequest("loadTable", { tableId: "nonexistent-table-xyz" });
      expect(loadResult).toBeNull();
    });
  });

  // ─── ProcessFlow 操作 ─────────────────────────────────────────────────────

  test.describe("processFlow ファイル操作", () => {
    test("saveProcessFlow / loadProcessFlow でデータが往復する", async () => {
      const id = "e2e-test-ag-001";
      const testData = {
        id,
        name: "E2E テストフロー",
        type: "screen",
        description: "",
        actions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const saveResult = await sendBrowserRequest("saveProcessFlow", { id, data: testData });
      expect((saveResult as { success: boolean }).success).toBe(true);

      const loadResult = await sendBrowserRequest("loadProcessFlow", { id });
      expect(loadResult).toMatchObject(testData);

      // 後片付け
      const filePath = path.resolve("../data/process-flows", `${id}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    test("deleteProcessFlow でファイルが削除される", async () => {
      const id = "e2e-test-ag-del-001";
      await sendBrowserRequest("saveProcessFlow", {
        id,
        data: { id, name: "tmp", type: "screen", description: "", actions: [] },
      });

      const deleteResult = await sendBrowserRequest("deleteProcessFlow", { id });
      expect((deleteResult as { success: boolean }).success).toBe(true);

      const loadResult = await sendBrowserRequest("loadProcessFlow", { id });
      expect(loadResult).toBeNull();
    });

    test("存在しない id の loadProcessFlow は null", async () => {
      const loadResult = await sendBrowserRequest("loadProcessFlow", { id: "nonexistent-ag-xyz" });
      expect(loadResult).toBeNull();
    });
  });
});
