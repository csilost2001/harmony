/**
 * 設計どうしの参照の整合 (shared/src/analysis/integrity.ts) と、工程の入れ子の置き場所をすべて歩く forEachStep。
 * shared には試験の実行がないので、ここに置く。
 */
import { describe, expect, it } from "vitest";
import { REF_KINDS_BY_PROPERTY, checkIntegrity, dropBrokenFlowParts, forEachStep, issueHint, type DesignDocInput } from "@harmony/shared";

const base = (): DesignDocInput => ({
  project: { name: "t" },
  screens: [{ id: "s1", name: "画面1", items: [{ id: "i1", binding: { kind: "tableColumn", ref: { tableId: "t1", columnId: "c1" } }, events: [{ id: "e", handlerFlowId: "f1", handlerActionId: "a1" }] }] }],
  tables: [{ id: "t1", name: "表1", columns: [{ id: "c1", physicalName: "col_1" }], constraints: [{ id: "fk", kind: "foreignKey", referencedTableId: "t1", referencedColumnIds: ["c1"] }] }],
  flows: [{
    meta: { id: "f1", name: "処理1", screenId: "s1" },
    actions: [{ id: "a1", responses: [{ id: "r200", status: 200 }], steps: [
      { id: "s-1", kind: "dbAccess", tableId: "t1", operation: "SELECT" },
      { id: "s-2", kind: "branch", branches: [{ id: "b", code: "A", condition: { kind: "expression", expression: "@x == 1" }, steps: [{ id: "s-3", kind: "return", responseId: "r200" }] }] },
    ] }],
  }],
  limits: { max: { value: 1 } }, regex: {}, messages: { ok: {} },
} as unknown as DesignDocInput);

const msgs = (i: DesignDocInput) => checkIntegrity(i).map((x) => `${x.severity}|${x.message}`);

