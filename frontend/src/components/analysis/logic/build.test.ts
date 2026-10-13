import { describe, it, expect } from "vitest";
import {
  buildDesignDocument, buildOpenApi, checkExternalContracts, customRuleIssues, deriveJobs, deriveOperationMatrix, deriveSla, generateTestData, normalizeApiPath,
  overallTrend, scaffoldTests, slaGaps, snapshotOf, summarizeOpenApi, summarizeProgress, testDataToInsertSql, testDataTableToCsv, deriveTestViewpointSheet,
  type CheckSettings, type DesignDocInput,
} from "@harmony/shared";
import { loadExample, tiny } from "./fixtures";

const withRules = (input: DesignDocInput, rules: CheckSettings["rules"]): DesignDocInput => ({ ...input, checkSettings: { version: 1, suppressions: [], rules } });

describe("独自ルール", () => {
  it("対象・項目の場所・条件を宣言して、違反を要確認にする", () => {
    const input = withRules(tiny(), [
      { id: "r1", name: "テーブルの説明は必須", target: "table", path: "description", check: { type: "required" }, severity: "warning" },
      { id: "r2", name: "備考は 20 文字以内の列", target: "column", path: "length", check: { type: "range", max: 20 }, severity: "info" },
      { id: "r3", name: "処理フローの種別", target: "processFlow", path: "meta.flowType", check: { type: "oneOf", values: ["screen", "batch"] }, severity: "error", message: "処理の種別は screen か batch" },
    ]);
    const issues = customRuleIssues(input);
    const of = (id: string) => issues.filter((i) => i.message.includes(id));
    expect(issues.filter((i) => i.message.startsWith("ルール「テーブルの説明は必須」"))).toHaveLength(3); // 3 テーブルとも説明が無い
    expect(issues.find((i) => i.message.includes("備考"))).toMatchObject({ severity: "info" });
    expect(of("order-orphan")).toEqual([]);
    expect(issues.filter((i) => i.message.startsWith("処理の種別は screen か batch"))).toHaveLength(1); // 迷子 (common) だけ
    expect(issues.find((i) => i.message.startsWith("処理の種別"))!.severity).toBe("error");
  });

  it("when で適用を絞れる。無効なルールは動かない", () => {
    const input = withRules(tiny(), [
      { id: "r1", name: "説明", target: "table", path: "description", check: { type: "required" }, severity: "warning", when: { path: "physicalName", equals: "customer" } },
      { id: "r2", name: "止めたルール", target: "table", path: "description", check: { type: "required" }, severity: "warning", enabled: false },
    ]);
    const issues = customRuleIssues(input);
    expect(issues).toHaveLength(1);
    expect(issues[0].ref).toEqual({ kind: "table", id: "customer" });
  });

  it("正規表現・禁止・値が無いとき", () => {
    const input = withRules(tiny(), [
      { id: "p", name: "ID の形", target: "screen", path: "id", check: { type: "pattern", pattern: "^scr-" }, severity: "warning" },
      { id: "f", name: "メモ列は書かない", target: "column", path: "comment", check: { type: "forbidden" }, severity: "warning" },
    ]);
    const issues = customRuleIssues(input);
    expect(issues.filter((i) => i.message.includes("ID の形"))).toHaveLength(2);
    expect(issues.filter((i) => i.message.includes("メモ列"))).toHaveLength(0); // comment を持つ列が無い
  });

  it("設計書の要確認に含まれる", () => {
    const doc = buildDesignDocument(withRules(tiny(), [{ id: "r1", name: "説明", target: "table", path: "description", check: { type: "required" }, severity: "warning" }]));
    expect(doc.issues.filter((i) => i.message.startsWith("ルール「説明」"))).toHaveLength(3);
  });

  it("対象に無い場所を指しても落ちない (空として扱う)", () => {
    expect(() => customRuleIssues(withRules(tiny(), [{ id: "x", name: "x", target: "table", path: "a.b.c", check: { type: "required" }, severity: "info" }]))).not.toThrow();
  });
});

