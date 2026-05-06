import { test, expect } from "@playwright/test";
import { isMcpRunning, sendBrowserRequest } from "./_helpers";

test.describe("wsBridge bulk load (#587)", () => {
  test.beforeEach(async () => {
    const running = await isMcpRunning();
    if (!running) test.skip();
  });

  test("listAllTables は配列を返す", async () => {
    const result = await sendBrowserRequest("listAllTables");
    expect(Array.isArray(result)).toBe(true);
  });

  test("listAllViews は配列を返す", async () => {
    const result = await sendBrowserRequest("listAllViews");
    expect(Array.isArray(result)).toBe(true);
  });
});
