/**
 * 独立レビュー (#1500) の指摘への回帰試験: 設計の文字列で、出力 (コメント・SQL・OpenAPI) が壊れない・正規表現が極端に遅くならない・
 * 列で絞った影響分析・未使用・権限の警告・CHECK の読み取り。
 */
import { describe, it, expect } from "vitest";
import {
  analyzeImpact, buildDesignDocument, customRuleIssues, buildOpenApi, checkRegexSafety, checkExternalContracts, deriveCrud, deriveOperationMatrix, deriveTestViewpointSheet, findUnused,
  generateTestData, oneLine, parseCheckSettings, scaffoldTests, testDataToInsertSql, type DesignDocInput,
} from "@harmony/shared";
import { generateAlterDdl, alterToText } from "../../../utils/ddlAlter";
import type { Table } from "../../../types/v3";
import { tiny } from "./fixtures";

const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029), NEL = String.fromCharCode(0x85);

describe("設計の文字列で、コメントを抜けて、出力が壊れない", () => {
  it("oneLine: 行の終わりになるすべての文字を空白にする", () => {
    expect(oneLine(`a\r\nb${LS}c${PS}d${NEL}e\vf\fg`)).toBe("a b c d e f g");
  });

  it("テスト雛形: U+2028 / U+2029 で、// のコメントから抜けて、コードにならない", () => {
    const sheet = deriveTestViewpointSheet({ screens: tiny().screens as never, flows: [] });
    const evil = JSON.parse(JSON.stringify(sheet));
    evil.screens[0].cases[0].itemLabel = `x${LS}process.exit(7)//`;
    evil.screens[0].cases[0].input = `y${PS}process.exit(8)//`;
    evil.screens[0].cases[0].expected = `z${NEL}process.exit(9)//`;
    const f = scaffoldTests(evil, "vitest", { ids: new Set([evil.screens[0].cases[0].id]) })[0].content;
    expect(f).not.toContain(LS);
    expect(f).not.toContain(PS);
    expect(f).not.toContain(NEL);
    // process.exit を含む行は、すべて // のコメントの行
    for (const line of f.split(/\r\n|\r|\n/).filter((l) => l.includes("process.exit"))) expect(line.trimStart().startsWith("//")).toBe(true);
  });

  it("テストデータの INSERT: テーブルの表示名の改行で、コメントから抜けて、次の行が実行されない", () => {
    const i = tiny();
    i.tables[0].name = "x\nDROP TABLE users;\n--";
    const sql = testDataToInsertSql(generateTestData(i, { tableIds: ["customer"], rowsPerTable: 1 }));
    expect(sql.split("\n").every((l) => !l.startsWith("DROP TABLE"))).toBe(true);
    expect(sql).toContain("-- x DROP TABLE users; --");
  });

  it("テストデータの INSERT: MySQL は \\ を 2 つにして、値の引用符から抜けない。ほかの方言は \\ を除く", () => {
    const i = tiny();
    i.tables[0].columns![2].name = "x\\' ); DROP TABLE y; --"; // memo 列 (値は、表示名から作られる)
    const res = generateTestData(i, { tableIds: ["customer"], rowsPerTable: 1 });
    const my = testDataToInsertSql(res, "mysql");
    expect(my).toContain("'x\\\\'' ); DROP TABLE y; --1'"); // \\ と '' : 値の中の文字として入る
    for (const q of ["standard", "sqlserver"] as const) {
      const out = testDataToInsertSql(res, q);
      expect(out).not.toContain("\\");
      expect(out).toContain("'x'' ); DROP TABLE y; --1'");
    }
  });

  it("DDL の ALTER: 物理名の改行で、コメントから抜けて、次の行が実行されない", () => {
    const col = (id: string, physicalName: string) => ({ id, physicalName, name: physicalName, dataType: "VARCHAR", length: 10 });
    const mk = (cols: unknown[]) => ({ id: "t", uuid: "u", name: "t", physicalName: "t", createdAt: "", updatedAt: "", columns: cols }) as unknown as Table;
    const evil = "b\nDROP TABLE users;\n--";
    const r = generateAlterDdl(mk([col("c1", "a"), col("c2", evil)]), mk([col("c1", "a"), col("c3", "z")]), "postgresql");
    const lines = r.statements.join("\n").split(/\r\n|\r|\n/);
    // 注意書きは 1 行 (名前の改行は空白になる)。DROP COLUMN の文の中の名前は、引用符の中なので、改行があっても文の一部
    expect(lines).toContain("-- 列「b DROP TABLE users; --」を削除します。この列のデータは失われます");
    expect(r.statements).toContain(`ALTER TABLE "t" DROP COLUMN "${evil}";`);
    // SQLite の注意書きと、既定値の変更の注意書きも、同じ
    const r2 = generateAlterDdl(mk([{ ...col("c1", evil), dataType: "INTEGER" }]), mk([{ ...col("c1", evil), dataType: "VARCHAR" }]), "sqlite");
    expect(alterToText(r2).split(/\r\n|\r|\n/).every((l) => !l.startsWith("DROP TABLE"))).toBe(true);
    expect(alterToText(r2)).toContain("-- SQLite は列の変更");
  });
});

