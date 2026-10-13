import { describe, it, expect } from "vitest";
import {
  analyzeMessages, applySuppressions, buildDesignDocument, checkRegexSafety, conventionPattern, deriveColumnMap, deriveTraceability,
  findTermInconsistencies, issueKey, namingIssues, parseCheckSettings, traceabilityToCsv, columnMapToCsv, type DesignDocInput,
} from "@harmony/shared";
import { loadExample, tiny } from "./fixtures";

describe("トレーサビリティ表", () => {
  const input = tiny();
  const r = deriveTraceability(input);

  it("業務フローの工程 → 画面 → 処理 → テーブル (操作) → テスト観点を 1 行にする", () => {
    const row = r.rows.find((x) => x.step?.id === "st1")!;
    expect(row.businessFlow?.name).toBe("受注");
    expect(row.screens.map((s) => s.id)).toEqual(["order-entry"]);
    expect(row.flows.map((f) => f.id)).toEqual(["order-create"]);
    expect(row.tables).toEqual(expect.arrayContaining([{ id: "order", name: "注文", ops: "C" }, { id: "customer", name: "顧客", ops: "R" }]));
    expect(row.viewpoints).toBeGreaterThan(0);
    expect(row.gaps).toEqual([]);
  });

  it("画面も処理も決まっていない作業の工程と、業務フローに出ない画面・どこからも呼ばれない処理を欠けとして挙げる", () => {
    expect(r.gaps.map((g) => g.kind).sort()).toEqual(["flow-unreferenced", "screen-no-business-flow", "step-unrealized"]);
    expect(r.gaps.find((g) => g.kind === "step-unrealized")!.message).toContain("確認する");
    expect(r.gaps.find((g) => g.kind === "screen-no-business-flow")!.message).toContain("注文一覧");
    expect(r.gaps.find((g) => g.kind === "flow-unreferenced")!.message).toContain("迷子");
  });

  it("CSV に出せて、式として解釈される値は無害化される", () => {
    const csv = traceabilityToCsv(r);
    expect(csv.split("\r\n")[0]).toBe("業務フロー,工程,担当レーン,画面,処理フロー,テーブル (操作),テスト観点の数,欠け");
    expect(csv).toContain("注文を入力");
    const evil = tiny();
    evil.businessFlows![0].steps[0].name = "=cmd|' /C calc'!A0";
    const out = traceabilityToCsv(deriveTraceability(evil));
    expect(out).toContain("'=cmd|' /C calc'!A0"); // 先頭に ' が付き、表計算ソフトで式として実行されない
    expect(out).not.toMatch(/(^|,)=cmd/m);
  });

  it("業務フローが無いプロジェクトでは、画面を「業務フローに出ない」欠けとは扱わない", () => {
    const none = { ...tiny(), businessFlows: [] };
    expect(deriveTraceability(none).gaps.some((g) => g.kind === "screen-no-business-flow")).toBe(false);
  });

  it("retail の実データで動き、行がある", () => {
    const rr = deriveTraceability(loadExample("retail"));
    expect(rr.rows.length).toBeGreaterThan(5);
  });
});

describe("用語の一貫性", () => {
  it("同じ物理名で表示名が違う (snake / camel は同じ名前)・同じ表示名で物理名が違う、を見つける", () => {
    const input = tiny();
    const issues = findTermInconsistencies(input);
    // customer_id: 顧客ID と お客様ID
    const a = issues.find((i) => i.kind === "same-physical-different-display" && i.subject.toLowerCase().replace(/_/g, "") === "customerid")!;
    expect(a.variants.map((v) => v.text).sort()).toEqual(["お客様ID", "顧客ID"]);
    expect(["お客様ID", "顧客ID"]).toContain(a.suggestion);
  });

  it("汎用的な名前 (id / name など) の表示名の違いは揺れとしない", () => {
    const input = tiny();
    // customer.id の表示名「顧客ID」と lonely.id の「ID」: 物理名が違うので別。order_id/customer_id は固有名。ここでは汎用名の確認
    input.tables[2].columns![0] = { id: "l-id", physicalName: "id", name: "ID", dataType: "INTEGER", primaryKey: true };
    input.tables[0].columns![0] = { id: "c-id", physicalName: "id", name: "顧客ID", dataType: "INTEGER", primaryKey: true };
    expect(findTermInconsistencies(input).some((i) => i.subject === "id")).toBe(false);
  });

  it("同じ表示名で物理名が違うと、候補を示す", () => {
    const input = tiny();
    input.tables[1].columns!.push({ id: "o-nm", physicalName: "cust_nm", name: "顧客名", dataType: "VARCHAR" });
    const i = findTermInconsistencies(input).find((x) => x.kind === "same-display-different-physical" && x.subject === "顧客名")!;
    expect(i.variants.map((v) => v.text).sort()).toEqual(["cust_nm", "customer_name"]);
  });
});

