import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleDesignTool } from "../handlers/design.js";
import { collectExtraIssues } from "../schemaIssues.js";
import { buildProjectContext } from "../projectContext.js";
import { tools } from "../tools.js";
import { isInProfile, PROFILES } from "../security/mcpProfiles.js";
import { isReadOnlyTool } from "../security/mcpAccess.js";
import { destinationOf, getScaffoldUpdate, loadTemplate, parseScaffold, recordScaffold, SCAFFOLD_COMBOS, scaffoldStore, scaffoldSummary, collectScaffoldIssues, templateVersionOf, DEFAULT_TEMPLATES_ROOT, HARMONY_IMAGE, MAX_SCAFFOLD_CONTENT, cutAtCharBoundary, defaultTemplatesRoot, usesHarmonyImage, issuesOfSummary } from "./scaffold.js";
import { classifyChangedPath } from "../externalChanges.js";
import { scaffoldTools } from "../toolsScaffold.js";

let ROOT = "", TPL = "";
const COMPOSE_WITH_HARMONY = `services:\n  harmony:\n    image: \${HARMONY_IMAGE:-${HARMONY_IMAGE}:local}\n`;

async function write(p: string, content: string) { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, content); }
/** 試験用の小さな雛形 (spring-boot-thymeleaf だけ) */
async function seedTemplate(files: Record<string, string>) {
  await fs.rm(path.join(TPL, "spring-boot-thymeleaf"), { recursive: true, force: true });
  for (const [rel, c] of Object.entries(files)) await write(path.join(TPL, "spring-boot-thymeleaf", rel), c);
}
const BASE_FILES = { ".devcontainer/compose.yml": "A\n", ".mcp.json": "{}\n", Dockerfile: "FROM x\n", "README.snippet.md": "## 開発環境\n手順\n" };
async function seedWs(tech: unknown = { backend: { framework: "spring-boot" }, frontend: { library: "thymeleaf" } }) {
  await write(path.join(ROOT, "harmony.json"), JSON.stringify({ schemaVersion: "v3", dataDir: "design", ...(tech ? { techStack: tech } : {}) }));
  await fs.mkdir(path.join(ROOT, "design"), { recursive: true });
}
beforeEach(async () => {
  ROOT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-")));
  TPL = path.join(ROOT, "..", `tpl-${path.basename(ROOT)}`);
  await fs.mkdir(TPL, { recursive: true });
  await seedWs();
  await seedTemplate(BASE_FILES);
});
afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  await fs.rm(TPL, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("雛形の版", () => {
  const a = [{ template: "a", content: "x\ny" }, { template: "b", content: "z" }];
  it("決まった値になる (パスと中身の SHA-256 の先頭 12 桁、パス順)", () => {
    expect(templateVersionOf(a)).toBe("be28c88f8d7c");
    expect(templateVersionOf([...a].reverse())).toBe(templateVersionOf(a));
    expect(templateVersionOf(a)).toMatch(/^[0-9a-f]{12}$/);
  });
  it("改行が CRLF でも変わらない。中身・パス・ファイルの追加で変わる", () => {
    expect(templateVersionOf([{ template: "a", content: "x\r\ny" }, a[1]])).toBe(templateVersionOf(a));
    expect(templateVersionOf([{ template: "a", content: "x\ny!" }, a[1]])).not.toBe(templateVersionOf(a));
    expect(templateVersionOf([{ template: "a2", content: "x\ny" }, a[1]])).not.toBe(templateVersionOf(a));
    expect(templateVersionOf([...a, { template: "c", content: "" }])).not.toBe(templateVersionOf(a));
  });
});

describe("実際の 4 組合せの雛形", () => {
  const EXPECTED = [".devcontainer/compose.yml", ".devcontainer/devcontainer.json", ".mcp.json", ".tmp/.gitignore", "Dockerfile", "README.snippet.md", "docker-compose.yml"];
  it.each(SCAFFOLD_COMBOS)("%s: 版が計算でき、列挙したファイルが行き先の表と合う", async (combo) => {
    const t = await loadTemplate(combo, ".", DEFAULT_TEMPLATES_ROOT);
    expect(t, combo).not.toBeNull();
    expect(t!.version).toMatch(/^[0-9a-f]{12}$/);
    // 雛形のフォルダに増減があれば、ここで気づく (行き先の表 destinationOf と scaffold の説明を直す)
    expect(t!.files.map((f) => f.template).sort()).toEqual(EXPECTED);
    const dest = Object.fromEntries(t!.files.map((f) => [f.template, [f.path, f.kind]]));
    expect(dest[".devcontainer/devcontainer.json"]).toEqual([".devcontainer/devcontainer.json", "file"]);
    expect(dest[".tmp/.gitignore"]).toEqual([".tmp/.gitignore", "file"]);
    expect(dest["Dockerfile"]).toEqual(["Dockerfile", "file"]);
    expect(dest["README.snippet.md"]).toEqual(["README.md", "section"]);
    const t2 = await loadTemplate(combo, "backend", DEFAULT_TEMPLATES_ROOT);
    expect(Object.fromEntries(t2!.files.map((f) => [f.template, f.path]))).toMatchObject({ ".mcp.json": ".mcp.json", Dockerfile: "backend/Dockerfile", "docker-compose.yml": "backend/docker-compose.yml", "README.snippet.md": "backend/README.md" });
  });
  it("4 組合せの版は互いに違う", async () => {
    const versions = await Promise.all(SCAFFOLD_COMBOS.map(async (c) => (await loadTemplate(c, ".", DEFAULT_TEMPLATES_ROOT))!.version));
    expect(new Set(versions).size).toBe(4);
  });
  it("表にないファイルは、出力先に同じ相対パスで置く扱い", () => {
    expect(destinationOf("extra/x.txt", "app")).toEqual({ path: "app/extra/x.txt", kind: "file" });
  });
});

describe("記録の読み書き", () => {
  it("記録が無ければ null。parse は壊れた項目を捨てて理由を返す", async () => {
    expect((await scaffoldStore.read(ROOT)).value).toBeNull();
    expect(parseScaffold(undefined).value).toBeNull();
    expect(parseScaffold({ combo: "x" }).problems).toHaveLength(1);
    const r = parseScaffold({ combo: "nestjs-nextjs", outDir: ".", templateVersion: "0123456789ab", recordedAt: "2026-10-31T00:00:00.000Z", files: [{ template: "a", path: "a", kind: "file", content: "x" }, { template: "../b", path: "b", kind: "file" }, { template: "c", path: "c", kind: "other" }, { template: "a", path: "a", kind: "file" }] });
    expect(r.value?.files).toEqual([{ template: "a", path: "a", kind: "file", content: "x" }]);
    expect(r.problems).toHaveLength(3);
  });
  it("record は雛形の中身を backend が読んで書く (data フォルダの scaffold.json)", async () => {
    const r = await recordScaffold(ROOT, {}, "AI", TPL);
    expect(r).toMatchObject({ combo: "spring-boot-thymeleaf", outDir: ".", recorded: 4, skipped: [] });
    const file = JSON.parse(await fs.readFile(path.join(ROOT, "design", "scaffold.json"), "utf-8"));
    expect(file).toMatchObject({ combo: "spring-boot-thymeleaf", outDir: ".", templateVersion: r.templateVersion });
    expect(file.files.find((f: { template: string }) => f.template === "Dockerfile")).toEqual({ template: "Dockerfile", path: "Dockerfile", kind: "file", content: "FROM x\n" });
    expect(file.files.find((f: { template: string }) => f.template === "README.snippet.md")).toMatchObject({ path: "README.md", kind: "section" });
  });
  it("skipped は content を持たず、省略すると前回のまま、空配列で解除する", async () => {
    await recordScaffold(ROOT, { skipped: ["Dockerfile"], outDir: "backend" }, "AI", TPL);
    let rec = (await scaffoldStore.read(ROOT)).value!;
    expect(rec.files.find((f) => f.template === "Dockerfile")).toEqual({ template: "Dockerfile", path: "backend/Dockerfile", kind: "file", skipped: true });
    await recordScaffold(ROOT, {}, "AI", TPL);
    rec = (await scaffoldStore.read(ROOT)).value!;
    expect(rec.outDir).toBe("backend");
    expect(rec.files.find((f) => f.template === "Dockerfile")?.skipped).toBe(true);
    await recordScaffold(ROOT, { skipped: [] }, "AI", TPL);
    expect((await scaffoldStore.read(ROOT)).value!.files.find((f) => f.template === "Dockerfile")?.content).toBe("FROM x\n");
  });
  it("outDir・skipped・combo の検査: ../ や雛形に無いパスを拒む", async () => {
    await expect(recordScaffold(ROOT, { outDir: "../x" }, "AI", TPL)).rejects.toThrow(/outDir/);
    await expect(recordScaffold(ROOT, { outDir: "/abs" }, "AI", TPL)).rejects.toThrow(/outDir/);
    await expect(recordScaffold(ROOT, { outDir: "a/./b" }, "AI", TPL)).rejects.toThrow(/outDir/);
    await expect(recordScaffold(ROOT, { skipped: ["nothing"] }, "AI", TPL)).rejects.toThrow(/雛形にないパス/);
    await expect(recordScaffold(ROOT, { skipped: "Dockerfile" }, "AI", TPL)).rejects.toThrow(/配列/);
    await expect(recordScaffold(ROOT, { combo: "rails" }, "AI", TPL)).rejects.toThrow(/combo/);
    await expect(scaffoldStore.read(ROOT).then((r) => r.value)).resolves.toBeNull(); // 失敗では書かない
  });
  it("組合せが決まらない (techStack 無し・combo 無し) と、記録できない。combo を渡せば記録できる", async () => {
    await seedWs(null);
    await expect(recordScaffold(ROOT, {}, "AI", TPL)).rejects.toThrow(/組合せを決められません/);
    expect((await recordScaffold(ROOT, { combo: "spring-boot-thymeleaf" }, "AI", TPL)).combo).toBe("spring-boot-thymeleaf");
  });
  it("壊れた記録 (JSON でない) があっても読み込みは落ちず、problems になる。壊れた項目のある記録は書き直せる", async () => {
    await write(path.join(ROOT, "design", "scaffold.json"), "{ nope");
    expect((await scaffoldStore.read(ROOT)).problems[0]).toMatch(/JSON として読めません/);
    await expect(recordScaffold(ROOT, {}, "AI", TPL)).rejects.toThrow(/書き換えません/);
    await write(path.join(ROOT, "design", "scaffold.json"), JSON.stringify({ combo: "spring-boot-thymeleaf", outDir: ".", templateVersion: "0123456789ab", recordedAt: "2026-10-31T00:00:00.000Z", files: [{ template: "..", path: "x", kind: "file" }] }));
    expect((await scaffoldStore.read(ROOT)).problems).toHaveLength(1);
    await recordScaffold(ROOT, {}, "AI", TPL);
    expect((await scaffoldStore.read(ROOT)).problems).toEqual([]);
  });
});

describe("状態 (status)", () => {
  it("記録なし + Harmony の image を使う compose → no-record", async () => {
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const s = await scaffoldSummary(ROOT, TPL);
    expect(s).toMatchObject({ status: "no-record", combo: "spring-boot-thymeleaf" });
    expect(s.currentVersion).toMatch(/^[0-9a-f]{12}$/);
  });
  it("記録なし + 無関係 (compose 無し・Harmony の image でない) → not-applicable", async () => {
    expect((await scaffoldSummary(ROOT, TPL)).status).toBe("not-applicable");
    await write(path.join(ROOT, ".devcontainer/compose.yml"), "services:\n  dev:\n    image: node:26\n");
    expect((await scaffoldSummary(ROOT, TPL)).status).toBe("not-applicable");
  });
  it("記録と同じ版 → current。雛形が変わる → outdated", async () => {
    await recordScaffold(ROOT, {}, "AI", TPL);
    expect(await scaffoldSummary(ROOT, TPL)).toMatchObject({ status: "current" });
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n" });
    const s = await scaffoldSummary(ROOT, TPL);
    expect(s.status).toBe("outdated");
    expect(s.recordedVersion).not.toBe(s.currentVersion);
  });
  it("techStack が決まらず Harmony の image を使う → not-applicable で理由に techStack を添える。記録の組合せの雛形が無ければ not-applicable", async () => {
    await seedWs(null);
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const s = await scaffoldSummary(ROOT, TPL);
    expect(s.status).toBe("not-applicable");
    expect(s.reason).toContain("techStack");
    await seedWs();
    await recordScaffold(ROOT, {}, "AI", TPL);
    expect((await scaffoldSummary(ROOT, path.join(TPL, "none"))).status).toBe("not-applicable");
  });
  it("記録の組合せは techStack より優先する", async () => {
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedWs({ backend: { framework: "nestjs" }, frontend: { library: "react" } });
    expect((await scaffoldSummary(ROOT, TPL)).combo).toBe("spring-boot-thymeleaf");
  });
});

describe("ファイルの state と差分の材料", () => {
  const byT = (u: Awaited<ReturnType<typeof getScaffoldUpdate>>) => Object.fromEntries(u.files.map((f) => [f.template, f]));
  it("current: 全ファイル unchanged で中身は返さない", async () => {
    await recordScaffold(ROOT, {}, "AI", TPL);
    const u = await getScaffoldUpdate(ROOT, TPL);
    expect(u.status).toBe("current");
    expect(u.files.every((f) => f.state === "unchanged" && f.base === undefined && f.latest === undefined)).toBe(true);
  });
  it("3 方向: 雛形が変わったファイルだけ template-changed。base・app・latest・appEdited(手入れ) を返す", async () => {
    await write(path.join(ROOT, "Dockerfile"), "FROM x\nUSER mine\n"); // 利用者が手を入れた
    await write(path.join(ROOT, ".mcp.json"), "{}\n");
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n" });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["Dockerfile"]).toMatchObject({ state: "template-changed", base: "FROM x\n", app: "FROM x\nUSER mine\n", latest: "FROM y\n", appEdited: true });
    expect(f[".mcp.json"]).toMatchObject({ state: "unchanged", appEdited: false });
    expect(f[".mcp.json"].latest).toBeUndefined();
  });
  it("appEdited: 写したままなら false、アプリにファイルが無ければ false (base あり)", async () => {
    await write(path.join(ROOT, "Dockerfile"), "FROM x\n");
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n", ".devcontainer/compose.yml": "B\n" });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["Dockerfile"].appEdited).toBe(false);
    expect(f[".devcontainer/compose.yml"]).toMatchObject({ state: "template-changed", app: null, appEdited: false });
  });
  it("2 方向: 飛ばしたファイルは base が無く、appEdited は null。雛形が変わっていれば template-changed", async () => {
    await write(path.join(ROOT, "Dockerfile"), "FROM own\n");
    await recordScaffold(ROOT, { skipped: ["Dockerfile"] }, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, ".mcp.json": '{"a":1}\n' });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["Dockerfile"]).toMatchObject({ state: "template-changed", app: "FROM own\n", latest: "FROM x\n", appEdited: null });
    expect(f["Dockerfile"].base).toBeUndefined();
    expect(f[".mcp.json"].state).toBe("template-changed");
  });
  it("new-in-template / removed-from-template", async () => {
    await recordScaffold(ROOT, {}, "AI", TPL);
    const { ".mcp.json": _gone, ...rest } = BASE_FILES; void _gone;
    await seedTemplate({ ...rest, "docker-compose.yml": "services: {}\n" });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["docker-compose.yml"]).toMatchObject({ state: "new-in-template", latest: "services: {}\n", app: null });
    expect(f[".mcp.json"]).toMatchObject({ state: "removed-from-template", latest: null, base: "{}\n" });
  });
  it("README の節: app は README.md 全体。snippet が入っていれば appEdited false", async () => {
    await write(path.join(ROOT, "README.md"), "# app\n\n## 開発環境\n手順\n\n他の節\n");
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, "README.snippet.md": "## 開発環境\n新しい手順\n" });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["README.snippet.md"]).toMatchObject({ kind: "section", path: "README.md", state: "template-changed", appEdited: false });
    expect(f["README.snippet.md"].app).toContain("他の節");
  });
  it("outDir を変えた記録では、本番用のファイルと README を出力先から読む", async () => {
    await write(path.join(ROOT, "backend/Dockerfile"), "FROM x\n");
    await recordScaffold(ROOT, { outDir: "backend" }, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n" });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["Dockerfile"]).toMatchObject({ path: "backend/Dockerfile", app: "FROM x\n", appEdited: false });
  });
  it("no-record: 全ファイルを 2 方向で。アプリと同じなら unchanged、違えば template-changed、無ければ new-in-template", async () => {
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    await write(path.join(ROOT, ".mcp.json"), "{}\n");
    const u = await getScaffoldUpdate(ROOT, TPL);
    expect(u.status).toBe("no-record");
    expect(u.recordedAt).toBeUndefined();
    const f = byT(u);
    expect(f[".mcp.json"].state).toBe("unchanged");
    expect(f[".devcontainer/compose.yml"]).toMatchObject({ state: "template-changed", app: COMPOSE_WITH_HARMONY, latest: "A\n", appEdited: null });
    expect(f["Dockerfile"]).toMatchObject({ state: "new-in-template", app: null });
    expect(u.guide.length).toBeGreaterThan(0);
  });
  it("200KB で打ち切り、打ち切ったと分かる", async () => {
    await write(path.join(ROOT, "Dockerfile"), "a".repeat(MAX_SCAFFOLD_CONTENT + 10));
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n" });
    const d = byT(await getScaffoldUpdate(ROOT, TPL))["Dockerfile"];
    expect(d.truncated).toBe(true);
    expect(Buffer.byteLength(d.app as string)).toBe(MAX_SCAFFOLD_CONTENT);
  });
  it("ワークスペースの外を指す symlink は読まない", async () => {
    const outside = path.join(TPL, "secret.txt");
    await write(outside, "secret");
    await fs.symlink(outside, path.join(ROOT, "Dockerfile"));
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n" });
    expect(byT(await getScaffoldUpdate(ROOT, TPL))["Dockerfile"].app).toBeNull();
  });
  it("該当しないときは files も guide も空", async () => {
    const u = await getScaffoldUpdate(ROOT, TPL);
    expect(u).toMatchObject({ status: "not-applicable", files: [], guide: [] });
  });
});