describe("設計の値で Object.prototype を触れない", () => {
  it("OpenAPI: パスが __proto__ でも、プロトタイプを汚さない。/ で始まらないパスは書き出さない", () => {
    const i = tiny();
    i.flows[0].actions[0].httpRoute = { method: "GET", path: "__proto__" };
    i.flows.push({ meta: { id: "ok", name: "ok", flowType: "common" }, actions: [{ id: "a", name: "a", trigger: "auto", httpRoute: { method: "GET", path: "/ok" }, steps: [] }] } as never);
    const r = buildOpenApi(i);
    expect(({} as Record<string, unknown>).get).toBeUndefined();
    expect(r.operations).toBe(1);
    expect(r.warnings.join("")).toContain("/ で始まっていない");
    for (const name of ["constructor", "prototype", "__proto__"]) {
      const j = tiny();
      j.flows[0].actions[0].httpRoute = { method: "POST", path: "/x" };
      j.flows[0].actions[0].responses = [{ id: "r", status: 200, bodySchema: { typeRef: name } }] as never;
      const doc = buildOpenApi(j).document as { components: { schemas: Record<string, unknown> } };
      expect(Object.hasOwn(doc.components.schemas, name)).toBe(true); // 型の定義が、自分のキーとして書かれる (プロトタイプの値と取り違えて、書き落とさない)
    }
    expect(({} as Record<string, unknown>).type).toBeUndefined();
  });

  it("CRUD: テーブル ID が __proto__ の DB アクセスでも落ちない。外部の定義の鍵が __proto__ でも、取り違えない", () => {
    const i = tiny();
    (i.flows[0].actions[0].steps[0] as Record<string, unknown>).tableId = "__proto__";
    expect(() => deriveCrud(i.flows, i.tables)).not.toThrow();
    const j = tiny();
    j.flows.push({ meta: { id: "x", name: "x", flowType: "common" }, context: { catalogs: { externalSystems: { __proto__x: { name: "X", openApiSpec: "__proto__" } } } }, actions: [{ id: "a", name: "a", trigger: "auto", steps: [{ id: "s", kind: "externalSystem", systemRef: "__proto__x", httpCall: { method: "GET", path: "/a" } }] }] } as never);
    j.externalSpecs = {};
    const r = checkExternalContracts(j);
    expect(r[0].status).toBe("error"); // 定義が読めていない (Object.prototype を、定義と取り違えない)
  });
});

