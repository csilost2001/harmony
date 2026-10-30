/**
 * スキルの付属ファイル (harmony://skill/<名前>/files と harmony://skill/<名前>/<パス>) の読み取りと守り (#1561)。
 * 守りの試験は、一時ディレクトリに資料の根を作って再現する。実リポジトリの読み出しは、実際の MCP プロトコルでも確かめる。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcpServer.js";
import { SERVER_INSTRUCTIONS, getPrompt, listResourceTemplates, listResources, readResource } from "./mcpKnowledge.js";
import { connect as wsConnect, disconnect as wsDisconnect } from "./workspaceState.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SESSION = `mcp-skill-files-test-${process.pid}`;

let tmp: string;
let outside: string;

const text = async (uri: string, root: string | null = tmp) => (await readResource(uri, null, root)).contents[0].text;
const list = async (skill: string, root: string | null = tmp) => JSON.parse(await text(`harmony://skill/${skill}/files`, root)) as { skill: string; files: Array<{ path: string; size: number; uri: string }>; note: string };

beforeAll(() => {
  wsConnect(SESSION);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-skill-files-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-skill-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "外のファイル");
  const gc = path.join(tmp, "ai-skills/generate-code");
  fs.mkdirSync(path.join(gc, "templates/devcontainer/x/.devcontainer"), { recursive: true });
  fs.writeFileSync(path.join(gc, "SKILL.md"), "---\ndescription: テスト\n---\n本文\n");
  fs.writeFileSync(path.join(gc, "templates/devcontainer/x/.devcontainer/devcontainer.json"), '{ "name": "x" }');
  fs.writeFileSync(path.join(gc, "templates/devcontainer/x/compose.yml"), "services: {}\n");
  fs.writeFileSync(path.join(gc, "templates/README.md"), "# 説明\n");
  fs.writeFileSync(path.join(gc, "binary.bin"), Buffer.from([1, 2, 0, 3]));
  fs.writeFileSync(path.join(gc, "big.txt"), Buffer.alloc(1024 * 1024 + 1, 97));
  // シンボリックリンク: ファイル・フォルダのどちらも辿らない
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(gc, "link-file.txt"));
  fs.symlinkSync(outside, path.join(gc, "link-dir"));
  // PROMPT_SKILLS 以外のスキル
  fs.mkdirSync(path.join(tmp, "ai-skills/issues"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "ai-skills/issues/SKILL.md"), "開発用");
});
afterAll(() => {
  wsDisconnect(SESSION);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("harmony://skill/<名前>/files (一覧)", () => {
  it("通常のファイルだけを、/ 区切りの相対パスで載せる (シンボリックリンク・大きすぎるファイルは載せない)", async () => {
    const l = await list("generate-code");
    expect(l.skill).toBe("generate-code");
    expect(l.files.map((f) => f.path)).toEqual([
      "SKILL.md",
      "binary.bin",
      "templates/README.md",
      "templates/devcontainer/x/.devcontainer/devcontainer.json",
      "templates/devcontainer/x/compose.yml",
    ]);
    expect(l.files.find((f) => f.path === "SKILL.md")?.uri).toBe("harmony://skill/generate-code/SKILL.md");
    expect(l.files.find((f) => f.path === "SKILL.md")?.size).toBeGreaterThan(0);
    expect(l.note).toContain("載せなかったもの 1 件"); // big.txt
  });

  it("listResources に各スキルの一覧が出て、listResourceTemplates に 2 つの形が出る", () => {
    const uris = listResources(tmp).map((r) => r.uri);
    expect(uris).toContain("harmony://skill/generate-code/files");
    expect(uris).not.toContain("harmony://skill/issues/files");
    expect(uris).not.toContain("harmony://skill/create-flow/files"); // SKILL.md が無いスキルは出さない
    const tpl = listResourceTemplates().map((t) => t.uriTemplate);
    expect(tpl).toEqual(expect.arrayContaining(["harmony://skill/{name}/files", "harmony://skill/{name}/{+path}"]));
  });
});

describe("harmony://skill/<名前>/<パス> (1 ファイル)", () => {
  it("入れ子のファイルを、拡張子に合う mimeType で読める", async () => {
    const json = (await readResource("harmony://skill/generate-code/templates/devcontainer/x/.devcontainer/devcontainer.json", null, tmp)).contents[0];
    expect(json.mimeType).toBe("application/json");
    expect(json.text).toBe('{ "name": "x" }');
    expect((await readResource("harmony://skill/generate-code/templates/README.md", null, tmp)).contents[0].mimeType).toBe("text/markdown");
    expect((await readResource("harmony://skill/generate-code/templates/devcontainer/x/compose.yml", null, tmp)).contents[0].mimeType).toBe("text/plain");
    expect(await text("harmony://skill/generate-code/SKILL.md")).toContain("本文");
  });

  it("一覧に無いパス・.. ・絶対パス・ディレクトリ・未知の名前・PROMPT_SKILLS 以外は断る", async () => {
    const bad = [
      "harmony://skill/generate-code/templates/nope.md",
      "harmony://skill/generate-code/../issues/SKILL.md",
      "harmony://skill/generate-code/templates/../SKILL.md",
      "harmony://skill/generate-code/%2e%2e/issues/SKILL.md",
      "harmony://skill/generate-code/..%2Fissues%2FSKILL.md",
      "harmony://skill/generate-code//etc/passwd",
      "harmony://skill/generate-code/templates",
      "harmony://skill/generate-code/templates/",
      "harmony://skill/generate-code/SKILL.md?x=1",
      "harmony://skill/issues/SKILL.md",
      "harmony://skill/issues/files",
      "harmony://skill/..%2Fx/files",
      "harmony://skill/nope/files",
      "harmony://skill/generate-code",
    ];
    for (const uri of bad) await expect(readResource(uri, null, tmp), uri).rejects.toThrow();
  });

  it("シンボリックリンク (ファイル・フォルダ) は、パスを直接指定されても辿らない", async () => {
    await expect(readResource("harmony://skill/generate-code/link-file.txt", null, tmp)).rejects.toThrow(/見つかりません/);
    await expect(readResource("harmony://skill/generate-code/link-dir/secret.txt", null, tmp)).rejects.toThrow(/見つかりません/);
  });

  it("スキルのフォルダ自体がシンボリックリンクなら、読まない", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-skill-root-"));
    try {
      fs.mkdirSync(path.join(root, "ai-skills"));
      fs.mkdirSync(path.join(outside, "gen"), { recursive: true });
      fs.writeFileSync(path.join(outside, "gen/SKILL.md"), "外");
      fs.symlinkSync(path.join(outside, "gen"), path.join(root, "ai-skills/generate-code"));
      await expect(readResource("harmony://skill/generate-code/files", null, root)).rejects.toThrow(/見つかりません/);
      await expect(readResource("harmony://skill/generate-code/SKILL.md", null, root)).rejects.toThrow();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("NUL を含むファイルと、大きすぎるファイルは読めない", async () => {
    await expect(readResource("harmony://skill/generate-code/binary.bin", null, tmp)).rejects.toThrow(/テキストではない/);
    await expect(readResource("harmony://skill/generate-code/big.txt", null, tmp)).rejects.toThrow(/見つかりません/);
  });

  it("資料が同梱されていない環境では、案内つきで断る", async () => {
    await expect(readResource("harmony://skill/generate-code/files", null, null)).rejects.toThrow(/同梱されていません/);
  });

  it("深さ・件数の上限を超えたものは載せない", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-skill-limit-"));
    try {
      const deep = path.join(root, "ai-skills/create-flow", ...Array.from({ length: 14 }, (_, i) => `d${i}`));
      fs.mkdirSync(deep, { recursive: true });
      fs.writeFileSync(path.join(deep, "deep.txt"), "x");
      fs.writeFileSync(path.join(root, "ai-skills/create-flow/SKILL.md"), "x");
      const l = await list("create-flow", root);
      expect(l.files.map((f) => f.path)).toEqual(["SKILL.md"]);
      expect(l.note).toContain("載せなかったもの 1 件");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe("件数の上限", () => {
  it("2001 個のファイルがあると、一覧は 2000 件までで、載せなかった件数を note に書く", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-skill-count-"));
    try {
      const dir = path.join(root, "ai-skills/create-flow");
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 2001; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, "0")}.txt`), "x");
      const l = await list("create-flow", root);
      expect(l.files).toHaveLength(2000);
      expect(l.note).toContain("載せなかったもの 1 件");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe("Prompt の付属ファイルの案内", () => {
  it("付属ファイルがあるスキルにだけ出し、相対パスでも読めると伝える。SKILL.md だけのスキルには出さない", () => {
    const withFiles = getPrompt("generate-code", undefined, tmp).messages[0].content.text;
    expect(withFiles).toContain("templates/...");
    expect(withFiles).toContain("harmony://skill/generate-code/<スキルのフォルダからの相対パス>");
    const only = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-skill-only-"));
    try {
      fs.mkdirSync(path.join(only, "ai-skills/create-flow"), { recursive: true });
      fs.writeFileSync(path.join(only, "ai-skills/create-flow/SKILL.md"), "---\ndescription: x\n---\n本文\n");
      const p = getPrompt("create-flow", undefined, only).messages[0].content.text;
      expect(p).not.toContain("harmony://skill/");
      expect(p).toContain("本文");
    } finally { fs.rmSync(only, { recursive: true, force: true }); }
  });
});

describe("実リポジトリの generate-code", () => {
  it("devcontainer の雛形 (隠しフォルダの中のファイルを含む) が一覧に出て、読める", async () => {
    const l = await list("generate-code", REPO);
    const paths = l.files.map((f) => f.path);
    expect(paths).toContain("SKILL.md");
    expect(paths).toContain("templates/devcontainer/nestjs-nextjs/.devcontainer/devcontainer.json");
    expect(await text("harmony://skill/generate-code/templates/devcontainer/nestjs-nextjs/.devcontainer/devcontainer.json", REPO)).toContain("dockerComposeFile");
  });

  it("MCP プロトコルで、一覧・複数階層の読み出し・断りができ、案内に付属ファイルの読み方がある", async () => {
    const server = createMcpServer(SESSION, []);
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      expect((await client.listResources()).resources.map((r) => r.uri)).toContain("harmony://skill/generate-code/files");
      expect((await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate)).toContain("harmony://skill/{name}/{+path}");
      const files = JSON.parse(((await client.readResource({ uri: "harmony://skill/generate-code/files" })).contents[0] as { text: string }).text);
      expect(files.files.length).toBeGreaterThan(10);
      const one = files.files.find((f: { path: string }) => f.path.endsWith("nestjs-nextjs/compose.yml") || f.path.endsWith("nestjs-nextjs/.devcontainer/compose.yml"));
      expect(one).toBeTruthy();
      expect(((await client.readResource({ uri: one.uri })).contents[0] as { text: string }).text).toContain("harmony");
      await expect(client.readResource({ uri: "harmony://skill/issues/SKILL.md" })).rejects.toThrow();
      await expect(client.readResource({ uri: "harmony://skill/generate-code/../issues/SKILL.md" })).rejects.toThrow();
    } finally { await client.close(); await server.close(); }
    expect(SERVER_INSTRUCTIONS).toContain("harmony://skill/");
    // 作業先は最後に開いたワークスペース。書く前に確かめる
    expect(SERVER_INSTRUCTIONS).toMatch(/最後に開いたワークスペース[\s\S]*designer__get_project_context[\s\S]*designer__workspace_status/);
    const p = getPrompt("generate-code", undefined, REPO).messages[0].content.text;
    expect(p).toContain("harmony://skill/generate-code/<スキルのフォルダからの相対パス>");
    expect(p).toContain("harmony://skill/generate-code/files");
  });
});
