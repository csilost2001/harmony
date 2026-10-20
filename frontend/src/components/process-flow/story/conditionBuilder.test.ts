import { selectShape } from "./sqlShape";
import { describe, expect, it } from "vitest";
import type { ActionDefinition } from "../../../types/v3";
import fs from "node:fs";
import path from "node:path";
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
    expect(parseCondition("@a === 'x'")!.clauses[0]).toEqual({ subject: "@a", op: "==", value: "'x'", strict: true });
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
    // 繰り返しの中で作った変数 (total) は、繰り返しのあとの工程から使える。繰り返しの 1 行 (line) は使えない
    expect(varCandidates(action, "s4").map((c) => c.ref)).toEqual(["@customer", "@total", "@txResult", "@inputs"]);
  });
  it("繰り返しの 1 行は、その繰り返しの中でだけ", () => {
    expect(varCandidates(action, "s2a").map((c) => c.ref)).toContain("@line");
    expect(varCandidates(action, "s4").map((c) => c.ref)).not.toContain("@line");
  });
  it("項目の候補: DB の検索結果の列・入力の名前・TX の結果", () => {
    const c = varCandidates(action, "s4");
    expect(c.find((x) => x.ref === "@customer")!.props.map((p) => p.name)).toEqual(["length", "id", "isActive"]); // 1 件に絞る条件がない検索は、一覧になりうるので「件数」(length) も候補に出る
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
  it("入力の公開された短縮形 (@入力名) は、「作られていない」変数にしない", () => {
    const cands = [{ ref: "@inputs", label: "入力", props: [{ name: "generateAudio", label: "音声を作る" }] }];
    expect(undefinedRefs("@generateAudio == true", cands)).toEqual([]);
  });
  it("処理の外から来る値 (ambient) も、候補に入る", () => {
    const action = { id: "a", name: "x", trigger: "submit", steps: [{ id: "s1", kind: "compute", expression: "1" }] } as unknown as ActionDefinition;
    expect(varCandidates(action, "s1", [{ name: "sessionUserId", label: "ログイン中の担当者" }]).map((c) => c.ref)).toEqual(["@inputs", "@sessionUserId"]);
  });
});

describe("意味を変えない書き戻し (レビュー対応)", () => {
  it("厳密な比較 (===, !==) と、!= true / !== null などは、触らなければ、そのまま書き戻す", () => {
    for (const e of ["@passwordValid != true", "@x != false", "@a !== null", "@a === 'x'", "@inputs.productCode != null && @inputs.productCode !== ''", "@a === null", "@a !== true"]) {
      const m = parseCondition(e);
      expect(m, e).not.toBeNull();
      expect(composeCondition(m!), e).toBe(e);
    }
  });
  it("文字列の値は、引用符・空白・バックスラッシュを、往復で壊さない", () => {
    for (const v of ["a b", "pending review", "it's", "a\\b", "x\"y"]) expect(exprToValue(valueToExpr(v)), v).toBe(v);
    expect(valueToExpr("pending review")).toBe("'pending review'");
  });
  it("実サンプルの、部品にできるすべての条件が、式を変えずに戻る", () => {
    const root = path.resolve(__dirname, "../../../../../examples");
    const exprs: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (o.kind === "expression" && typeof o.expression === "string") exprs.push(o.expression);
        Object.values(o).forEach(walk);
      }
    };
    const files: string[] = [];
    const scan = (d: string) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) scan(p); else if (p.includes("process-flows") && p.endsWith(".json")) files.push(p); } };
    scan(root);
    for (const f of files) walk(JSON.parse(fs.readFileSync(f, "utf-8")));
    let parsed = 0;
    for (const e of exprs) {
      const m = parseCondition(e);
      if (!m || m.clauses.length === 0) continue;
      parsed++;
      expect(composeCondition(m), e).toBe(e.trim().replace(/\s+/g, " ").replace(/\s*(&&|\|\|)\s*/g, " $1 "));
    }
    expect(parsed).toBeGreaterThan(10);
  });
});