describe("正規表現の安全性 (ReDoS)", () => {
  const bad = ["^(a|aa)+$", "(a|aa)+", "((a+))+", "^(([a-z])+.)+[A-Z]([a-z])+$", "(a+)+", "(a*)*b", "(\\d{2})+", "(a|b)*c", "^(x+x+)+y$", "(.*)*", "a*a*a*a*b", "^a{0,300}a{0,300}a{0,300}a{0,300}a{0,300}b", "^(.*a){5}b", "^(a+){5}b", "^(a?){20}a{20}$"];
  const good = ["^[a-z][a-z0-9]*(_[a-z0-9]+)*$", "^m_", "^[A-Z]{2}\\d{4}$", "^(?:_[a-z]+)*$", "^[a-z]+(-[a-z]+)*$", "^(\\.[a-z0-9]+){1,3}$", "^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$", "^(a|b)$", "([a-z])+x", "^(ab)?c$", "^[\\w.+-]+@[\\w-]+\\.[\\w.]+$", "^([A-Z][a-z0-9]*)+$", "^[a-z]+([A-Z][a-z0-9]*)*$", "^([a-z0-9]+-)*[a-z0-9]+$", "^(?=.{1,30}$)[a-z][a-z0-9_]*$", "^(\\d{3}-){2}\\d{4}$", "^[a-z]{1,10}[0-9]{1,5}_[a-z]{1,10}$"];
  it.each(bad)("拒否: %s", (p) => { expect(checkRegexSafety(p)).not.toBeNull(); });
  it.each(good)("受理: %s", (p) => { expect(checkRegexSafety(p)).toBeNull(); });

  it("区切りの文字を含む文字クラスのグループの繰り返しは、拒否する ((_\\w+)* の _ は \\w に含まれる)", () => {
    expect(checkRegexSafety("^(_\\w+)*$")).toContain("区切り");
    expect(checkRegexSafety("^(_[A-z]+)*$")).toContain("区切り"); // A-z は _ を含む
    expect(checkRegexSafety("^(_[^a]+)*$")).toContain("区切り");
  });

  it("受理した式は、悪意のある入力 (長さの上限いっぱい) でも、速く終わる", () => {
    const inputs = ["a".repeat(300).concat("!"), "aA".repeat(150).concat("!"), "a-".repeat(150).concat("!"), "A".repeat(300).concat("!"), "_a".repeat(150).concat("!"), "1".repeat(300).concat("!")];
    for (const p of good) for (const input of inputs) {
      const t = performance.now();
      new RegExp(p).test(input);
      expect(performance.now() - t, `${p} / ${input.slice(0, 6)}`).toBeLessThan(300);
    }
  });

  it("独自ルール: 長すぎる値 (300 文字を超える) は、正規表現で検査しない (途中で切ると、末尾に効く式の判定がずれる)", () => {
    const i = tiny();
    i.tables[0].description = "x".repeat(400);
    const issues = customRuleIssues({ ...i, checkSettings: { version: 1, suppressions: [], rules: [{ id: "r", name: "n", target: "table", path: "description", check: { type: "pattern", pattern: "^x+y$" }, severity: "warning" }] } });
    expect(issues.filter((x) => x.ref?.id === "customer")).toEqual([]);
    i.tables[0].description = "x".repeat(10);
    expect(customRuleIssues({ ...i, checkSettings: { version: 1, suppressions: [], rules: [{ id: "r", name: "n", target: "table", path: "description", check: { type: "pattern", pattern: "^x+y$" }, severity: "warning" }] } }).filter((x) => x.ref?.id === "customer")).toHaveLength(1);
  });

  it("設定の読み込みでも、危険な式のルールは捨てる", () => {
    const { settings, problems } = parseCheckSettings({ rules: [{ id: "r", name: "n", target: "table", path: "name", check: { type: "pattern", pattern: "^(a|aa)+$" }, severity: "info" }] });
    expect(settings.rules).toEqual([]);
    expect(problems.join("")).toContain("グループ");
  });
});

