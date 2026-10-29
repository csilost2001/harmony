/**
 * MCP の Resources と Prompts: AI が「読むもの」と「使う手順」を、tool とは別に、自分から探して読めるようにする。
 *
 * - Resources: 資料の索引 (harmony://docs/ai-index)・仕様書 (harmony://spec/<名前>)・JSON Schema (harmony://schema/<種類>)・設計全体の要約 (harmony://project/context)
 * - Prompts: 設計の作成・点検用のスキル (ai-skills/<名前>/SKILL.md)。Claude Code 以外の AI も、同じ手順を使える
 * - スキルの付属ファイル (harmony://skill/<名前>/files と harmony://skill/<名前>/<パス>): SKILL.md が参照する templates/** や golden-examples/** を、外から読む口
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
  "手順 (Prompts) の本文にある ai-skills/<名前>/<パス> の付属ファイル (templates・golden-examples など) は、Resource harmony://skill/<名前>/<パス> で読めます。一覧は harmony://skill/<名前>/files です。",
].join("\n");

/** 資料を同梱するディレクトリ (リポジトリの根)。HARMONY_DOCS_DIR で変えられる。docs/AI-INDEX.md と schemas/v3 がある場所 */
export function findDocsRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = [];
  if (env.HARMONY_DOCS_DIR?.trim()) candidates.push(path.resolve(env.HARMONY_DOCS_DIR.trim()));
  const here = path.dirname(fileURLToPath(import.meta.url)); // backend/src または backend/dist
  candidates.push(path.resolve(here, "../.."), path.resolve(process.cwd(), ".."), process.cwd());
  const found = candidates.find((d) => fs.existsSync(path.join(d, "schemas/v3")) && fs.existsSync(path.join(d, "docs/spec"))) ?? null;
  if (env.HARMONY_DOCS_DIR?.trim() && found !== path.resolve(env.HARMONY_DOCS_DIR.trim())) console.error(`[MCP] HARMONY_DOCS_DIR=${env.HARMONY_DOCS_DIR} に schemas/v3 と docs/spec がありません。${found ?? "資料なし"} を使います`);
  return found;
}

/** harmony://docs/<名前> で読める資料 (リポジトリの根からの相対パス)。許可リスト */
const DOC_FILES: Record<string, { file: string; name: string; description: string; mimeType: string }> = {
  "ai-index": { file: "docs/AI-INDEX.md", name: "AI 向けの資料の入口", description: "やりたいこと → 読む資料・使う tool の対応。最初に読む", mimeType: "text/markdown" },
  glossary: { file: "docs/glossary.json", name: "用語集", description: "日本語の用語 ↔ スキーマの定義 ↔ MCP tool ↔ 仕様書 (JSON。工程の種類も含む)", mimeType: "application/json" },
  codemap: { file: "docs/codemap.md", name: "コードの地図", description: "用語・機能 → ファイルの対応 (実装を読む・直すとき)", mimeType: "text/markdown" },
  recipes: { file: "docs/spec/ai-recipes.md", name: "作業別のレシピ", description: "やりたい作業ごとの tool の呼び順と、よくある疑問の逆引き", mimeType: "text/markdown" },
  patterns: { file: "examples/PATTERNS.md", name: "サンプルが示す工程のパターン", description: "工程の種類・書き方ごとに、近い例のサンプルの場所", mimeType: "text/markdown" },
  decisions: { file: "docs/decisions/README.md", name: "設計判断の記録", description: "決めたこととその理由 (ADR) の一覧", mimeType: "text/markdown" },
};

const SCHEMA_SUFFIX = ".v3.schema.json";
const names = (dir: string, suffix: string): string[] => {
  try { return fs.readdirSync(dir).filter((n) => n.endsWith(suffix)).map((n) => n.slice(0, -suffix.length)).sort(); } catch { return []; }
};
/** 通常のファイルだけ読む (シンボリックリンクで、資料の外のファイルを読ませない) */
const read = (p: string): string | null => {
  try { return fs.lstatSync(p).isFile() ? fs.readFileSync(p, "utf8") : null; } catch { return null; }
};