describe("checkIntegrity (設計どうしの参照)", () => {
  it("整った設計は 0 件", () => { expect(checkIntegrity(base())).toEqual([]); });

  it("処理フロー: 画面・テーブル・遷移先・レスポンス・空の条件・工程 id の重複", () => {
    const i = base();
    const f = i.flows[0] as unknown as { meta: Record<string, unknown>; actions: Array<{ steps: Array<Record<string, unknown>> }> };
    f.meta.screenId = "gone";
    f.actions[0].steps[0].tableId = "gone-table";
    f.actions[0].steps.push({ id: "s-9", kind: "screenTransition", targetScreenId: "gone-screen" }, { id: "s-1", kind: "compute", expression: "1" });
    (f.actions[0].steps[1].branches as Array<Record<string, any>>)[0].condition.expression = "  ";
    (f.actions[0].steps[1].branches as Array<Record<string, any>>)[0].steps[0].responseId = "r404";
    const out = msgs(i).join("\n");
    for (const w of ["呼び出す画面「gone」", "テーブル「gone-table」", "遷移先の画面「gone-screen」", "レスポンス「r404」", "条件が空です", "工程の id「s-1」が 2 回"]) expect(out, w).toContain(w);
  });

  it("画面項目: 結びつき先のテーブル・カラム、イベントの処理フロー・アクション", () => {
    const i = base();
    const it = (i.screens[0].items as unknown as Array<Record<string, any>>)[0];
    it.binding.ref = { tableId: "t1", columnId: "gone-col" };
    it.events[0].handlerActionId = "gone-action";
    let out = msgs(i).join("\n");
    expect(out).toContain("カラム「gone-col」");
    expect(out).toContain("アクション「gone-action」");
    it.binding.ref = { tableId: "gone-table", columnId: "c1" };
    it.events[0].handlerFlowId = "gone-flow";
    out = msgs(i).join("\n");
    expect(out).toContain("テーブル「gone-table」");
    expect(out).toContain("処理フロー「gone-flow」");
    // 物理名での結びつきも受ける
    (i.screens[0].items as unknown as Array<Record<string, any>>)[0].binding.ref = { tableId: "t1", columnId: "col_1" };
    (i.screens[0].items as unknown as Array<Record<string, any>>)[0].events = [];
    expect(checkIntegrity(i)).toEqual([]);
  });

  it("テーブル: 外部キーの参照先のテーブル・カラム。noConstraint は見ない", () => {
    const i = base();
    const t = i.tables[0] as unknown as { constraints: Array<Record<string, unknown>> };
    t.constraints[0].referencedTableId = "gone";
    expect(msgs(i).join("\n")).toContain("参照先のテーブル「gone」");
    t.constraints[0].referencedTableId = "t1"; t.constraints[0].referencedColumnIds = ["gone-col"];
    expect(msgs(i).join("\n")).toContain("参照先のカラム「gone-col」");
    t.constraints[0].noConstraint = true;
    expect(checkIntegrity(i)).toEqual([]);
  });

  it("規約の参照: 定義された側があるときだけ見る。定義の中の項目まで書く参照は先頭の名前で見る", () => {
    const i = base();
    (i as unknown as Record<string, unknown>).regex = { zip: {} }; // 定義がある種類だけ見る
    const f = i.flows[0] as unknown as { actions: Array<{ steps: Array<Record<string, unknown>> }> };
    f.actions[0].steps.push({ id: "s-7", kind: "compute", expression: "@conv.limit.max + @conv.limit.max.value + @conv.limit.gone + @conv.msg.ok + @conv.msg.gone2 + @conv.regex.nothing" });
    const out = msgs(i).join("\n");
    expect(out).toContain("@conv.limit.gone");
    expect(out).toContain("@conv.msg.gone2");
    expect(out).toContain("@conv.regex.nothing");
    expect(out).not.toContain("@conv.limit.max」");
    const i2 = base(); (i2 as unknown as Record<string, unknown>).limits = undefined;
    (i2.flows[0] as unknown as { actions: Array<{ steps: Array<Record<string, unknown>> }> }).actions[0].steps.push({ id: "s-7", kind: "compute", expression: "@conv.limit.gone" });
    expect(checkIntegrity(i2)).toEqual([]); // 規約を読めていないときは、言わない
  });

  it("規約の参照: 式が続く参照 (@conv.limit.max-1)・権限キーの : (product:view) を偽陽性にしない。定義が 1 つもない種類は見ない", () => {
    const i = base();
    (i as unknown as Record<string, unknown>).permissions = { "product:view": {} };
    (i.flows[0] as unknown as { actions: Array<{ steps: Array<Record<string, unknown>> }> }).actions[0].steps.push({ id: "s-8", kind: "compute", expression: "@conv.limit.max-1 + @conv.limit.max.value" }, { id: "s-9", kind: "compute", requiredPermissions: ["@conv.permission.product:view"] });
    expect(checkIntegrity(i)).toEqual([]);
    (i.flows[0] as unknown as { actions: Array<{ steps: Array<Record<string, unknown>> }> }).actions[0].steps.push({ id: "s-10", kind: "compute", expression: "@conv.limit.maxx" });
    expect(msgs(i).join("\n")).toContain("@conv.limit.maxx");
    (i as unknown as Record<string, unknown>).limits = {};
    expect(checkIntegrity(i)).toEqual([]); // 上限値の定義が 1 つもない → 規約が読めていないとみなして見ない
  });

  it("入力チェックの NG のレスポンス (ngResponseId) も、responses にあること", () => {
    const i = base();
    (i.flows[0] as unknown as { actions: Array<{ steps: Array<Record<string, unknown>> }> }).actions[0].steps.push({ id: "v", kind: "validation", inlineBranch: { ok: [], ng: [], ngResponseId: "r999" } });
    expect(msgs(i).join("\n")).toContain("レスポンス「r999」");
  });

  it("アクションをまたぐ同じ工程 id は、警告でなく情報", () => {
    const i = base();
    (i.flows[0] as unknown as { actions: unknown[] }).actions.push({ id: "a2", steps: [{ id: "s-1", kind: "compute", expression: "1" }] });
    const out = checkIntegrity(i);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("info");
    expect(out[0].message).toContain("アクションをまたいで");
  });

  it("入れ子 (検証の OK/NG・承認の後・失敗系の副作用) の中の工程も見る", () => {
    const i = base();
    (i.flows[0] as unknown as { actions: Array<{ steps: unknown[] }> }).actions[0].steps.push(
      { id: "v", kind: "validation", inlineBranch: { ok: [], ng: [{ id: "ng-1", kind: "dbAccess", tableId: "gone-ng" }] } },
      { id: "w", kind: "workflow", onApproved: [{ id: "ap-1", kind: "dbAccess", tableId: "gone-ap" }] },
      { id: "x", kind: "externalSystem", errorHandling: { outcomes: { failure: { sideEffects: [{ id: "se-1", kind: "dbAccess", tableId: "gone-se" }] } } } },
    );
    const out = msgs(i).join("\n");
    for (const t of ["gone-ng", "gone-ap", "gone-se"]) expect(out, t).toContain(`テーブル「${t}」`);
  });
});