describe("分析の正しさ (レビューの指摘)", () => {
  it("列で絞った影響分析は、その列を指す外部キーの子テーブルを含む。別の列では含まない", () => {
    const i = tiny();
    // order.customer_id (o-cust) → customer.customer_id (c-id) の外部キーがある
    const withCol = analyzeImpact(i, "table", "customer", { column: "c-id" });
    expect(withCol.levels.flatMap((l) => l.hits).map((h) => h.node.key)).toContain("table:order");
    const otherCol = analyzeImpact(i, "table", "customer", { column: "c-memo" });
    expect(otherCol.levels.flatMap((l) => l.hits).map((h) => h.node.key)).not.toContain("table:order");
    expect(analyzeImpact(i, "table", "customer", { column: "customer_id" }).levels.flatMap((l) => l.hits).map((h) => h.node.key)).toContain("table:order"); // 物理名でも
  });

  it("自分の処理 (meta.screenId) を持つだけの孤立した画面は、未使用", () => {
    const i = tiny();
    i.screens.push({ id: "lone", name: "孤立", items: [] } as never);
    i.flows.push({ meta: { id: "lone-flow", name: "孤立の処理", flowType: "screen", screenId: "lone" }, actions: [{ id: "a", name: "a", trigger: "click", steps: [] }] } as never);
    expect(findUnused(i).some((u) => u.kind === "screen" && u.id === "lone")).toBe(true);
    // ほかの画面から遷移されていれば、使われている
    i.transitions = [{ sourceScreenId: "order-entry", targetScreenId: "lone" }];
    expect(findUnused(i).some((u) => u.kind === "screen" && u.id === "lone")).toBe(false);
  });

  it("権限の警告は、人が呼ぶ入口 (画面・HTTP の契約) のある更新操作だけ。バッチ・共通処理・イベントの購読は出さない", () => {
    const i = tiny();
    i.roles = { clerk: { name: "担当", permissions: ["p"] } } as DesignDocInput["roles"];
    i.permissions = { p: {} } as DesignDocInput["permissions"];
    const upd = [{ id: "s", kind: "dbAccess", tableId: "order", operation: "UPDATE" }];
    i.flows.push(
      { meta: { id: "job", name: "夜間", flowType: "batch" }, actions: [{ id: "a", name: "a", trigger: "timer", steps: upd }] } as never,
      { meta: { id: "common", name: "共通", flowType: "common" }, actions: [{ id: "a", name: "a", trigger: "auto", steps: upd }] } as never,
      { meta: { id: "sub", name: "購読", flowType: "system" }, actions: [{ id: "a", name: "a", trigger: "auto", steps: [{ id: "e", kind: "eventSubscribe", topic: "t" }, ...upd] }] } as never,
    );
    const issues = deriveOperationMatrix(i).issues;
    expect(issues.map((x) => x.ref?.id)).toEqual(["order-create"]); // 画面から呼ぶ注文登録だけ
    const withApi = tiny();
    withApi.roles = i.roles; withApi.permissions = i.permissions;
    withApi.flows.push({ meta: { id: "api", name: "API", flowType: "common" }, actions: [{ id: "a", name: "a", trigger: "auto", httpRoute: { method: "DELETE", path: "/x" }, steps: [] }] } as never);
    expect(deriveOperationMatrix(withApi).issues.map((x) => x.ref?.id)).toContain("api");
  });

  it("CHECK の IN (...) を読んで、候補から値を作る (外側の括弧があっても)", () => {
    const i = tiny();
    i.tables[1].constraints!.push({ id: "ck2", kind: "check", expression: "(qty IN (1, 2, 3)) AND (qty >= 1)" } as never);
    const r = generateTestData(i, { tableIds: ["order"], rowsPerTable: 6 });
    expect(r.warnings.join("")).not.toContain("読めない");
    expect(r.tables[0].rows.map((x) => x[2])).toEqual([1, 2, 3, 1, 2, 3]);
    const j = tiny();
    j.tables[1].columns!.push({ id: "o-st", physicalName: "status", name: "状態", dataType: "VARCHAR", length: 10 } as never);
    j.tables[1].constraints!.push({ id: "ck3", kind: "check", expression: "status IN ('new','done')" } as never);
    const rr = generateTestData(j, { tableIds: ["order"], rowsPerTable: 4 });
    expect(rr.warnings.join("")).not.toContain("読めない");
    expect(rr.tables[0].rows.map((x) => x[3])).toEqual(["new", "done", "new", "done"]);
  });

  it("ALTER: データを失いうる型の変更を数える (狭い型・小数の切り捨て・長さの縮小)。広げる変更は数えない。NOT NULL の追加は注意", () => {
    const col = (over: Record<string, unknown>) => ({ id: "c", physicalName: "v", name: "v", dataType: "VARCHAR", length: 10, ...over });
    const mk = (c: unknown) => ({ id: "t", uuid: "u", name: "t", physicalName: "t", createdAt: "", updatedAt: "", columns: [c] }) as unknown as Table;
    const cnt = (a: Record<string, unknown>, b: Record<string, unknown>) => generateAlterDdl(mk(col(a)), mk(col(b)), "postgresql").destructive;
    expect(cnt({ dataType: "DECIMAL", length: 10, scale: 2 }, { dataType: "INTEGER" })).toBe(1);
    expect(cnt({ dataType: "TEXT" }, { dataType: "VARCHAR", length: 10 })).toBe(1);
    expect(cnt({ dataType: "BIGINT" }, { dataType: "INTEGER" })).toBe(1);
    expect(cnt({ dataType: "DECIMAL", length: 10, scale: 2 }, { dataType: "DECIMAL", length: 10, scale: 0 })).toBe(1);
    expect(cnt({ length: 10 }, { length: 5 })).toBe(1);
    expect(cnt({ dataType: "VARCHAR" }, { dataType: "INTEGER" })).toBe(1);
    expect(cnt({ dataType: "INTEGER" }, { dataType: "BIGINT" })).toBe(0);
    expect(cnt({ dataType: "INTEGER" }, { dataType: "DECIMAL" })).toBe(0);
    expect(cnt({ dataType: "INTEGER" }, { dataType: "VARCHAR" })).toBe(0);
    expect(cnt({ length: 10 }, { length: 50 })).toBe(0);
    expect(cnt({ dataType: "BOOLEAN" }, { dataType: "INTEGER" })).toBe(0); // 対応表に無い型は、狭いとは数えない
    const notNull = generateAlterDdl(mk(col({})), mk(col({ notNull: true, defaultValue: "'-'" })), "postgresql"); // 既定値があっても、既存の NULL は埋まらない
    expect(notNull.statements.join("\n")).toContain("NOT NULL にします。NULL の行があると失敗します");
    expect(notNull.destructive).toBe(0);
  });

  it("抑制の期限は、この環境の日付で判断する (generatedAt が無いとき)", () => {
    const doc = buildDesignDocument(tiny());
    const t = doc.issues[0];
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const { issues, suppression } = buildDesignDocument({ ...tiny(), checkSettings: { version: 1, rules: [], suppressions: [{ key: t.key!, reason: "r", expiresOn: local, at: "x", severity: t.severity, section: t.section, message: t.message }] } });
    expect(suppression?.suppressed).toHaveLength(1); // 期限の当日までは有効 (ローカルの日付)
    expect(issues.length).toBe(doc.issues.length - 1);
  });
});
