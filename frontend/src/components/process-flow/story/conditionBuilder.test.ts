import { describe, expect, it } from "vitest";
import type { ActionDefinition } from "../../../types/v3";
import { clauseProblem, composeCondition, exprToValue, parseCondition, selectColumns, undefinedRefs, valueToExpr, varCandidates } from "./conditionBuilder";

describe("parseCondition / composeCondition", () => {
  it("単純な比較の並びを、部品にして、元の式に戻せる", () => {
    for (const e of ["@customer == null", "@a.b != null", "@x.isActive == false", "@problems.length > 0", "@inputs.paymentTerm == 'prepaid'", "@a == 1 && @b >= 2 && @c != null", "@a == 1 || @b == 2"]) {
      const m = parseCondition(e)!;
      expect(m, e).not.toBeNull();
      expect(composeCondition(m), e).toBe(e);
    }
  });
  it("部品: 主語・演算・値", () => {
    expect(parseCondition("@customer == null")).toEqual({ join: "&&", clauses: [{ subject: "@customer", op: "null", value: "" }] });
    expect(parseCondition("@x.ok == true")!.clauses[0]).toEqual({ subject: "@x.ok", op: "true", value: "" });
    expect(parseCondition("@a === 'x'")!.clauses[0]).toEqual({ subject: "@a", op: "==", value: "'x'" });
    expect(parseCondition("@a == 1 || @b == 2")!.join).toBe("||");
  });
  it("部品にできない式は null (入れ子の括弧・混在・関数・三項・比較でない式)", () => {
    for (const e of ["(@a == 1 || @b == 2) && @c == 3", "@a == 1 && @b == 2 || @c == 3", "fn(@a) > 1", "@a ? 1 : 2", "@a", "@a + 1 > 2", "@a == @b + 1"]) expect(parseCondition(e), e).toBeNull();
  });
  it("空の式は、部品が 0 件", () => {
    expect(parseCondition("")).toEqual({ join: "&&", clauses: [] });
  });
});

describe("値", () => {
  it("文字は引用符で囲み、数・変数・true/false/null はそのまま", () => {
    expect(valueToExpr("prepaid")).toBe("'prepaid'");
    expect(valueToExpr("0")).toBe("0");
    expect(valueToExpr("@credit.limit")).toBe("@credit.limit");
    expect(valueToExpr("it's")).toBe("'it\\'s'");
    expect(valueToExpr("'x'")).toBe("'x'");
    expect(valueToExpr("")).toBe("");
  });
  it("入力欄に出す形は、引用符を外す", () => {
    expect(exprToValue("'prepaid'")).toBe("prepaid");
    expect(exprToValue("10")).toBe("10");
    expect(exprToValue("@a.b")).toBe("@a.b");
  });
});

describe("selectColumns", () => {
  it("別名・列名・関数つきの別名を読む。* は読まない", () => {
    expect(selectColumns('SELECT id, full_name AS "name", credit_limit AS "creditLimit", COALESCE(SUM(x), 0) AS "receivable" FROM t WHERE a = 1')).toEqual(["id", "name", "creditLimit", "receivable"]);
    expect(selectColumns("SELECT c.id, c.status FROM carts c")).toEqual(["id", "status"]);
    expect(selectColumns("SELECT * FROM t")).toEqual([]);
    expect(selectColumns("UPDATE t SET a = 1")).toEqual([]);
  });
});

describe("varCandidates", () => {
  const action = {
    id: "a", name: "x", trigger: "submit",
    inputs: [{ name: "customerId", label: "取引先ID", type: "integer" }],
    steps: [
      { id: "s1", kind: "dbAccess", tableId: "t", operation: "SELECT", sql: 'SELECT id, is_active AS "isActive" FROM t', outputBinding: { name: "customer", label: "取引先" } },
      { id: "s2", kind: "loop", loopKind: "collection", collectionSource: "@inputs.lines", collectionItemName: "line", collectionItemLabel: "明細の行", steps: [
        { id: "s2a", kind: "compute", expression: "1", outputBinding: { name: "total" } },
      ] },
      { id: "s3", kind: "transactionScope", steps: [], outputBinding: { name: "txResult", expose: ["committed", "error", "newOrder"] } },
      { id: "s4", kind: "compute", expression: "1" },
    ],
  } as unknown as ActionDefinition;
  it("その工程より前で作られる変数と、入力だけ", () => {
    expect(varCandidates(action, "s1").map((c) => c.ref)).toEqual(["@inputs"]);
    expect(varCandidates(action, "s2").map((c) => c.ref)).toEqual(["@customer", "@inputs"]);
    expect(varCandidates(action, "s4").map((c) => c.ref)).toEqual(["@customer", "@total", "@txResult", "@inputs"]);
  });
  it("繰り返しの 1 行は、その繰り返しの中でだけ", () => {
    expect(varCandidates(action, "s2a").map((c) => c.ref)).toContain("@line");
    expect(varCandidates(action, "s4").map((c) => c.ref)).not.toContain("@line");
  });
  it("項目の候補: DB の検索結果の列・入力の名前・TX の結果", () => {
    const c = varCandidates(action, "s4");
    expect(c.find((x) => x.ref === "@customer")!.props.map((p) => p.name)).toEqual(["id", "isActive"]);
    expect(c.find((x) => x.ref === "@inputs")!.props).toEqual([{ name: "customerId", label: "取引先ID" }]);
    expect(c.find((x) => x.ref === "@txResult")!.props.map((p) => p.name)).toEqual(["committed", "error.code", "newOrder"]);
  });
});

describe("条件の足りないところ・作られていない変数", () => {
  it("値・主語が足りない部品は、決められない", () => {
    expect(clauseProblem({ subject: "@customer", op: "==", value: "" })).toBe("比べる値を入れてください");
    expect(clauseProblem({ subject: "@customer", op: "null", value: "" })).toBe("");
    expect(clauseProblem({ subject: "@inputs", op: "null", value: "" })).toBe("入力の、どの項目かを選んでください");
    expect(clauseProblem({ subject: "@", op: "null", value: "" })).toBe("どの値かを選んでください");
  });
  it("この位置より前で作られていない変数の名前を返す。入力・規約などの値は含めない", () => {
    const cands = [{ ref: "@customer", label: "取引先", props: [] }, { ref: "@inputs", label: "入力", props: [] }];
    expect(undefinedRefs("@customer == null && @later > 1 && @conv.limit.x > 0 && @inputs.a == 1", cands)).toEqual(["later"]);
    expect(undefinedRefs("@var.action.later2 == 1", cands)).toEqual(["later2"]);
    expect(undefinedRefs("@customer == null", cands)).toEqual([]);
  });
  it("処理の外から来る値 (ambient) も、候補に入る", () => {
    const action = { id: "a", name: "x", trigger: "submit", steps: [{ id: "s1", kind: "compute", expression: "1" }] } as unknown as ActionDefinition;
    expect(varCandidates(action, "s1", [{ name: "sessionUserId", label: "ログイン中の担当者" }]).map((c) => c.ref)).toEqual(["@inputs", "@sessionUserId"]);
  });
});