describe("forEachStep: 入れ子の置き場所をすべて歩く", () => {
  it("steps / subSteps / 分岐の道 / 上記以外 / コミット後・ロールバック時 / 承認・却下・期限切れ / 検証の OK・NG / 失敗系の副作用", () => {
    const steps = [
      { id: "a", kind: "loop", steps: [{ id: "a1", kind: "compute" }], subSteps: [{ id: "a2", kind: "compute" }] },
      { id: "b", kind: "branch", branches: [{ id: "x", code: "A", steps: [{ id: "b1", kind: "compute" }] }], elseBranch: { steps: [{ id: "b2", kind: "compute" }] } },
      { id: "c", kind: "transactionScope", steps: [], onCommit: [{ id: "c1", kind: "log" }], onRollback: [{ id: "c2", kind: "log" }] },
      { id: "d", kind: "workflow", onApproved: [{ id: "d1" }], onRejected: [{ id: "d2" }], onTimeout: [{ id: "d3" }] },
      { id: "e", kind: "validation", inlineBranch: { ok: [{ id: "e1" }], ng: [{ id: "e2" }] } },
      { id: "f", kind: "externalSystem", errorHandling: { outcomes: { failure: { sideEffects: [{ id: "f1" }] }, success: { sideEffects: [{ id: "f2" }] } } } },
    ];
    const seen: string[] = [];
    forEachStep(steps as never, (s) => { seen.push(String((s as { id?: string }).id)); });
    expect(seen.sort()).toEqual(["a", "a1", "a2", "b", "b1", "b2", "c", "c1", "c2", "d", "d1", "d2", "d3", "e", "e1", "e2", "f", "f1", "f2"]);
  });
});

describe("dropBrokenFlowParts: 壊れた工程を取り除く (設計全体の検査が、1 件の壊れた工程で止まらないように)", () => {
  it("null・文字列・数・配列の工程と、配列でない actions / steps を取り除き、取り除いた数を返す。入れ子の中も", () => {
    const f = { meta: { id: "x" }, actions: [{ id: "a", steps: [null, "x", 5, [], { id: "ok", kind: "branch", branches: [{ steps: [null, { id: "in" }] }], elseBranch: { steps: ["z"] }, inlineBranch: { ok: [7], ng: [] } }] }, "bad-action", { id: "b", steps: "nope" }] };
    expect(dropBrokenFlowParts(f)).toBe(4 + 1 + 1 + 1 + 1 + 1); // 工程 4・入れ子 3・不正な action 1・配列でない steps 1
    expect(f.actions).toHaveLength(2);
    expect((f.actions[0] as { steps: unknown[] }).steps).toHaveLength(1);
    expect((f.actions[1] as { steps: unknown[] }).steps).toEqual([]);
    expect(dropBrokenFlowParts({ actions: "x" })).toBe(1);
    expect(dropBrokenFlowParts({ meta: {} })).toBe(0); // actions がなければ、空にするだけ (壊れてはいない)
    expect(dropBrokenFlowParts(null)).toBe(0);
  });
});