describe("設計の要確認 (info) と project context", () => {
  it("版が違う → info。記録なし + Harmony の image → info。最新・該当なしは出さない", async () => {
    expect(await collectScaffoldIssues(ROOT, TPL)).toEqual([]);
    await recordScaffold(ROOT, {}, "AI", TPL);
    expect(await collectScaffoldIssues(ROOT, TPL)).toEqual([]);
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n" });
    const out = await collectScaffoldIssues(ROOT, TPL);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "info", section: "開発コンテナの雛形" });
    expect(out[0].message).toMatch(/spring-boot-thymeleaf.*記録 [0-9a-f]{12} → いま [0-9a-f]{12}.*designer__get_scaffold_update/);
    await fs.rm(path.join(ROOT, "design", "scaffold.json"));
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const nr = await collectScaffoldIssues(ROOT, TPL);
    expect(nr[0]).toMatchObject({ severity: "info" });
    expect(nr[0].message).toContain("記録がありません");
  });
  it("techStack が決まらない + Harmony の image → techStack を決める案内", async () => {
    await seedWs(null);
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const out = await collectScaffoldIssues(ROOT, TPL);
    expect(out[0].message).toContain("techStack");
  });
  it("collectExtraIssues は本体の雛形で info を足し、error / warning を足さない。project context に scaffold の要約が入る", async () => {
    const extra = await collectExtraIssues(ROOT);
    expect(extra.filter((i) => i.section === "開発コンテナの雛形")).toEqual([]); // 記録も Harmony の compose も無い
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const extra2 = await collectExtraIssues(ROOT);
    const sc = extra2.filter((i) => i.section === "開発コンテナの雛形");
    expect(sc).toHaveLength(1);
    expect(sc[0].severity).toBe("info");
    const ctx = (await buildProjectContext(ROOT)) as unknown as { scaffold: { status: string; combo: string; currentVersion: string } };
    expect(ctx.scaffold).toMatchObject({ status: "no-record", combo: "spring-boot-thymeleaf" });
    expect(JSON.stringify(ctx.scaffold)).not.toContain("FROM");
  });
  it("壊れた記録は warning (読み込み) で知らせる", async () => {
    await write(path.join(ROOT, "design", "scaffold.json"), "{ nope");
    const extra = await collectExtraIssues(ROOT);
    expect(extra.some((i) => i.severity === "warning" && i.section === "読み込み" && i.message.includes("scaffold.json"))).toBe(true);
  });
});