describe("操作単位の権限", () => {
  const withModel = (): DesignDocInput => {
    const i = tiny();
    i.roles = { clerk: { name: "担当", permissions: ["order.write"] }, viewer: { name: "閲覧", permissions: ["order.read"] } } as DesignDocInput["roles"];
    i.permissions = { "order.write": { action: "write" }, "order.read": { action: "read" } } as DesignDocInput["permissions"];
    return i;
  };

  it("画面 × 操作ごとに、使える役割を出す (画面の権限と操作の権限の両方が要る)", () => {
    const i = withModel();
    i.screens[0].permissions = ["order.read"];
    (i.flows[0].actions[0] as unknown as Record<string, unknown>).requiredPermissions = ["order.write"];
    const m = deriveOperationMatrix(i);
    const row = m.rows.find((r) => r.flow.id === "order-create")!;
    expect(row.screen?.id).toBe("order-entry");
    expect(row.writes).toBe(true);
    expect(row.writtenTables).toEqual(["order"]);
    expect(row.roles).toEqual([]); // 両方持つ役割がいない
    i.roles!.clerk.permissions = ["order.write", "order.read"];
    expect(deriveOperationMatrix(i).rows.find((r) => r.flow.id === "order-create")!.roles).toEqual(["clerk"]);
  });

  it("権限が決まっていない更新操作を警告する", () => {
    const m = deriveOperationMatrix(withModel());
    expect(m.issues).toHaveLength(1);
    expect(m.issues[0]).toMatchObject({ severity: "warning", ref: { kind: "processFlow", id: "order-create" } });
    expect(m.issues[0].message).toContain("誰でも実行できます");
  });

  it("画面の権限か、操作の権限のどちらかがあれば警告しない。参照だけの操作も警告しない", () => {
    const i = withModel();
    i.screens[0].permissions = ["order.write"];
    expect(deriveOperationMatrix(i).issues).toHaveLength(0);
    const j = withModel();
    (j.flows[0].actions[0].steps[0] as unknown as Record<string, unknown>).operation = "SELECT";
    expect(deriveOperationMatrix(j).issues).toHaveLength(0);
  });

  it("HTTP の更新メソッドの API は、更新として扱う", () => {
    const i = withModel();
    i.flows[1].actions[0].httpRoute = { method: "POST", path: "/api/x" };
    const m = deriveOperationMatrix(i);
    expect(m.rows.find((r) => r.flow.id === "order-orphan")).toMatchObject({ writes: true, screen: null, http: { method: "POST", path: "/api/x" } });
  });

  it("権限の仕組みを使っていないプロジェクトの設計書には、警告を足さない", () => {
    const doc = buildDesignDocument(tiny());
    expect(doc.issues.some((x) => x.message.includes("誰でも実行できます"))).toBe(false);
    const doc2 = buildDesignDocument(withModel());
    expect(doc2.issues.some((x) => x.message.includes("誰でも実行できます"))).toBe(true);
  });
});

describe("SLA とジョブ", () => {
  it("アクション・処理フロー全体の宣言を区別し、API・ジョブの宣言漏れを挙げる", () => {
    const i = tiny();
    i.flows[0].actions[0].httpRoute = { method: "POST", path: "/api/orders" };
    i.flows.push({ meta: { id: "nightly", name: "夜間集計", flowType: "batch", sla: { timeoutMs: 600000 } }, actions: [{ id: "a1", name: "集計", trigger: "timer", steps: [{ id: "s1", kind: "dbAccess", tableId: "order", operation: "UPDATE" }] }] } as never);
    i.flows.push({ meta: { id: "weekly", name: "週次", flowType: "scheduled" }, actions: [{ id: "a1", name: "週次", trigger: "timer", steps: [] }] } as never);
    const rows = deriveSla(i);
    expect(rows.find((r) => r.flow.id === "nightly")).toMatchObject({ kind: "job", declaredAt: "flow", sla: { timeoutMs: 600000 } });
    expect(rows.find((r) => r.flow.id === "order-create")).toMatchObject({ kind: "api", declaredAt: "none" });
    const gaps = slaGaps(rows).map((g) => g.row.flow.id).sort();
    expect(gaps).toEqual(["order-create", "weekly"]);
  });

  it("ジョブの一覧と依存 (イベントの発行元・共通処理) を出す", () => {
    const i = tiny();
    i.flows.push(
      { meta: { id: "pub", name: "発行", flowType: "batch" }, actions: [{ id: "a", name: "発行", trigger: "timer", steps: [{ id: "p", kind: "eventPublish", topic: "daily.closed" }] }] } as never,
      { meta: { id: "sub", name: "受け", flowType: "scheduled" }, actions: [{ id: "a", name: "受け", trigger: "timer", description: "翌日の処理", steps: [{ id: "q", kind: "eventSubscribe", topic: "daily.closed" }, { id: "c", kind: "commonProcess", refId: "order-orphan" }, { id: "w", kind: "dbAccess", tableId: "order", operation: "DELETE" }, { id: "k", kind: "closing", period: "monthly" }] }] } as never,
    );
    const jobs = deriveJobs(i);
    expect(jobs.map((j) => j.flow.id)).toEqual(["pub", "sub"]);
    const sub = jobs[1];
    expect(sub.publishes).toEqual([]);
    expect(sub.subscribes).toEqual(["daily.closed"]);
    expect(sub.writtenTables).toEqual(["order"]);
    expect(sub.closing).toEqual({ period: "monthly" });
    expect(sub.dependsOn.map((d) => `${d.via}:${d.flow.id}`).sort()).toEqual(["commonProcess:order-orphan", "event:pub"]);
    expect(sub.actions[0].description).toBe("翌日の処理");
  });
});

