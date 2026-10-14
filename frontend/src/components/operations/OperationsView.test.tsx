/**
 * 連携と運用の画面: 8 つのタブがどれも描画でき、承認・コメント・権限・通知・取り込みの操作が、backend への正しい要求になる。
 * backend 側の正しさは backend/src/ops/ops.test.ts、実際の画面の通しは e2e/integration-ops.spec.ts。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { tiny } from "../analysis/logic/fixtures";

const request = vi.fn();
const listeners = new Map<string, Array<() => void>>();
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    request: (...a: unknown[]) => request(...a),
    onBroadcast: (ev: string, cb: () => void) => { listeners.set(ev, [...(listeners.get(ev) ?? []), cb]); return () => undefined; },
    onStatusChange: () => () => undefined, startWithoutEditor: () => undefined, getStatus: () => "connected",
  },
}));
vi.mock("../document/loadDesignInput", () => ({ loadDesignInput: async () => ({ input: tiny(), skipped: [] }) }));
vi.mock("../../hooks/useWorkspacePath", () => ({ useWorkspacePath: () => ({ wsPath: (p: string) => `/w/x${p}` }) }));
const toast = vi.fn();
vi.mock("../../utils/toast", () => ({ showToast: (...a: unknown[]) => toast(...a) }));
const reportFailure = vi.fn();
vi.mock("../../utils/failureToast", () => ({ reportFailure: (...a: unknown[]) => reportFailure(...a) }));
vi.mock("../../store/tableStore", () => ({ saveTable: vi.fn(async () => undefined) }));
vi.mock("../../store/processFlowStore", () => ({ createProcessFlow: vi.fn(), saveProcessFlow: vi.fn(), loadAllProcessFlows: async () => new Map() }));
import { OperationsView } from "./OperationsView";

const rpc: Record<string, (p: unknown) => unknown> = {};
const calls = (m: string) => request.mock.calls.filter((c) => c[0] === m).map((c) => c[1]);

beforeEach(() => {
  request.mockReset(); toast.mockReset(); reportFailure.mockReset(); localStorage.clear(); listeners.clear();
  for (const k of Object.keys(rpc)) delete rpc[k];
  const defaults: Record<string, unknown> = {
    "approvals.load": { rows: [], problems: [] }, "reviewComments.load": { threads: [], problems: [] },
    "audit.list": { entries: [], actors: [], total: 0 }, "git.status": { isRepo: false, ownRepo: false, files: [], clean: true, identityConfigured: false },
    "git.log": { commits: [] }, "git.branches": { branches: [] }, "notify.load": { webhooks: [], problems: [] }, "generation.status": { rows: [], problems: [] },
    "access.load": { access: { version: 1, users: [], policy: { requireApprovalForCommitted: false } }, problems: [], you: { name: "花子", role: null, enforced: false } },
    "app.version": { version: "1.2.3", commit: "abc1234", startedAt: "2026-10-01T00:00:00.000Z", notes: [{ date: "2026-10-01", title: "更新あり", pr: "9" }], notesTotal: 1 },
    listAllTables: [], loadAllProcessFlows: [],
  };
  request.mockImplementation(async (method: string, params: unknown) => {
    if (rpc[method]) return rpc[method](params);
    if (method in defaults) return defaults[method];
    throw new Error(`unexpected ${method}`);
  });
});

const open = async (tab?: string) => {
  render(<MemoryRouter><OperationsView /></MemoryRouter>);
  if (tab) fireEvent.click(screen.getByTestId(`op-tab-${tab}`));
};

describe("連携と運用: 全体", () => {
  it("8 つのタブがあり、選んだタブを覚える。どのタブも、描画で落ちない", async () => {
    await open();
    expect(screen.getAllByRole("tab")).toHaveLength(8);
    for (const [id, marker] of [["review", "op-review"], ["audit", "op-audit"], ["git", "op-git"], ["notify", "op-notify"], ["generation", "op-generation"], ["import", "op-import"], ["access", "op-access"], ["version", "op-version"]] as const) {
      fireEvent.click(screen.getByTestId(`op-tab-${id}`));
      expect(await screen.findByTestId(marker)).toBeTruthy();
      expect(localStorage.getItem("harmony.operations.tab")).toBe(id);
    }
  });

  it("書き込みの通知 (opsChanged) を受けると、読み直す", async () => {
    await open();
    await screen.findByTestId("op-review");
    const before = calls("approvals.load").length;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try { for (const cb of listeners.get("opsChanged") ?? []) cb(); await vi.advanceTimersByTimeAsync(500); } finally { vi.useRealTimers(); }
    await waitFor(() => expect(calls("approvals.load").length).toBeGreaterThan(before));
  });
});

describe("レビューと承認", () => {
  it("承認の一覧に、状態・最後の操作・次の操作が出る。差し戻しは理由が空だと押せず、理由つきで送る", async () => {
    rpc["approvals.load"] = () => ({ problems: [], rows: [{ kind: "table", id: "orders", name: "注文", state: "review", status: "review", history: [{ state: "review", by: "花子", at: "2026-10-01T09:00:00.000Z" }], nextStates: [{ to: "approved", needs: "approver" }, { to: "rejected", needs: "approver" }, { to: "draft", needs: "editor" }] }] });
    rpc["approvals.transition"] = () => ({});
    await open();
    const table = await screen.findByTestId("op-approval-table");
    expect(await within(table).findByText("注文")).toBeTruthy();
    expect(within(table).getByTestId("op-status").textContent).toBe("承認待ち");
    fireEvent.click(within(table).getByTestId("op-approval-rejected"));
    expect((screen.getByTestId("op-reject-go") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("op-reject-note"), { target: { value: "桁が足りない" } });
    fireEvent.click(screen.getByTestId("op-reject-go"));
    await waitFor(() => expect(calls("approvals.transition")).toEqual([{ kind: "table", id: "orders", to: "rejected", note: "桁が足りない" }]));
    expect(toast).toHaveBeenCalledWith("「差し戻し」にしました");
  });

  it("操作が断られたら (役割が足りない)、理由を失敗として知らせる", async () => {
    rpc["approvals.load"] = () => ({ problems: [], rows: [{ kind: "table", id: "orders", name: "注文", state: "review", status: "review", history: [], nextStates: [{ to: "approved", needs: "approver" }] }] });
    rpc["approvals.transition"] = () => { throw new Error("「承認」以上の役割が必要です"); };
    await open();
    fireEvent.click(await screen.findByTestId("op-approval-approved"));
    await waitFor(() => expect(reportFailure).toHaveBeenCalled());
    expect((reportFailure.mock.calls[0][0] as Error).message).toContain("「承認」以上");
  });

  it("コメントのスレッドを、未解決・解決済みで絞れ、返信と解決ができる", async () => {
    const th = (id: string, status: string, text: string) => ({ id, status, target: { kind: "table", id: "orders", path: "columns[0]" }, messages: [{ id: `${id}-m`, by: "花子", at: "2026-10-01T09:00:00.000Z", text }] });
    rpc["reviewComments.load"] = () => ({ problems: [], threads: [th("t-1", "open", "桁数は？"), th("t-2", "resolved", "済んだ件")] });
    rpc["reviewComments.add"] = () => ({ threadId: "t-1" });
    rpc["reviewComments.resolve"] = () => ({ ok: true });
    await open();
    const section = await screen.findByTestId("op-comments");
    expect(await within(section).findByText("桁数は？")).toBeTruthy();
    expect(within(section).queryByText("済んだ件")).toBeNull();
    fireEvent.change(within(section).getByTestId("op-reply-input"), { target: { value: "20 桁です" } });
    fireEvent.click(within(section).getByTestId("op-reply-send"));
    await waitFor(() => expect(calls("reviewComments.add")).toEqual([{ threadId: "t-1", text: "20 桁です" }]));
    fireEvent.click(within(section).getByTestId("op-thread-resolve"));
    await waitFor(() => expect(calls("reviewComments.resolve")).toEqual([{ threadId: "t-1", resolved: true }]));
    fireEvent.change(screen.getByTestId("op-thread-filter"), { target: { value: "all" } });
    expect(within(section).getByText("済んだ件")).toBeTruthy();
  });
});

describe("利用者と権限", () => {
  it("制限がないときは「制限なし」と出る。利用者を足して保存すると、役割と方針を送る。変更前は保存できない", async () => {
    localStorage.setItem("harmony.userName", "花子");
    rpc["access.save"] = () => ({ access: {}, problems: [] });
    await open("access");
    expect((await screen.findByTestId("op-access-you")).textContent).toContain("制限なし");
    expect((screen.getByTestId("op-access-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("op-access-add"));
    const row = within(screen.getByTestId("op-access-table")).getAllByRole("row")[1];
    expect((within(row).getByLabelText("利用者名") as HTMLInputElement).value).toBe("花子"); // 最初の 1 人は、自分
    expect((within(row).getByLabelText("役割") as HTMLSelectElement).value).toBe("admin");
    fireEvent.click(screen.getByTestId("op-access-policy"));
    fireEvent.click(screen.getByTestId("op-access-save"));
    await waitFor(() => expect(calls("access.save")).toEqual([{ users: [{ name: "花子", role: "admin" }], policy: { requireApprovalForCommitted: true }, discardUnreadable: false }]));
  });

  it("保存が断られたら、理由を画面に出す", async () => {
    rpc["access.save"] = () => { throw new Error("「管理」の役割の人を、1 人以上残してください"); };
    await open("access");
    fireEvent.click(await screen.findByTestId("op-access-add"));
    fireEvent.click(screen.getByTestId("op-access-save"));
    expect((await screen.findByTestId("op-access-error")).textContent).toContain("「管理」の役割の人を");
  });
});

describe("通知", () => {
  it("http・ローカルのホストの URL は、保存できない。保存すると、URL は送るが、画面には出さない", async () => {
    rpc["notify.save"] = () => ({ saved: 1 });
    await open("notify");
    fireEvent.click(await screen.findByTestId("op-hook-add"));
    fireEvent.change(screen.getByTestId("op-hook-name"), { target: { value: "設計チーム" } });
    fireEvent.change(screen.getByTestId("op-hook-url"), { target: { value: "http://hooks.example.com/x" } });
    expect(screen.getByText("https:// の URL だけ使えます")).toBeTruthy();
    expect((screen.getByTestId("op-notify-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("op-hook-url"), { target: { value: "https://localhost/x" } });
    expect(screen.getByText("社内・ローカルのホストへは送れません")).toBeTruthy();
    fireEvent.change(screen.getByTestId("op-hook-url"), { target: { value: "https://hooks.example.com/SECRET" } });
    fireEvent.click(screen.getByTestId("op-notify-save"));
    await waitFor(() => expect(calls("notify.save")).toHaveLength(1));
    expect((calls("notify.save")[0] as { webhooks: Array<{ url: string; name: string }> }).webhooks[0]).toMatchObject({ name: "設計チーム", url: "https://hooks.example.com/SECRET" });
  });

  it("登録済みの URL は、ホスト名だけを出す。URL を入れ直さなければ、URL は送らない (サーバが元の URL を保つ)", async () => {
    rpc["notify.load"] = () => ({ problems: [], webhooks: [{ id: "h1", name: "チーム", format: "slack", events: ["approval"], enabled: true, urlMasked: "https://hooks.slack.com/…" }] });
    rpc["notify.save"] = () => ({ saved: 1 });
    await open("notify");
    const url = (await screen.findByTestId("op-hook-url")) as HTMLInputElement;
    expect(url.value).toBe("");
    expect(screen.getByText(/登録済み: https:\/\/hooks\.slack\.com\/…/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("op-hook-event-comment"));
    fireEvent.click(screen.getByTestId("op-notify-save"));
    await waitFor(() => expect(calls("notify.save")).toHaveLength(1));
    const sent = (calls("notify.save")[0] as { webhooks: Array<Record<string, unknown>> }).webhooks[0];
    expect(sent).toMatchObject({ id: "h1", events: ["approval", "comment"] });
    expect(sent.url ?? "").toBe(""); // 送らない (サーバが、登録済みの URL をそのまま保つ)
  });

  it("テスト送信は、確認のあとだけ送る", async () => {
    rpc["notify.load"] = () => ({ problems: [], webhooks: [{ id: "h1", name: "チーム", format: "slack", events: [], enabled: true, urlMasked: "https://x.example.com/…" }] });
    rpc["notify.test"] = () => ({ ok: true, status: 200 });
    await open("notify");
    fireEvent.click(await screen.findByTestId("op-hook-test"));
    expect(calls("notify.test")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("op-hook-test-go"));
    await waitFor(() => expect(calls("notify.test")).toEqual([{ id: "h1" }]));
  });
});

describe("Git", () => {
  it("リポジトリでなければ案内し、確認のあとに init する", async () => {
    rpc["git.init"] = () => ({ ok: true });
    await open("git");
    fireEvent.click(await screen.findByTestId("op-git-init"));
    expect(calls("git.init")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("op-git-init-go"));
    await waitFor(() => expect(calls("git.init")).toHaveLength(1));
  });

  it("選んだファイルだけをコミットする。メッセージが空・何も選ばないときは押せない。差分は、行の種類で色分けされる", async () => {
    rpc["git.status"] = () => ({ isRepo: true, ownRepo: true, branch: "main", clean: false, identityConfigured: true, files: [{ path: "a.json", status: "M", staged: false }, { path: "b.json", status: "?", staged: false }] });
    rpc["git.diff"] = () => ({ diff: "@@ -1 +1 @@\n-old\n+new\n", truncated: false });
    rpc["git.commit"] = () => ({ commit: "abc", files: 1 });
    await open("git");
    const commit = (await screen.findByTestId("op-git-commit")) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    const rows = screen.getAllByTestId("op-git-file");
    fireEvent.click(within(rows[0]).getByRole("checkbox"));
    fireEvent.change(screen.getByTestId("op-git-message"), { target: { value: "直した" } });
    expect(commit.disabled).toBe(false);
    fireEvent.click(within(rows[0]).getByRole("button", { name: "差分" }));
    const diff = await screen.findByTestId("op-git-diff");
    await waitFor(() => expect(diff.querySelector(".op-add")?.textContent).toContain("+new"));
    expect(diff.querySelector(".op-del")?.textContent).toContain("-old");
    fireEvent.click(commit);
    await waitFor(() => expect(calls("git.commit")).toEqual([{ message: "直した", paths: ["a.json"] }]));
  });
});

describe("取り込み", () => {
  const DDL = "CREATE TABLE orders (id bigint primary key, name varchar(10));";
  it("DDL を貼ると予行が出て、選んだものだけを、新規のテーブルとして保存する。既にあるものは作らない", async () => {
    rpc.listAllTables = () => [{ id: "orders", physicalName: "orders" }];
    await open("import");
    fireEvent.change(await screen.findByTestId("op-ddl-text"), { target: { value: `${DDL} CREATE TABLE customers (id int);` } });
    const rows = await screen.findAllByTestId("op-ddl-row");
    expect(rows).toHaveLength(2);
    await waitFor(() => expect(within(rows[0]).getByText(/既にあるため、作りません/)).toBeTruthy());
    expect(within(rows[1]).getByText("新規に作る")).toBeTruthy();
    const { saveTable } = await import("../../store/tableStore");
    fireEvent.click(screen.getByTestId("op-ddl-apply"));
    await waitFor(() => expect(saveTable).toHaveBeenCalledTimes(1));
    expect((saveTable as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0][0]).toMatchObject({ id: "customers", physicalName: "customers", maturity: "draft" });
    expect(toast).toHaveBeenCalledWith("1 件のテーブルを取り込みました");
  });

  it("DDL でない文には、理由を出す。OpenAPI は JSON でないと理由を出す", async () => {
    await open("import");
    fireEvent.change(await screen.findByTestId("op-ddl-text"), { target: { value: "SELECT 1" } });
    expect((await screen.findByTestId("op-ddl-preview")).textContent).toContain("CREATE TABLE が見つかりませんでした");
    fireEvent.change(screen.getByTestId("op-openapi-text"), { target: { value: "openapi: 3.0.0" } });
    expect((await screen.findByTestId("op-openapi-warnings")).textContent).toContain("JSON として読めません");
  });
});

describe("生成の管理・版と更新", () => {
  it("乖離のある生成物を数えて示し、変わった設計の差分を取りに行く", async () => {
    rpc["generation.status"] = () => ({ problems: [], rows: [
      { path: "gen/a.ts", state: "design-changed", at: "2026-10-01T00:00:00.000Z", changedSources: [{ kind: "table", id: "orders", state: "changed" }] },
      { path: "gen/b.ts", state: "current", at: "2026-10-01T00:00:00.000Z", changedSources: [] },
    ] });
    rpc["generation.diff"] = () => ({ diffs: [{ path: "gen/a.ts", sources: [{ kind: "table", id: "orders", state: "changed", truncated: false, changes: [{ path: "comment", type: "added", after: "追記" }] }] }] });
    await open("generation");
    expect((await screen.findByTestId("op-generation-summary")).textContent).toContain("1 件が、確認を要します (全 2 件)");
    fireEvent.click(screen.getByTestId("op-drift-diff"));
    expect((await screen.findByTestId("op-drift-diff-view")).textContent).toContain("追記");
    expect(calls("generation.diff")).toEqual([{ path: "gen/a.ts" }]);
  });

  it("版・コミット・リリースノートを出し、更新の確認は押したときだけ問い合わせる", async () => {
    rpc["app.checkUpdate"] = () => ({ status: "behind", message: "更新があります" });
    await open("version");
    expect((await screen.findByTestId("op-version-info")).textContent).toContain("1.2.3");
    expect(screen.getByTestId("op-release-notes").textContent).toContain("更新あり");
    expect(calls("app.checkUpdate")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("op-version-check"));
    expect((await screen.findByTestId("op-version-update")).textContent).toBe("更新があります");
    expect(localStorage.getItem("harmony.seenVersion")).toBe("1.2.3+abc1234"); // この画面で版を見たので、更新の案内は出さない
  });
});