describe("checkIntegrity: スキーマの参照の宣言 (x-ref-kind) から、どこの参照も見る", () => {
  const ENTITY: Record<string, string> = { table: "テーブル", screen: "画面", processFlow: "処理フロー" };
  const entityProps = Object.entries(REF_KINDS_BY_PROPERTY).filter(([, k]) => k.length === 1 && ENTITY[k[0]]);

  it("宣言されたテーブル・画面・処理フローの項目は、ないものを指せば、置き場所によらず指摘される", () => {
    expect(entityProps.length).toBeGreaterThan(10);
    for (const [prop, [kind]] of entityProps) {
      const i = base();
      const many = prop.endsWith("Ids");
      (i.flows[0] as unknown as { actions: Array<Record<string, unknown>> }).actions[0].extra = { deep: [{ [prop]: many ? ["nowhere"] : "nowhere" }] };
      const hit = msgs(i).filter((m) => m.includes(`${ENTITY[kind]}「nowhere」がありません (${prop})`));
      expect(hit, prop).toHaveLength(1);
    }
  });

  it("あるものを指す・式・個別の検査が見た場所は、二重に指摘しない", () => {
    const i = base();
    const f = i.flows[0] as unknown as { actions: Array<Record<string, any>>; meta: Record<string, unknown> };
    f.actions[0].extra = { tableId: "t1", screenId: "s1", processFlowId: "f1", tableIds: ["t1"], refId: "@inputs.x", targetScreenId: "{{x}}" };
    expect(checkIntegrity(i)).toEqual([]);
    f.actions[0].steps[0].tableId = "gone";
    f.meta.screenId = "gone";
    expect(msgs(i).filter((m) => /「gone」がありません/.test(m))).toHaveLength(2);
  });

  it("引用符つきの文字・式は、id ではないので見ない", () => {
    const i = base();
    (i.flows[0] as unknown as { actions: Array<Record<string, unknown>> }).actions[0].extra = { screenId: "'S001'", tableId: "orders[0]", processFlowId: "a b" };
    expect(checkIntegrity(i)).toEqual([]);
  });

  it("画面遷移の一覧・画面・テーブルの中も見る", () => {
    const i = base();
    (i as unknown as { transitions: unknown[] }).transitions = [{ sourceScreenId: "s1", targetScreenId: "ghost" }];
    (i.screens[0] as unknown as Record<string, unknown>).extra = { processFlowId: "ghost-flow" };
    const out = msgs(i).join("\n");
    expect(out).toContain("画面「ghost」がありません (targetScreenId)");
    expect(out).toContain("処理フロー「ghost-flow」がありません (processFlowId)");
  });
});

describe("checkIntegrity: 共通処理の呼び出しの契約 (引数と呼び先の入力)", () => {
  const withCall = (callee: unknown, mapping?: Record<string, string>) => {
    const i = base();
    i.flows.push(callee as never);
    (i.flows[0] as unknown as { actions: Array<Record<string, unknown>> }).actions[0].steps = [{ id: "c", kind: "commonProcess", description: "d", refId: "common-1", ...(mapping ? { argumentMapping: mapping } : {}) }];
    return i;
  };
  const common = (inputs: unknown[], more: unknown[] = []) => ({ meta: { id: "common-1", name: "共通", flowType: "common" }, actions: [{ id: "x", inputs }, ...more] });

  it("余分な引数・必須の入力に渡していないものを指摘する", () => {
    const out = msgs(withCall(common([{ name: "id", required: true }, { name: "memo" }]), { memo: "@a", extra: "@b" })).join("\n");
    expect(out).toContain("呼び先の処理フロー「共通」の入力に、引数「extra」がありません");
    expect(out).toContain("必須の入力「id」に、引数が渡されていません");
    expect(out).not.toContain("「memo」");
  });

  it("合っている・既定値がある・アクションが複数 (どれを呼ぶか決められない) ときは、必須の不足を指摘しない", () => {
    expect(checkIntegrity(withCall(common([{ name: "id", required: true }]), { id: "@a" }))).toEqual([]);
    expect(checkIntegrity(withCall(common([{ name: "id", required: true, defaultValue: "1" }])))).toEqual([]);
    expect(checkIntegrity(withCall(common([{ name: "id", required: true }], [{ id: "y", inputs: [] }])))).toEqual([]);
    expect(msgs(withCall(common([{ name: "id" }], [{ id: "y", inputs: [] }]), { zzz: "1" })).join("\n")).toContain("引数「zzz」がありません");
  });
});