describe("命名規約", () => {
  it("DB 規約の namingConvention の読み取り", () => {
    expect(conventionPattern("snake_case")?.label).toBe("snake_case");
    expect(conventionPattern("lowerCamelCase")?.label).toBe("camelCase");
    expect(conventionPattern("UpperCamelCase")?.label).toBe("PascalCase");
    expect(conventionPattern("UPPER_SNAKE_CASE")?.label).toBe("UPPER_SNAKE_CASE");
    expect(conventionPattern("kebab-case")?.label).toBe("kebab-case");
    expect(conventionPattern("謎の規約")).toBeNull();
    expect(conventionPattern(undefined)).toBeNull();
  });

  it("規約カタログの正規表現 (namingTable など) に合わない物理名を指摘する。接頭辞も正規表現で書ける", () => {
    const input = tiny();
    input.regex = { namingTable: { pattern: "^m_|^t_", description: "m_ か t_ で始める", exampleValid: ["m_customer"] } } as DesignDocInput["regex"];
    const issues = namingIssues(input);
    expect(issues.length).toBe(3);
    expect(issues[0]).toMatchObject({ severity: "warning", ref: { kind: "table", id: "customer" } });
    expect(issues[0].message).toContain("@conv.regex.namingTable");
    expect(issues[0].message).toContain("例: m_customer");
  });

  it("明示の規約が無ければ、DB 規約の namingConvention をテーブル・カラムの物理名の既定にする", () => {
    const input = tiny();
    input.db = { default: { namingConvention: "snake_case", default: true } };
    input.tables[0].columns![1].physicalName = "CustomerName";
    const issues = namingIssues(input);
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining("CustomerName")]);
    expect(issues[0].message).toContain("snake_case");
  });

  it("使えない (危険な) 正規表現は、規約として使わず、その旨を警告する", () => {
    const input = tiny();
    input.regex = { namingTable: { pattern: "^(a+)+$" } } as DesignDocInput["regex"];
    const issues = namingIssues(input);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("繰り返しの入れ子");
  });

  it("規約が無ければ何も指摘しない", () => {
    expect(namingIssues(tiny())).toEqual([]);
  });

  it("正規表現の安全性の検査", () => {
    expect(checkRegexSafety("^[a-z]+$")).toBeNull();
    expect(checkRegexSafety("(a+)+")).toContain("入れ子");
    expect(checkRegexSafety("(a*)*b")).toContain("入れ子");
    expect(checkRegexSafety("(a)\\1")).toContain("後方参照");
    expect(checkRegexSafety("[")).toContain("読めません");
    expect(checkRegexSafety("a".repeat(201))).toContain("長すぎ");
    expect(checkRegexSafety("a", "g")).toContain("フラグ");
    expect(checkRegexSafety("")).toContain("空");
  });
});