describe("MCP tool の登録", () => {
  it("2 つの tool があり、どのプロファイルからも案内を辿れる。get は読み取り専用、record は書き込み", () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain("designer__record_scaffold");
    expect(names).toContain("designer__get_scaffold_update");
    expect(isReadOnlyTool("designer__get_scaffold_update")).toBe(true);
    expect(isReadOnlyTool("designer__record_scaffold")).toBe(false);
    for (const p of Object.keys(PROFILES)) expect(isInProfile("designer__get_scaffold_update", [p]), p).toBe(true);
    for (const p of ["flow", "table", "screen", "doc", "maint"]) expect(isInProfile("designer__record_scaffold", [p]), p).toBe(true);
    expect(isInProfile("designer__record_scaffold", ["read"])).toBe(false);
  });
});

// 本体の雛形の置き場所の既定が、リポジトリの ai-skills を指していること
describe("雛形の置き場所", () => {
  it("既定は Harmony 本体の ai-skills/generate-code/templates/devcontainer", () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    expect(DEFAULT_TEMPLATES_ROOT).toBe(path.join(repo, "ai-skills/generate-code/templates/devcontainer"));
  });
});

describe("MCP tool の handler (本体の雛形)", () => {
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(((await handleDesignTool(name, args, ROOT, "s")) as { content: Array<{ text: string }> }).content[0].text);
  it("record_scaffold → get_scaffold_update で current。不正な引数は InvalidParams", async () => {
    const r = await call("designer__record_scaffold", { skipped: ["Dockerfile"] });
    expect(r).toMatchObject({ combo: "spring-boot-thymeleaf", outDir: ".", skipped: ["Dockerfile"] });
    const u = await call("designer__get_scaffold_update", {});
    expect(u).toMatchObject({ status: "current", combo: "spring-boot-thymeleaf", recordedVersion: r.templateVersion, currentVersion: r.templateVersion });
    expect(u.files.map((f: { template: string }) => f.template)).toContain("README.snippet.md");
    await expect(call("designer__record_scaffold", { outDir: "../x" })).rejects.toThrow(/outDir/);
  });
});