describe("変数の候補の範囲 (レビュー対応)", () => {
  const action = {
    id: "a", name: "x", trigger: "submit",
    steps: [
      { id: "s1", kind: "branch", branches: [{ id: "b1", code: "A", condition: { kind: "expression", expression: "" }, steps: [{ id: "s1a", kind: "compute", expression: "1", outputBinding: { name: "inArm" } }] }, { id: "b2", code: "B", condition: { kind: "expression", expression: "" }, steps: [{ id: "s1b", kind: "compute", expression: "2" }] }] },
      { id: "s2", kind: "transactionScope", steps: [{ id: "s2a", kind: "compute", expression: "1", outputBinding: { name: "inTx" } }, { id: "s2b", kind: "compute", expression: "2" }], outputBinding: { name: "txResult" } },
      { id: "s3", kind: "compute", expression: "3" },
    ],
  } as unknown as ActionDefinition;
  it("別の道・まとまりの中で作られる変数は、外からは使えない", () => {
    expect(varCandidates(action, "s1b").map((c) => c.ref)).toEqual(["@inputs"]); // 兄弟の道の変数は出ない
    // 道の中で作った変数 (inArm) は、そのあとの外側の工程から使える (検査と同じ)。まとまりの中の変数 (inTx) は、外からは使えない
    expect(varCandidates(action, "s3").map((c) => c.ref)).toEqual(["@inArm", "@txResult", "@inputs"]);
    expect(varCandidates(action, "s2b").map((c) => c.ref)).toEqual(["@inArm", "@inTx", "@inputs"]); // まとまりの中では、前の工程の変数が出る (自分の TX の結果は、まだ無い)
  });
  it("まとまりの「確定したあと」「取り消したあと」の中からは、まとまりの中の変数が見える", () => {
    const a = {
      id: "a", name: "x", trigger: "submit",
      steps: [{ id: "t", kind: "transactionScope", steps: [{ id: "t1", kind: "compute", expression: "1", outputBinding: { name: "inner" } }], onCommit: [{ id: "c1", kind: "compute", expression: "1" }], onRollback: [{ id: "r1", kind: "compute", expression: "1" }], outputBinding: { name: "txResult" } }],
    } as unknown as ActionDefinition;
    expect(varCandidates(a, "c1").map((c) => c.ref)).toContain("@inner");
    expect(varCandidates(a, "r1").map((c) => c.ref)).toContain("@inner");
  });
  it("繰り返しの中で作った変数 (push) は、繰り返しのあとの工程から使える", () => {
    const a = {
      id: "a", name: "x", trigger: "submit",
      steps: [{ id: "l", kind: "loop", loopKind: "collection", collectionSource: "@inputs.lines", collectionItemName: "line", steps: [{ id: "l1", kind: "compute", expression: "1", outputBinding: { name: "enriched", operation: "push" } }] }, { id: "z", kind: "compute", expression: "1" }],
    } as unknown as ActionDefinition;
    expect(varCandidates(a, "z").map((c) => c.ref)).toContain("@enriched");
    expect(varCandidates(a, "z").map((c) => c.ref)).not.toContain("@line");
  });
  it("beforeStepId が null: 最上位で作られる変数だけ", () => {
    expect(varCandidates(action, null).map((c) => c.ref)).toEqual(["@inArm", "@txResult", "@inputs"]);
  });
});

describe("selectShape (検索の結果が 1 件か一覧か)", () => {
  it("1 件: LIMIT 1・主キーの一致・集計だけ。それ以外は一覧", () => {
    expect(selectShape("SELECT id FROM t WHERE id = @inputs.id")).toBe("one");
    expect(selectShape('SELECT c.id FROM customers c WHERE c."id" = @inputs.customerId AND c.active = true')).toBe("one");
    expect(selectShape("SELECT * FROM t WHERE code = @inputs.code LIMIT 1")).toBe("one");
    expect(selectShape("SELECT COUNT(*) AS n, SUM(x) AS s FROM t WHERE a = @inputs.a")).toBe("one");
    expect(selectShape("SELECT a, COUNT(*) AS n FROM t GROUP BY a")).toBe("list");
    expect(selectShape("SELECT id, name FROM t WHERE store_id = @inputs.storeId")).toBe("list");
    expect(selectShape("SELECT id FROM t WHERE parent_id = @inputs.p")).toBe("list");
  });
});
