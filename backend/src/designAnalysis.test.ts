/**
 * 設計の分析 (第 3 弾): 点検の設定 (抑制・独自ルール)・外部システムの OpenAPI の読み込み・完成度の記録・MCP の分析 tool。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { issueKey, summarizeProgress } from "@harmony/shared";
import { handleDesignTool } from "./handlers/design.js";
import { designCheckFile, readCheckSettings, removeSuppressions, saveRules, suppressIssue, unsuppressIssue } from "./designCheckSettings.js";
import { loadDesignInputFull, loadExternalSpec, MAX_SPEC_BYTES } from "./designInput.js";
import { readProgressHistory, recordProgress, sanitizeHistory } from "./progressStore.js";
import { classifyChangedPath } from "./externalChanges.js";
import { writeScreenEntity, writeTable } from "./projectStorage.js";
import { loadDesignInputFromRoot } from "./designInput.js";

const ROOT = path.join(os.tmpdir(), `design-analysis-${process.pid}-${Date.now()}`);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await handleDesignTool(name, args, ROOT, "s") as { content: Array<{ text: string }> } | null;
  if (!res) throw new Error(`未処理のツール: ${name}`);
  return res.content[0].text;
};
const J = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(await call(name, args));

const ts = "2026-01-01T00:00:00.000Z";
const table = (id: string, extra: Record<string, unknown> = {}) => ({
  id, uuid: `00000000-0000-4000-8000-0000000000${id.length}${id.charCodeAt(0) % 10}0`.slice(0, 36), name: id === "cust" ? "顧客" : "注文", physicalName: id, createdAt: ts, updatedAt: ts,
  columns: [{ id: "c1", physicalName: `${id}_id`, name: "ID", dataType: "INTEGER", primaryKey: true, notNull: true }, { id: "c2", physicalName: "note", name: "備考", dataType: "VARCHAR", length: 10 }], ...extra,
});

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "screens"), { recursive: true });
  await fs.mkdir(path.join(ROOT, "specs"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000019", name: "分析用", createdAt: ts, updatedAt: ts },
    entities: { screens: [{ id: "entry", name: "入力", kind: "form", path: "/entry" }], tables: [{ id: "cust", name: "顧客" }, { id: "order", name: "注文" }] },
  }));
  await writeScreenEntity("entry", {
    id: "entry", uuid: "11111111-1111-4111-8111-111111111112", name: "入力", kind: "form", path: "/entry", createdAt: ts, updatedAt: ts,
    items: [{ id: "name", label: "名前", type: "string", direction: "in", binding: { kind: "tableColumn", ref: { tableId: "cust", columnId: "c2" } } }],
    layout: { version: 1, nodes: [{ id: "name", type: "field", itemRef: "name" }] },
  }, ROOT);
  await writeTable("cust", table("cust"), ROOT);
  await writeTable("order", table("order", { constraints: [{ id: "fk", kind: "foreignKey", columnIds: ["c2"], referencedTableId: "cust", referencedColumnIds: ["c1"] }] }), ROOT);
  await fs.writeFile(path.join(ROOT, "specs", "pay.json"), JSON.stringify({ openapi: "3.0.0", paths: { "/charges": { post: { operationId: "charge" } } } }));
  await fs.writeFile(path.join(ROOT, "specs", "pay.yaml"), "openapi: 3.0.0\n");
  await fs.writeFile(path.join(ROOT, "specs", "broken.json"), "{ not json");
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("点検の設定: 抑制", () => {
  const issue = { severity: "warning" as const, section: "テスト", message: "何かの指摘" };
  const input = { ...issue, key: issueKey(issue), reason: "仕様どおり" };

  it("理由つきで抑制を書き、読み直せる。同じ印は上書き、外すと消える", async () => {
    const r = await suppressIssue(ROOT, { ...input, expiresOn: "2099-12-31", by: "松木田" }, new Date("2026-10-13T00:00:00Z"));
    expect(r.settings.suppressions).toHaveLength(1);
    expect(r.settings.suppressions[0]).toMatchObject({ key: input.key, reason: "仕様どおり", expiresOn: "2099-12-31", by: "松木田", at: "2026-10-13T00:00:00.000Z" });
    expect((await readCheckSettings(ROOT)).settings.suppressions).toHaveLength(1);
    await suppressIssue(ROOT, { ...input, reason: "理由を変えた" });
    const again = (await readCheckSettings(ROOT)).settings.suppressions;
    expect(again).toHaveLength(1);
    expect(again[0].reason).toBe("理由を変えた");
    expect((await unsuppressIssue(ROOT, input.key)).settings.suppressions).toHaveLength(0);
  });

  it("理由が無い・印と内容が合わない・日付が不正なものは書かない", async () => {
    await expect(suppressIssue(ROOT, { ...input, reason: "  " })).rejects.toThrow("理由");
    await expect(suppressIssue(ROOT, { ...input, message: "別の指摘" })).rejects.toThrow("合いません");
    await expect(suppressIssue(ROOT, { ...input, key: "x" })).rejects.toThrow("印が正しくありません");
    await expect(suppressIssue(ROOT, { ...input, expiresOn: "2026-02-30" })).rejects.toThrow("日付");
    expect((await readCheckSettings(ROOT)).settings.suppressions).toHaveLength(0);
  });

  it("手で書き換えて壊れた項目があるファイルは、読み込みでは項目を捨てて理由を返し、書き換えはしない (項目が消えないように)", async () => {
    const file = designCheckFile(path.join(ROOT, "harmony"));
    await fs.writeFile(file, JSON.stringify({ version: 1, suppressions: [{ key: "i-1", reason: "" }], rules: [] }));
    const loaded = await readCheckSettings(ROOT);
    expect(loaded.problems.join("")).toContain("抑制 1 件目");
    await expect(suppressIssue(ROOT, input)).rejects.toThrow("読めない項目があるため、書き換えません");
    expect(JSON.parse(await fs.readFile(file, "utf-8")).suppressions[0].key).toBe("i-1"); // そのまま
    await fs.rm(file);
  });

  it("まとめて外せる", async () => {
    await suppressIssue(ROOT, input);
    const b = { severity: "info" as const, section: "B", message: "もう一つ" };
    await suppressIssue(ROOT, { ...b, key: issueKey(b), reason: "r" });
    expect((await removeSuppressions(ROOT, [input.key, issueKey(b)])).settings.suppressions).toHaveLength(0);
  });
});

describe("点検の設定: 独自ルール", () => {
  const rule = { id: "r1", name: "テーブルの説明", target: "table", path: "description", check: { type: "required" }, severity: "warning" };

  it("検証に通るルールだけ保存でき、壊れたルールは理由つきで拒否する (保存済みの内容は変えない)", async () => {
    await saveRules(ROOT, [rule]);
    expect((await readCheckSettings(ROOT)).settings.rules).toHaveLength(1);
    await expect(saveRules(ROOT, [rule, { ...rule, id: "r2", check: { type: "pattern", pattern: "(a+)+" } }])).rejects.toThrow("繰り返しの入れ子");
    await expect(saveRules(ROOT, [{ ...rule, path: "__proto__.x" }])).rejects.toThrow("英数字と .");
    await expect(saveRules(ROOT, "x")).rejects.toThrow("形が正しくありません");
    expect((await readCheckSettings(ROOT)).settings.rules).toHaveLength(1);
  });

  it("保存したルールが check_design に出て、抑制すると消える (入力のキャッシュは設定の変更で更新される)", async () => {
    const before = await J("designer__check_design", { includeInfo: true });
    const ruled = before.issues.filter((i: { message: string }) => i.message.startsWith("ルール「テーブルの説明」"));
    expect(ruled).toHaveLength(2);
    const target = ruled[0] as { severity: "warning"; section: string; message: string };
    await suppressIssue(ROOT, { ...target, key: issueKey(target), reason: "意図どおり" });
    const after = await J("designer__check_design", { includeInfo: true });
    expect(after.issues.filter((i: { message: string }) => i.message.startsWith("ルール「テーブルの説明」"))).toHaveLength(1);
    expect(after.suppressed).toBe(1);
    await removeSuppressions(ROOT, [issueKey(target)]);
    await saveRules(ROOT, []);
  });
});

describe("外部システムの OpenAPI の読み込み", () => {
  it("ワークスペース内の JSON を読んで要約する (データフォルダからの相対も可)", async () => {
    expect(await loadExternalSpec(ROOT, "specs/pay.json")).toMatchObject({ source: "specs/pay.json", operations: [{ method: "POST", path: "/charges", operationId: "charge" }] });
  });
  it("URL は取りに行かず、ワークスペースの外・YAML・壊れた JSON・無いファイルは理由を返す", async () => {
    expect(await loadExternalSpec(ROOT, "https://example.com/spec.json")).toMatchObject({ skipped: "url" });
    expect((await loadExternalSpec(ROOT, "../../etc/passwd")).error).toContain("外のファイルは読みません");
    expect((await loadExternalSpec(ROOT, "/etc/passwd")).error).toContain("外のファイルは読みません");
    expect((await loadExternalSpec(ROOT, "specs/pay.yaml")).error).toContain("YAML");
    expect((await loadExternalSpec(ROOT, "specs/broken.json")).error).toContain("JSON として読めません");
    expect((await loadExternalSpec(ROOT, "specs/none.json")).error).toContain("見つかりません");
  });
  it("大きすぎる定義は読まない", async () => {
    await fs.writeFile(path.join(ROOT, "specs", "big.json"), JSON.stringify({ openapi: "3.0.0", paths: {}, pad: "x".repeat(MAX_SPEC_BYTES) }));
    expect((await loadExternalSpec(ROOT, "specs/big.json")).error).toContain("大きすぎます");
  });
  it("処理フローのカタログが指す定義を、入力に載せる", async () => {
    const base = await loadDesignInputFromRoot(ROOT);
    expect(base.input.externalSpecs).toBeUndefined();
    const full = await loadDesignInputFull(ROOT);
    expect(full.input.externalSpecs).toBeUndefined(); // 処理フローが無いので、載せるものが無い
    expect(full.input.genericDefinitions).toEqual([]);
    expect(full.input.checkSettings?.version).toBe(1);
  });
});

describe("完成度の記録", () => {
  it("その日の記録を最新の件数で置き換え、同じ件数なら書き直さない", async () => {
    const { input } = await loadDesignInputFromRoot(ROOT);
    const s1 = summarizeProgress(input);
    const day = new Date(2026, 9, 13, 12);
    const h1 = await recordProgress(ROOT, s1, day);
    expect(h1).toHaveLength(1);
    const file = path.join(ROOT, ".harmony-progress", "history.json");
    const m1 = (await fs.stat(file)).mtimeMs;
    await new Promise((r) => setTimeout(r, 15));
    await recordProgress(ROOT, s1, day);
    expect((await fs.stat(file)).mtimeMs).toBe(m1);
    expect(await fs.readFile(path.join(ROOT, ".harmony-progress", ".gitignore"), "utf-8")).toBe("*\n");
    const changed = { ...s1, byKind: s1.byKind.map((k) => (k.kind === "table" ? { ...k, counts: { ...k.counts, draft: 0, committed: k.counts.total } } : k)) };
    const h2 = await recordProgress(ROOT, changed, day);
    expect(h2).toHaveLength(1);
    expect(h2[0].byKind.table.committed).toBe(2);
    const h3 = await recordProgress(ROOT, s1, new Date(2026, 9, 14, 12));
    expect(h3.map((x) => x.date)).toEqual(["2026-10-13", "2026-10-14"]);
    expect(await readProgressHistory(ROOT)).toHaveLength(2);
  });
  it("壊れた記録は捨てる", () => {
    expect(sanitizeHistory({ snapshots: [{ date: "x" }, { date: "2026-01-01", byKind: { table: { draft: -1, committed: "a" } } }, 5, null] })).toEqual([
      { date: "2026-01-01", byKind: expect.objectContaining({ table: { draft: 0, provisional: 0, committed: 0, total: 0 } }) },
    ]);
    expect(sanitizeHistory(null)).toEqual([]);
  });
});

describe("MCP: designer__analyze_design ほか", () => {
  it("影響分析: テーブルを変えたときの連鎖を返し、引数が不正なら拒否する", async () => {
    const r = await J("designer__analyze_design", { kind: "impact", entityType: "table", id: "cust" });
    expect(r.target.key).toBe("table:cust");
    expect(r.levels[0].hits.map((h: { node: { key: string } }) => h.node.key).sort()).toEqual(["screen:entry", "table:order"]);
    await expect(call("designer__analyze_design", { kind: "impact", entityType: "nope", id: "cust" })).rejects.toThrow("entityType");
    await expect(call("designer__analyze_design", { kind: "impact", entityType: "table", id: "../x" })).rejects.toThrow();
    await expect(call("designer__analyze_design", { kind: "zzz" })).rejects.toThrow("kind");
  });
  it("各種の分析が読み取りで動く (csv も)", async () => {
    for (const kind of ["traceability", "unused", "terms", "column-map", "messages", "operations", "sla", "jobs", "external", "progress", "suppressions"]) {
      expect(await J("designer__analyze_design", { kind }), kind).toBeTruthy();
    }
    expect((await call("designer__analyze_design", { kind: "column-map", format: "csv" })).split("\r\n")[0]).toContain("画面項目");
    expect((await call("designer__analyze_design", { kind: "traceability", format: "csv" })).split("\r\n")[0]).toContain("業務フロー");
    const unused = await J("designer__analyze_design", { kind: "unused" });
    expect(unused.items.some((i: { kind: string; id: string }) => i.kind === "table" && i.id === "order")).toBe(true); // 外部キーの参照元だけ
  });
  it("進捗は、読み取りでは記録しない", async () => {
    const before = await readProgressHistory(ROOT);
    await J("designer__analyze_design", { kind: "progress" });
    expect(await readProgressHistory(ROOT)).toEqual(before);
  });
  it("OpenAPI・テストデータ・テスト雛形", async () => {
    expect((await J("designer__export_openapi")).warnings.join("")).toContain("HTTP の契約");
    const data = await J("designer__generate_test_data", { tableIds: ["order"], rowsPerTable: 3, seed: 5 });
    expect(data.tables.map((t: { table: { id: string } }) => t.table.id)).toEqual(["order"]);
    expect(data.tables[0].rows).toHaveLength(3);
    expect(await call("designer__generate_test_data", { tableIds: ["cust"], format: "sql", dialect: "sqlserver" })).toContain("INSERT INTO [cust]");
    expect((await call("designer__generate_test_data", { tableIds: ["cust"], format: "csv" })).split("\r\n")[0]).toBe("cust_id,note");
    await expect(call("designer__generate_test_data", { format: "csv" })).rejects.toThrow("1 つに絞って");
    await expect(call("designer__generate_test_data", { tableIds: ["nope"] })).rejects.toThrow("見つからない");
    const sc = await J("designer__get_test_viewpoints", { scaffold: "vitest" });
    expect(sc.files.length).toBeGreaterThan(0);
    await expect(call("designer__get_test_viewpoints", { scaffold: "mocha" })).rejects.toThrow("scaffold");
  });
});

describe("ファイル監視の分類", () => {
  it("design-check.json の変更を、点検の設定の変更として通知する", () => {
    expect(classifyChangedPath("design-check.json")).toEqual({ event: "designCheckChanged", data: {} });
  });
});