/** 章 (見出し ##) ごとに分ける。0 番は最初の ## より前 (表題・前書き)。コードブロックの中の # は見出しにしない */
export function splitSections(md: string): Array<{ n: number; title: string; text: string }> {
  const body = md.replace(/^\uFEFF/, "").replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  const out: Array<{ n: number; title: string; lines: string[] }> = [{ n: 0, title: "(前書き)", lines: [] }];
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && /^## (.+)$/.exec(line);
    if (h) out.push({ n: out.length, title: h[1].trim(), lines: [line] });
    else out[out.length - 1].lines.push(line);
  }
  return out.map((x) => ({ n: x.n, title: x.title, text: x.lines.join("\n").trim() })).filter((x) => x.n > 0 || x.text);
}

/** スキーマの定義 1 つと、それが (直接・間接に) 参照する定義。大きなスキーマ (処理フローは 92KB) を、必要な部分だけ読むため。外部の参照は `<ファイル>#<定義>` のキーで */
export function schemaDefClosure(schemaDir: string, kind: string, defName: string): { definition: unknown; dependencies: Record<string, unknown> } | null {
  const load = (k: string): { $defs?: Record<string, unknown> } | null => {
    const t = read(path.join(schemaDir, `${k}${SCHEMA_SUFFIX}`));
    if (t === null) return null;
    try { return JSON.parse(t) as { $defs?: Record<string, unknown> }; } catch { return null; }
  };
  const main = load(kind);
  if (!main?.$defs || !Object.hasOwn(main.$defs, defName)) return null;
  const allowedKinds = new Set(names(schemaDir, SCHEMA_SUFFIX));
  const deps: Record<string, unknown> = {};
  const seen = new Set<string>([`${kind}#${defName}`]);
  const queue: Array<{ kind: string; def: string; node: unknown }> = [{ kind, def: defName, node: main.$defs[defName] }];
  const MAX_DEPS = 200;
  while (queue.length && Object.keys(deps).length < MAX_DEPS) {
    const cur = queue.shift()!;
    const refs: string[] = [];
    (function walk(n: unknown): void {
      if (Array.isArray(n)) { for (const x of n) walk(x); return; }
      if (!n || typeof n !== "object") return;
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) { if (k === "$ref" && typeof v === "string") refs.push(v); else walk(v); }
    })(cur.node);
    for (const ref of refs) {
      const m = /^(?:([A-Za-z0-9._-]+?)(?:\.v3\.schema\.json))?#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
      if (!m) continue;
      const k = m[1] ?? cur.kind;
      if (!allowedKinds.has(k)) continue;
      const key = `${k}#${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sch = k === kind ? main : load(k);
      const node = sch?.$defs && Object.hasOwn(sch.$defs, m[2]) ? sch.$defs[m[2]] : undefined;
      if (node === undefined) continue;
      // 種類の多い oneOf (工程 26 種類など) の中身までは辿らない (入れ子で、スキーマ全体になってしまう)。名前だけ示し、個別に読ませる
      const oneOf = (node as { oneOf?: unknown[] }).oneOf;
      if (Array.isArray(oneOf) && oneOf.length > 8) {
        deps[k === kind ? m[2] : key] = { $comment: `${oneOf.length} 種類の oneOf。中身は辿りません。個別の定義は harmony://schema/${k}/<定義名>`, oneOf };
        continue;
      }
      deps[k === kind ? m[2] : key] = node;
      queue.push({ kind: k, def: m[2], node });
    }
  }
  return { definition: main.$defs[defName], dependencies: deps };
}

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
  for (const [key, d] of Object.entries(DOC_FILES)) if (fs.existsSync(path.join(rootDir, d.file))) out.push({ uri: `harmony://docs/${key}`, name: d.name, description: d.description, mimeType: d.mimeType });
  if (fs.existsSync(path.join(rootDir, "docs/spec/index.json"))) out.push({ uri: "harmony://spec/index", name: "仕様書の索引", description: "docs/spec の全仕様書の要約・状態・種別 (JSON)", mimeType: "application/json" });
  if (fs.existsSync(path.join(rootDir, "docs/spec/schema-index.json"))) out.push({ uri: "harmony://spec/schema-index", name: "スキーマの索引", description: "schemas/v3 の $defs の名前・要約・必須の項目 (JSON)", mimeType: "application/json" });
  for (const n of names(path.join(rootDir, "docs/decisions"), ".md")) if (n !== "README") out.push({ uri: `harmony://decisions/${n}`, name: `設計判断: ${n}`, mimeType: "text/markdown" });
  out.push({ uri: "harmony://schema/index", name: "JSON Schema の一覧", description: "schemas/v3 の種類と、読む URI", mimeType: "application/json" });
  const byFile = new Map(specIndex(rootDir).map((e) => [e.file, e]));
  for (const n of names(path.join(rootDir, "docs/spec"), ".md")) {
    const e = byFile.get(`docs/spec/${n}.md`);
    const big = (() => { try { return fs.statSync(path.join(rootDir, "docs/spec", `${n}.md`)).size; } catch { return 0; } })();
    const sectionNote = big > 20000 ? ` (${Math.round(big / 1000)}KB。harmony://spec/${n}/sections で章の一覧、harmony://spec/${n}/<番号> で章ごとに読める)` : "";
    out.push({ uri: `harmony://spec/${n}`, name: e?.title || n, ...(e ? { description: `[${e.status}] ${e.description}${sectionNote}` } : {}), mimeType: "text/markdown" });
  }
  for (const n of names(path.join(rootDir, "schemas/v3"), SCHEMA_SUFFIX)) out.push({ uri: `harmony://schema/${n}`, name: `${n} の JSON Schema`, mimeType: "application/json" });
  for (const n of PROMPT_SKILLS) if (fs.existsSync(path.join(rootDir, "ai-skills", n, "SKILL.md"))) out.push({ uri: `harmony://skill/${n}/files`, name: `スキル ${n} の付属ファイル一覧`, description: `ai-skills/${n}/ の templates・golden-examples など。1 ファイルは harmony://skill/${n}/<path> で読む`, mimeType: "application/json" });
  return out;
}

