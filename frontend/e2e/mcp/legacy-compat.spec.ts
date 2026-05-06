/**
 * onBehalfOfSession 追加後の後方互換性 smoke テスト (#690 PR-7)
 *
 * PR-7 で lock__acquire / lock__release に onBehalfOfSession (optional) を追加した。
 * 既存 AI ツール呼び出し (onBehalfOfSession なし) が PR-7 後も同じ shape の result を返すことを確認する。
 *
 * 前提: backend が http://localhost:5179/mcp で起動済みであること。
 * 未起動の場合は test.skip() でスキップする。
 */

import { test, expect } from "@playwright/test";
import { isMcpRunning } from "./_helpers";

const MCP_URL = "http://localhost:5179/mcp";

/** MCP Streamable HTTP へ JSON-RPC リクエストを送るヘルパー */
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name, arguments: args },
  });

  let res: Response;
  try {
    res = await fetch(MCP_URL, { method: "POST", headers, body });
  } catch {
    return null;
  }

  const text = await res.text();

  // SSE (Server-Sent Events) レスポンスの場合はパース
  if (text.startsWith("data:")) {
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    if (dataLine) {
      return JSON.parse(dataLine.slice("data:".length).trim());
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

test.describe("onBehalfOfSession 後方互換性 smoke", () => {
  test.beforeEach(async () => {
    const running = await isMcpRunning();
    if (!running) test.skip();
  });

  test("既存 lock__acquire (onBehalfOfSession なし) — result shape 変わらず", async () => {
    const resourceId = `compat-${Date.now()}`;
    const sessionId = `test-session-${Date.now()}`;

    const raw = await callTool("lock__acquire", {
      resourceType: "table",
      resourceId,
      sessionId,
    });

    // raw が null の場合はサーバ未起動 or 接続失敗
    if (raw === null) {
      test.skip();
      return;
    }

    const res = raw as {
      result?: {
        content?: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      error?: unknown;
    };

    // エラーレスポンスでないこと
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
    expect(res.result?.isError).toBeFalsy();

    // result.content[0].text を JSON パースして entry shape を確認
    const content = res.result?.content;
    if (content && content.length > 0) {
      const parsed = JSON.parse(content[0].text) as {
        entry?: { ownerSessionId: string; actorSessionId: string };
        conflict?: boolean;
      };
      if (parsed.entry) {
        // onBehalfOfSession なし → owner == actor == sessionId
        expect(parsed.entry.ownerSessionId).toBe(sessionId);
        expect(parsed.entry.actorSessionId).toBe(sessionId);
      }
    }

    // 後片付け: ロック解放
    await callTool("lock__release", { resourceType: "table", resourceId, sessionId });
  });

  test("無効な onBehalfOfSession を渡すとエラー", async () => {
    const resourceId = `compat-invalid-${Date.now()}`;
    const sessionId = `test-session-${Date.now()}`;

    const raw = await callTool("lock__acquire", {
      resourceType: "table",
      resourceId,
      sessionId,
      onBehalfOfSession: "non-existent-session-id-99999",
    });

    if (raw === null) {
      test.skip();
      return;
    }

    const res = raw as {
      result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
      error?: { message?: string };
    };

    // エラーレスポンス (isError=true or error フィールド) であること
    const isError =
      res.error != null ||
      res.result?.isError === true ||
      (res.result?.content?.[0]?.text ?? "").includes("INVALID_ON_BEHALF_OF_SESSION");

    expect(isError).toBe(true);
  });

  test("lock__acquire → lock__release 往復 (onBehalfOfSession なし)", async () => {
    const resourceId = `compat-roundtrip-${Date.now()}`;
    const sessionId = `test-session-rt-${Date.now()}`;

    // acquire
    const acquireRaw = await callTool("lock__acquire", {
      resourceType: "table",
      resourceId,
      sessionId,
    });
    if (acquireRaw === null) {
      test.skip();
      return;
    }
    const acq = acquireRaw as { result?: { isError?: boolean }; error?: unknown };
    expect(acq.error).toBeUndefined();
    expect(acq.result?.isError).toBeFalsy();

    // release
    const releaseRaw = await callTool("lock__release", {
      resourceType: "table",
      resourceId,
      sessionId,
    });
    if (releaseRaw !== null) {
      const rel = releaseRaw as { result?: { isError?: boolean }; error?: unknown };
      expect(rel.error).toBeUndefined();
      expect(rel.result?.isError).toBeFalsy();
    }
  });
});
