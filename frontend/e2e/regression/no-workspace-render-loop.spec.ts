/**
 * Regression — workspace re-render loop (#1299 I-7 Phase D)
 *
 * 背景:
 *   #1296 I-4 リリース後、Playwright headless で /w/:wsId/* ページを開くと
 *   `[ui-log][flood] workspace/state-change が 1 秒に 25 回以上発生` レベルの
 *   無限 re-render loop が発生し、I-5 (#1297) / I-6 (#1298) の e2e 2 spec が
 *   `test.describe.skip` 化された。
 *
 * 真因 (Phase D 調査結果):
 *   AppShellInner は workspaceState.loading=true で外側 AppShell が splash 描画する間
 *   アンマウントされる。component-local な useRef (initialRestoreDoneRef /
 *   recoveryPendingRef) は remount で初期化されるため、initial-restore 経路の
 *   loadWorkspaces() が loading=true → unmount → remount → ref=false → 再 initial-restore
 *   → loop となる。
 *
 * 修正:
 *   `__initialRestoreDoneWsIds` / `__recoveryPendingWsId` を module-level に持ち、
 *   remount 越しでも持続させる。mcpBridge disconnect 時にクリア。
 *
 * 本 spec は再発防止: workspace 切替後 5 秒滞在で `[ui-log][flood]` が 0 件であることを assert。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, isMcpRunning } from "../helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

test.describe("Regression — workspace re-render loop (#1299 I-7 Phase D)", () => {
  test("/table/list 表示時に ui-log flood が発生しない", async ({ page }) => {
    if (!(await isMcpRunning())) test.skip();

    const floods: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("[ui-log][flood]")) floods.push(m.text());
    });

    const ws = await setupTestWorkspace({
      key: "regression-no-render-loop",
      fromExample: "retail",
    });
    await ws.gotoActive(page, "/table/list");

    // 5 秒滞在 — loop があれば 1 秒に 25-35 回の flood が出る (検出 threshold は 5/s)
    await page.waitForTimeout(5000);

    // flood は 0 件であるべき。
    // 万一 flood が出た場合は __uiLogDump() を出力して原因解析を助ける。
    if (floods.length > 0) {
      const dump = await page.evaluate(() => {
        const w = window as unknown as { __uiLogDump?: () => unknown };
        return typeof w.__uiLogDump === "function" ? w.__uiLogDump() : null;
      });
      console.log("=== ui-log dump (head 50) ===");
      console.log(JSON.stringify(Array.isArray(dump) ? dump.slice(0, 50) : dump, null, 2));
    }

    expect(
      floods,
      `re-render loop regression: ${floods.length} flood warnings observed within 5s.\n` +
        `First 5:\n${floods.slice(0, 5).join("\n")}`,
    ).toEqual([]);
  });

  test("workspace 切替 (新規 wsId) でも flood が発生しない", async ({ page }) => {
    if (!(await isMcpRunning())) test.skip();

    const floods: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("[ui-log][flood]")) floods.push(m.text());
    });

    // 2 つの workspace を順に open する (initial-restore + 切替 両経路をカバー)
    const wsA = await setupTestWorkspace({
      key: "regression-loop-switch-a",
      fromExample: "retail",
    });
    await wsA.gotoActive(page, "/table/list");
    await page.waitForTimeout(2000);

    const wsB = await setupTestWorkspace({
      key: "regression-loop-switch-b",
      fromExample: "retail",
    });
    await wsB.gotoActive(page, "/table/list");
    await page.waitForTimeout(3000);

    if (floods.length > 0) {
      console.log("flood preview:", floods.slice(0, 5).join("\n"));
    }
    expect(floods).toEqual([]);
  });
});