// ── #1577 PR #1578 レビューの指摘への試験 ───────────────────────────────

describe("雛形の置き場所は HARMONY_DOCS_DIR に従う (レビュー S1)", () => {
  const REL = "ai-skills/generate-code/templates/devcontainer";
  let DOCS = "";
  beforeEach(async () => {
    DOCS = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "docs-root-")));
    await fs.mkdir(path.join(DOCS, "schemas/v3"), { recursive: true });
    await fs.mkdir(path.join(DOCS, "docs/spec"), { recursive: true });
  });
  afterEach(async () => { await fs.rm(DOCS, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

  it("HARMONY_DOCS_DIR があればその下、無ければ本体のルートの下", () => {
    expect(defaultTemplatesRoot({ HARMONY_DOCS_DIR: DOCS })).toBe(path.join(DOCS, REL));
    expect(defaultTemplatesRoot({})).toBe(DEFAULT_TEMPLATES_ROOT);
  });
  it("資料の置き場が不正なら、本体のルートに戻る (エラーにしない)", () => {
    const err = console.error;
    console.error = () => {};
    try { expect(defaultTemplatesRoot({ HARMONY_DOCS_DIR: path.join(DOCS, "nothing") })).toBe(DEFAULT_TEMPLATES_ROOT); } finally { console.error = err; }
  });
  it("雛形の引数を渡さない呼び出し (画面・MCP と同じ) が、HARMONY_DOCS_DIR の雛形を読む", async () => {
    const files = { "Dockerfile": "FROM docs-dir\n", ".mcp.json": "{}\n" };
    for (const [rel, c] of Object.entries(files)) await write(path.join(DOCS, REL, "spring-boot-thymeleaf", rel), c);
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const saved = process.env.HARMONY_DOCS_DIR;
    process.env.HARMONY_DOCS_DIR = DOCS;
    try {
      const s = await scaffoldSummary(ROOT);
      expect(s).toMatchObject({ status: "no-record", combo: "spring-boot-thymeleaf" });
      expect(s.currentVersion).toBe(templateVersionOf(Object.entries(files).map(([template, content]) => ({ template, content }))));
      const u = await getScaffoldUpdate(ROOT);
      expect(u.files.map((f) => f.template).sort()).toEqual([".mcp.json", "Dockerfile"]);
    } finally {
      if (saved === undefined) delete process.env.HARMONY_DOCS_DIR; else process.env.HARMONY_DOCS_DIR = saved;
    }
  });
});

describe("外部の変更の通知 (レビュー S3)", () => {
  it("scaffold.json の変更 (git pull・手編集) は opsChanged で画面へ知らせる", () => {
    expect(classifyChangedPath("scaffold.json")).toEqual({ event: "opsChanged", data: {} });
    expect(classifyChangedPath("scaffold.txt")).toBeNull();
  });
});

describe("切り口は文字の境界 (レビュー N2)", () => {
  it("UTF-8 の途中で切らず、U+FFFD を入れない", () => {
    expect(cutAtCharBoundary("ああい", 4)).toBe("あ"); // 4 バイトは「あ」(3) + 「あ」の途中
    expect(cutAtCharBoundary("ああい", 6)).toBe("ああ");
    expect(cutAtCharBoundary("ああい", 100)).toBe("ああい");
    expect(cutAtCharBoundary("a😀b", 3)).toBe("a"); // 絵文字 (4 バイト) の途中
    expect(cutAtCharBoundary("abc", 2)).toBe("ab");
  });
  it("get_scaffold_update が日本語の長いファイルを切っても、壊れた文字が入らない", async () => {
    await write(path.join(ROOT, "Dockerfile"), "あ".repeat(100_000)); // 300KB
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n" });
    const d = (await getScaffoldUpdate(ROOT, TPL)).files.find((f) => f.template === "Dockerfile")!;
    expect(d.truncated).toBe(true);
    expect(d.app).not.toContain("\uFFFD");
    expect(Buffer.byteLength(d.app as string)).toBeLessThanOrEqual(MAX_SCAFFOLD_CONTENT);
    expect(Buffer.byteLength(d.app as string)).toBeGreaterThan(MAX_SCAFFOLD_CONTENT - 3);
  });
});

describe("Harmony の image を使っているかは image: の行で見る (レビュー N3)", () => {
  const uses = async (compose: string) => { await write(path.join(ROOT, ".devcontainer/compose.yml"), compose); return usesHarmonyImage(ROOT); };
  it("image: の行 (環境変数の既定値・引用符・版の固定を含む) は当たる", async () => {
    expect(await uses(COMPOSE_WITH_HARMONY)).toBe(true);
    expect(await uses(`services:\n  harmony:\n    image: ${HARMONY_IMAGE}:1.0\n`)).toBe(true);
    expect(await uses(`services:\n  harmony:\n    image: "${HARMONY_IMAGE}:1.0"\n`)).toBe(true);
    expect(await uses(`services:\n  harmony:\n    image: ${HARMONY_IMAGE}\n`)).toBe(true);
    expect(await uses(`services:\n  harmony:\n    image: \${HARMONY_IMAGE}\n`)).toBe(false); // 既定値なし = image の名前は分からない
  });
  it("コメント・別の image・別の項目での言及には当たらない", async () => {
    expect(await uses(`# ${HARMONY_IMAGE} を使う予定\nservices:\n  app:\n    image: node:26\n`)).toBe(false);
    expect(await uses(`services:\n  harmony:\n    image: ${HARMONY_IMAGE}-dev:1.0\n`)).toBe(false);
    expect(await uses(`services:\n  harmony:\n    image: ${HARMONY_IMAGE}x:1.0\n`)).toBe(false);
    expect(await uses(`services:\n  app:\n    image: node:26\n    environment:\n      NOTE: ${HARMONY_IMAGE}\n`)).toBe(false);
    expect(await uses(`services:\n  app:\n    image: node:26 # ${HARMONY_IMAGE}\n`)).toBe(false);
  });
  it("compose.yml が無ければ false", async () => {
    expect(await usesHarmonyImage(ROOT)).toBe(false);
  });
});

describe("not-applicable の理由は reasonCode で分ける (レビュー N4)", () => {
  it("理由の文を使わず、種類で返す", async () => {
    expect(await scaffoldSummary(ROOT, TPL)).toMatchObject({ status: "not-applicable", reasonCode: "image-not-used" });
    await seedWs(null);
    expect(await scaffoldSummary(ROOT, TPL)).toMatchObject({ status: "not-applicable", reasonCode: "no-scaffold-record" });
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    expect(await scaffoldSummary(ROOT, TPL)).toMatchObject({ status: "not-applicable", reasonCode: "tech-stack-undecided" });
    await seedWs();
    await recordScaffold(ROOT, {}, "AI", TPL);
    expect(await scaffoldSummary(ROOT, path.join(TPL, "none"))).toMatchObject({ status: "not-applicable", reasonCode: "template-missing" });
  });
  it("info は理由の文でなく reasonCode で決まる。文に techStack が入っていても種類が違えば出さず、文が変わっても種類が techStack 未決定なら出す", () => {
    expect(issuesOfSummary({ status: "not-applicable", reasonCode: "template-missing", reason: "雛形が見つかりません。harmony.json の techStack を見直してください" })).toEqual([]);
    expect(issuesOfSummary({ status: "not-applicable", reasonCode: "image-not-used", reason: "techStack とは関係ない理由" })).toEqual([]);
    const out = issuesOfSummary({ status: "not-applicable", reasonCode: "tech-stack-undecided", reason: "文言が変わっても出る" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "info", section: "開発コンテナの雛形" });
    expect(out[0].message).toContain("文言が変わっても出る");
    expect(issuesOfSummary({ status: "not-applicable", reason: "techStack" })).toEqual([]); // reasonCode が無ければ出さない
  });
  it("info は reasonCode で出る (文を変えても黙らない)。techStack 未決定の案内は理由の文を添える", async () => {
    await seedWs(null);
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const out = await collectScaffoldIssues(ROOT, TPL);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain((await scaffoldSummary(ROOT, TPL)).reason!);
    // 記録があって雛形が見つからない (template-missing) 場合は出さない
    await seedWs();
    await recordScaffold(ROOT, {}, "AI", TPL);
    await fs.rm(path.join(ROOT, ".devcontainer/compose.yml"));
    expect(await collectScaffoldIssues(ROOT, path.join(TPL, "none"))).toEqual([]);
  });
});

describe("記録のファイルが多すぎるときは知らせる (レビュー N5)", () => {
  const rec = (n: number) => ({
    combo: "spring-boot-thymeleaf", outDir: ".", templateVersion: "0123456789ab", recordedAt: "2026-10-31T00:00:00.000Z",
    files: Array.from({ length: n }, (_, i) => ({ template: `f${i}`, path: `f${i}`, kind: "file", content: "x" })),
  });
  it("50 件までは何も言わず、超えた分は件数つきの problem で知らせる", () => {
    expect(parseScaffold(rec(50)).problems).toEqual([]);
    const over = parseScaffold(rec(53));
    expect(over.value?.files).toHaveLength(50);
    expect(over.problems).toHaveLength(1);
    expect(over.problems[0]).toMatch(/50 件を超え.*3 件.*読みません/);
  });
});

describe("記録なしで README に節が無いときは、節を足す (レビュー N6)", () => {
  const readme = async (u: ReturnType<typeof getScaffoldUpdate>) => (await u).files.find((f) => f.template === "README.snippet.md")!;
  it("README はあるが節が無い → new-in-template", async () => {
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    await write(path.join(ROOT, "README.md"), "# app\n\n## 別の節\n中身\n");
    expect(await readme(getScaffoldUpdate(ROOT, TPL))).toMatchObject({ state: "new-in-template", kind: "section" });
  });
  it("README に見出しがあって中身が違う → template-changed。同じ → unchanged。README が無い → new-in-template", async () => {
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    await write(path.join(ROOT, "README.md"), "# app\n\n## 開発環境\n古い手順\n");
    expect(await readme(getScaffoldUpdate(ROOT, TPL))).toMatchObject({ state: "template-changed" });
    await write(path.join(ROOT, "README.md"), "# app\n\n## 開発環境\n手順\n");
    expect(await readme(getScaffoldUpdate(ROOT, TPL))).toMatchObject({ state: "unchanged" });
    await fs.rm(path.join(ROOT, "README.md"));
    expect(await readme(getScaffoldUpdate(ROOT, TPL))).toMatchObject({ state: "new-in-template" });
  });
});

describe("当てなかったファイルは skipped に渡すと、案内に強く書く (レビュー N7)", () => {
  it("tool の説明・guide・SKILL.md が「必ず skipped」と、渡さないとどうなるかを言う", async () => {
    const rec = scaffoldTools.find((t) => t.name === "designer__record_scaffold")!;
    expect(rec.description).toMatch(/必ず.*skipped/);
    expect(rec.description).toContain("置き換わる");
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const guide = (await getScaffoldUpdate(ROOT, TPL)).guide.join("\n");
    expect(guide).toMatch(/必ず skipped/);
    expect(guide).toContain("置き換わ");
    const skill = await fs.readFile(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."), "ai-skills/generate-code/SKILL.md"), "utf-8");
    expect(skill).toMatch(/必ず\*\* `skipped`/);
  });
});

describe("設計の要確認 (info) は覚える (レビュー N8)", () => {
  it("設計のデータ・ルートの compose.yml が変わらないあいだは同じ結果を返し、変わったら読み直す", async () => {
    const a = await collectScaffoldIssues(ROOT);
    expect(await collectScaffoldIssues(ROOT)).toBe(a); // 同じ配列 = 覚えている
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const b = await collectScaffoldIssues(ROOT);
    expect(b).not.toBe(a);
    expect(b).toHaveLength(1); // 記録なし + Harmony の image → info
    expect(await collectScaffoldIssues(ROOT)).toBe(b);
    await recordScaffold(ROOT, {}, "AI", TPL); // 記録 (設計のデータ) が変わった。本体の雛形ではなく TPL で記録したので、本体の雛形とは版が違う
    const c = await collectScaffoldIssues(ROOT);
    expect(c).not.toBe(b);
    expect(c[0]?.message ?? "").toContain("新しくなっています");
  });
  it("雛形の置き場を指定したときは覚えない (試験で雛形を差し替えられる)", async () => {
    const a = await collectScaffoldIssues(ROOT, TPL);
    expect(await collectScaffoldIssues(ROOT, TPL)).not.toBe(a);
  });
});

// ── tax-app の実機確認の提案: README の節の切り出しと、人に見せる差分 ──────────

describe("人に見せる差分 (diff / templateDiff / appChanges)", () => {
  const byT = (u: Awaited<ReturnType<typeof getScaffoldUpdate>>) => Object.fromEntries(u.files.map((f) => [f.template, f]));
  it("3 方向: diff は アプリ → 新しい雛形、templateDiff は 写したとき → 新しい雛形、appChanges は 写したとき → アプリ", async () => {
    await write(path.join(ROOT, "Dockerfile"), "FROM x\nUSER mine\n");
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n" });
    const f = byT(await getScaffoldUpdate(ROOT, TPL))["Dockerfile"];
    const head = "--- a/Dockerfile\n+++ b/Dockerfile\n";
    expect(f.templateDiff).toBe(`${head}@@ -1,1 +1,1 @@\n-FROM x\n+FROM y\n`);
    expect(f.appChanges).toBe(`${head}@@ -1,2 +1,2 @@\n FROM x\n+USER mine\n`.replace("@@ -1,2 +1,2 @@", "@@ -1,1 +1,2 @@"));
    expect(f.diff).toBe(`${head}@@ -1,2 +1,1 @@\n-FROM x\n-USER mine\n+FROM y\n`);
    expect(f.diffTooLarge).toBeUndefined();
    expect(f.diffTruncated).toBeUndefined();
  });
  it("2 方向 (base が無い): diff だけ。templateDiff / appChanges は付かない。アプリにファイルが無ければ、全部が追加の差分", async () => {
    await write(path.join(ROOT, "Dockerfile"), "FROM own\n");
    await recordScaffold(ROOT, { skipped: ["Dockerfile"] }, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, ".mcp.json": '{"a":1}\n', "docker-compose.yml": "services: {}\n" });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["Dockerfile"].diff).toBe("--- a/Dockerfile\n+++ b/Dockerfile\n@@ -1,1 +1,1 @@\n-FROM own\n+FROM x\n");
    expect(f["Dockerfile"].templateDiff).toBeUndefined();
    expect(f["Dockerfile"].appChanges).toBeUndefined();
    expect(f["docker-compose.yml"]).toMatchObject({ state: "new-in-template", diff: "--- a/docker-compose.yml\n+++ b/docker-compose.yml\n@@ -0,0 +1,1 @@\n+services: {}\n" });
  });
  it("アプリにファイルが無い (base あり) と appChanges は付かない。雛形から無くなったファイルの diff は全部削除", async () => {
    await write(path.join(ROOT, ".mcp.json"), "{}\n");
    await recordScaffold(ROOT, {}, "AI", TPL);
    const { ".mcp.json": _gone, ...rest } = BASE_FILES; void _gone;
    await seedTemplate({ ...rest, Dockerfile: "FROM y\n" });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["Dockerfile"].appChanges).toBeUndefined(); // アプリに Dockerfile が無い
    expect(f["Dockerfile"].templateDiff).toContain("+FROM y");
    expect(f[".mcp.json"]).toMatchObject({ state: "removed-from-template", diff: "--- a/.mcp.json\n+++ b/.mcp.json\n@@ -1,1 +0,0 @@\n-{}\n" });
  });
  it("unchanged のファイルには差分を付けない。CRLF のアプリのファイルは LF にそろえて比べる", async () => {
    await write(path.join(ROOT, "Dockerfile"), "FROM x\r\n");
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, ".mcp.json": '{"a":1}\n' });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["Dockerfile"].state).toBe("unchanged");
    expect(f["Dockerfile"].diff).toBeUndefined();
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM x\nRUN a\n" });
    const g = byT(await getScaffoldUpdate(ROOT, TPL))["Dockerfile"];
    expect(g.diff).toBe("--- a/Dockerfile\n+++ b/Dockerfile\n@@ -1,1 +1,2 @@\n FROM x\n+RUN a\n");
    expect(g.appChanges).toBe(""); // 手入れは無い (CRLF の違いは差にしない)
  });
  it("片方が 3000 行を超えるファイルは、差分を作らず diffTooLarge。ほかのファイルには影響しない", async () => {
    const big = Array.from({ length: 3001 }, (_, i) => `l${i}`).join("\n") + "\n";
    await write(path.join(ROOT, "Dockerfile"), big);
    await recordScaffold(ROOT, { skipped: ["Dockerfile"] }, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, Dockerfile: "FROM y\n", ".mcp.json": '{"a":1}\n' });
    const f = byT(await getScaffoldUpdate(ROOT, TPL));
    expect(f["Dockerfile"]).toMatchObject({ state: "template-changed", diffTooLarge: true });
    expect(f["Dockerfile"].diff).toBeUndefined();
    expect(f["Dockerfile"].app).toBe(big); // 中身は返す (自分で比べられる)
    expect(f[".mcp.json"].diff).toContain("+{\"a\":1}");
    expect(f[".mcp.json"].diffTooLarge).toBeUndefined();
  });
  it("差分が 200KB を超えるときは、行の境界で切り、diffTruncated で知らせる", async () => {
    const lines = (p: string) => Array.from({ length: 2900 }, (_, i) => `${p}${i} ${"x".repeat(100)}`).join("\n") + "\n";
    await write(path.join(ROOT, "Dockerfile"), lines("a"));
    await recordScaffold(ROOT, { skipped: ["Dockerfile"] }, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, Dockerfile: lines("b") });
    const f = byT(await getScaffoldUpdate(ROOT, TPL))["Dockerfile"];
    expect(f.diffTruncated).toBe(true);
    expect(Buffer.byteLength(f.diff!)).toBeLessThanOrEqual(MAX_SCAFFOLD_CONTENT);
    expect(f.diff!.endsWith("\n")).toBe(true);
    expect(f.diffTooLarge).toBeUndefined();
  });
});