describe("外部インタフェースの整合", () => {
  const flowWith = (steps: unknown[], catalog: unknown) => ({ meta: { id: "pay", name: "決済", flowType: "common" }, context: { catalogs: { externalSystems: catalog } }, actions: [{ id: "a", name: "決済", trigger: "auto", steps }] }) as never;
  const spec = summarizeOpenApi("specs/pay.json", { openapi: "3.0.0", servers: [{ url: "https://api.pay.example/v1" }], paths: { "/charges": { post: { operationId: "createCharge" } }, "/charges/{id}": { get: { operationId: "getCharge" }, delete: {} }, "/refunds": { post: {} } } });

  it("OpenAPI から、メソッド・パス・operationId を取り出す (servers のパスの接頭辞を含む)", () => {
    expect(spec.operations).toEqual(expect.arrayContaining([{ method: "POST", path: "/v1/charges", operationId: "createCharge" }, { method: "GET", path: "/v1/charges/{id}", operationId: "getCharge" }]));
    expect(summarizeOpenApi("x", { foo: 1 }).error).toContain("paths がありません");
  });

  it("呼び出しを相手の定義と突き合わせ、無いパス・メソッドと、呼ばれていない操作を出す", () => {
    const i = tiny();
    i.flows.push(flowWith([
      { id: "s1", kind: "externalSystem", systemRef: "pay", httpCall: { method: "POST", path: "/v1/charges" } },
      { id: "s2", kind: "externalSystem", systemRef: "pay", httpCall: { method: "PUT", path: "/v1/charges/:id" } },
      { id: "s3", kind: "externalSystem", systemRef: "pay", httpCall: { method: "GET", path: "/v1/customers" } },
      { id: "s4", kind: "externalSystem", systemRef: "pay", operationId: "getCharge" },
      { id: "s5", kind: "externalSystem", systemRef: "pay", operationId: "nope" },
    ], { pay: { name: "決済会社", openApiSpec: "specs/pay.json", baseUrl: "https://api.pay.example" } }));
    i.externalSpecs = { "specs/pay.json": spec };
    const r = checkExternalContracts(i);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("checked");
    expect(r[0].calls.map((c) => c.result)).toEqual(["ok", "missing-method", "missing-path", "ok", "unknown-operation"]);
    expect(r[0].calls[1].note).toContain("GET / DELETE");
    expect(r[0].uncalled).toEqual(["DELETE /v1/charges/{id}", "POST /v1/refunds"]);
  });

  it("baseUrl のパスを除いて書いた呼び出しも合う。URL の定義は照合しない。読めない定義は理由を出す", () => {
    const i = tiny();
    i.flows.push(flowWith([{ id: "s1", kind: "externalSystem", systemRef: "pay", httpCall: { method: "POST", path: "/charges" } }], { pay: { name: "決済", openApiSpec: "specs/pay.json", baseUrl: "https://api.pay.example/v1" } }));
    i.externalSpecs = { "specs/pay.json": spec };
    expect(checkExternalContracts(i)[0].calls[0].result).toBe("ok");
    i.externalSpecs = { "specs/pay.json": { source: "specs/pay.json", skipped: "url", operations: [] } };
    expect(checkExternalContracts(i)[0].status).toBe("url-skipped");
    i.externalSpecs = { "specs/pay.json": { source: "specs/pay.json", error: "ファイルがありません", operations: [] } };
    expect(checkExternalContracts(i)[0]).toMatchObject({ status: "error", error: "ファイルがありません" });
    i.externalSpecs = {};
    expect(checkExternalContracts(i)[0].status).toBe("error");
  });

  it("定義の指定が無い外部システムは「定義なし」", () => {
    const i = tiny();
    i.flows.push(flowWith([{ id: "s1", kind: "externalSystem", systemRef: "x", httpCall: { method: "GET", path: "/a" } }], { x: { name: "X" } }));
    expect(checkExternalContracts(i)[0]).toMatchObject({ status: "no-spec", source: null });
  });

  it("パスの比較用の正規化", () => {
    expect(normalizeApiPath("/a/{id}/b/")).toBe("/a/{}/b");
    expect(normalizeApiPath("/a/:id?x=1")).toBe("/a/{}");
    expect(normalizeApiPath("/a/${orderId}")).toBe("/a/{}");
    expect(normalizeApiPath("/")).toBe("/");
  });
});