export function listResourceTemplates(): Array<{ uriTemplate: string; name: string; description: string; mimeType: string }> {
  return [
    { uriTemplate: "harmony://spec/{name}", name: "仕様書", description: "docs/spec/<name>.md。name は harmony://spec/index の file から .md を除いたもの", mimeType: "text/markdown" },
    { uriTemplate: "harmony://spec/{name}/sections", name: "仕様書の章の一覧", description: "仕様書の章 (## の見出し) の番号・題・大きさ。大きな仕様書は、この一覧で選んで 1 章ずつ読む", mimeType: "application/json" },
    { uriTemplate: "harmony://spec/{name}/{n}", name: "仕様書の 1 章", description: "n は章の番号 (0 = 前書き、1 以降 = ## の見出し順)", mimeType: "text/markdown" },
    { uriTemplate: "harmony://skill/{name}/files", name: "スキルの付属ファイルの一覧", description: "手順 (Prompts) のスキルのフォルダにあるファイルの一覧 (path・大きさ・uri)。name は Prompts の名前 (generate-code など)", mimeType: "application/json" },
    { uriTemplate: "harmony://skill/{name}/{+path}", name: "スキルの付属ファイル 1 つ", description: "SKILL.md が参照する ai-skills/<name>/<path> (templates・golden-examples など)。path は harmony://skill/{name}/files の一覧にあるもの。読み取り専用", mimeType: "text/plain" },
    { uriTemplate: "harmony://schema/{kind}", name: "JSON Schema", description: "schemas/v3/<kind>.v3.schema.json。kind は harmony://schema/index にある", mimeType: "application/json" },
    { uriTemplate: "harmony://schema/{kind}/{def}", name: "JSON Schema の定義 1 つ", description: "$defs の定義 1 つと、それが参照する定義だけ (処理フローのスキーマは 92KB あるので、工程の種類 1 つだけ読むときなど)。def は docs/spec/schema-index.json の defs の名前", mimeType: "application/json" },
  ];
}

export interface ResourceContents { [x: string]: unknown; contents: Array<{ uri: string; mimeType: string; text: string }> }

