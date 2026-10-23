/**
 * MCP の Resources と Prompts: AI が「読むもの」と「使う手順」を、tool とは別に、自分から探して読めるようにする。
 *
 * - Resources: 資料の索引 (harmony://docs/ai-index)・仕様書 (harmony://spec/<名前>)・JSON Schema (harmony://schema/<種類>)・設計全体の要約 (harmony://project/context)
 * - Prompts: 設計の作成・点検用のスキル (ai-skills/<名前>/SKILL.md)。Claude Code 以外の AI も、同じ手順を使える
 *
 * 読み取り専用。読めるのは、許可リスト (ディレクトリの中身から作る) にある名前だけ。URI の中の名前を、パスに直接使わない。
 * 資料が見つからない配置 (資料を同梱しない image など) では、空の一覧を返し、project/context だけが動く。
 * 仕様: docs/spec/server-security.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { buildProjectContext } from "./projectContext.js";

/** 接続したときに、AI へ最初に渡す案内 (initialize の instructions) */
export const SERVER_INSTRUCTIONS = [
  "Harmony は、日本の Web システム開発の設計書 (画面・処理フロー・テーブル・規約) を扱う設計ツールです。設計の原本は JSON で、JSON Schema (schemas/v3) が正本です。",
  "最初に designer__get_project_context を 1 回呼ぶと、設計の全体 (件数・名前・規約・未解決のマーカー) をつかめます。",
  "資料は Resources にあります: harmony://docs/ai-index (やりたいこと → 読む資料・使う tool)、harmony://spec/index (仕様書の索引)、harmony://schema/<種類> (JSON Schema)。",
  "設計を作る・直したあとは designer__check_design を呼び、error / warning を 0 件にしてから報告してください。schema の変更は設計者の判断です (AI は変えない)。",
  "処理フローの作成・レビューなどの手順は Prompts (create-flow / review-flow ほか) にあります。",
].join("\n");

/** 資料を同梱するディレクトリ (リポジトリの根)。HARMONY_DOCS_DIR で変えられる。docs/AI-INDEX.md と schemas/v3 がある場所 */
export function findDocsRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = [];
  if (env.HARMONY_DOCS_DIR?.trim()) candidates.push(path.resolve(env.HARMONY_DOCS_DIR.trim()));
  const here = path.dirname(fileURLToPath(import.meta.url)); // backend/src または backend/dist
  candidates.push(path.resolve(here, "../.."), path.resolve(process.cwd(), ".."), process.cwd());
  return candidates.find((d) => fs.existsSync(path.join(d, "schemas/v3")) && fs.existsSync(path.join(d, "docs/spec"))) ?? null;
}

const SCHEMA_SUFFIX = ".v3.schema.json";
const names = (dir: string, suffix: string): string[] => {
  try { return fs.readdirSync(dir).filter((n) => n.endsWith(suffix)).map((n) => n.slice(0, -suffix.length)).sort(); } catch { return []; }
};
const read = (p: string): string | null => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

interface SpecEntry { file: string; title: string; description: string; status: string; category: string }
function specIndex(rootDir: string): SpecEntry[] {
  const text = read(path.join(rootDir, "docs/spec/index.json"));
  if (!text) return [];
  try { return (JSON.parse(text) as { specs?: SpecEntry[] }).specs ?? []; } catch { return []; }
}

export interface ResourceInfo { uri: string; name: string; description?: string; mimeType: string }

export function listResources(rootDir: string | null = findDocsRoot()): ResourceInfo[] {
  const out: ResourceInfo[] = [
    { uri: "harmony://project/context", name: "設計全体の要約", description: "いま開いているワークスペースの設計の件数・名前・規約・未解決のマーカー (designer__get_project_context と同じ)", mimeType: "application/json" },
  ];
  if (!rootDir) return out;
  if (fs.existsSync(path.join(rootDir, "docs/AI-INDEX.md"))) out.push({ uri: "harmony://docs/ai-index", name: "AI 向けの資料の入口", description: "やりたいこと → 読む資料・使う tool の対応。最初に読む", mimeType: "text/markdown" });
  if (fs.existsSync(path.join(rootDir, "docs/spec/index.json"))) out.push({ uri: "harmony://spec/index", name: "仕様書の索引", description: "docs/spec の全仕様書の要約・状態・種別 (JSON)", mimeType: "application/json" });
  out.push({ uri: "harmony://schema/index", name: "JSON Schema の一覧", description: "schemas/v3 の種類と、読む URI", mimeType: "application/json" });
  const byFile = new Map(specIndex(rootDir).map((e) => [e.file, e]));
  for (const n of names(path.join(rootDir, "docs/spec"), ".md")) {
    const e = byFile.get(`docs/spec/${n}.md`);
    out.push({ uri: `harmony://spec/${n}`, name: e?.title || n, ...(e ? { description: `[${e.status}] ${e.description}` } : {}), mimeType: "text/markdown" });
  }
  for (const n of names(path.join(rootDir, "schemas/v3"), SCHEMA_SUFFIX)) out.push({ uri: `harmony://schema/${n}`, name: `${n} の JSON Schema`, mimeType: "application/json" });
  return out;
}

