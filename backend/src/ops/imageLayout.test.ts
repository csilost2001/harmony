/**
 * 配布 image の中の配置の確認 (#1577 PR #1578 レビュー S6)。docker の無い環境でも、Dockerfile・.dockerignore・smoke の script を文字で読んで、
 * 「コードが読む場所」と「image に置く場所」が食い違っていないことを確かめる。実機の確認は `scripts/smoke-harmony-image.sh`。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TEMPLATES_ROOT, SCAFFOLD_COMBOS } from "./scaffold.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf-8");
const dockerfile = read("Dockerfile");
const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

describe("配布 image の配置 (Dockerfile ↔ コードが読む場所)", () => {
  it("実行時のルートは /app。backend/dist/ops/*.js の ../../.. がそこになる (build-info.json・雛形・docs を /app 直下から読む)", () => {
    expect(runtime).toMatch(/^WORKDIR \/app$/m);
    expect(runtime).toMatch(/COPY --from=build \/app\/backend\/dist \.\/backend\/dist/); // /app/backend/dist/ops/*.js
    expect(path.posix.resolve("/app/backend/dist/ops", "../../..")).toBe("/app");
    // ソース上でも同じ式 (backend/src/ops/*.ts の ../../..) がリポジトリのルートになる
    expect(path.resolve(REPO, "backend/src/ops", "../../..")).toBe(REPO);
  });
  it("実装側が PROJECT_ROOT を `path.resolve(import.meta.dirname, \"../../..\")` で作っている (この式を変えると、image の配置の前提が崩れるので落ちる)", () => {
    for (const rel of ["backend/src/ops/scaffold.ts", "backend/src/ops/versionInfo.ts"]) {
      expect(read(rel), rel).toMatch(/const PROJECT_ROOT = path\.resolve\(import\.meta\.dirname, "\.\.\/\.\.\/\.\."\);/);
    }
    // 資料の置き場 (docsRoot.ts) は backend/src 直下にあり、`../..` で /app になる (backend/dist 直下も同じ)
    expect(read("backend/src/docsRoot.ts")).toMatch(/path\.resolve\(here, "\.\.\/\.\."\)/);
    expect(fs.existsSync(path.join(REPO, "backend/src/docsRoot.ts"))).toBe(true);
  });
  it("雛形は COPY ai-skills で /app/ai-skills に入り、コードの既定の置き場と同じ相対パス", () => {
    expect(lines(runtime)).toContain("COPY ai-skills ./ai-skills");
    expect(path.relative(REPO, DEFAULT_TEMPLATES_ROOT)).toBe("ai-skills/generate-code/templates/devcontainer");
  });
  it("build-info.json は /app/build-info.json に書く (readBuildInfo が読むプロジェクトのルート直下)", () => {
    expect(dockerfile).toContain("writeFileSync(\"/app/build-info.json\"");
    expect(dockerfile).toContain("org.opencontainers.image.revision");
    expect(lines(runtime)).toContain("COPY docs/release-notes.md ./docs/release-notes.md");
    // build-info.json を書くのは runtime の段 (build の段ではない)
    expect(runtime).toContain("/app/build-info.json");
  });
});

describe(".dockerignore が雛形を落とさない", () => {
  const rules = lines(read(".dockerignore"));
  // Docker の .dockerignore は、先頭が `**/` でない規則を、build context の根からの相対で見る。根にしか効かない規則は、雛形の中の同名のものを落とさない
  const rootOnly = rules.filter((r) => !r.startsWith("**/") && !r.startsWith("!"));
  const anywhere = rules.filter((r) => r.startsWith("**/")).map((r) => r.slice(3));

  it("雛形の中の .devcontainer・.tmp/.gitignore・.mcp.json は、根にだけ効く規則 (.devcontainer / .tmp / .gitignore) に当たらない", () => {
    for (const r of [".devcontainer", ".tmp", ".gitignore"]) expect(rootOnly, r).toContain(r);
    for (const r of [".devcontainer", ".tmp", ".gitignore", ".mcp.json"]) expect(anywhere, `**/${r} だと雛形の中のものまで落ちる`).not.toContain(r);
    expect(rootOnly.some((r) => r.includes("ai-skills"))).toBe(false);
  });
  it("どの階層にも効く規則 (**/node_modules・**/dist・**/build ほか) は、雛形のどのパスにも当たらない", () => {
    for (const combo of SCAFFOLD_COMBOS) {
      const dir = path.join(DEFAULT_TEMPLATES_ROOT, combo);
      const walk = (d: string, rel: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]));
      for (const f of walk(dir, "")) for (const seg of f.split("/")) expect(anywhere, `${combo}/${f}`).not.toContain(seg);
    }
  });
});

describe("smoke の script が image の中を確かめる", () => {
  const smoke = read("scripts/smoke-harmony-image.sh");
  it("build のときの commit と build-info.json・label・workspace_status の harmony.commit の一致を確かめる", () => {
    expect(smoke).toContain("/app/build-info.json");
    expect(smoke).toContain("org.opencontainers.image.revision");
    expect(smoke).toContain("designer__workspace_status");
    expect(smoke).toContain("HARMONY_SMOKE_EXPECT_COMMIT");
    expect(smoke).toContain("harmony.commit");
  });
  it("host の node_modules に頼らない (require(\"ws\") を使わず、Node 組み込みの WebSocket を使う)。公開ポートが使われていれば docker run の前に断る", () => {
    expect(smoke).not.toMatch(/require\(\s*["']ws["']\s*\)/);
    expect(smoke).not.toMatch(/from\s+["']ws["']/);
    expect(smoke).toContain("typeof WebSocket === \"undefined\"");
    expect(smoke).toContain("new WebSocket(");
    const portCheck = smoke.indexOf("net.createServer");
    expect(portCheck).toBeGreaterThan(-1);
    expect(portCheck).toBeLessThan(smoke.indexOf("run -d")); // 起動の前に確かめる
    expect(smoke).toContain("HARMONY_SMOKE_PORT=5189");
  });
  it("雛形の 4 組合せ × 7 ファイルが image にあることを確かめる (script の組合せとファイルが、コードの定義と同じ)", () => {
    const combos = /for combo in ([^;]+); do/.exec(smoke)?.[1].trim().split(/\s+/);
    expect(combos).toEqual([...SCAFFOLD_COMBOS]);
    const files = /for f in ([^;]+); do/.exec(smoke)?.[1].trim().split(/\s+/) ?? [];
    expect(files).toHaveLength(7);
    for (const combo of SCAFFOLD_COMBOS) for (const f of files) expect(fs.existsSync(path.join(DEFAULT_TEMPLATES_ROOT, combo, f)), `${combo}/${f}`).toBe(true);
    expect(smoke).toContain("/app/ai-skills/generate-code/templates/devcontainer");
  });
});
