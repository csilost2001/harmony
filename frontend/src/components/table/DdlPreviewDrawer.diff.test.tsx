/** DDL プレビュー: 保存前の版との差分 (ALTER) の表示 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Table } from "../../types/v3";

const request = vi.fn();
vi.mock("../../mcp/mcpBridge", () => ({ mcpBridge: { request: (...a: unknown[]) => request(...a) } }));
import { DdlPreviewDrawer } from "./DdlPreviewDrawer";

const col = (id: string, physicalName: string, extra: Record<string, unknown> = {}) => ({ id, physicalName, name: physicalName, dataType: "VARCHAR", length: 20, ...extra });
const mk = (columns: unknown[]): Table => ({ id: "orders", uuid: "u", name: "注文", physicalName: "orders", createdAt: "", updatedAt: "", columns } as unknown as Table);
const before = mk([col("c1", "id", { dataType: "INTEGER", primaryKey: true }), col("c2", "memo")]);
const now = mk([col("c1", "id", { dataType: "INTEGER", primaryKey: true }), col("c2", "memo"), col("c3", "price", { dataType: "INTEGER" })]);

describe("DdlPreviewDrawer: 版との差分", () => {
  beforeEach(() => { request.mockReset(); });

  it("差分に切り替えると、保存前の版を選んで、ALTER を出す", async () => {
    request.mockImplementation(async (method: string) => method === "fileVersions.list"
      ? { versions: [{ id: "v2", savedAt: "2026-10-13T01:00:00Z", size: 1 }, { id: "v1", savedAt: "2026-10-12T01:00:00Z", size: 1 }] }
      : { snapshot: before });
    render(<DdlPreviewDrawer ddl="CREATE TABLE ..." dialect="postgresql" onDialectChange={vi.fn()} defaultOpen diff={{ table: now, allTables: [now] }} />);
    expect(screen.getByTestId("ddl-text").textContent).toBe("CREATE TABLE ...");
    fireEvent.change(screen.getByTestId("ddl-mode"), { target: { value: "alter" } });
    await waitFor(() => expect(screen.getByTestId("ddl-text").textContent).toContain(`ALTER TABLE "orders" ADD COLUMN "price" INTEGER;`));
    expect(request).toHaveBeenCalledWith("fileVersions.list", { resourceType: "table", resourceId: "orders" });
    expect(request).toHaveBeenCalledWith("fileVersions.get", { resourceType: "table", resourceId: "orders", versionId: "v2" });
    expect(screen.getAllByRole("option").some((o) => o.textContent?.includes("の保存の前"))).toBe(true);
  });

  it("保存前の版が無いときは、その旨を出す", async () => {
    request.mockResolvedValue({ versions: [] });
    render(<DdlPreviewDrawer ddl="x" dialect="mysql" onDialectChange={vi.fn()} defaultOpen diff={{ table: now, allTables: [now] }} />);
    fireEvent.change(screen.getByTestId("ddl-mode"), { target: { value: "alter" } });
    await waitFor(() => expect(screen.getByText(/保存前の版がまだありません/)).toBeInTheDocument());
  });

  it("版を読めなかったときは、エラーを出し、差分は出さない", async () => {
    request.mockRejectedValue(new Error("読めません"));
    render(<DdlPreviewDrawer ddl="x" dialect="mysql" onDialectChange={vi.fn()} defaultOpen diff={{ table: now, allTables: [now] }} />);
    fireEvent.change(screen.getByTestId("ddl-mode"), { target: { value: "alter" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("読めません"));
    expect(screen.getByTestId("ddl-text").textContent).toBe("");
  });

  it("diff を渡さない呼び出し (差分の無い画面) では、切り替えを出さない", () => {
    render(<DdlPreviewDrawer ddl="x" dialect="mysql" onDialectChange={vi.fn()} defaultOpen />);
    expect(screen.queryByTestId("ddl-mode")).toBeNull();
  });
});