export function listResourceTemplates(): Array<{ uriTemplate: string; name: string; description: string; mimeType: string }> {
  return [
    { uriTemplate: "harmony://spec/{name}", name: "仕様書", description: "docs/spec/<name>.md。name は harmony://spec/index の file から .md を除いたもの", mimeType: "text/markdown" },
    { uriTemplate: "harmony://schema/{kind}", name: "JSON Schema", description: "schemas/v3/<kind>.v3.schema.json。kind は harmony://schema/index にある", mimeType: "application/json" },
  ];
}

export interface ResourceContents { [x: string]: unknown; contents: Array<{ uri: string; mimeType: string; text: string }> }

/** URI の中身を返す。root は、いま開いているワークスペース (project/context だけが使う。未選択なら null) */
export async function readResource(uri: string, root: string | null, rootDir: string | null = findDocsRoot()): Promise<ResourceContents> {
  const ok = (mimeType: string, text: string): ResourceContents => ({ contents: [{ uri, mimeType, text }] });
  const m = uri.match(/^harmony:\/\/([a-z-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) throw new McpError(ErrorCode.InvalidParams, `未知の資料です: ${uri} (harmony://docs/… spec/… schema/… project/context)`);
  const [, area, name] = m;

  if (area === "project" && name === "context") {
    if (!root) throw new McpError(ErrorCode.InvalidParams, "ワークスペースが選ばれていません (designer__workspace_open で開いてください)");
    return ok("application/json", JSON.stringify(await buildProjectContext(root), null, 2));
  }
  if (!rootDir) throw new McpError(ErrorCode.InvalidParams, "この環境には資料が同梱されていません");

  if (area === "docs" && name === "ai-index") {
    const t = read(path.join(rootDir, "docs/AI-INDEX.md"));
    if (t !== null) return ok("text/markdown", t);
  } else if (area === "spec") {
    if (name === "index") {
      const t = read(path.join(rootDir, "docs/spec/index.json"));
      if (t !== null) return ok("application/json", t);
    } else if (names(path.join(rootDir, "docs/spec"), ".md").includes(name)) { // 許可リストにある名前だけ
      const t = read(path.join(rootDir, "docs/spec", `${name}.md`));
      if (t !== null) return ok("text/markdown", t);
    }
  } else if (area === "schema") {
    const kinds = names(path.join(rootDir, "schemas/v3"), SCHEMA_SUFFIX);
    if (name === "index") {
      return ok("application/json", JSON.stringify({ schemas: kinds.map((k) => ({ kind: k, uri: `harmony://schema/${k}`, file: `schemas/v3/${k}${SCHEMA_SUFFIX}` })) }, null, 2));
    }
    if (kinds.includes(name)) {
      const t = read(path.join(rootDir, "schemas/v3", `${name}${SCHEMA_SUFFIX}`));
      if (t !== null) return ok("application/json", t);
    }
  }
  throw new McpError(ErrorCode.InvalidParams, `見つかりません: ${uri}`);
}

// ─── Prompts ────────────────────────────────────────────

/** Prompts として出すスキル。設計を作る・点検する・コードやテストを作るもの (リポジトリの開発用 = issues・review-pr・publish-* などは出さない) */
export const PROMPT_SKILLS = ["create-flow", "review-flow", "generate-code", "generate-tests", "import-md", "rename-screen-ids", "test-strategy"] as const;

interface Skill { name: string; description: string; argumentHint: string; body: string }

function parseSkill(text: string): { fields: Record<string, string>; body: string } {
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fields: Record<string, string> = {};
  if (!m) return { fields, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return { fields, body: text.slice(m[0].length) };
}

function loadSkill(rootDir: string, name: string): Skill | null {
  const text = read(path.join(rootDir, "ai-skills", name, "SKILL.md"));
  if (text === null) return null;
  const { fields, body } = parseSkill(text);
  return { name, description: fields.description ?? name, argumentHint: fields["argument-hint"] ?? "", body };
}

export interface PromptInfo { name: string; description: string; arguments: Array<{ name: string; description: string; required: boolean }> }

export function listPrompts(rootDir: string | null = findDocsRoot()): PromptInfo[] {
  if (!rootDir) return [];
  const out: PromptInfo[] = [];
  for (const n of PROMPT_SKILLS) {
    const s = loadSkill(rootDir, n);
    if (!s) continue;
    out.push({
      name: s.name,
      description: s.description.length > 300 ? `${s.description.slice(0, 298)}…` : s.description,
      arguments: [{ name: "arguments", description: s.argumentHint || "(引数なし)", required: false }],
    });
  }
  return out;
}

export function getPrompt(name: string, args: Record<string, string> | undefined, rootDir: string | null = findDocsRoot()): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  if (!(PROMPT_SKILLS as readonly string[]).includes(name) || !rootDir) throw new McpError(ErrorCode.InvalidParams, `未知のプロンプトです: ${name}`);
  const s = loadSkill(rootDir, name);
  if (!s) throw new McpError(ErrorCode.InvalidParams, `未知のプロンプトです: ${name}`);
  const given = (args?.arguments ?? "").trim();
  // スキルの本文の `$ARGUMENTS` を、渡された引数に置き換える (replace の特殊パターン $& を避けるため関数で渡す)
  const body = s.body.replace(/\$ARGUMENTS/g, () => given);
  const header = `これは Harmony のスキル「${name}」の手順です。次の手順に従って進めてください。${given ? `\n引数: ${given}` : s.argumentHint ? `\n(引数の形: ${s.argumentHint})` : ""}\n\n`;
  return { description: s.description, messages: [{ role: "user", content: { type: "text", text: header + body } }] };
}
