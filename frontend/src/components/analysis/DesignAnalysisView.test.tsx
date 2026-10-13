/**
 * 設計の分析の画面: 各タブが、設計から分析を出す・抑制と独自ルールを backend へ送る。
 * 分析そのものの正しさは logic/*.test.ts。ここでは、画面の操作と、backend への要求を確かめる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildDesignDocument, issueKey, type CheckSettings, type DesignDocInput } from "@harmony/shared";
import { tiny } from "./logic/fixtures";

const request = vi.fn();
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: { request: (...a: unknown[]) => request(...a), onBroadcast: () => () => undefined, onStatusChange: () => () => undefined, startWithoutEditor: () => undefined },
}));
const loadDesignInput = vi.fn();
vi.mock("../document/loadDesignInput", () => ({ loadDesignInput: () => loadDesignInput() }));
vi.mock("../../hooks/useWorkspacePath", () => ({ useWorkspacePath: () => ({ wsPath: (p: string) => `/w/x${p}` }) }));
const toast = vi.fn();
vi.mock("../../utils/toast", () => ({ showToast: (...a: unknown[]) => toast(...a) }));
vi.mock("../../utils/failureToast", () => ({ reportFailure: vi.fn() }));
import { DesignAnalysisView } from "./DesignAnalysisView";

let settings: CheckSettings;
let input: DesignDocInput;
const rpc: Record<string, (p: unknown) => unknown> = {};

beforeEach(() => {
  request.mockReset(); loadDesignInput.mockReset(); toast.mockReset();
  localStorage.clear();
  settings = { version: 1, suppressions: [], rules: [] };
  input = tiny();
  for (const k of Object.keys(rpc)) delete rpc[k];
  loadDesignInput.mockImplementation(async () => ({ input: { ...input, checkSettings: settings }, skipped: [] }));
  request.mockImplementation(async (method: string, params: unknown) => {
    if (method === "designCheck.load") return { settings, problems: [] };
    if (rpc[method]) return rpc[method](params);
    if (method === "design.progress") return { summary: {}, history: [] };
    throw new Error(`unexpected ${method}`);
  });
});

/** 要確認の表で、この指摘 (対象と内容が同じ) の行 */
const issueRows = (i: { section: string; message: string }) => {
  const table = screen.queryByTestId("an-issues-table");
  return table ? within(table).getAllByRole("row").filter((r) => r.textContent?.includes(i.section) && r.textContent?.includes(i.message)) : [];
};

const open = async (tab?: string) => {
  render(<MemoryRouter><DesignAnalysisView /></MemoryRouter>);
  await screen.findByTestId("an-issues");
  if (tab) fireEvent.click(screen.getByTestId(`an-tab-${tab}`));
};

describe("設計の分析: 全体", () => {
  it("8 つのタブがあり、選んだタブを覚えて、次に開いたときの初期値にする", async () => {
    await open("maps");
    expect(screen.getByTestId("an-maps")).toBeTruthy();
    expect(localStorage.getItem("harmony.analysis.tab")).toBe("maps");
    expect(screen.getAllByRole("tab")).toHaveLength(8);
  });

  it("読み込みに失敗したら、理由を出す", async () => {
    loadDesignInput.mockRejectedValue(new Error("つながりません"));
    render(<MemoryRouter><DesignAnalysisView /></MemoryRouter>);
    expect((await screen.findByRole("alert")).textContent).toContain("つながりません");
  });

  it("読めなかった設計があれば、点検に含まれないことを知らせる", async () => {
    loadDesignInput.mockResolvedValue({ input: { ...input, checkSettings: settings }, skipped: ["画面「ghost」"] });
    render(<MemoryRouter><DesignAnalysisView /></MemoryRouter>);
    expect((await screen.findByTestId("an-issues")).textContent).toContain("画面「ghost」");
  });
});