describe("checkIntegrity: 結果の形 (outputBinding.shape) と読み方", () => {
  const withSteps = (steps: unknown[]) => { const i = base(); (i.flows[0] as unknown as { actions: Array<Record<string, unknown>> }).actions[0].steps = steps; return i; };
  const bind = (shape?: string) => ({ id: "q", kind: "dbAccess", tableId: "t1", operation: "SELECT", outputBinding: { name: "rows", ...(shape ? { shape } : {}) } });

  it("一覧と宣言した変数を項目名で読む・1 件と宣言した変数を添字で読むと、指摘される", () => {
    expect(msgs(withSteps([bind("list"), { id: "u", kind: "compute", expression: "@rows.name" }])).join("\n")).toContain("一覧 (shape: list) と宣言されていますが、項目名で読んでいます (@rows.name)");
    expect(msgs(withSteps([bind("one"), { id: "u", kind: "compute", expression: "@rows[0].name" }])).join("\n")).toContain("1 件 (shape: one) と宣言されていますが、一覧として読んでいます (@rows[0])");
    expect(msgs(withSteps([bind("one"), { id: "u", kind: "compute", expression: "@rows.map(x => x)" }])).join("\n")).toContain("1 件 (shape: one)");
  });

  it("合った読み方・宣言なし・別の名前は、指摘しない", () => {
    expect(checkIntegrity(withSteps([bind("list"), { id: "u", kind: "compute", expression: "@rows.length + @rows[0].a + @rowsX.b + @rows.map(r => r)" }]))).toEqual([]);
    expect(checkIntegrity(withSteps([bind("one"), { id: "u", kind: "compute", expression: "@rows.name" }]))).toEqual([]);
    expect(checkIntegrity(withSteps([bind(), { id: "u", kind: "compute", expression: "@rows.name + @rows[0]" }]))).toEqual([]);
  });

  it("検証の ok / ng・失敗時の副作用の中の工程の読み方は、その工程だけが指摘される (親と二重にならない)", () => {
    const val = { id: "v", kind: "validation", description: "@rows.name は説明文", inlineBranch: { ok: [{ id: "u", kind: "compute", expression: "@rows.name" }], ng: [] } };
    const hits = msgs(withSteps([bind("list"), val])).filter((m) => m.includes("変数「rows」は一覧"));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("工程 u");
  });

  it("同じ名前を別の形で宣言した変数 (分岐ごとの同名) は、決められないので見ない", () => {
    expect(checkIntegrity(withSteps([bind("list"), { ...bind("one"), id: "q2" }, { id: "u", kind: "compute", expression: "@rows.name + @rows[0]" }]))).toEqual([]);
  });

  it("入れ子の工程の中の読み方も見る。結果を作る工程自身の式 (SQL など) は、自分の変数として見ない", () => {
    const nested = { id: "b", kind: "branch", branches: [{ id: "x", code: "A", condition: { kind: "expression", expression: "@rows.id == 1" }, steps: [] }] };
    expect(msgs(withSteps([bind("list"), nested])).join("\n")).toContain("工程 b: 変数「rows」は一覧");
  });
});