describe("抑制", () => {
  const issues = [
    { severity: "warning" as const, section: "画面 注文入力", message: "項目が足りません" },
    { severity: "info" as const, section: "CRUD 顧客", message: "参照 (R) する処理フローがありません" },
  ];
  const sup = (over: Record<string, unknown> = {}) => ({ key: issueKey(issues[0]), reason: "仕様どおり", at: "2026-10-01T00:00:00Z", severity: "warning" as const, section: issues[0].section, message: issues[0].message, ...over });

  it("印は、重大度・対象・内容が同じなら同じ、違えば違う", () => {
    expect(issueKey(issues[0])).toBe(issueKey({ ...issues[0] }));
    expect(issueKey(issues[0])).not.toBe(issueKey({ ...issues[0], severity: "error" }));
    expect(issueKey(issues[0])).not.toBe(issueKey({ ...issues[0], message: "別の内容" }));
    expect(issueKey(issues[0])).toMatch(/^i-[0-9a-f]{16}$/);
  });

  it("理由つきの抑制は、指摘を要確認から外す。期限を過ぎると、また出る", () => {
    const ok = applySuppressions(issues, [sup({ expiresOn: "2026-12-31" })], "2026-10-13");
    expect(ok.active.map((i) => i.section)).toEqual(["CRUD 顧客"]);
    expect(ok.status.suppressed).toHaveLength(1);
    const expired = applySuppressions(issues, [sup({ expiresOn: "2026-10-12" })], "2026-10-13");
    expect(expired.active).toHaveLength(2);
    expect(expired.status.expired).toHaveLength(1);
    // 期限の当日までは有効
    expect(applySuppressions(issues, [sup({ expiresOn: "2026-10-13" })], "2026-10-13").active).toHaveLength(1);
  });

  it("該当する指摘がなくなった抑制は、整理の対象として返す", () => {
    const r = applySuppressions([issues[1]], [sup()], "2026-10-13");
    expect(r.status.orphaned).toHaveLength(1);
    expect(r.active).toHaveLength(1);
  });

  it("設計書の要確認に反映され、抑制中の件数が分かる", () => {
    const input = tiny();
    const before = buildDesignDocument(input);
    expect(before.issues.length).toBeGreaterThan(0);
    const target = before.issues[0];
    const after = buildDesignDocument({ ...input, checkSettings: { version: 1, rules: [], suppressions: [{ key: target.key!, reason: "意図どおり", at: "2026-10-01T00:00:00Z", severity: target.severity, section: target.section, message: target.message }] } });
    expect(after.issues.length).toBe(before.issues.length - 1);
    expect(after.suppression?.suppressed).toHaveLength(1);
    expect(after.html).toContain("理由つきで抑制している要確認が 1 件");
  });
});

describe("設定の読み込み", () => {
  it("正しい設定はそのまま、壊れた項目は捨てて理由を返す", () => {
    const { settings, problems } = parseCheckSettings({
      version: 1,
      suppressions: [
        { key: "i-1", reason: "ok", at: "2026-10-01T00:00:00Z", severity: "warning", section: "s", message: "m", expiresOn: "2026-12-31" },
        { key: "i-2", reason: "  ", at: "x", severity: "warning" },
        { key: "i-3", reason: "期限が不正", at: "2026-10-01T00:00:00Z", severity: "info", expiresOn: "2026-02-30" },
        { key: "i-1", reason: "重複", at: "2026-10-01T00:00:00Z", severity: "info" },
      ],
      rules: [
        { id: "r1", name: "説明は必須", target: "table", path: "description", check: { type: "required" }, severity: "warning" },
        { id: "r2", name: "壊れた", target: "table", path: "__proto__.x", check: { type: "required" }, severity: "warning" },
        { id: "r3", name: "危険な正規表現", target: "table", path: "name", check: { type: "pattern", pattern: "(a+)+" }, severity: "warning" },
        { id: "r4", name: "対象が不明", target: "unknown", path: "x", check: { type: "required" }, severity: "warning" },
        { id: "r1", name: "重複 ID", target: "table", path: "x", check: { type: "required" }, severity: "warning" },
      ],
    });
    expect(settings.suppressions.map((s) => s.key)).toEqual(["i-1"]);
    expect(settings.rules.map((r) => r.id)).toEqual(["r1"]);
    expect(problems).toHaveLength(6); // 抑制 2 件 (理由が空・期限が不正) + ルール 4 件 (危険な場所・正規表現・対象不明・ID 重複)。同じ key の重複は、黙って 1 件にまとめる
    expect(problems.join("\n")).toContain("key・理由・日時・重大度");
    expect(problems.join("\n")).toContain("期限は YYYY-MM-DD");
    expect(problems.join("\n")).toContain("英数字と . だけ");
    expect(problems.join("\n")).toContain("繰り返しの入れ子");
    expect(problems.join("\n")).toContain("重複しています");
  });

  it("空・null・おかしな型でも落ちない", () => {
    expect(parseCheckSettings(null).settings).toEqual({ version: 1, suppressions: [], rules: [] });
    expect(parseCheckSettings("x").problems.length).toBe(1);
    expect(parseCheckSettings({ suppressions: "x", rules: 5 }).settings.rules).toEqual([]);
  });
});

