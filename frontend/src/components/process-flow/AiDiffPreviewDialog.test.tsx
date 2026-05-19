import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProcessFlow } from "../../types/v3";
import { AiDiffPreviewDialog } from "./AiDiffPreviewDialog";
import {
  applyProcessFlowDiffSelection,
  computeDiff,
  replaceProcessFlowContents,
} from "./AiDiffPreviewDialogUtils";

function flow(overrides: Partial<ProcessFlow> = {}): ProcessFlow {
  return {
    $schema: "../schemas/v3/process-flow.v3.schema.json",
    meta: {
      id: "flow-1" as never,
      name: "元フロー",
      kind: "screen",
      maturity: "draft",
      createdAt: "2026-05-01T00:00:00.000Z" as never,
      updatedAt: "2026-05-01T00:00:00.000Z" as never,
    },
    context: { screenId: "screen-1" },
    actions: [
      { id: "act-1", name: "登録", trigger: "click", steps: [] },
      { id: "act-removed", name: "削除対象", trigger: "click", steps: [] },
    ],
    ...overrides,
  } as ProcessFlow;
}

describe("AiDiffPreviewDialog diff helpers", () => {
  it("computes meta/action/context diff entries", () => {
    const current = flow();
    const proposed = flow({
      meta: { ...current.meta, name: "提案フロー" },
      context: { screenId: "screen-2" },
      actions: [
        { id: "act-1", name: "登録修正", trigger: "click", steps: [] },
        { id: "act-added", name: "追加", trigger: "click", steps: [] },
      ],
    });

    expect(computeDiff(current, proposed).map((entry) => entry.path)).toEqual([
      "meta.name",
      "actions[act-1]",
      "actions[act-added]",
      "actions[act-removed]",
      "context",
    ]);
  });

  it("applies only selected diff paths", () => {
    const current = flow();
    const proposed = flow({
      meta: { ...current.meta, name: "提案フロー" },
      context: { screenId: "screen-2" },
      actions: [
        { id: "act-1", name: "登録修正", trigger: "click", steps: [] },
        { id: "act-added", name: "追加", trigger: "click", steps: [] },
      ],
    });

    applyProcessFlowDiffSelection(current, proposed, ["meta.name", "actions[act-added]", "actions[act-removed]"]);

    expect(current.meta.name).toBe("提案フロー");
    expect(current.context).toEqual({ screenId: "screen-1" });
    expect(current.actions.map((action) => action.id)).toEqual(["act-1", "act-added"]);
    expect(current.actions[0].name).toBe("登録");
  });

  it("replaces all contents and deletes removed top-level keys", () => {
    const current = flow();
    const proposed = flow({ actions: [] });
    delete proposed.context;

    replaceProcessFlowContents(current, proposed);

    expect(Object.prototype.hasOwnProperty.call(current, "context")).toBe(false);
    expect(current.actions).toEqual([]);
  });
});

describe("AiDiffPreviewDialog", () => {
  it("submits checked paths when selecting partial adoption", () => {
    const current = flow();
    const proposed = flow({
      meta: { ...current.meta, name: "提案フロー" },
      context: { screenId: "screen-2" },
    });
    const onApplySelected = vi.fn();

    render(
      <AiDiffPreviewDialog
        current={current}
        proposed={proposed}
        onApply={vi.fn()}
        onApplySelected={onApplySelected}
        onDiscard={vi.fn()}
        onAddMarker={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("context を採用対象にする"));
    fireEvent.click(screen.getByRole("button", { name: /選択して採用/ }));

    expect(onApplySelected).toHaveBeenCalledWith(["meta.name"]);
  });
});
