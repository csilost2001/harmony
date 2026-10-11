import { describe, it, expect, vi, beforeEach } from "vitest";

const request = vi.fn();
vi.mock("../mcp/mcpBridge", () => ({ mcpBridge: { request: (...a: unknown[]) => request(...a) } }));

import { _resetEditSessionIndex, invalidateSessionIndex, listActiveSessionsFor } from "./editSessionIndex";

const session = (id: string, resourceId: string, state = "Active") => ({ id, resourceType: "table", resourceId, state });

describe("editSessionIndex", () => {
  beforeEach(() => { request.mockReset(); _resetEditSessionIndex(); });

  it("多くの行が同時に尋ねても、種類ごとに 1 回だけ問い合わせ、行ごとに振り分ける", async () => {
    request.mockResolvedValue({ sessions: [session("s1", "a"), session("s2", "b"), session("s3", "a", "Discarded")] });
    const res = await Promise.all(["a", "b", "c"].map((id) => listActiveSessionsFor("table", id)));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("editSession.list", { resourceType: "table" });
    expect(res.map((r) => r.map((s) => s.id))).toEqual([["s1"], ["s2"], []]);
  });

  it("変更の通知のあとは、尋ね直す (一斉に尋ね直しても 1 回)", async () => {
    request.mockResolvedValue({ sessions: [] });
    await listActiveSessionsFor("table", "a");
    await new Promise((r) => setTimeout(r, 60));
    invalidateSessionIndex();
    invalidateSessionIndex();
    await Promise.all([listActiveSessionsFor("table", "a"), listActiveSessionsFor("table", "b")]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("失敗したら、次は尋ね直す", async () => {
    request.mockRejectedValueOnce(new Error("x")).mockResolvedValue({ sessions: [session("s1", "a")] });
    await expect(listActiveSessionsFor("table", "a")).rejects.toThrow("x");
    expect((await listActiveSessionsFor("table", "a")).map((s) => s.id)).toEqual(["s1"]);
  });
});
