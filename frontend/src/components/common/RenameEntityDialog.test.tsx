/**
 * RenameEntityDialog component test (RFC #1284 / ISSUE #1298 I-6)
 *
 * mcpBridge を mock して input → preview → execute の state machine を検証する。
 * (E2E は frontend/e2e/refactor/rename-entity.spec.ts で実 backend 経由を担保)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RenameEntityDialog } from "./RenameEntityDialog";

// mcpBridge の request を mock。各 test で mockResolvedValueOnce で振分け
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    request: vi.fn(),
  },
}));

// EntityIdSuggestion (AI 提案) も unit test なので mock 化 (Codex 実通信を避ける)
vi.mock("../../utils/entityIdSuggestion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/entityIdSuggestion")>();
  return {
    ...actual,
    requestAiSuggestedEntityId: vi.fn(async () => "ai-suggested-id"),
  };
});

import { mcpBridge } from "../../mcp/mcpBridge";

const PREVIEW_FIXTURE = {
  entityType: "table" as const,
  oldId: "products",
  newId: "products-v2",
  uniqueOk: true,
  oldExists: true,
  lockedByOther: false,
  fileRenames: [
    { from: "tables/products.json", to: "tables/products-v2.json" },
  ],
  refUpdates: [
    {
      filePath: "process-flows/order-create.json",
      entityKind: "processFlow",
      entityId: "order-create",
      jsonPointer: "/steps/0/inputs/2/tableId",
      oldValue: "products",
    },
  ],
  totalRefs: 1,
  // Phase I round 3+4 SF-1: backend で追加された 4 field、空が通常 case
  ambiguousDependencies: [],
  concurrentEditRefs: [],
  warnings: [],
  positionsCollisions: [],
};

const RENAME_RESULT_FIXTURE = {
  operation: {
    operationId: "op-uuid-1234",
    entityType: "table" as const,
    oldId: "products",
    newId: "products-v2",
    uuid: "entity-uuid-1234",
    ts: 1714000000000,
    ttlExpiresAt: 1714000000000 + 5 * 60 * 1000,
  },
  preview: PREVIEW_FIXTURE,
};

const NOOP = () => undefined;

beforeEach(() => {
  vi.mocked(mcpBridge.request).mockReset();
});

describe("RenameEntityDialog", () => {
  it("step=input — タイトル + EntityIdInput + シミュレーションボタンが表示される", () => {
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={["products", "customers"]}
        onClose={NOOP}
        onSuccess={NOOP}
      />,
    );
    expect(screen.getByTestId("rename-entity-dialog")).toBeTruthy();
    expect(screen.getByText(/テーブル定義 の id を変更/)).toBeTruthy();
    expect(screen.getByText(/products/)).toBeTruthy();
    expect(screen.getByTestId("entity-id-input")).toBeTruthy();
    expect(screen.getByTestId("rename-entity-preview-btn")).toBeTruthy();
  });

  it("validation 不正 (空) のときシミュレーションボタンは disabled", () => {
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={[]}
        onClose={NOOP}
        onSuccess={NOOP}
      />,
    );
    const btn = screen.getByTestId("rename-entity-preview-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("有効 id 入力 + シミュレーション → preview RPC 呼出 + preview 画面に遷移", async () => {
    vi.mocked(mcpBridge.request).mockResolvedValueOnce(PREVIEW_FIXTURE);
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={["customers"]}
        onClose={NOOP}
        onSuccess={NOOP}
      />,
    );
    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: "products-v2" } }));
    const btn = screen.getByTestId("rename-entity-preview-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await act(async () => { fireEvent.click(btn); });

    await waitFor(() => expect(mcpBridge.request).toHaveBeenCalledWith(
      "previewEntityRename",
      { entityType: "table", oldId: "products", newId: "products-v2" },
    ));
    const summary = screen.getByTestId("rename-entity-preview-summary");
    // テキストノードが strong で分割されているので textContent で確認
    expect(summary.textContent).toMatch(/1.*ファイル rename/);
    expect(screen.getByText("process-flows/order-create.json")).toBeTruthy();
  });

  it("preview 後の「実行」 → renameEntityId RPC + onSuccess callback", async () => {
    vi.mocked(mcpBridge.request)
      .mockResolvedValueOnce(PREVIEW_FIXTURE)
      .mockResolvedValueOnce(RENAME_RESULT_FIXTURE);
    const onSuccess = vi.fn();
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={[]}
        onClose={NOOP}
        onSuccess={onSuccess}
      />,
    );
    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: "products-v2" } }));
    await act(async () => { fireEvent.click(screen.getByTestId("rename-entity-preview-btn")); });

    await waitFor(() => expect(screen.getByTestId("rename-entity-execute-btn")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByTestId("rename-entity-execute-btn")); });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("products-v2", "op-uuid-1234"));
    expect(mcpBridge.request).toHaveBeenNthCalledWith(2, "renameEntityId", {
      entityType: "table",
      oldId: "products",
      newId: "products-v2",
    });
  });

  it("lockedByOther preview → 実行ボタン disabled + 警告表示", async () => {
    vi.mocked(mcpBridge.request).mockResolvedValueOnce({
      ...PREVIEW_FIXTURE,
      lockedByOther: true,
    });
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={[]}
        onClose={NOOP}
        onSuccess={NOOP}
      />,
    );
    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: "products-v2" } }));
    await act(async () => { fireEvent.click(screen.getByTestId("rename-entity-preview-btn")); });

    await waitFor(() => expect(screen.getByTestId("rename-entity-lock-warning")).toBeTruthy());
    const execBtn = screen.getByTestId("rename-entity-execute-btn") as HTMLButtonElement;
    expect(execBtn.disabled).toBe(true);
  });

  it("preview RPC エラー → input 画面でエラー表示", async () => {
    vi.mocked(mcpBridge.request).mockRejectedValueOnce(new Error("backend に到達できません"));
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={[]}
        onClose={NOOP}
        onSuccess={NOOP}
      />,
    );
    act(() => fireEvent.change(
      screen.getByTestId("entity-id-input"),
      { target: { value: "products-v2" } },
    ));
    await act(async () => { fireEvent.click(screen.getByTestId("rename-entity-preview-btn")); });
    await waitFor(() => expect(screen.getByTestId("rename-entity-error")).toBeTruthy());
    expect(screen.getByText(/backend に到達できません/)).toBeTruthy();
  });

  it("「再入力」 → preview state クリアして input 画面に戻る", async () => {
    vi.mocked(mcpBridge.request).mockResolvedValueOnce(PREVIEW_FIXTURE);
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={[]}
        onClose={NOOP}
        onSuccess={NOOP}
      />,
    );
    act(() => fireEvent.change(
      screen.getByTestId("entity-id-input"),
      { target: { value: "products-v2" } },
    ));
    await act(async () => { fireEvent.click(screen.getByTestId("rename-entity-preview-btn")); });
    await waitFor(() => expect(screen.getByTestId("rename-entity-back-btn")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByTestId("rename-entity-back-btn")); });
    expect(screen.getByTestId("rename-entity-preview-btn")).toBeTruthy();
  });

  it("キャンセル → onClose 呼出", () => {
    const onClose = vi.fn();
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={[]}
        onClose={onClose}
        onSuccess={NOOP}
      />,
    );
    fireEvent.click(screen.getByTestId("rename-entity-cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase I round 3+4 SF-1: backend で追加された 4 field (ambiguousDependencies /
  //   concurrentEditRefs / warnings / positionsCollisions) を UI で render + execute
  //   button を disable する
  // ─────────────────────────────────────────────────────────────────────────

  async function gotoPreview(previewFixture: typeof PREVIEW_FIXTURE) {
    vi.mocked(mcpBridge.request).mockResolvedValueOnce(previewFixture);
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={[]}
        onClose={NOOP}
        onSuccess={NOOP}
      />,
    );
    // input 入力 + シミュレーション click
    const input = screen.getByTestId("entity-id-input") as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: "products-v2" } }));
    await act(async () => { fireEvent.click(screen.getByTestId("rename-entity-preview-btn")); });
    await waitFor(() => expect(screen.getByTestId("rename-entity-preview-summary")).toBeTruthy());
  }

  it("SF-1: ambiguousDependencies が非空 → section 表示 + 実行 button disable", async () => {
    await gotoPreview({
      ...PREVIEW_FIXTURE,
      ambiguousDependencies: [
        { viewId: "monthly-sales", conflictingEntityType: "view" as const, filePath: "views/monthly-sales.json" },
      ],
    });
    expect(screen.getByTestId("rename-entity-ambiguous-deps")).toBeTruthy();
    const execBtn = screen.getByTestId("rename-entity-execute-btn") as HTMLButtonElement;
    expect(execBtn.disabled).toBe(true);
  });

  it("SF-1: concurrentEditRefs が非空 → section 表示 + 実行 button disable", async () => {
    await gotoPreview({
      ...PREVIEW_FIXTURE,
      concurrentEditRefs: [
        { entityKind: "processFlow", entityId: "order-create", sessionId: "sess-A" },
      ],
    });
    expect(screen.getByTestId("rename-entity-concurrent-edits")).toBeTruthy();
    const execBtn = screen.getByTestId("rename-entity-execute-btn") as HTMLButtonElement;
    expect(execBtn.disabled).toBe(true);
  });

  it("SF-1: positionsCollisions が非空 → section 表示 + 実行 button disable", async () => {
    await gotoPreview({
      ...PREVIEW_FIXTURE,
      positionsCollisions: [
        `screen-flow-positions.json: positions に旧 id "home" と新 id "landing" が同時存在`,
      ],
    });
    expect(screen.getByTestId("rename-entity-positions-collisions")).toBeTruthy();
    const execBtn = screen.getByTestId("rename-entity-execute-btn") as HTMLButtonElement;
    expect(execBtn.disabled).toBe(true);
  });

  it("SF-1: warnings は非 blocker — section 表示 + 実行 button enable", async () => {
    await gotoPreview({
      ...PREVIEW_FIXTURE,
      warnings: ["将来拡張用の通知 message"],
    });
    expect(screen.getByTestId("rename-entity-warnings")).toBeTruthy();
    const execBtn = screen.getByTestId("rename-entity-execute-btn") as HTMLButtonElement;
    expect(execBtn.disabled).toBe(false);
  });

  it("SF-1: 全 field 空 (normal case) → 4 section 不在 + 実行 button enable", async () => {
    await gotoPreview(PREVIEW_FIXTURE);
    expect(screen.queryByTestId("rename-entity-ambiguous-deps")).toBeNull();
    expect(screen.queryByTestId("rename-entity-concurrent-edits")).toBeNull();
    expect(screen.queryByTestId("rename-entity-positions-collisions")).toBeNull();
    expect(screen.queryByTestId("rename-entity-warnings")).toBeNull();
    const execBtn = screen.getByTestId("rename-entity-execute-btn") as HTMLButtonElement;
    expect(execBtn.disabled).toBe(false);
  });

  it("N-1: fetchExistingIds が渡された場合、open 時に呼ばれ existingIds を refresh", async () => {
    const fetchExistingIds = vi.fn(async () => ["products", "customers", "new-from-other-session"]);
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={["products", "customers"]}
        fetchExistingIds={fetchExistingIds}
        onClose={NOOP}
        onSuccess={NOOP}
      />,
    );
    await waitFor(() => expect(fetchExistingIds).toHaveBeenCalled());
  });

  it("N-1: fetchExistingIds 省略時は props.existingIds を使用 (旧挙動 = backward compat)", () => {
    render(
      <RenameEntityDialog
        entityType="table"
        currentId="products"
        currentName="商品マスタ"
        existingIds={["products", "customers"]}
        onClose={NOOP}
        onSuccess={NOOP}
      />,
    );
    // 例外無く render される
    expect(screen.getByTestId("rename-entity-dialog")).toBeTruthy();
  });
});