/** URI の中身を返す。root は、いま開いているワークスペース (project/context だけが使う。未選択なら null) */
export async function readResource(uri: string, root: string | null, rootDir: string | null = findDocsRoot()): Promise<ResourceContents> {
  const ok = (mimeType: string, text: string): ResourceContents => ({ contents: [{ uri, mimeType, text }] });
  // スキルの付属ファイルは、パスが複数の階層になるので、下の 3 階層までの形より先に判定する
  const sk = uri.match(/^harmony:\/\/skill\/([^/]+)\/(.+)$/s);
  if (sk) return readSkillResource(uri, sk[1], sk[2], rootDir);
  const m = uri.match(/^harmony:\/\/([a-z-]+)\/([A-Za-z0-9._-]+)(?:\/([A-Za-z0-9._-]+))?$/);
  if (!m) throw new McpError(ErrorCode.InvalidParams, `未知の資料です: ${uri} (harmony://docs/… spec/… schema/… decisions/… skill/<名前>/files・skill/<名前>/<パス> project/context)`);
  const [, area, name, sub] = m;
  if (sub !== undefined && area !== "spec" && area !== "schema") throw new McpError(ErrorCode.InvalidParams, `見つかりません: ${uri}`);

  if (area === "project" && name === "context") {
    if (!root) throw new McpError(ErrorCode.InvalidParams, "ワークスペースが選ばれていません (designer__workspace_open で開いてください)");
    return ok("application/json", JSON.stringify(await buildProjectContext(root), null, 2));
  }
  if (!rootDir) throw new McpError(ErrorCode.InvalidParams, "この環境には資料が同梱されていません");

  if (area === "docs" && Object.hasOwn(DOC_FILES, name)) {
    const d = DOC_FILES[name];
    const t = read(path.join(rootDir, d.file));
    if (t !== null) return ok(d.mimeType, t);
  } else if (area === "decisions" && name !== "README" && names(path.join(rootDir, "docs/decisions"), ".md").includes(name)) {
    const t = read(path.join(rootDir, "docs/decisions", `${name}.md`));
    if (t !== null) return ok("text/markdown", t);
  } else if (area === "spec") {
    if (name === "index" || name === "schema-index") {
      if (sub !== undefined) throw new McpError(ErrorCode.InvalidParams, `見つかりません: ${uri}`);
      const t = read(path.join(rootDir, "docs/spec", `${name}.json`));
      if (t !== null) return ok("application/json", t);
    } else if (names(path.join(rootDir, "docs/spec"), ".md").includes(name)) { // 許可リストにある名前だけ
      const t = read(path.join(rootDir, "docs/spec", `${name}.md`));
      if (t !== null) {
        if (sub === undefined) return ok("text/markdown", t);
        const sections = splitSections(t);
        if (sub === "sections") return ok("application/json", JSON.stringify({ spec: name, sections: sections.map((x) => ({ n: x.n, title: x.title, chars: x.text.length })), note: "harmony://spec/<名前>/<n> で 1 章ずつ読む (0 = 前書き)" }, null, 2));
        if (/^\d+$/.test(sub)) {
          const sec = sections.find((x) => x.n === Number(sub));
          if (sec) return ok("text/markdown", sec.text);
          const nums = sections.map((x) => x.n);
          throw new McpError(ErrorCode.InvalidParams, `章 ${sub} がありません (${nums.length ? `${nums[0]}〜${nums[nums.length - 1]}` : "章がありません"}。一覧は harmony://spec/${name}/sections)`);
        }
      }
    }
  } else if (area === "schema") {
    const kinds = names(path.join(rootDir, "schemas/v3"), SCHEMA_SUFFIX);
    if (name === "index") {
      if (sub !== undefined) throw new McpError(ErrorCode.InvalidParams, `見つかりません: ${uri}`);
      return ok("application/json", JSON.stringify({ schemas: kinds.map((k) => ({ kind: k, uri: `harmony://schema/${k}`, file: `schemas/v3/${k}${SCHEMA_SUFFIX}` })) }, null, 2));
    }
    if (kinds.includes(name)) {
      // harmony://schema/<種類>/<定義名>: その定義と、参照している定義だけ (大きなスキーマの部分読み)
      if (sub !== undefined) {
        const r = schemaDefClosure(path.join(rootDir, "schemas/v3"), name, sub);
        if (r) return ok("application/json", JSON.stringify({ kind: name, def: sub, definition: r.definition, dependencies: r.dependencies, note: "dependencies は、この定義が (直接・間接に) 参照する定義。同じファイルの定義は名前、ほかのファイルは <種類>#<定義名>。全体は harmony://schema/" + name }, null, 2));
        throw new McpError(ErrorCode.InvalidParams, `定義「${sub}」が ${name} のスキーマにありません (一覧は docs/spec/schema-index.json)`);
      }
      const t = read(path.join(rootDir, "schemas/v3", `${name}${SCHEMA_SUFFIX}`));
      if (t !== null) return ok("application/json", t);
    }
  }
  throw new McpError(ErrorCode.InvalidParams, `見つかりません: ${uri}`);
}

// ─── スキルの付属ファイル (harmony://skill/…) ─────────────

/** 付属ファイルの上限。ai-skills の中だけを読む読み取り専用の口なので、暴走しないための値 */
const SKILL_MAX_FILES = 2000;
const SKILL_MAX_DEPTH = 12;
const SKILL_MAX_BYTES = 1024 * 1024;

