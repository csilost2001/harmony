import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Data } from "@measured/puck";

const { mockGenerateUUID } = vi.hoisted(() => ({
  mockGenerateUUID: vi.fn<() => string>(() => "uuid-default"),
}));

vi.mock("../utils/uuid", () => ({
  generateUUID: mockGenerateUUID,
}));

vi.mock("../mcp/mcpBridge", () => ({
  mcpBridge: {
    loadPuckData: vi.fn(),
    savePuckData: vi.fn(),
    request: vi.fn(),
  },
}));

import { mcpBridge } from "../mcp/mcpBridge";
import { duplicateScreenDesignData } from "./duplicateScreen";

const mockBridge = mcpBridge as {
  loadPuckData: ReturnType<typeof vi.fn>;
  savePuckData: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
};

function puckData(data: unknown): Data {
  return data as Data;
}

describe("duplicateScreenDesignData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateUUID.mockReturnValue("regenerated-id");
  });

  it("puck は loadPuckData で読み、ID 再生成後に savePuckData へ保存する", async () => {
    const src = puckData({
      root: { props: {} },
      content: [{ type: "Text", props: { id: "old-id", text: "hello" } }],
    });
    mockBridge.loadPuckData.mockResolvedValue(src);

    await duplicateScreenDesignData("src-screen", "dup-screen", "puck");

    expect(mockBridge.loadPuckData).toHaveBeenCalledWith("src-screen");
    expect(mockBridge.savePuckData).toHaveBeenCalledTimes(1);
    expect(mockBridge.savePuckData).toHaveBeenCalledWith("dup-screen", {
      root: { props: {} },
      content: [{ type: "Text", props: { id: "regenerated-id", text: "hello" } }],
    });
    expect(mockBridge.request).not.toHaveBeenCalled();
  });

  it("grapesjs は loadScreen で読み、saveScreen へ同じ data を保存する", async () => {
    const src = {
      assets: [],
      pages: [{ frames: [{ component: { type: "wrapper" } }] }],
      styles: [],
    };
    mockBridge.request.mockResolvedValueOnce(src).mockResolvedValueOnce({ success: true });

    await duplicateScreenDesignData("src-screen", "dup-screen", "grapesjs");

    expect(mockBridge.request).toHaveBeenNthCalledWith(1, "loadScreen", { screenId: "src-screen" });
    expect(mockBridge.request).toHaveBeenNthCalledWith(2, "saveScreen", {
      screenId: "dup-screen",
      data: src,
    });
    expect(mockBridge.loadPuckData).not.toHaveBeenCalled();
    expect(mockBridge.savePuckData).not.toHaveBeenCalled();
  });

  it("puck の load が null の場合は保存しない", async () => {
    mockBridge.loadPuckData.mockResolvedValue(null);

    await duplicateScreenDesignData("src-screen", "dup-screen", "puck");

    expect(mockBridge.savePuckData).not.toHaveBeenCalled();
  });

  it("grapesjs の load が undefined の場合は保存しない", async () => {
    mockBridge.request.mockResolvedValue(undefined);

    await duplicateScreenDesignData("src-screen", "dup-screen", "grapesjs");

    expect(mockBridge.request).toHaveBeenCalledTimes(1);
    expect(mockBridge.request).toHaveBeenCalledWith("loadScreen", { screenId: "src-screen" });
  });

  it("grapesjs 経路で saveScreen は呼ばれるが savePuckData / loadPuckData は呼ばれない (entity.editorKind/cssFramework を Puck API で上書きしない)", async () => {
    // wsBridge.ts の writeScreen は {screenId}.design.json と {screenId}.json (entity) を両方書く設計。
    // ただし entity 書き込みは projectStorage.ts:377 のスプレッド `{ ...entity.design, designFileRef: ... }`
    // 経由なので editorKind / cssFramework は保持される (pre-existing 設計に依存)。
    // このテストでは GrapesJS 経路が Puck 専用 API (savePuckData) を呼ばないことを保証し、
    // entity 上書き経路が mcpBridge.request("saveScreen") のみであることを trace 可能にする。
    const src = {
      assets: [],
      pages: [{ frames: [{ component: { type: "wrapper" } }] }],
      styles: [],
    };
    mockBridge.request.mockResolvedValueOnce(src).mockResolvedValueOnce({ success: true });

    await duplicateScreenDesignData("src-screen", "dup-screen", "grapesjs");

    // GrapesJS の保存は request("saveScreen") のみ — entity の editorKind/cssFramework は
    // wsBridge 側のスプレッドで保持される (projectStorage.ts:377 参照)
    expect(mockBridge.request).toHaveBeenNthCalledWith(2, "saveScreen", {
      screenId: "dup-screen",
      data: src,
    });
    // Puck 専用 API は呼ばれない (entity を Puck 経路で二重上書きしない)
    expect(mockBridge.savePuckData).not.toHaveBeenCalled();
    expect(mockBridge.loadPuckData).not.toHaveBeenCalled();
  });
});
