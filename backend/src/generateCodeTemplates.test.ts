/**
 * generate-code の開発コンテナの雛形 (4 組合せ) の形の検査 (#1573)。
 * Playwright MCP (ブラウザの自動操作) が、4 組合せすべてに同じ形で入っていることを確かめる。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATES = path.join(REPO, "ai-skills/generate-code/templates/devcontainer");
const COMBOS = ["nestjs-nextjs", "nestjs-thymeleaf", "spring-boot-nextjs", "spring-boot-thymeleaf"] as const;
const OUTPUT_DIR = "/workspaces/app/.tmp/playwright-mcp";
const COMMON_ARGS = ["-y", "@playwright/mcp@latest"];
const TAIL_ARGS = ["--isolated", "--browser", "chromium", "--output-dir", OUTPUT_DIR];
const INSTALL_WITH_DEPS = "npx -y -p @playwright/mcp@latest playwright install --with-deps chromium";

interface McpServer {
  type: string;
  command?: string;
  args?: string[];
  url?: string;
}

const read = (combo: string, rel: string) => fs.readFileSync(path.join(TEMPLATES, combo, rel), "utf8");
const mcpServers = (combo: string) => (JSON.parse(read(combo, ".mcp.json")) as { mcpServers: Record<string, McpServer> }).mcpServers;
/** devcontainer.json は素の JSON で書く方針だが、コメントがあっても読めるように行コメントを除いてから読む。 */
const devcontainer = (combo: string) =>
  JSON.parse(read(combo, ".devcontainer/devcontainer.json").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")) as {
    postCreateCommand: string;
    postStartCommand: string;
  };

describe.each(COMBOS)("雛形 %s の Playwright MCP (#1573)", (combo) => {
  it(".mcp.json は harmony・playwright・playwright-headed の 3 項目を持つ", () => {
    const servers = mcpServers(combo);
    expect(Object.keys(servers).sort()).toEqual(["harmony", "playwright", "playwright-headed"]);
    expect(servers.harmony).toEqual({ type: "http", url: "http://localhost:5179/mcp" });
  });

  it("playwright は headless・隔離・chromium で、出力先を .tmp/playwright-mcp にする (args は配列ごと完全一致)", () => {
    const p = mcpServers(combo).playwright;
    expect(p.type).toBe("stdio");
    expect(p.command).toBe("npx");
    expect(p.args).toEqual([...COMMON_ARGS, "--headless", ...TAIL_ARGS]);
  });

  it("playwright-headed は --headless だけ持たず、それ以外は playwright と同じ (args は配列ごと完全一致)", () => {
    const h = mcpServers(combo)["playwright-headed"];
    expect(h.type).toBe("stdio");
    expect(h.command).toBe("npx");
    expect(h.args).toEqual([...COMMON_ARGS, ...TAIL_ARGS]);
  });

  it("postCreateCommand の末尾で依存ライブラリつきの chromium を入れ (失敗しても止めない)、postStartCommand で入れ直す", () => {
    const d = devcontainer(combo);
    // 末尾の (…|| echo '…') で包む。入れられなくても postCreate 全体は失敗しない
    expect(d.postCreateCommand).toContain(`&& (${INSTALL_WITH_DEPS} || echo '`);
    expect(d.postCreateCommand.endsWith("')")).toBe(true);
    expect(d.postCreateCommand.slice(d.postCreateCommand.lastIndexOf("|| echo '") + 9, -2)).not.toContain("'");
    // 既存の並び (Codex CLI の導入 → Claude の設定ファイル) は変えない
    expect(d.postCreateCommand.indexOf("npm install -g @openai/codex")).toBeGreaterThan(-1);
    expect(d.postCreateCommand.indexOf("npm install -g @openai/codex")).toBeLessThan(d.postCreateCommand.indexOf("playwright install"));
    expect(d.postStartCommand.startsWith("npx -y -p @playwright/mcp@latest playwright install chromium || echo ")).toBe(true);
    expect(d.postStartCommand).not.toContain("--with-deps");
  });

  it("compose.yml の dev に WSLg の X11 の volumes 2 行と DISPLAY を渡す", () => {
    const compose = read(combo, ".devcontainer/compose.yml");
    const dev = compose.slice(compose.indexOf("  dev:"), compose.indexOf("  harmony:"));
    expect(dev).toMatch(/^\s+- \/tmp\/\.X11-unix:\/tmp\/\.X11-unix$/m);
    expect(dev).toMatch(/^\s+- \/mnt\/wslg:\/mnt\/wslg$/m);
    expect(dev).toMatch(/^\s+environment:\n\s+DISPLAY: ":0"$/m);
    // harmony 側には渡さない
    expect(compose.slice(compose.indexOf("  harmony:"))).not.toContain("wslg");
  });

  it(".tmp/.gitignore は中身を全部無視し、自分自身だけ残す", () => {
    expect(read(combo, ".tmp/.gitignore").split("\n").filter((l) => l !== "")).toEqual(["*", "!.gitignore"]);
  });

  it("README.snippet.md に Playwright MCP の節がある", () => {
    const readme = read(combo, "README.snippet.md");
    expect(readme).toContain("## ブラウザの自動操作 (Playwright MCP)");
    expect(readme).toContain("playwright-headed");
    expect(readme).toContain("mountWaylandSocket=false");
    expect(readme).toContain("npx -y -p @playwright/mcp@latest playwright install chromium");
    expect(readme).toContain(".tmp/playwright-mcp/");
    expect(readme).toContain("designer__workspace_close");
    expect(readme).not.toContain("5-10 分");
  });
});

describe("4 組合せの Playwright MCP の設定が同じ", () => {
  it(".mcp.json は 4 組合せで完全に同一", () => {
    const first = read(COMBOS[0], ".mcp.json");
    for (const c of COMBOS.slice(1)) expect(read(c, ".mcp.json")).toBe(first);
  });

  it("Playwright の導入コマンドは 4 組合せで同一", () => {
    const base = devcontainer(COMBOS[0]);
    const tail = (cmd: string) => cmd.slice(cmd.indexOf("&& (npx -y -p @playwright"));
    expect(tail(base.postCreateCommand)).toContain(INSTALL_WITH_DEPS);
    for (const c of COMBOS.slice(1)) {
      const d = devcontainer(c);
      expect(d.postStartCommand).toBe(base.postStartCommand);
      expect(tail(d.postCreateCommand)).toBe(tail(base.postCreateCommand));
    }
  });

  it(".tmp/.gitignore の例外が効く (ルートの .gitignore に無視されない)", () => {
    // REPO が git 管理下であることを前提にする
    for (const c of COMBOS) {
      const rel = path.posix.join("ai-skills/generate-code/templates/devcontainer", c, ".tmp/.gitignore");
      const r = spawnSync("git", ["check-ignore", "-q", rel], { cwd: REPO });
      expect(r.error).toBeUndefined();
      // 0 = 無視される、1 = 無視されない
      expect(r.status, `${rel} が無視されている`).toBe(1);
    }
  });
});