interface SkillFileEntry { path: string; size: number }

/** スキルのフォルダの通常のファイルを列挙する。lstat 相当 (Dirent) で見て、シンボリックリンクは (ファイルもフォルダも) 辿らない・載せない */
function listSkillFiles(rootDir: string, name: string): { files: SkillFileEntry[]; skipped: number } | null {
  const base = path.join(rootDir, "ai-skills", name);
  try { if (!fs.lstatSync(base).isDirectory()) return null; } catch { return null; }
  const files: SkillFileEntry[] = [];
  let skipped = 0;
  const walk = (dir: string, rel: string, depth: number): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (depth + 1 > SKILL_MAX_DEPTH) { skipped++; continue; }
        walk(path.join(dir, e.name), childRel, depth + 1);
      } else if (e.isFile()) {
        if (files.length >= SKILL_MAX_FILES) { skipped++; continue; }
        let size: number;
        try { size = fs.lstatSync(path.join(dir, e.name)).size; } catch { continue; }
        if (size > SKILL_MAX_BYTES) { skipped++; continue; }
        files.push({ path: childRel, size });
      }
    }
  };
  walk(base, "", 0);
  return { files, skipped };
}

function skillMimeType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return ext === ".md" ? "text/markdown" : ext === ".json" ? "application/json" : "text/plain";
}

/** harmony://skill/<名前>/files と harmony://skill/<名前>/<パス> を読む。読めるのは PROMPT_SKILLS のスキルの、列挙した一覧にあるパスと完全一致したものだけ */
function readSkillResource(uri: string, name: string, rest: string, rootDir: string | null): ResourceContents {
  if (!(PROMPT_SKILLS as readonly string[]).includes(name)) throw new McpError(ErrorCode.InvalidParams, `未知のスキルです: ${name} (読めるのは ${PROMPT_SKILLS.join(" / ")})`);
  if (!rootDir) throw new McpError(ErrorCode.InvalidParams, "この環境には資料が同梱されていません");
  const listing = listSkillFiles(rootDir, name);
  if (!listing) throw new McpError(ErrorCode.InvalidParams, `スキル「${name}」のフォルダが見つかりません`);
  if (rest === "files") {
    const note = `harmony://skill/${name}/<path> で 1 ファイルを読む (path はこの一覧の path)。読み取り専用。シンボリックリンク・${Math.round(SKILL_MAX_BYTES / 1024 / 1024)}MiB を超えるファイル・深さ ${SKILL_MAX_DEPTH} を超える階層は載せない${listing.skipped ? `。載せなかったもの ${listing.skipped} 件` : ""}`;
    const body = { skill: name, files: listing.files.map((f) => ({ path: f.path, size: f.size, uri: `harmony://skill/${name}/${f.path}` })), note };
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(body, null, 2) }] };
  }
  let decoded = rest;
  try { decoded = decodeURIComponent(rest); } catch { /* そのまま比べる */ }
  const hit = listing.files.find((f) => f.path === rest) ?? listing.files.find((f) => f.path === decoded);
  if (!hit) throw new McpError(ErrorCode.InvalidParams, `見つかりません: ${uri} (一覧は harmony://skill/${name}/files)`);
  // URI の文字列ではなく、一覧にあったパスから組み直して読む
  const full = path.join(rootDir, "ai-skills", name, ...hit.path.split("/"));
  let buf: Buffer;
  try {
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.size > SKILL_MAX_BYTES) throw new Error("not readable");
    buf = fs.readFileSync(full);
  } catch { throw new McpError(ErrorCode.InvalidParams, `読めません: ${uri}`); }
  if (buf.includes(0)) throw new McpError(ErrorCode.InvalidParams, `テキストではないファイルは読めません: ${uri}`);
  return { contents: [{ uri, mimeType: skillMimeType(hit.path), text: buf.toString("utf8") }] };
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
  const header = `これは Harmony のスキル「${name}」の手順です。次の手順に従って進めてください。\n本文にある ai-skills/${name}/<パス> の付属ファイル (templates・golden-examples など) は、Resource harmony://skill/${name}/<パス> で読めます。一覧は harmony://skill/${name}/files です。${given ? `\n引数: ${given}` : s.argumentHint ? `\n(引数の形: ${s.argumentHint})` : ""}\n\n`;
  return { description: s.description, messages: [{ role: "user", content: { type: "text", text: header + body } }] };
}