describe("要確認: 抑制", () => {
  it("理由が空のあいだは抑制できず、理由と期限を付けて backend へ送る", async () => {
    rpc["designCheck.suppress"] = () => ({ settings, problems: [] });
    await open();
    const doc = buildDesignDocument({ ...input, generatedAt: "2026-10-13T00:00:00Z" });
    const target = doc.issues.find((i) => i.section.startsWith("画面 注文入力"))!;
    const rows = within(screen.getByTestId("an-issues-table")).getAllByRole("row");
    const row = rows.find((r) => r.textContent?.includes(target.message) && r.textContent?.includes("注文入力"))!;
    fireEvent.click(within(row).getByTestId("an-suppress-open"));
    const submit = screen.getByTestId("an-suppress-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("an-suppress-reason"), { target: { value: "  仕様どおり  " } });
    fireEvent.change(screen.getByTestId("an-suppress-expires"), { target: { value: "2099-12-31" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(request).toHaveBeenCalledWith("designCheck.suppress", expect.objectContaining({
      key: issueKey(target), reason: "  仕様どおり  ", expiresOn: "2099-12-31", severity: target.severity, section: target.section, message: target.message,
    })));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("抑制しました"));
    expect(loadDesignInput.mock.calls.length).toBeGreaterThanOrEqual(2); // 送ったあと、読み直す
  });

  it("抑制中の指摘は要確認から消え、理由・期限・抑制した人とともに一覧に出る。外せる", async () => {
    const doc = buildDesignDocument({ ...input, generatedAt: "2099-01-01T00:00:00Z" });
    const t = doc.issues[0];
    settings = { version: 1, rules: [], suppressions: [{ key: issueKey(t), reason: "意図どおり", expiresOn: "2099-12-31", by: "松木田", at: "2026-10-01T00:00:00Z", severity: t.severity, section: t.section, message: t.message }] };
    rpc["designCheck.unsuppress"] = () => ({ settings, problems: [] });
    await open();
    const sup = screen.getByTestId("an-suppressed-table");
    expect(sup.textContent).toContain("意図どおり");
    expect(sup.textContent).toContain("2099-12-31");
    expect(sup.textContent).toContain("松木田 / 2026-10-01");
    expect(issueRows(t).length).toBe(0); // 要確認の表には、もう出ない
    fireEvent.click(within(sup).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("designCheck.unsuppress", { key: issueKey(t) }));
  });

  it("期限切れは要確認に戻り、該当のなくなった抑制は「まとめて整理」できる", async () => {
    const doc = buildDesignDocument({ ...input, generatedAt: "2099-01-01T00:00:00Z" });
    const t = doc.issues[0];
    const orphan = { key: "i-0000000000000000", reason: "昔の理由", at: "2026-01-01T00:00:00Z", severity: "warning" as const, section: "消えた", message: "もう出ない" };
    settings = { version: 1, rules: [], suppressions: [{ key: issueKey(t), reason: "期限つき", expiresOn: "2026-01-02", at: "2026-01-01T00:00:00Z", severity: t.severity, section: t.section, message: t.message }, orphan] };
    rpc["designCheck.unsuppress"] = () => ({ settings, problems: [] });
    await open();
    expect(screen.getByTestId("an-expired").textContent).toContain("期限つき");
    expect(issueRows(t).length).toBe(1); // 要確認に戻っている
    const o = screen.getByTestId("an-orphaned");
    expect(o.textContent).toContain("もう出ない");
    fireEvent.click(within(o).getByRole("button", { name: "まとめて整理" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("designCheck.unsuppress", { keys: ["i-0000000000000000"] }));
  });

  it("重大度と文字で絞り込める", async () => {
    await open();
    const total = within(screen.getByTestId("an-issues-table")).getAllByRole("row").length;
    fireEvent.change(screen.getByLabelText("重大度で絞る"), { target: { value: "warning" } });
    expect(within(screen.getByTestId("an-issues-table")).queryAllByRole("row").length).toBeLessThan(total);
    fireEvent.change(screen.getByLabelText("重大度で絞る"), { target: { value: "error" } });
    expect(screen.getByText("要確認事項はありません。")).toBeTruthy(); // エラーは無い
    fireEvent.change(screen.getByLabelText("重大度で絞る"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("絞り込み"), { target: { value: "存在しない文字列" } });
    expect(screen.getByText("要確認事項はありません。")).toBeTruthy();
  });
});

describe("影響分析", () => {
  it("テーブルを選ぶと、連鎖して影響する設計を段ごとに出す。列で絞れる", async () => {
    await open("impact");
    fireEvent.change(screen.getByTestId("an-impact-target"), { target: { value: "customer" } });
    const level1 = screen.getByTestId("an-impact-level-1");
    expect(level1.textContent).toContain("注文入力");
    expect(level1.textContent).toContain("注文登録");
    expect(screen.getByTestId("an-impact-level-2").textContent).toContain("受注");
    fireEvent.change(screen.getByTestId("an-impact-column"), { target: { value: "c-name" } });
    expect(screen.getByTestId("an-impact-result").textContent).toContain("注文入力"); // 顧客名の列に結び付いた画面項目
    expect(screen.getByTestId("an-impact-result").textContent).not.toContain("外部キーで参照している"); // 注文テーブルは、顧客名の列には頼っていない
  });

  it("誰も頼っていない設計は、その旨を出す", async () => {
    await open("impact");
    fireEvent.change(screen.getByTestId("an-impact-target"), { target: { value: "lonely" } });
    expect(screen.getByTestId("an-impact-result").textContent).toContain("影響しません");
  });
});

describe("対応表", () => {
  it("トレーサビリティ表と、欠けを出す。欠けのある行だけに絞れる", async () => {
    await open("maps");
    expect(screen.getByTestId("an-trace-gaps").textContent).toContain("確認する");
    const before = within(screen.getByTestId("an-trace-table")).getAllByRole("row").length;
    fireEvent.click(screen.getByLabelText("欠けのある行だけ"));
    expect(within(screen.getByTestId("an-trace-table")).getAllByRole("row").length).toBeLessThan(before);
  });

  it("画面項目 ↔ カラム: 保存先の無い入力・存在しない列・使われない列を出す", async () => {
    await open("maps");
    fireEvent.click(screen.getByRole("button", { name: "画面項目 ↔ カラム" }));
    expect(screen.getByTestId("an-col-unbound").textContent).toContain("メモ");
    expect(screen.getByTestId("an-col-broken").textContent).toContain("nope");
    expect(screen.getByTestId("an-col-unused").textContent).toContain("memo");
    fireEvent.change(screen.getByLabelText("状態で絞る"), { target: { value: "mapped" } });
    const rows = within(screen.getByTestId("an-col-map")).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.textContent?.includes("列に結び付いている"))).toBe(true);
  });

  it("役割 × 画面 × 操作: 権限の仕組みを使っていなければ、その旨を出す。使っていれば、更新操作の警告を出す", async () => {
    await open("maps");
    fireEvent.click(screen.getByRole("button", { name: "役割 × 画面 × 操作" }));
    expect(screen.getByTestId("an-ops-nomodel")).toBeTruthy();
    expect(screen.getByTestId("an-ops-issues").textContent).toContain("対象外");
  });

  it("権限の仕組みがあれば、更新操作の警告と、役割の列が出る", async () => {
    input = { ...tiny(), roles: { clerk: { name: "担当", permissions: ["order.write"] } } as DesignDocInput["roles"], permissions: { "order.write": {} } as DesignDocInput["permissions"] };
    await open("maps");
    fireEvent.click(screen.getByRole("button", { name: "役割 × 画面 × 操作" }));
    expect(screen.getByTestId("an-ops-issues").textContent).toContain("誰でも実行できます");
    expect(within(screen.getByTestId("an-ops-matrix")).getByRole("columnheader", { name: "担当" })).toBeTruthy();
  });
});

describe("整理", () => {
  it("未使用の定義を種類ごとに出す", async () => {
    await open("cleanup");
    expect(screen.getByTestId("an-unused-table").textContent).toContain("孤立");
    expect(screen.getByTestId("an-unused-message").textContent).toContain("spare");
    expect(screen.getByTestId("an-unused-processFlow").textContent).toContain("迷子");
  });

  it("用語の揺れを出す", async () => {
    await open("cleanup");
    fireEvent.click(screen.getByRole("button", { name: "用語の揺れ" }));
    const t = screen.getByTestId("an-terms-same-physical-different-display");
    expect(t.textContent).toContain("お客様ID");
    expect(t.textContent).toContain("顧客ID");
  });

  it("メッセージの使用箇所と、重複を出す", async () => {
    input = { ...tiny(), messages: { a: { template: "同じ文面です" }, b: { template: "同じ文面です" } } };
    await open("cleanup");
    fireEvent.click(screen.getByRole("button", { name: "メッセージ・文言" }));
    expect(screen.getByTestId("an-msg-usage").textContent).toContain("@conv.msg.a");
    expect(screen.getByTestId("an-msg-similar").textContent).toContain("同じ文面");
  });
});

describe("運用", () => {
  it("SLA の宣言漏れ・ジョブ・外部システムの突き合わせ", async () => {
    input = tiny();
    input.flows[0].actions[0].httpRoute = { method: "POST", path: "/api/orders" };
    input.flows.push({ meta: { id: "nightly", name: "夜間集計", flowType: "batch" }, actions: [{ id: "a", name: "集計", trigger: "timer", steps: [] }] } as never);
    input.flows.push({ meta: { id: "pay", name: "決済", flowType: "common" }, context: { catalogs: { externalSystems: { pay: { name: "決済会社", openApiSpec: "specs/pay.json" } } } }, actions: [{ id: "a", name: "x", trigger: "auto", steps: [{ id: "s", kind: "externalSystem", systemRef: "pay", httpCall: { method: "GET", path: "/x" } }] }] } as never);
    input.externalSpecs = { "specs/pay.json": { source: "specs/pay.json", operations: [{ method: "POST", path: "/charges" }] } };
    await open("ops");
    expect(screen.getByTestId("an-sla-gaps").textContent).toContain("注文登録");
    fireEvent.click(screen.getByRole("button", { name: "ジョブ" }));
    expect(screen.getByTestId("an-jobs").textContent).toContain("夜間集計");
    fireEvent.click(screen.getByRole("button", { name: "外部システムの契約" }));
    const ext = screen.getByTestId("an-external");
    expect(ext.textContent).toContain("相手の定義に無いパス");
    expect(ext.textContent).toContain("POST /charges"); // 呼んでいない操作
  });
});

describe("進捗", () => {
  it("種類ごとの完成度と、確定までの残りを出し、その日の記録を求める", async () => {
    (input.screens[0] as unknown as { maturity: string }).maturity = "committed";
    rpc["design.progress"] = () => ({ history: [{ date: "2026-10-01", byKind: { screen: { draft: 2, provisional: 0, committed: 0, total: 2 }, processFlow: { draft: 2, provisional: 0, committed: 0, total: 2 }, table: { draft: 3, provisional: 0, committed: 0, total: 3 }, businessFlow: { draft: 1, provisional: 0, committed: 0, total: 1 }, report: { draft: 0, provisional: 0, committed: 0, total: 0 } } }, { date: "2026-10-13", byKind: { screen: { draft: 1, provisional: 0, committed: 1, total: 2 }, processFlow: { draft: 2, provisional: 0, committed: 0, total: 2 }, table: { draft: 3, provisional: 0, committed: 0, total: 3 }, businessFlow: { draft: 1, provisional: 0, committed: 0, total: 1 }, report: { draft: 0, provisional: 0, committed: 0, total: 0 } } }] });
    await open("progress");
    await waitFor(() => expect(request).toHaveBeenCalledWith("design.progress", { record: true }));
    expect(screen.getByTestId("an-progress-table").textContent).toContain("全体");
    expect(screen.getByTestId("an-progress-remaining").textContent).toContain("注文一覧");
    await waitFor(() => expect(screen.getByTestId("an-trend")).toBeTruthy());
  });
});

describe("ルール", () => {
  it("ルールを足して条件を決め、試し打ちの件数を見て、保存する", async () => {
    rpc["designCheck.saveRules"] = () => ({ settings, problems: [] });
    await open("rules");
    expect((screen.getByTestId("an-rules-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("an-rule-add"));
    fireEvent.change(screen.getByTestId("an-rule-name"), { target: { value: "テーブルの説明は必須" } });
    expect(screen.getByTestId("an-rules-preview").textContent).toContain("3 件の違反"); // 3 テーブルとも説明が無い
    const save = screen.getByTestId("an-rules-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(request).toHaveBeenCalledWith("designCheck.saveRules", { rules: [expect.objectContaining({ id: "rule-1", name: "テーブルの説明は必須", target: "table", path: "description", check: { type: "required" }, severity: "warning" })] }));
  });

  it("壊れたルール (危険な正規表現) は、保存させずに理由を出す", async () => {
    await open("rules");
    fireEvent.click(screen.getByTestId("an-rule-add"));
    fireEvent.change(screen.getByTestId("an-rule-name"), { target: { value: "x" } });
    fireEvent.change(screen.getByTestId("an-rule-check"), { target: { value: "pattern" } });
    fireEvent.change(screen.getByPlaceholderText("例: ^[a-z]+$"), { target: { value: "(a+)+" } });
    expect(screen.getByTestId("an-rules-problems").textContent).toContain("繰り返しの入れ子");
    expect((screen.getByTestId("an-rules-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("backend が保存を拒否したら、理由を出す", async () => {
    rpc["designCheck.saveRules"] = () => { throw new Error("design-check.json に読めない項目があるため、書き換えません"); };
    await open("rules");
    fireEvent.click(screen.getByTestId("an-rule-add"));
    fireEvent.change(screen.getByTestId("an-rule-name"), { target: { value: "r" } });
    fireEvent.click(screen.getByTestId("an-rules-save"));
    expect((await screen.findAllByRole("alert")).some((a) => a.textContent?.includes("書き換えません"))).toBe(true);
  });

  it("命名規約の設定状況 (規約カタログのキー・DB 規約の既定) を出す", async () => {
    input = { ...tiny(), regex: { namingScreen: { pattern: "^scr-" } } as DesignDocInput["regex"], db: { default: { namingConvention: "snake_case", default: true } } };
    await open("rules");
    const n = screen.getByTestId("an-naming").textContent ?? "";
    expect(n).toContain("設定済み: ^scr-");
    expect(n).toContain("DB 規約の既定: snake_case");
    expect(n).toContain("未設定");
  });

  it("保存済みのルールがあれば、最初から一覧に出る", async () => {
    settings = { version: 1, suppressions: [], rules: [{ id: "r1", name: "既存のルール", target: "table", path: "description", check: { type: "required" }, severity: "info" }] };
    await open("rules");
    expect(screen.getAllByTestId("an-rule")).toHaveLength(1);
    expect((screen.getByTestId("an-rule-name") as HTMLInputElement).value).toBe("既存のルール");
  });
});

describe("書き出し", () => {
  it("テスト雛形: ファイル一覧と中身を出し、種類を切り替えられる", async () => {
    await open("export");
    expect(screen.getByTestId("an-scaffold-count").textContent).toMatch(/\d+ ファイル/);
    expect(screen.getByTestId("an-preview").textContent).toContain("it.todo(");
    fireEvent.change(screen.getByTestId("an-scaffold-framework"), { target: { value: "playwright" } });
    expect(screen.getByTestId("an-preview").textContent).toContain("test.fixme(");
  });

  it("テストデータ: INSERT 文・CSV・JSON を出す。CSV はテーブルを 1 つ選んだときだけ", async () => {
    await open("export");
    fireEvent.click(screen.getByRole("button", { name: "テストデータ" }));
    expect(screen.getByTestId("an-preview").textContent).toContain("INSERT INTO");
    fireEvent.change(screen.getByTestId("an-testdata-rows"), { target: { value: "3" } });
    expect(screen.getByTestId("an-preview").textContent).toContain("(3 件)");
    fireEvent.change(screen.getByTestId("an-testdata-format"), { target: { value: "csv" } });
    expect(screen.getByText("CSV は、テーブルを 1 つだけ選んだときに出せます。")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("対象のテーブル"), { target: { value: "customer" } });
    // multiple select: 選択状態を作る
    const sel = screen.getByLabelText("対象のテーブル") as HTMLSelectElement;
    Array.from(sel.options).forEach((o) => { o.selected = o.value === "customer"; });
    fireEvent.change(sel);
    expect(screen.getByTestId("an-preview").textContent).toContain("customer_id,customer_name,memo");
    fireEvent.change(screen.getByTestId("an-testdata-format"), { target: { value: "json" } });
    expect(screen.getByTestId("an-preview").textContent).toContain('"table": "customer"');
  });

  it("OpenAPI: HTTP の契約が無ければ警告、あれば文書を出す", async () => {
    await open("export");
    fireEvent.click(screen.getByRole("button", { name: "OpenAPI" }));
    expect(screen.getByTestId("an-openapi").textContent).toContain("HTTP の契約");
    input = tiny();
    input.flows[0].actions[0].httpRoute = { method: "POST", path: "/api/orders" };
    fireEvent.click(screen.getByRole("button", { name: "読み直す" }));
    await waitFor(() => expect(screen.getByTestId("an-openapi-count").textContent).toContain("1 操作"));
    expect(screen.getByTestId("an-preview").textContent).toContain('"openapi": "3.0.3"');
  });
});
