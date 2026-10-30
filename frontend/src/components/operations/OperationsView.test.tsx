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
    "scaffold.status": { status: "not-applicable", reason: "このワークスペースには、開発コンテナの雛形の記録がありません" },
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
    await waitFor(() => expect(calls("reviewComments.load").length).toBeGreaterThan(1)); // 返信のあとの読み直しが終わってから、解決する
    fireEvent.click(await within(section).findByTestId("op-thread-resolve"));
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

describe("読めない項目のある設定ファイル", () => {
  it("利用者と権限: 読めない項目があると、「捨てて保存する」ことを承知するまで保存できない。承知すると、捨てる保存として送る", async () => {
    rpc["access.load"] = () => ({ access: { version: 1, users: [{ name: "花子", role: "admin" }], policy: { requireApprovalForCommitted: false } }, problems: ["利用者「太郎」: 役割は viewer / editor / approver / admin のどれかです"], you: { name: "花子", role: "admin", enforced: true } });
    rpc["access.save"] = () => ({ access: {}, problems: [] });
    await open("access");
    await screen.findByTestId("op-access-discard");
    fireEvent.click(screen.getByTestId("op-access-policy"));
    expect((screen.getByTestId("op-access-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("op-access-discard-check"));
    expect((screen.getByTestId("op-access-save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("op-access-save"));
    await waitFor(() => expect(calls("access.save")).toHaveLength(1));
    expect((calls("access.save")[0] as { discardUnreadable: boolean }).discardUnreadable).toBe(true);
  });

  it("通知: 同じ。問題が無いときは、承知の欄を出さない", async () => {
    rpc["notify.load"] = () => ({ problems: ["通知先「x」: https:// の URL だけ使えます"], webhooks: [{ id: "h1", name: "チーム", format: "slack", events: [], enabled: true, urlMasked: "https://x.example.com/…" }] });
    rpc["notify.save"] = () => ({ saved: 1 });
    await open("notify");
    await screen.findByTestId("op-notify-discard");
    fireEvent.click(screen.getByTestId("op-hook-event-approval"));
    expect((screen.getByTestId("op-notify-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("op-notify-discard-check"));
    fireEvent.click(screen.getByTestId("op-notify-save"));
    await waitFor(() => expect(calls("notify.save")).toHaveLength(1));
    expect((calls("notify.save")[0] as { discardUnreadable: boolean }).discardUnreadable).toBe(true);
  });
});

describe("通知", () => {
  it("問題の無い設定には、承知の欄を出さない", async () => {
    await open("notify");
    await screen.findByTestId("op-hook-add");
    expect(screen.queryByTestId("op-notify-discard")).toBeNull();
  });

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

  it("一部の取り込みが失敗したら、入力を残し、失敗した名前を知らせる。全部できたときだけ入力を空にする (続編 第 10 弾 レビュー M2)", async () => {
    rpc.listAllTables = () => [];
    const { saveTable } = await import("../../store/tableStore");
    const mocked = saveTable as unknown as { mockClear: () => void; mockImplementationOnce: (f: (t: { id: string }) => Promise<void>) => void };
    mocked.mockClear();
    // 2 件目だけ失敗する
    mocked.mockImplementationOnce(async () => undefined);
    mocked.mockImplementationOnce(async () => { throw new Error("保存できません"); });
    await open("import");
    const text = "CREATE TABLE a1 (id int); CREATE TABLE b2 (id int); CREATE TABLE c3 (id int);";
    fireEvent.change(await screen.findByTestId("op-ddl-text"), { target: { value: text } });
    await waitFor(() => expect(screen.getAllByTestId("op-ddl-row")).toHaveLength(3));
    fireEvent.click(screen.getByTestId("op-ddl-apply"));
    await waitFor(() => expect(toast.mock.calls.some((c) => String(c[0]).includes("失敗: b2"))).toBe(true));
    expect(toast.mock.calls.some((c) => String(c[0]).includes("3 件中 2 件を取り込みました (1 件は失敗しました)"))).toBe(true);
    expect((screen.getByTestId("op-ddl-text") as HTMLTextAreaElement).value).toBe(text); // 入力は残る
    expect(screen.getByTestId("op-ddl-apply")).toBeTruthy(); // やり直せる
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
    // 差分の枠は、取得中の表示で先に出る。中身が入るまで待つ (待たないと、負荷の高いときに「取得中」を読んで落ちる)
    await waitFor(() => expect(screen.getByTestId("op-drift-diff-view").textContent).toContain("追記"));
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
    expect(screen.queryByTestId("op-version-image")).toBeNull(); // git の作業コピーなので、配布 image の表示は出さない
    expect(screen.queryByTestId("op-version-warn")).toBeNull();
  });

  it("配布 image は、commit・作った日時・取得元を出し、main 以外のブランチ・未コミットの変更つきなら注意を出す。更新の確認に N commit が出る (#1577)", async () => {
    rpc["app.version"] = () => ({ version: "1.2.3", commit: "0123456", commitFull: "0123456789abcdef0123456789abcdef01234567", branch: "feat/issue-1561-x", dirty: true, source: "image", builtAt: "2026-10-30T11:23:00.000Z", repo: "csilost2001/harmony", startedAt: "2026-10-31T00:00:00.000Z", notes: [], notesTotal: 0 });
    rpc["app.checkUpdate"] = () => ({ status: "behind", message: "この image は main より 12 commit 古いです。image を作り直してください", behindBy: 12, aheadBy: 0 });
    await open("version");
    const info = (await screen.findByTestId("op-version-info")).textContent ?? "";
    expect(info).toContain("配布 image");
    expect(info).toContain("0123456");
    expect(info).toContain("github.com/csilost2001/harmony");
    const warns = screen.getAllByTestId("op-version-warn").map((e) => e.textContent ?? "");
    expect(warns).toHaveLength(2);
    expect(warns[0]).toContain("feat/issue-1561-x");
    expect(warns[1]).toContain("コミットしていない変更");
    fireEvent.click(screen.getByTestId("op-version-check"));
    expect((await screen.findByTestId("op-version-update")).textContent).toContain("main より 12 commit 古い");
  });

  it("配布 image が main の commit 済みから作られていれば、注意は出ない (#1577)", async () => {
    rpc["app.version"] = () => ({ version: "1.2.3", commit: "0123456", branch: "main", dirty: false, source: "image", builtAt: "2026-10-30T11:23:00.000Z", repo: "csilost2001/harmony", startedAt: "2026-10-31T00:00:00.000Z", notes: [], notesTotal: 0 });
    await open("version");
    expect((await screen.findByTestId("op-version-info")).textContent).toContain("配布 image");
    expect(screen.queryByTestId("op-version-warn")).toBeNull();
  });

  it("開発コンテナの雛形: 該当しなければ理由だけ。古ければ状態・版・AI への頼み方を出す (#1577)", async () => {
    await open("version");
    expect((await screen.findByTestId("op-scaffold-status")).textContent).toBe("該当しません");
    expect(screen.getByTestId("op-scaffold-reason").textContent).toContain("記録がありません");
    expect(screen.queryByTestId("op-scaffold-ask")).toBeNull();
  });

  it("開発コンテナの雛形が新しくなっていれば、記録の版といまの版と、「AI に頼む」案内が出る (#1577)", async () => {
    rpc["scaffold.status"] = () => ({ status: "outdated", combo: "spring-boot-thymeleaf", recordedVersion: "aaaaaaaaaaaa", currentVersion: "bbbbbbbbbbbb", outDir: "." });
    await open("version");
    expect((await screen.findByTestId("op-scaffold-status")).textContent).toBe("雛形が新しくなっています");
    const info = screen.getByTestId("op-scaffold-info").textContent ?? "";
    expect(info).toContain("spring-boot-thymeleaf");
    expect(info).toContain("aaaaaaaaaaaa");
    expect(info).toContain("bbbbbbbbbbbb");
    expect(screen.getByTestId("op-scaffold-ask").textContent).toContain("開発コンテナの雛形の更新を取り込んで");
  });

  it("開発コンテナの雛形: 記録が無い (Harmony の image を使う) ときも案内が出る。最新なら案内は出ない (#1577)", async () => {
    rpc["scaffold.status"] = () => ({ status: "no-record", combo: "nestjs-nextjs", currentVersion: "bbbbbbbbbbbb" });
    await open("version");
    expect((await screen.findByTestId("op-scaffold-status")).textContent).toBe("雛形の記録がありません");
    expect(screen.getByTestId("op-scaffold-ask")).toBeTruthy();
  });

  it("開発コンテナの雛形が最新なら、案内は出ない (#1577)", async () => {
    rpc["scaffold.status"] = () => ({ status: "current", combo: "nestjs-nextjs", recordedVersion: "bbbbbbbbbbbb", currentVersion: "bbbbbbbbbbbb" });
    await open("version");
    expect((await screen.findByTestId("op-scaffold-status")).textContent).toBe("最新です");
    expect(screen.queryByTestId("op-scaffold-ask")).toBeNull();
  });
});
