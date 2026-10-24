import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ActionDefinition } from "../../../types/v3";
import { collectAllProcessFlowLocalIds } from "../../../utils/localIdGenerator";
import { subscribeToasts, type ToastMessage } from "../../../utils/toast";
import { ProcessFlowStory } from "./ProcessFlowStory";

const flowCtx = { tableName: (id: string) => ({ order: "注文" }[id]), screenName: () => undefined };
const TABLES: Array<{ id: string; name: string; physicalName: string; uniqueKeys?: string[][] }> = [{ id: "order", name: "注文", physicalName: "orders" }, { id: "customer", name: "顧客", physicalName: "customers" }];

function base(): ActionDefinition {
  return ({
    id: "a1", name: "試験", trigger: "submit",
    inputs: [{ name: "customerId", label: "取引先ID", type: "integer" }],
    responses: [{ id: "200-ok", status: 200, description: "完了" }, { id: "404-nf", status: 404, description: "取引先なし" }, { id: "422-x", status: 422, description: "不備" }],
    steps: [
      { id: "step-01", kind: "dbAccess", heading: "取引先を確かめる", description: "取引先を取得する", tableId: "order", operation: "SELECT", sql: "SELECT id, is_active AS \"isActive\" FROM t", outputBinding: { name: "customer", label: "取引先" } },
      { id: "step-02", kind: "branch", description: "無ければ返す", branches: [{ id: "br-01", code: "A", condition: { kind: "expression", expression: "@customer == null" }, steps: [{ id: "step-03", kind: "return", description: "404", responseId: "404-nf" }] }], elseBranch: { id: "br-02", code: "B", steps: [] } },
      { id: "step-04", kind: "return", description: "完了を返す", responseId: "200-ok" },
    ],
  }) as unknown as ActionDefinition;
}

/** 編集中の下書きを持つ、試験用の入れ物 (本番の ProcessFlowEditor の updateGroupWithDraft の代わり) */
function Harness({ initial = base(), editable = true, onAsk, onUndo, tables = TABLES }: { initial?: ActionDefinition; editable?: boolean; onAsk?: (p: string) => void; onUndo?: () => void; tables?: typeof TABLES }) {
  const [action, setAction] = useState(initial);
  return (
    <>
      <ProcessFlowStory
        action={action}
        reviewKey="t:edit"
        ctx={flowCtx}
        selectedStepIds={new Set()}
        onSelectStep={vi.fn()}
        onOpenStep={vi.fn()}
        editable={editable}
        onMutate={(fn) => setAction((cur) => { const next = structuredClone(cur); fn(next); return next; })}
        flowIds={() => collectAllProcessFlowLocalIds({ actions: [action] })}
        tables={tables}
        onAskAi={onAsk}
        onUndo={onUndo}
      />
      <pre data-testid="dump">{JSON.stringify(action)}</pre>
    </>
  );
}
const dump = (): ActionDefinition => JSON.parse(screen.getByTestId("dump").textContent ?? "{}") as ActionDefinition;
const stepIds = () => dump().steps.map((s) => s.id);

