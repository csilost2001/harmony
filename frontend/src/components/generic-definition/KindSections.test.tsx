/**
 * 汎用定義の、種類ごとの入力欄 (#1499): 状態遷移・初期データ・非機能要件・ジョブ。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { GenericDefinition } from "../../types/v3/generic-definition";

vi.mock("../../hooks/useWorkspaceReferences", () => ({
  useWorkspaceReferences: () => ({
    screens: [], viewDefinitions: [], components: [], exceptionTypes: [], modelEndpoints: [], secrets: [], events: [],
    tables: [{ id: "t1", name: "店舗", physicalName: "stores", columns: [{ physicalName: "store_code", name: "コード", primaryKey: false, notNull: true }] }],
    processFlows: [{ id: "f1", name: "出荷", kind: "screen" }],
  }),
}));
import { KindSections } from "./KindSections";

function Host({ initial }: { initial: GenericDefinition }) {
  const [def, setDef] = useState(initial);
  return (
    <>
      <KindSections def={def} updateDef={(fn) => setDef((p) => fn(p))} renderIssues={() => null} />
      <pre data-testid="dump">{JSON.stringify(def)}</pre>
    </>
  );
}
const dump = (): GenericDefinition => JSON.parse(screen.getByTestId("dump").textContent ?? "{}") as GenericDefinition;
const base = (kind: GenericDefinition["kind"], extra: Partial<GenericDefinition> = {}): GenericDefinition => ({ kind, name: "X", purpose: "p", responsibilities: ["r"], targets: ["backend"], ...extra });

describe("KindSections", () => {
  afterEach(() => cleanup());

  it("ほかの種類では、何も出さない", () => {
    render(<Host initial={base("message")} />);
    expect(screen.queryByTestId("gd-add-state")).toBeNull();
  });

  it("状態遷移: 状態と遷移を足し、最初の状態は 1 つだけ選べ、遷移の元・先は状態から選ぶ", () => {
    render(<Host initial={base("state-machine")} />);
    fireEvent.click(screen.getByTestId("gd-add-state"));
    fireEvent.click(screen.getByTestId("gd-add-state"));
    fireEvent.change(screen.getByLabelText("状態 1 の名前"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("状態 2 の名前"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("状態 1 の呼び名"), { target: { value: "はじめ" } });
    fireEvent.click(screen.getByLabelText("状態 1 は最初の状態"));
    fireEvent.click(screen.getByLabelText("状態 2 は最初の状態"));
    expect(dump().states).toEqual([{ name: "A", label: "はじめ" }, { name: "B", initial: true }]);
    fireEvent.click(screen.getByLabelText("状態 2 は終わりの状態"));
    expect(dump().states?.[1]).toEqual({ name: "B", initial: true, final: true });

    fireEvent.click(screen.getByTestId("gd-add-transition"));
    fireEvent.change(screen.getByLabelText("遷移 1 の元の状態"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("遷移 1 の先の状態"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("遷移 1 の契機"), { target: { value: "進める" } });
    fireEvent.change(screen.getByLabelText("遷移 1 の処理フロー"), { target: { value: "f1" } });
    expect(dump().transitions).toEqual([{ from: "A", to: "B", trigger: "進める", processFlowId: "f1" }]);
    // 元の選びには、定義にある状態だけが並ぶ
    const opts = within(screen.getByLabelText("遷移 1 の元の状態")).getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["（選ぶ）", "はじめ (A)", "B"]);
    // 状態を消しても、遷移は残り、定義にない状態として見える
    fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
    expect(within(screen.getByLabelText("遷移 1 の元の状態")).getByRole("option", { name: "A (定義にない状態)" })).toBeTruthy();
  });

  it("初期データ: テーブルを選び、行を JSON で直せる。不正な JSON は反映しない", () => {
    render(<Host initial={base("seed-data")} />);
    fireEvent.change(screen.getByLabelText("対象のテーブル"), { target: { value: "t1" } });
    expect(screen.getByText(/store_code \*/)).toBeTruthy();
    const ta0 = screen.getByTestId("gd-seed-rows");
    fireEvent.change(ta0, { target: { value: '[{"store_code":"TOKYO"}]' } });
    fireEvent.blur(ta0);
    const ta = screen.getByTestId("gd-seed-rows"); // 反映すると、欄は作り直される
    expect(dump().tableId).toBe("t1");
    expect(dump().rows).toEqual([{ store_code: "TOKYO" }]);
    fireEvent.change(ta, { target: { value: "[{" } });
    fireEvent.blur(ta);
    expect(dump().rows).toEqual([{ store_code: "TOKYO" }]);
    expect(screen.getByTestId("gd-seed-error").textContent).toContain("JSON として読めません");
    expect((screen.getByTestId("gd-seed-rows") as HTMLTextAreaElement).value).toBe("[{"); // 書いた文字は残る
    fireEvent.change(ta, { target: { value: '["x"]' } });
    fireEvent.blur(ta);
    expect(dump().rows).toEqual([{ store_code: "TOKYO" }]);
    expect(screen.getByTestId("gd-seed-error").textContent).toContain("配列にしてください");
    fireEvent.change(screen.getByTestId("gd-seed-rows"), { target: { value: '[{"store_code":"OSAKA"}]' } });
    fireEvent.blur(screen.getByTestId("gd-seed-rows"));
    expect(screen.queryByTestId("gd-seed-error")).toBeNull();
    expect(dump().rows).toEqual([{ store_code: "OSAKA" }]);
  });

  it("状態の名前を変えると、その状態を指す遷移も追う。名前が空のまま最初の状態にしても、名前の欄は消えない", () => {
    render(<Host initial={base("state-machine", { states: [{ name: "A", initial: true }, { name: "B" }], transitions: [{ from: "A", to: "B", trigger: "t" }] })} />);
    fireEvent.change(screen.getByLabelText("状態 1 の名前"), { target: { value: "Start" } });
    expect(dump().transitions?.[0]).toMatchObject({ from: "Start", to: "B" });
    fireEvent.click(screen.getByTestId("gd-add-state"));
    fireEvent.click(screen.getByLabelText("状態 3 は最初の状態"));
    expect(dump().states?.[2]).toEqual({ name: "", initial: true });
    expect(dump().states?.[0]).toEqual({ name: "Start" });
  });

  it("目標値・実行の種類は、未設定のうちは空で見せる (入れた値だけが定義になる)", () => {
    render(<Host initial={base("requirement")} />);
    expect((screen.getByLabelText("比べ方") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("目標値") as HTMLInputElement).value).toBe("");
    cleanup();
    render(<Host initial={base("job-definition")} />);
    expect((screen.getByLabelText("実行の種類") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("実行の種類"), { target: { value: "interval" } });
    fireEvent.change(screen.getByLabelText("実行の式"), { target: { value: "PT15M" } });
    fireEvent.change(screen.getByLabelText("実行の種類"), { target: { value: "cron" } });
    expect(dump().schedule).toEqual({ kind: "cron" }); // 種類を変えたら、前の式は消える
  });

  it("非機能要件: 目標値を入れる", () => {
    render(<Host initial={base("requirement")} />);
    fireEvent.change(screen.getByLabelText("測るもの"), { target: { value: "応答時間" } });
    fireEvent.change(screen.getByLabelText("比べ方"), { target: { value: "<" } });
    fireEvent.change(screen.getByLabelText("目標値"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("単位"), { target: { value: "ms" } });
    fireEvent.change(screen.getByLabelText("対象の処理フロー"), { target: { value: "f1" } });
    expect(dump().measure).toEqual({ metric: "応答時間", operator: "<", value: 300, unit: "ms" });
    expect(dump().processFlowId).toBe("f1");
    fireEvent.change(screen.getByLabelText("単位"), { target: { value: "" } });
    expect(dump().measure).not.toHaveProperty("unit", "ms");
  });

  it("ジョブ: 時刻・タイムゾーン・再実行を入れる。回数を空にすると再実行の方針ごと外れる", () => {
    render(<Host initial={base("job-definition")} />);
    fireEvent.change(screen.getByLabelText("実行の種類"), { target: { value: "cron" } });
    fireEvent.change(screen.getByLabelText("実行の式"), { target: { value: "0 2 * * *" } });
    fireEvent.change(screen.getByLabelText("タイムゾーン"), { target: { value: "Asia/Tokyo" } });
    fireEvent.change(screen.getByLabelText("実行する処理フロー"), { target: { value: "f1" } });
    expect(screen.queryByLabelText("最大の試行の回数")).toBeNull(); // 再実行しないうちは、欄を出さない
    fireEvent.click(screen.getByLabelText("失敗したら再実行する"));
    fireEvent.change(screen.getByLabelText("最大の試行の回数"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("間隔の取り方"), { target: { value: "exponential" } });
    fireEvent.change(screen.getByLabelText("最初の間隔"), { target: { value: "60" } });
    expect(dump().schedule).toEqual({ kind: "cron", expression: "0 2 * * *", timezone: "Asia/Tokyo" });
    expect(dump().retry).toEqual({ maxAttempts: 3, backoff: "exponential", intervalSeconds: 60 });
    expect(dump().processFlowId).toBe("f1");
    // 回数を打ち直す途中で空にしても、再実行の方針は消えない。外すのは「失敗したら再実行する」のチェック
    fireEvent.change(screen.getByLabelText("最大の試行の回数"), { target: { value: "" } });
    expect(dump().retry).toEqual({ maxAttempts: 3, backoff: "exponential", intervalSeconds: 60 });
    fireEvent.click(screen.getByLabelText("失敗したら再実行する"));
    expect(dump().retry).toBeUndefined();
    expect(screen.queryByLabelText("最大の試行の回数")).toBeNull();
    fireEvent.click(screen.getByLabelText("失敗したら再実行する"));
    expect(dump().retry).toEqual({ maxAttempts: 3 });
  });
});
