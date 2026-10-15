import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const request = vi.fn();
const broadcastHandlers: Record<string, Array<(d: unknown) => void>> = {};
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    request: (...a: unknown[]) => request(...(a as [string, unknown])),
    onBroadcast: (ev: string, h: (d: unknown) => void) => { (broadcastHandlers[ev] ??= []).push(h); return () => { broadcastHandlers[ev] = (broadcastHandlers[ev] ?? []).filter((x) => x !== h); }; },
  },
}));
import { RemoteMarkerPanel, diffMarkers } from "./RemoteMarkerPanel";
import type { Marker } from "../../types/v3";

const mk = (id: string, body: string, over: Partial<Marker> = {}): Marker => ({ id: id as Marker["id"], kind: "todo", body, author: "human", createdAt: "2026-01-01T00:00:00.000Z" as Marker["createdAt"], ...over });
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("diffMarkers", () => {
  it("追加・更新・削除に分ける", () => {
    const prev = [mk(A, "a"), mk(B, "b")];
    const next = [mk(A, "a", { resolvedAt: "2026-01-02T00:00:00.000Z" as Marker["resolvedAt"] }), mk("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "c")];
    const d = diffMarkers(prev, next);
    expect(d.added.map((m) => m.body)).toEqual(["c"]);
    expect(d.updated.map((m) => m.id)).toEqual([A]);
    expect(d.removedIds).toEqual([B]);
    expect(diffMarkers(prev, prev)).toEqual({ added: [], updated: [], removedIds: [] });
  });
});

describe("RemoteMarkerPanel", () => {
  beforeEach(() => { request.mockReset(); for (const k of Object.keys(broadcastHandlers)) delete broadcastHandlers[k]; });

  it("開いたとき、サーバのマーカーを読む。追加は、その場で保存の要求 (差分だけ) を送り、サーバの結果で整える", async () => {
    request.mockImplementation(async (method: string) => {
      if (method === "listMarkers") return { markers: [mk(A, "既存")] };
      if (method === "applyMarkerChanges") return { markers: [mk(A, "既存"), mk(B, "AI が並行して足した", { author: "ai" })] };
      return null;
    });
    render(<RemoteMarkerPanel type="screen" id="cart" name="カート" expanded render="bodyOnly" />);
    expect(await screen.findByText("既存")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("marker-add-input"), { target: { value: "ボタンの位置" } });
    fireEvent.click(screen.getByTestId("marker-add-btn"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("applyMarkerChanges", expect.objectContaining({ entityType: "screen", entityId: "cart" })));
    const call = request.mock.calls.find((c) => c[0] === "applyMarkerChanges")![1] as { changes: { added: Marker[]; updated: Marker[]; removedIds: string[] } };
    expect(call.changes.added).toHaveLength(1);
    expect(call.changes.added[0]).toMatchObject({ body: "ボタンの位置", author: "human" });
    expect(call.changes.updated).toEqual([]);
    expect(call.changes.removedIds).toEqual([]); // 一覧ごとではなく、差分だけ送る
    // サーバが返した (AI が並行して足したものを含む) 一覧に、整う
    expect(await screen.findByText("AI が並行して足した")).toBeInTheDocument();
  });

  it("設計の変更の知らせ (自分の設計) を受けたら読み直す。別の設計の知らせは無視する", async () => {
    request.mockResolvedValue({ markers: [] });
    render(<RemoteMarkerPanel type="screen" id="cart" expanded render="bodyOnly" />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    act(() => broadcastHandlers["screenChanged"].forEach((h) => h({ screenId: "other" })));
    expect(request).toHaveBeenCalledTimes(1);
    act(() => broadcastHandlers["screenChanged"].forEach((h) => h({ screenId: "cart" })));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("保存に失敗したら、読み直して、サーバの内容に戻す", async () => {
    let n = 0;
    request.mockImplementation(async (method: string) => {
      if (method === "listMarkers") return { markers: n++ === 0 ? [] : [mk(A, "サーバにあるもの")] };
      throw new Error("書き込めません");
    });
    render(<RemoteMarkerPanel type="screen" id="cart" expanded render="bodyOnly" />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId("marker-add-input"), { target: { value: "失敗するもの" } });
    fireEvent.click(screen.getByTestId("marker-add-btn"));
    expect(await screen.findByText("サーバにあるもの")).toBeInTheDocument();
    expect(screen.queryByText("失敗するもの")).toBeNull();
  });
});