describe("issueHint: 主な指摘に、直し方が付く (実際の文言で)", () => {
  const CASES: Array<[string, RegExp, string?]> = [
    ["/actions/0/steps/2/x: 画面「x」がありません (screenId)", /list_screens.*screenId/],
    ["アクション a の工程 c: 呼び先の処理フロー「共通」の入力に、引数「extra」がありません (argumentMapping)", /inputs.*argumentMapping/],
    ["アクション a の工程 c: 呼び先の処理フロー「共通」の必須の入力「id」に、引数が渡されていません (argumentMapping)", /argumentMapping.*「id」/],
    ["アクション a の工程 s: 変数「rows」は一覧 (shape: list) と宣言されていますが、項目名で読んでいます (@rows.name)。1 件なら…", /shape を|"one"/],
    ["アクション a の工程 s: 変数「rows」は 1 件 (shape: one) と宣言されていますが、一覧として読んでいます (@rows[0])。一覧なら…", /"list"/],
    ["アクション act-001 の工程 step-02: テーブル「no-such-table」がありません (tableId)", /list_tables.*tableId/],
    ["呼び出す画面「x」がありません (meta.screenId)", /list_screens.*update_process_flow/],
    ["アクション a の工程 s: 遷移先の画面「x」がありません (targetScreenId)", /targetScreenId/],
    ["項目「i」の結びつき先のテーブル「x」がありません (binding.ref.tableId)", /editSession__create/],
    ["項目「i」の結びつき先のカラム「x」が、テーブル「t」にありません (binding.ref.columnId)", /editSession__update/],
    ["外部キーの参照先のテーブル「x」がありません (referencedTableId)", /update_table.*definition/],
    ["外部キーの参照先のカラム「x」が、テーブル「t」にありません (referencedColumnIds)", /referencedColumnIds/],
    ["規約の上限値「@conv.limit.nope」が、規約に定義されていません", /get_conventions.*save_conventions/],
    ["アクション a で、工程の id「step-01」が 2 回使われています (id は一意にしてください)", /list_steps.*update_step/],
    ["アクション a の工程 s: 道「A」の条件が空です (常に成り立たない扱いになります)", /analyze_branches/],
    ["アクション a の工程 s: レスポンス「r」が、このアクションの responses にありません (responseId)", /responses/],
    ["アクション a の工程 s: NG のときのレスポンス「r」が、このアクションの responses にありません (inlineBranch.ngResponseId)", /responses/],
    ["項目「i」のイベントが呼ぶ処理フロー「f」がありません (handlerFlowId)", /list_process_flows/],
    ["項目「i」のイベントが呼ぶアクション「a」が、処理フロー「f」にありません (handlerActionId)", /handlerActionId/],
    ["スキーマ: 「/actions/0/steps/0」に、必須の項目「fieldErrorsVar」がありません", /fieldErrorsVar.*validate_design/],
    ["スキーマ: 全体に、必須の項目「meta」がありません", /「meta」/],
    ["スキーマ: 「/actions/0/steps/0/kind」の値が、決められた値と違います", /schema/i],
    ["スキーマ: 「/actions/0/trigger」の値が、決められた選択肢にありません", /schema/i],
    ["スキーマ: 「/actions/0/name」の型が違います", /schema/i],
    ["スキーマ: 「/actions/0」に、定義にない項目「x」があります", /schema/i],
    ["一覧 (harmony.json) にありますが、ファイル (tables/x.json) が見つかりません。一覧から外すには…", /repair_registry/],
    ["画面レイアウト (業務部品) が未作成です", /set_screen_layout/],
  ];
  for (const [msg, re] of CASES) it(`${msg.slice(0, 50)}…`, () => { expect(issueHint({ message: msg })).toMatch(re); });

  it("JSON の破損は、設計のファイル (section に tables/ など) のときだけ『保存前の版に戻す』を案内する", () => {
    expect(issueHint({ section: "テーブル tables/cart.json", message: "JSON として読めません (1 行目 3 桁目付近)。このままでは…" })).toMatch(/restore_version/);
    expect(issueHint({ section: "読み込み", message: "design-check.json が JSON として読めません" })).toBeNull();
  });

  it("関係のない指摘には付けない", () => {
    expect(issueHint({ message: "同じ SQL が複数か所にあります" })).toBeNull();
    expect(issueHint({ message: "どの画面でも使われていません" })).toBeNull();
  });
});