describe("流れの表示: その場で直す (編集中)", () => {
  beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => cleanup());

  it("閲覧中は、足す・消す・動かすの窓口が出ない", () => {
    render(<Harness editable={false} />);
    expect(screen.queryByTestId("pfs-gap-add")).toBeNull();
    expect(screen.queryByTestId("pfs-delete")).toBeNull();
    expect(screen.queryByTestId("pfs-up")).toBeNull();
  });

  it("行の間の「＋」から、ひな型を選んで、その位置に足せる (ガード: 条件の窓がそのまま開く)", () => {
    render(<Harness />);
    const gaps = screen.getAllByTestId("pfs-gap-add");
    fireEvent.click(gaps[0]); // 最上位の先頭
    fireEvent.click(screen.getByTestId("pfs-template-guard"));
    const ids = stepIds();
    expect(ids).toHaveLength(4);
    expect(ids[1]).toBe("step-01");
    const guard = dump().steps[0] as unknown as { kind: string; branches: Array<{ condition: { expression: string }; steps: Array<{ responseId: string }> }> };
    expect(guard.kind).toBe("branch");
    expect(guard.branches[0].steps[0].responseId).toBe("404-nf");
    // 続けて、条件を決める窓が開く
    expect(screen.getByTestId("pfs-popover")).toHaveTextContent("この道に進む条件");
  });

  it("「1 件取得して、無ければ返す」: 取得と、それを見るガードが入り、テーブルを選ぶ窓が開く", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByTestId("pfs-gap-add").at(-1)!);
    fireEvent.click(screen.getByTestId("pfs-template-lookup"));
    const s = dump().steps;
    // 末尾に、取得 → ガードが入る (もとの 3 工程の後ろ)
    expect(s.map((x) => x.kind)).toEqual(["dbAccess", "branch", "return", "dbAccess", "branch"]);
    expect(String((s[4] as unknown as { branches: Array<{ condition: { expression: string } }> }).branches[0].condition.expression)).toBe("@found == null");
    expect(screen.getByTestId("pfs-popover")).toHaveTextContent("どのテーブルを使う");
    fireEvent.click(screen.getByRole("option", { name: /顧客/ }));
    expect((dump().steps[3] as unknown as { tableId: string }).tableId).toBe("customer");
  });

  it("説明をその場で書き換える (Enter で確定、Esc でやめる)", () => {
    render(<Harness />);
    // 説明が空の行はないので、説明のある行を直す: 「完了を返す」をクリック
    fireEvent.click(screen.getByText("完了を返す"));
    const input = screen.getByPlaceholderText("（何をするか書く）");
    fireEvent.change(input, { target: { value: "書き換えた" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dump().steps.some((s) => s.description === "書き換えた")).toBe(true);
  });

  it("消す・1 つ上へ / 下へ", () => {
    render(<Harness />);
    const rows = screen.getAllByTestId("pfs-row");
    fireEvent.click(within(rows[0]).getByTestId("pfs-down"));
    expect(stepIds()).toEqual(["step-02", "step-01", "step-04"]);
    // 「完了を返す」(最後の工程) を消す
    const last = screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === "step-04")!;
    fireEvent.click(within(last).getByTestId("pfs-delete"));
    expect(stepIds()).toEqual(["step-02", "step-01"]);
  });

  it("キーボード: Alt+↓ で動かし、Delete で消す", () => {
    render(<Harness />);
    const row = screen.getAllByTestId("pfs-row")[0];
    fireEvent.keyDown(row, { key: "ArrowDown", altKey: true });
    expect(stepIds()).toEqual(["step-02", "step-01", "step-04"]);
    fireEvent.keyDown(screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === "step-04")!, { key: "Delete" });
    expect(stepIds()).toEqual(["step-02", "step-01"]);
  });

  it("条件を、選びで直す (どの値を / どうなら / 値) → 式と言葉が同時に変わる", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("pfs-guard-cond"));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.change(within(pop).getByLabelText("比べ方"), { target: { value: "!=" } });
    fireEvent.change(within(pop).getByLabelText("比べる値"), { target: { value: "0" } });
    expect(within(pop).getByTestId("pfs-cond-preview")).toHaveTextContent("@customer != 0");
    fireEvent.click(within(pop).getByTestId("pfs-cond-apply"));
    const arm = (dump().steps[1] as unknown as { branches: Array<{ condition: { expression: string } }> }).branches[0];
    expect(arm.condition.expression).toBe("@customer != 0");
  });

  it("条件に、条件を足せる (かつ)。DB の検索結果の列が、項目の候補に出る", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("pfs-guard-cond"));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.click(within(pop).getByText("＋ 条件を足す"));
    expect(within(pop).getAllByTestId("pfs-clause")).toHaveLength(2);
    expect(pop.querySelector("datalist option[value='isActive']")).not.toBeNull();
    const props = within(pop).getAllByLabelText("項目")[1];
    fireEvent.change(props, { target: { value: "isActive" } });
    fireEvent.change(within(pop).getAllByLabelText("比べ方")[1], { target: { value: "false" } });
    fireEvent.click(within(pop).getByTestId("pfs-cond-apply"));
    const arm = (dump().steps[1] as unknown as { branches: Array<{ condition: { expression: string } }> }).branches[0];
    expect(arm.condition.expression).toBe("@customer == null && @customer.isActive == false");
  });

  it("足りない部品 (値が空) のままでは、決められない。作られていない変数は、知らせる", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("pfs-guard-cond"));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.change(within(pop).getByLabelText("比べ方"), { target: { value: "==" } });
    expect(within(pop).getByTestId("pfs-cond-problem")).toHaveTextContent("比べる値を入れてください");
    expect(within(pop).getByTestId("pfs-cond-apply")).toBeDisabled();
    fireEvent.click(within(pop).getByText("式を直接書く"));
    fireEvent.change(within(pop).getByLabelText("条件の式"), { target: { value: "@later == null" } });
    expect(within(pop).getByTestId("pfs-cond-missing")).toHaveTextContent("@later");
  });

  it("組み立てられない式 (括弧・関数) は、式のまま直せる", () => {
    const a = base();
    (a.steps[1] as unknown as { branches: Array<{ condition: unknown }> }).branches[0].condition = { kind: "expression", expression: "(@a == 1 || @b == 2) && @c == 3" };
    render(<Harness initial={a} />);
    fireEvent.click(screen.getByTestId("pfs-guard-cond"));
    const pop = screen.getByTestId("pfs-popover");
    const ta = within(pop).getByLabelText("条件の式");
    expect((ta as HTMLTextAreaElement).value).toBe("(@a == 1 || @b == 2) && @c == 3");
    fireEvent.change(ta, { target: { value: "@c == 4" } });
    fireEvent.click(within(pop).getByTestId("pfs-cond-apply"));
    expect(JSON.stringify(dump().steps[1])).toContain("@c == 4");
  });

  it("テーブルの印から、テーブルを選び直せる", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTitle(/注文 — クリックで直す/));
    fireEvent.click(screen.getByRole("option", { name: /顧客/ }));
    expect((dump().steps[0] as unknown as { tableId: string }).tableId).toBe("customer");
  });

  it("結果の変数の呼び名と名前を直すと、それを使う式も直る", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTitle(/この工程で作る変数 customer — クリックで直す/));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.change(within(pop).getByLabelText("名前"), { target: { value: "client" } });
    fireEvent.change(within(pop).getByLabelText("呼び名"), { target: { value: "顧客" } });
    fireEvent.click(within(pop).getByRole("button", { name: "決める" }));
    const d = dump();
    expect((d.steps[0] as unknown as { outputBinding: unknown }).outputBinding).toEqual({ name: "client", label: "顧客" });
    expect(JSON.stringify(d.steps[1])).toContain("@client == null");
    expect(JSON.stringify(d.steps[1])).not.toContain("@customer");
  });

  it("名前が形式に合わない・重なるときは、決められない", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTitle(/この工程で作る変数 customer — クリックで直す/));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.change(within(pop).getByLabelText("名前"), { target: { value: "取引先" } });
    expect(within(pop).getByRole("button", { name: "決める" })).toBeDisabled();
  });

  it("見出しを付ける・書き換える・外す", () => {
    render(<Harness />);
    const last = screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === "step-04")!;
    fireEvent.click(within(last).getByTestId("pfs-add-heading"));
    expect(dump().steps[2]).toMatchObject({ heading: "新しい区切り" });
    // 書き換える
    const headings = screen.getAllByRole("button", { name: "見出しを書き換える" });
    fireEvent.click(headings[1]);
    const input = screen.getByRole("textbox", { name: "見出しを書き換える" });
    fireEvent.change(input, { target: { value: "仕上げ" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dump().steps[2]).toMatchObject({ heading: "仕上げ" });
    // 外す
    fireEvent.click(screen.getAllByRole("button", { name: "見出しを外す" })[1]);
    expect("heading" in dump().steps[2]).toBe(false);
  });

  it("道 (条件) を足す・消す。「それ以外」を作る", () => {
    const a = base();
    a.steps.splice(1, 1, {
      id: "step-02", kind: "branch", description: "分ける",
      branches: [{ id: "br-01", code: "A", condition: { kind: "expression", expression: "@customer == null" }, steps: [{ id: "step-03", kind: "compute", description: "控える", expression: "1" }] }],
    } as never);
    render(<Harness initial={a} />);
    fireEvent.click(screen.getByTestId("pfs-add-arm"));
    expect((dump().steps[1] as unknown as { branches: unknown[] }).branches).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("この道を消す")[0]);
    expect((dump().steps[1] as unknown as { branches: unknown[] }).branches).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "＋ それ以外" }));
    expect((dump().steps[1] as unknown as { elseBranch?: unknown }).elseBranch).toBeTruthy();
  });

  it("ひな型の ID は、すでにある ID と重ならない", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByTestId("pfs-gap-add")[0]);
    fireEvent.click(screen.getByTestId("pfs-template-workflow"));
    const all = collectAllProcessFlowLocalIds({ actions: [dump()] });
    const count = JSON.stringify(dump().steps).match(/"id":/g)!.length + 1 + 3; // +1 は、アクションの ID、+3 は、応答の ID
    expect(all.size).toBe(count);
  });

  it("日本語で頼む: AI への頼みが、位置つきで渡る", () => {
    const ask = vi.fn();
    render(<Harness onAsk={ask} />);
    fireEvent.click(screen.getAllByTestId("pfs-gap-add")[1]);
    fireEvent.change(screen.getByPlaceholderText(/在庫が足りなければ/), { target: { value: "在庫が足りなければ 422 を返す" } });
    fireEvent.click(screen.getByRole("button", { name: "頼む" }));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toContain("在庫が足りなければ 422 を返す");
    expect(ask.mock.calls[0][0]).toContain("試験");
    // 位置は、前後の工程の ID と説明で示される (step-01 と step-02 の間)
    expect(ask.mock.calls[0][0]).toContain("直前の工程: step-01 (取引先を取得する)");
    expect(ask.mock.calls[0][0]).toContain("直後の工程: step-02");
  });

  it("工程が 0 件でも、最初の工程を足せる", () => {
    const a = base();
    a.steps = [];
    render(<Harness initial={a} />);
    fireEvent.click(screen.getByTestId("pfs-gap-add"));
    fireEvent.click(screen.getByTestId("pfs-template-compute"));
    expect(dump().steps).toHaveLength(1);
  });

  it("承認の枠 (承認されたら・却下されたら・期限が切れたら) は、無ければ「＋」で足せる", () => {
    const a = base();
    a.steps.push({ id: "step-09", kind: "workflow", description: "承認", pattern: "approval-sequential", approvers: [] } as never);
    render(<Harness initial={a} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 承認されたら" }));
    expect(Array.isArray((dump().steps.at(-1) as unknown as { onApproved?: unknown }).onApproved)).toBe(true);
  });

  it("ドラッグで、別の位置へ動かせる (持ち手 → 行の間)。自分の中へは動かせない", () => {
    const store: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] ?? "", get types() { return Object.keys(store); }, effectAllowed: "", dropEffect: "" };
    render(<Harness />);
    const last = screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === "step-04")!;
    fireEvent.dragStart(last.querySelector(".pfs-handle")!, { dataTransfer: dt });
    // 先頭の「行の間」へ落とす
    const gap = screen.getAllByTestId("pfs-gap-add")[0].parentElement!;
    fireEvent.dragOver(gap, { dataTransfer: dt });
    fireEvent.drop(gap, { dataTransfer: dt });
    expect(stepIds()).toEqual(["step-04", "step-01", "step-02"]);
  });

  it("まとまりの「確定したあと」「取り消したあと」を足すと、空の枠が出て、中に工程を足せる", () => {
    const a = base();
    a.steps.push({ id: "step-09", kind: "transactionScope", description: "確定する", steps: [] } as never);
    render(<Harness initial={a} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 確定したあと" }));
    expect(screen.getByText("確定したあと", { selector: ".pfs-arm-lab" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ 確定したあと" })).toBeNull();
    // 空の枠にも、足す入口がある
    expect(screen.getAllByTestId("pfs-gap-add").length).toBeGreaterThan(3);
  });

  it("入力チェックの「不正なときの処理」を足すと、枠が出る", () => {
    const a = base();
    a.steps.unshift({ id: "step-00", kind: "validation", description: "入力", fieldErrorsVar: "fieldErrors", rules: [] } as never);
    render(<Harness initial={a} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 不正なときの処理" }));
    expect(screen.getByText("ひとつでも不正なら", { selector: ".pfs-arm-lab" })).toBeInTheDocument();
  });

  it("式でない条件 (エラーを捕まえる道) は、直す窓口を出さず、カードへ案内する。中身は消えない", () => {
    const a = base();
    a.steps.push({
      id: "step-09", kind: "branch", description: "失敗したら",
      branches: [{ id: "br-09", code: "A", condition: { kind: "tryCatch", errorCode: "E1", errorVar: "caught" }, steps: [{ id: "step-10", kind: "compute", description: "控える", expression: "1" }] }],
      elseBranch: { id: "br-10", code: "X", steps: [] },
    } as never);
    render(<Harness initial={a} />);
    expect(screen.getByText(/この種類の条件は、カードで直します/)).toBeInTheDocument();
    expect(screen.getByText(/エラー「E1」が起きたとき/)).toBeInTheDocument();
    expect(screen.queryAllByTestId("pfs-arm-cond")).toHaveLength(0);
    expect(JSON.stringify(dump().steps.at(-1))).toContain("errorVar");
  });

  it("窓の中のダブルクリックは、行の「カードで開く」にならない", () => {
    const onOpen = vi.fn();
    const Wrap = () => {
      const [action, setAction] = useState(base());
      return <ProcessFlowStory action={action} reviewKey="t:dbl" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={onOpen} editable onMutate={(fn) => setAction((cur) => { const n = structuredClone(cur); fn(n); return n; })} flowIds={() => new Set()} tables={TABLES} />;
    };
    render(<Wrap />);
    fireEvent.click(screen.getByTitle(/注文 — クリックで直す/));
    fireEvent.doubleClick(screen.getByPlaceholderText("テーブルを探す (名前・物理名)"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("結果の変数の名前に、予約語 (inputs ほか) は使えない", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTitle(/この工程で作る変数 customer — クリックで直す/));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.change(within(pop).getByLabelText("名前"), { target: { value: "inputs" } });
    expect(within(pop).getByRole("button", { name: "決める" })).toBeDisabled();
    expect(pop).toHaveTextContent("この名前は使えません");
  });

  it("「＋ 結果の変数」で新しい名前を決めても、ほかの文字は書き換わらない", () => {
    const a = base();
    a.steps.push({ id: "step-09", kind: "compute", description: "連絡先 @ に送る", expression: "1" } as never);
    render(<Harness initial={a} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 結果の変数" }));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.change(within(pop).getByLabelText("名前"), { target: { value: "newVar" } });
    fireEvent.click(within(pop).getByRole("button", { name: "決める" }));
    expect(dump().steps.at(-1)).toMatchObject({ description: "連絡先 @ に送る", outputBinding: { name: "newVar" } });
  });

  it("繰り返しの「一覧」が空のときは、選ぶ入口が出る。ひな型は、本物に見える仮の値を入れない", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByTestId("pfs-gap-add").at(-1)!);
    fireEvent.click(screen.getByTestId("pfs-template-loop"));
    const loop = dump().steps.at(-1) as unknown as { kind: string; collectionSource: string };
    expect(loop.kind).toBe("loop");
    expect(loop.collectionSource).toBe("");
    fireEvent.click(screen.getByText("（繰り返す一覧を選ぶ）"));
    fireEvent.change(screen.getByLabelText("一覧の式"), { target: { value: "@inputs.lines" } });
    fireEvent.click(screen.getByRole("button", { name: "この一覧にする" }));
    expect((dump().steps.at(-1) as unknown as { collectionSource: string }).collectionSource).toBe("@inputs.lines");
  });

  it("比べる値に、空白を含む文字を打てる", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("pfs-guard-cond"));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.change(within(pop).getByLabelText("比べ方"), { target: { value: "==" } });
    const input = within(pop).getByLabelText("比べる値");
    fireEvent.change(input, { target: { value: "pending " } });
    expect((input as HTMLInputElement).value).toBe("pending ");
    fireEvent.change(input, { target: { value: "pending review" } });
    expect((input as HTMLInputElement).value).toBe("pending review");
    expect(within(pop).getByTestId("pfs-cond-preview")).toHaveTextContent("@customer == 'pending review'");
  });

  it("消したあとの通知に「元に戻す」が付く。そのあとに別の操作をしたら、戻さない", () => {
    const toasts: ToastMessage[] = [];
    const off = subscribeToasts((t) => toasts.push(t));
    const onUndo = vi.fn();
    render(<Harness onUndo={onUndo} />);
    const last = screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === "step-04")!;
    fireEvent.click(within(last).getByTestId("pfs-delete"));
    expect(toasts.at(-1)?.undo).toBeTypeOf("function");
    toasts.at(-1)!.undo!();
    expect(onUndo).toHaveBeenCalledTimes(1);
    // もう一度消してから、別の操作 (動かす) をすると、戻せない
    fireEvent.click(screen.getAllByTestId("pfs-delete")[0]);
    const undo2 = toasts.at(-1)!.undo!;
    // 動かす操作は、残りが 1 つだと何も変わらず (版も変わらない) 戻せてしまうので、確かに内容が変わる操作 (道を足す) にする
    fireEvent.click(screen.getAllByTestId("pfs-add-arm")[0]);
    undo2();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(toasts.at(-1)?.text).toContain("そのあとに別の操作");
    off();
  });

  it("「移す」: 別の枠 (道の中) を選んで、末尾へ移せる", () => {
    render(<Harness />);
    const last = screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === "step-04")!;
    fireEvent.click(within(last).getByTestId("pfs-move"));
    const dests = screen.getAllByTestId("pfs-move-dest");
    expect(dests.length).toBeGreaterThan(1);
    fireEvent.click(dests.find((d) => d.textContent?.includes("道 A"))!);
    const g = dump().steps.find((s) => s.id === "step-02") as unknown as { branches: Array<{ steps: Array<{ id: string }> }> };
    expect(g.branches[0].steps.map((x) => x.id)).toEqual(["step-03", "step-04"]);
    expect(dump().steps.some((s) => s.id === "step-04")).toBe(false);
  });

  it("結果の変数の「作り方」: 一覧に足すにすると、最初の値 [] も入る", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /→ 取引先/ }));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.change(within(pop).getByLabelText("作り方"), { target: { value: "push" } });
    expect(within(pop).getByLabelText("最初の値")).toHaveValue("[]");
    fireEvent.click(within(pop).getByRole("button", { name: "決める" }));
    expect((dump().steps[0] as unknown as { outputBinding: unknown }).outputBinding).toEqual({ name: "customer", label: "取引先", operation: "push", initialValue: [] });
  });

  it("一覧になりうる検索の結果を「ない」で調べていたら、件数で調べる案内が出る (押すと直る)", () => {
    render(<Harness />);
    // 「一覧」の印が、検索の行に出る
    expect(screen.getByText("結果は一覧")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pfs-guard-cond"));
    const pop = screen.getByTestId("pfs-popover");
    expect(within(pop).getByTestId("pfs-list-hint")).toHaveTextContent("一覧");
    fireEvent.click(within(pop).getByRole("button", { name: /件数が 0/ }));
    expect(within(pop).getByTestId("pfs-cond-preview")).toHaveTextContent("@customer.length == 0");
    fireEvent.click(within(pop).getByTestId("pfs-cond-apply"));
    expect((dump().steps[1] as unknown as { branches: Array<{ condition: { expression: string } }> }).branches[0].condition.expression).toBe("@customer.length == 0");
  });

  it("1 件を探す検索 (一意の列の一致) の結果は、「ない」で調べていても、案内も印も出ない", () => {
    const a = base();
    (a.steps[0] as unknown as { sql: string }).sql = "SELECT id, is_active AS \"isActive\" FROM customers WHERE customer_code = @inputs.code";
    render(<Harness initial={a} tables={[{ id: "customer", name: "顧客", physicalName: "customers", uniqueKeys: [["id"], ["customer_code"]] }]} />);
    expect(screen.queryByText("結果は一覧")).toBeNull();
    fireEvent.click(screen.getByTestId("pfs-guard-cond"));
    expect(screen.queryByTestId("pfs-list-hint")).toBeNull();
  });
});