describe("OpenAPI の書き出し", () => {
  const input = (): DesignDocInput => {
    const i = tiny();
    i.flows[0].actions[0] = {
      id: "a1", name: "注文を登録する", trigger: "submit", description: "注文を 1 件登録する", httpRoute: { method: "POST", path: "/api/customers/:customerId/orders", auth: "required" },
      inputs: [{ name: "customerId", type: "string", required: true }, { name: "qty", type: "integer", required: true, description: "数量" }, { name: "note", type: "string" }],
      responses: [{ id: "201", status: 201, description: "登録した", bodySchema: { typeRef: "ext:OrderCreated" } }, { id: "400", status: 400, when: "入力が不正", bodySchema: { schema: { type: "object" } } }],
      requiredPermissions: ["order.write"], steps: [],
    } as never;
    i.flows.push({ meta: { id: "order-list", name: "一覧", flowType: "common" }, actions: [{ id: "a1", name: "一覧", trigger: "auto", httpRoute: { method: "GET", path: "/api/orders", auth: "none" }, inputs: [{ name: "page", type: "integer" }], outputs: [{ name: "items", type: { kind: "array", itemType: "string" } }], steps: [] }] } as never);
    return i;
  };

  it("HTTP の契約から OpenAPI 3.0.3 の文書を作る", () => {
    const r = buildOpenApi(input());
    expect(r.operations).toBe(2);
    const doc = r.document as { openapi: string; paths: Record<string, Record<string, Record<string, unknown>>>; components: { securitySchemes: unknown; schemas: Record<string, unknown> } };
    expect(doc.openapi).toBe("3.0.3");
    const post = doc.paths["/api/customers/{customerId}/orders"].post;
    expect(post.operationId).toBe("order_create_a1");
    expect(post.parameters).toEqual([{ name: "customerId", in: "path", required: true, schema: { type: "string" } }]);
    expect(post.requestBody).toMatchObject({ required: true, content: { "application/json": { schema: { required: ["qty"], properties: { qty: { type: "integer", description: "数量" }, note: { type: "string" } } } } } });
    expect(post.responses).toMatchObject({ "201": { description: "登録した", content: { "application/json": { schema: { $ref: "#/components/schemas/OrderCreated" } } } }, "400": { description: "入力が不正" } });
    expect(post.security).toEqual([{ bearerAuth: [] }]);
    expect(post["x-required-permissions"]).toEqual(["order.write"]);
    expect(doc.components.schemas.OrderCreated).toBeTruthy();
    const get = doc.paths["/api/orders"].get;
    expect(get.parameters).toEqual([{ name: "page", in: "query", required: false, schema: { type: "integer" } }]);
    expect(get.security).toEqual([]);
    expect(get.responses).toMatchObject({ "200": { content: { "application/json": { schema: { properties: { items: { type: "array", items: { type: "string" } } } } } } } });
  });

  it("重複するメソッドとパスは先のものだけを書き出し、警告する。契約の無い処理は数だけ数える", () => {
    const i = input();
    i.flows.push({ meta: { id: "dup", name: "重複", flowType: "common" }, actions: [{ id: "a", name: "x", trigger: "auto", httpRoute: { method: "GET", path: "/api/orders" }, steps: [] }] } as never);
    const r = buildOpenApi(i);
    expect(r.operations).toBe(2);
    expect(r.warnings[0]).toContain("重複");
    expect(r.skipped).toBe(1); // order-orphan
  });

  it("契約が 1 つも無ければ警告する", () => {
    expect(buildOpenApi(tiny()).warnings.join("")).toContain("HTTP の契約");
  });

  it("retail の実データでも書き出せる", () => {
    expect(() => buildOpenApi(loadExample("retail"))).not.toThrow();
  });
});