describe("README の節 (appSection / sectionHeading / appSectionRange)", () => {
  const readme = async (u: ReturnType<typeof getScaffoldUpdate>) => (await u).files.find((f) => f.template === "README.snippet.md")!;
  const README = "# app\n\n## 開発環境\n手順\n追記した行\n\n## 本番\n本番の手順\n";
  it("節だけを切り出して返し、差分と appEdited は節で見る (他の節の違いは出ない)", async () => {
    await write(path.join(ROOT, "README.md"), README);
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, "README.snippet.md": "## 開発環境\n新しい手順\n" });
    const f = await readme(getScaffoldUpdate(ROOT, TPL));
    expect(f).toMatchObject({ kind: "section", path: "README.md", state: "template-changed", sectionHeading: "## 開発環境", appSectionRange: { startLine: 3, endLine: 5 } });
    expect(f.appSection).toBe("## 開発環境\n手順\n追記した行");
    expect(f.app).toBe(README); // README 全体は今までどおり
    expect(f.appEdited).toBe(false); // base の節の本文は入っている (追記は手入れとみなさない: 従来どおり)
    expect(f.diff).toBe("--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,2 @@\n ## 開発環境\n-手順\n-追記した行\n+新しい手順\n");
    expect(f.templateDiff).toBe("--- a/README.md\n+++ b/README.md\n@@ -1,2 +1,2 @@\n ## 開発環境\n-手順\n+新しい手順\n");
    expect(f.appChanges).toBe("--- a/README.md\n+++ b/README.md\n@@ -1,2 +1,3 @@\n ## 開発環境\n 手順\n+追記した行\n");
  });
  it("節の本文を書き換えた (base が入っていない) ら appEdited は true。節の外の変更は無関係", async () => {
    await write(path.join(ROOT, "README.md"), "# app\n\n## 開発環境\n書き換えた手順\n\n## 本番\n手順\n"); // base の本文 (「手順」) は別の節にだけある
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, "README.snippet.md": "## 開発環境\n新しい手順\n" });
    const f = await readme(getScaffoldUpdate(ROOT, TPL));
    expect(f.appEdited).toBe(true);
  });
  it("README に節が無ければ appSection は null (diff は全部追加)。README が無くても null", async () => {
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    await write(path.join(ROOT, "README.md"), "# app\n\n## 別の節\n中身\n");
    const f = await readme(getScaffoldUpdate(ROOT, TPL));
    expect(f).toMatchObject({ state: "new-in-template", appSection: null, appSectionRange: null, sectionHeading: "## 開発環境" });
    expect(f.diff).toBe("--- a/README.md\n+++ b/README.md\n@@ -0,0 +1,2 @@\n+## 開発環境\n+手順\n");
    await fs.rm(path.join(ROOT, "README.md"));
    const g = await readme(getScaffoldUpdate(ROOT, TPL));
    expect(g).toMatchObject({ state: "new-in-template", app: null, appSection: null, appSectionRange: null });
  });
  it("見出しが複数ある README・README の終わりまで続く節・出力先 (outDir) の README", async () => {
    await write(path.join(ROOT, "backend/README.md"), "# a\n## 開発環境\n手順\n### 小見出し\n中\n# 上のレベル\n外\n");
    await recordScaffold(ROOT, { outDir: "backend" }, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, "README.snippet.md": "## 開発環境\n新しい手順\n" });
    const f = await readme(getScaffoldUpdate(ROOT, TPL));
    expect(f).toMatchObject({ path: "backend/README.md", appSection: "## 開発環境\n手順\n### 小見出し\n中", appSectionRange: { startLine: 2, endLine: 5 } });
    await write(path.join(ROOT, "backend/README.md"), "# a\n## 開発環境\n手順\n最後まで\n");
    expect((await readme(getScaffoldUpdate(ROOT, TPL))).appSectionRange).toEqual({ startLine: 2, endLine: 4 });
  });
  it("記録なし (2 方向): 節が同じなら unchanged、README の他の部分が違っても影響しない。違えば template-changed", async () => {
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    await write(path.join(ROOT, "README.md"), "# 全然違う README\n\n## 開発環境\n手順\n\n## 本番\n別\n");
    expect(await readme(getScaffoldUpdate(ROOT, TPL))).toMatchObject({ state: "unchanged" });
    await write(path.join(ROOT, "README.md"), "# a\n## 開発環境\n古い手順\n");
    const f = await readme(getScaffoldUpdate(ROOT, TPL));
    expect(f).toMatchObject({ state: "template-changed", appEdited: null });
    expect(f.diff).toBe("--- a/README.md\n+++ b/README.md\n@@ -1,2 +1,2 @@\n ## 開発環境\n-古い手順\n+手順\n");
  });
  it("見出しの無い snippet は、これまでどおり README 全体で見る (appSection は null)", async () => {
    await write(path.join(ROOT, "README.md"), "# app\n手順だけ\n");
    await seedTemplate({ ...BASE_FILES, "README.snippet.md": "手順だけ\n" });
    await recordScaffold(ROOT, {}, "AI", TPL);
    await seedTemplate({ ...BASE_FILES, "README.snippet.md": "新しい手順だけ\n" });
    const f = await readme(getScaffoldUpdate(ROOT, TPL));
    expect(f).toMatchObject({ state: "template-changed", appEdited: false, appSection: null });
  });
});

describe("guide と案内が diff / appSection を言う", () => {
  it("guide・SKILL.md・仕様書に、diff を見せる・appSection の範囲だけ差し替える、が書いてある", async () => {
    await write(path.join(ROOT, ".devcontainer/compose.yml"), COMPOSE_WITH_HARMONY);
    const guide = (await getScaffoldUpdate(ROOT, TPL)).guide.join("\n");
    expect(guide).toMatch(/自分で差分を作らず/);
    expect(guide).toMatch(/appSection.*範囲だけ/);
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    for (const [f, re] of [["ai-skills/generate-code/SKILL.md", /自分で差分を作らず/], ["docs/spec/mcp-design-access.md", /appSection/], ["docs/spec/integration-ops.md", /templateDiff/]] as const) {
      expect(await fs.readFile(path.join(repo, f), "utf-8"), f).toMatch(re);
    }
  });
});
