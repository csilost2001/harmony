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
import { destinationOf, getScaffoldUpdate, loadTemplate, parseScaffold, recordScaffold, SCAFFOLD_COMBOS, scaffoldStore, scaffoldSummary, collectScaffoldIssues, templateVersionOf, DEFAULT_TEMPLATES_ROOT, HARMONY_IMAGE, MAX_SCAFFOLD_CONTENT } from "./scaffold.js";

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