describe("テストデータの生成", () => {
  it("型・長さ・主キー・一意・外部キー・CHECK に沿って、親を先に作る", () => {
    const r = generateTestData(tiny(), { rowsPerTable: 5, tableIds: ["order"] });
    expect(r.tables.map((t) => t.table.id)).toEqual(["order"]); // 親の顧客も作るが、出力は選んだテーブルだけ
    const o = r.tables[0];
    expect(o.columns).toEqual(["order_id", "customer_id", "qty"]);
    expect(o.rows).toHaveLength(5);
    expect(new Set(o.rows.map((x) => x[0])).size).toBe(5); // 主キーは一意
    const full = generateTestData(tiny(), { rowsPerTable: 5 });
    const cust = full.tables.find((t) => t.table.id === "customer")!;
    const custIds = new Set(cust.rows.map((x) => x[0]));
    expect(full.tables.find((t) => t.table.id === "order")!.rows.every((x) => custIds.has(x[1] as number))).toBe(true); // 外部キーは親にある値
    expect(o.rows.every((x) => (x[2] as number) >= 1 && (x[2] as number) <= 9)).toBe(true); // CHECK (qty >= 1 AND qty <= 9)
    expect(cust.rows.every((x) => typeof x[1] === "string" && (x[1] as string).length <= 20)).toBe(true); // 長さ
  });

  it("同じ設定なら同じデータ。seed を変えると変わる", () => {
    const a = generateTestData(tiny(), { seed: 3, rowsPerTable: 4 }), b = generateTestData(tiny(), { seed: 3, rowsPerTable: 4 }), c = generateTestData(tiny(), { seed: 99, rowsPerTable: 4 });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("行数の上限・読めない CHECK の警告・一意の外部キーの行数の制限", () => {
    expect(generateTestData(tiny(), { rowsPerTable: 999999, tableIds: ["lonely"] }).tables[0].rows).toHaveLength(1000);
    const i = tiny();
    i.tables[1].constraints!.push({ id: "ck2", kind: "check", expression: "lower(name) <> 'x'" });
    expect(generateTestData(i).warnings.join("")).toContain("読めない");
    const j = tiny();
    j.tables[1].constraints!.push({ id: "u1", kind: "unique", columnIds: ["o-cust"] });
    const r = generateTestData({ ...j }, { rows: { customer: 3, order: 10 } });
    expect(r.tables.find((t) => t.table.id === "order")!.rows).toHaveLength(3);
    expect(r.warnings.join("")).toContain("行数を親の行数");
  });

  it("INSERT 文と CSV に書き出せる。文字列は引用符をエスケープし、CSV は式を無害化する", () => {
    const i = tiny();
    i.tables[0].columns![1].name = "O'Reilly";
    const r = generateTestData(i, { rowsPerTable: 2, tableIds: ["customer"] });
    const sql = testDataToInsertSql(r, "mysql");
    expect(sql).toContain("INSERT INTO `customer` (`customer_id`, `customer_name`, `memo`) VALUES");
    expect(sql).toContain("-- 顧客 (2 件)");
    const csv = testDataTableToCsv(r.tables[0]);
    expect(csv.split("\r\n")[0]).toBe("customer_id,customer_name,memo");
    r.tables[0].rows[0][1] = "=1+1";
    expect(testDataTableToCsv(r.tables[0])).toContain("'=1+1");
    r.tables[0].rows[0][1] = "it's";
    expect(testDataToInsertSql(r)).toContain("'it''s'");
  });

  it("retail の実データで外部キーが親の行にある", () => {
    const i = loadExample("retail");
    const r = generateTestData(i, { rowsPerTable: 3 });
    expect(r.tables.length).toBe(i.tables.length);
    expect(r.tables.every((t) => t.rows.length > 0)).toBe(true);
  });
});

describe("テスト雛形", () => {
  const sheet = deriveTestViewpointSheet({ screens: tiny().screens as never, flows: tiny().flows as never, limits: {}, regex: {}, messages: {} });

  it("画面・処理ごとのファイルに、観点の ID を題名にした未実装のテストを作る", () => {
    const files = scaffoldTests(sheet, "vitest");
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(["tests/screens/order-entry.test.ts", "tests/flows/order-create.test.ts"]));
    const f = files.find((x) => x.path.endsWith("order-entry.test.ts"))!;
    expect(f.content.startsWith(`import { describe, it } from "vitest";`)).toBe(true);
    expect(f.content).toContain("it.todo(");
    expect(f.content).toContain("order-entry.qty.min-under");
    expect(f.content).toContain("// 期待結果:");
    expect(f.cases).toBeGreaterThan(3);
  });

  it("フレームワークごとの形 (Jest はグローバル、Playwright は test.fixme)", () => {
    expect(scaffoldTests(sheet, "jest")[0].content.startsWith("\n")).toBe(true);
    const pw = scaffoldTests(sheet, "playwright").find((x) => x.path.includes("order-entry"))!;
    expect(pw.path.endsWith(".spec.ts")).toBe(true);
    expect(pw.content).toContain(`import { test } from "@playwright/test";`);
    expect(pw.content).toContain("test.fixme(");
  });

  it("選んだ観点だけを作る。出力先を変えられる", () => {
    const all = scaffoldTests(sheet, "vitest");
    const id = "order-entry.qty.min-under";
    const some = scaffoldTests(sheet, "vitest", { ids: new Set([id]), dir: "src/__tests__/" });
    expect(some).toHaveLength(1);
    expect(some[0].path).toBe("src/__tests__/screens/order-entry.test.ts");
    expect(some[0].cases).toBe(1);
    expect((some[0].content.match(/it\.todo/g) ?? []).length).toBe(1);
    expect(all.reduce((n, f) => n + f.cases, 0)).toBeGreaterThan(1);
  });

  it("題名・コメントに悪意のある文字列があっても、コードとして壊れない・コメントを抜けない", () => {
    const evil = JSON.parse(JSON.stringify(sheet));
    evil.screens[0].cases[0].viewpoint = '"); process.exit(1); //';
    evil.screens[0].cases[0].expected = "*/ process.exit(1); /*";
    evil.screens[0].cases[0].input = "line1\nline2";
    const f = scaffoldTests(evil, "vitest", { ids: new Set([evil.screens[0].cases[0].id]) })[0].content;
    expect(f).toContain('it.todo("order-entry.');
    expect(f).toContain('\\"); process.exit(1); //"');
    expect(f).not.toContain("\n  process.exit(1);");
    expect(f).toContain("* / process.exit(1); /*");
    expect(f).toContain("入力: line1 line2");
  });
});

describe("完成度", () => {
  it("種別ごとの成熟度を数え、未設定は下書きにする", () => {
    const i = tiny();
    (i.screens[0] as unknown as Record<string, unknown>).maturity = "committed";
    (i.flows[0].meta as unknown as Record<string, unknown>).maturity = "provisional";
    (i.tables[0] as unknown as Record<string, unknown>).maturity = "committed";
    const p = summarizeProgress(i);
    expect(p.byKind.find((k) => k.kind === "screen")!.counts).toEqual({ draft: 1, provisional: 0, committed: 1, total: 2 });
    expect(p.byKind.find((k) => k.kind === "processFlow")!.counts).toEqual({ draft: 1, provisional: 1, committed: 0, total: 2 });
    expect(p.byKind.find((k) => k.kind === "table")!.counts.committed).toBe(1);
    expect(p.overall.total).toBe(2 + 2 + 3 + 1 + 0);
    expect(p.remaining.length).toBe(p.overall.total - p.overall.committed);
    expect(p.committedPct).toBe(Math.round((2 / 8) * 1000) / 10);
  });

  it("日ごとの記録から、全体の推移を作る", () => {
    const a = snapshotOf(summarizeProgress(tiny()), "2026-10-01");
    const i = tiny(); (i.screens[0] as unknown as Record<string, unknown>).maturity = "committed";
    const b = snapshotOf(summarizeProgress(i), "2026-10-08");
    const t = overallTrend([b, a]);
    expect(t.map((x) => x.date)).toEqual(["2026-10-01", "2026-10-08"]);
    expect(t[1].committed - t[0].committed).toBe(1);
  });

  it("部品画面は数えない。0 件でも割合は 0", () => {
    const i = tiny(); (i.screens[1] as unknown as Record<string, unknown>).purpose = "gadget";
    expect(summarizeProgress(i).byKind.find((k) => k.kind === "screen")!.counts.total).toBe(1);
    expect(summarizeProgress({ project: { name: "x" }, screens: [], flows: [], tables: [] }).committedPct).toBe(0);
  });
});