describe("項目 ↔ カラムの対応", () => {
  const r = deriveColumnMap(tiny());

  it("列に結び付いた項目・結び付いていない入力・存在しない列を指す項目を分ける", () => {
    expect(r.rows.find((x) => x.item.id === "qty")).toMatchObject({ status: "mapped", table: { id: "order" }, column: { physicalName: "qty" } });
    expect(r.unboundInputs.map((x) => x.item.id)).toEqual(["note"]);
    expect(r.brokenBindings.map((x) => x.item.id)).toEqual(["ghost"]);
    expect(r.brokenBindings[0].note).toContain("nope");
  });

  it("どこからも使われていない列を挙げる (主キー・外部キー・SQL に出る列は除く)", () => {
    const names = r.unusedColumns.map((c) => `${c.table.id}.${c.column.physicalName}`);
    expect(names).toContain("customer.memo");
    expect(names).not.toContain("order.order_id"); // 主キー
    expect(names).not.toContain("order.customer_id"); // 外部キー
    expect(names).not.toContain("customer.customer_name"); // 画面項目に結び付いている
    expect(names.some((n) => n.startsWith("lonely."))).toBe(false); // どこからも使われないテーブルは別扱い
  });

  it("SELECT * など列を指定しないアクセスがあるテーブルは、列単位では判断しない", () => {
    const input = tiny();
    (input.flows[0].actions[0].steps[1] as unknown as Record<string, unknown>).sql = "SELECT * FROM customer";
    expect(deriveColumnMap(input).unusedColumns.some((c) => c.table.id === "customer")).toBe(false);
  });

  it("CSV に出せる", () => {
    expect(columnMapToCsv(r).split("\r\n")[0]).toBe("画面,画面項目,項目 ID,方向,状態,結び付き,テーブル,列 (物理名),列 (論理名),備考");
  });
});

describe("メッセージの管理", () => {
  it("使用箇所・未使用・定義の無い参照・似た文面を出す", () => {
    const input = tiny();
    input.messages = {
      used: { template: "数量は {min} から {max} の間で入力してください" },
      dup: { template: "数量は {min} から {max} の間で入力してください" },
      near: { template: "数量は {min} から {max} の間で入力して下さい" },
      spare: { template: "全然違う文面です" },
    };
    (input.screens[0].items![1] as unknown as Record<string, unknown>).errorMessages = { range: "@conv.msg.used", other: "@conv.msg.missing" };
    const a = analyzeMessages(input);
    expect(a.messages.find((m) => m.key === "used")!.uses.map((u) => u.id)).toEqual(["order-entry"]);
    expect(a.unused.map((m) => m.key).sort()).toEqual(["dup", "near", "spare"]);
    expect(a.undefinedRefs).toEqual([{ key: "missing", uses: [{ kind: "screen", id: "order-entry", name: "注文入力" }] }]);
    expect(a.similar.find((s) => s.reason === "same")!.keys.sort()).toEqual(["dup", "used"]);
    expect(a.similar.some((s) => s.reason === "similar" && s.keys.includes("near"))).toBe(true);
  });
});
