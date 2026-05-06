import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CustomStepPanel } from "./CustomStepPanel";

const bridgeMock = vi.hoisted(() => {
  let extensionHandler: (() => void) | null = null;
  return {
    getExtensions: vi.fn(),
    onExtensionsChanged: vi.fn((handler: () => void) => {
      extensionHandler = handler;
      return vi.fn();
    }),
    emitExtensionsChanged: () => extensionHandler?.(),
  };
});

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: bridgeMock,
}));

const bundleWithSchema = {
  steps: {
    namespace: "gm50",
    steps: {
      BatchStep: {
        label: "バッチ処理",
        icon: "bi-gear",
        description: "バッチ処理ステップ",
        schema: {
          type: "object",
          properties: {
            batchId: { type: "string", description: "バッチ ID" },
          },
        },
      },
    },
  },
};

describe("CustomStepPanel", () => {
  beforeEach(() => {
    bridgeMock.getExtensions.mockReset();
    bridgeMock.onExtensionsChanged.mockClear();
  });

  it("renders loading first and then renders SchemaForm", async () => {
    bridgeMock.getExtensions.mockResolvedValue(bundleWithSchema);

    render(<CustomStepPanel customStepType="gm50:BatchStep" value={{}} onChange={vi.fn()} />);

    expect(screen.getByText("カスタムステップ定義を読み込み中...")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("batchId")).toBeTruthy());
  });

  it("shows an error when custom step definition is not found", async () => {
    bridgeMock.getExtensions.mockResolvedValue(bundleWithSchema);

    render(<CustomStepPanel customStepType="gm50:UnknownStep" value={{}} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('カスタムステップ "gm50:UnknownStep" の定義が見つかりません')).toBeTruthy();
    });
  });

  it("re-fetches schema when extensionsChanged is broadcast", async () => {
    bridgeMock.getExtensions
      .mockResolvedValueOnce(bundleWithSchema)
      .mockResolvedValueOnce({
        steps: {
          namespace: "gm50",
          steps: {
            BatchStep: {
              label: "バッチ処理",
              icon: "bi-gear",
              description: "バッチ処理ステップ",
              schema: {
                type: "object",
                properties: {
                  retryCount: { type: "integer", description: "リトライ回数" },
                },
              },
            },
          },
        },
      });

    render(<CustomStepPanel customStepType="gm50:BatchStep" value={{}} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("batchId")).toBeTruthy());

    bridgeMock.emitExtensionsChanged();

    await waitFor(() => expect(screen.getByLabelText("retryCount")).toBeTruthy());
    expect(bridgeMock.getExtensions).toHaveBeenLastCalledWith(true);
  });
});
