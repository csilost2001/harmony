#!/usr/bin/env tsx
/**
 * scripts/migrate/processflow-hierarchical-refs.ts
 *
 * #1269 提案 A: examples の階層参照 migration script。
 *
 * 旧 flat 形式 (例: `@screen.shippingPostalCode`) を、
 * 新 階層形式 (例: `@screen.<screenId>.item.shippingPostalCode`) に rewrite する。
 * docs/spec/process-flow-prefix-system.md §3 に整合。
 *
 * 対象:
 *   - examples/<project-id>/harmony/screens/*.json
 *     (events.argumentMapping 等の `@screen.<itemId>` を local screen の hierarchical form に変換)
 *   - examples/<project-id>/harmony/process-flows/*.json
 *     (process-flow 内に flat ref が見つかった場合は安全側で skip + warn する。
 *      process-flow には "current screen" context が無いため、自動 mapping は出来ない)
 *
 * 使用法:
 *   tsx scripts/migrate/processflow-hierarchical-refs.ts [--dry-run] [<projectDir>]
 *
 * 引数:
 *   --dry-run    変更内容を表示するのみで実書き込みしない
 *   <projectDir> 対象プロジェクトディレクトリ (省略時は examples/ 配下の全プロジェクト)
 *
 * 例:
 *   tsx scripts/migrate/processflow-hierarchical-refs.ts --dry-run
 *   tsx scripts/migrate/processflow-hierarchical-refs.ts examples/retail
 *
 * 冪等性:
 *   既に hierarchical form (`@screen.<UUID>.item.<...>`) になっている ref は再変換せず skip する。
 *   従って本 script を複数回実行しても二重変換は起こらない。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// ─── コマンドライン引数解析 ───────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const positional = rawArgs.filter((a) => !a.startsWith("--"));
const explicitProjectDir = positional[0];

// ─── スクリプトルートの解決 ───────────────────────────────────────────────────

const scriptDir = resolve(process.argv[1] ?? __filename, "..", "..");
const repoRoot = resolve(scriptDir, "..");

// ─── 対象プロジェクトディレクトリ列挙 ─────────────────────────────────────────

function getProjectDirs(): string[] {
  if (explicitProjectDir) {
    const abs = resolve(explicitProjectDir);
    if (!existsSync(abs)) {
      console.error(`エラー: 指定したプロジェクトディレクトリが存在しません: ${abs}`);
      process.exit(1);
    }
    return [abs];
  }
  const examplesDir = join(repoRoot, "examples");
  if (!existsSync(examplesDir)) {
    console.error(`エラー: examples/ ディレクトリが見つかりません: ${examplesDir}`);
    process.exit(1);
  }
  return readdirSync(examplesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(examplesDir, d.name));
}

// ─── harmony.json から dataDir を解決 ─────────────────────────────────────────

function resolveDataDir(projectDir: string): string {
  const harmonyPath = join(projectDir, "harmony.json");
  if (existsSync(harmonyPath)) {
    try {
      const raw = JSON.parse(readFileSync(harmonyPath, "utf-8")) as { dataDir?: string };
      if (typeof raw.dataDir === "string" && raw.dataDir.length > 0) {
        return join(projectDir, raw.dataDir);
      }
    } catch {
      // parse error → fallback
    }
  }
  return projectDir;
}

// ─── UUID 判定 ────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// ─── flat ref を hierarchical に rewrite するコア関数 ─────────────────────────

/**
 * 文字列 value 中の `@screen.<key>` flat ref を `@screen.<screenId>.item.<key>` に変換する。
 *
 * 判定ルール:
 *   - `@screen.<UUID>.item.<...>` → 既に hierarchical → skip
 *   - `@screen.<UUID>.<...>` (item 以外) → 不明形式、安全側で skip + warn
 *   - `@screen.<simpleId>` → flat → 変換
 *   - `@screen.<simpleId>.<subPath>` → flat with field accessor → `@screen.<screenId>.item.<simpleId>.<subPath>` に変換
 *
 * @param value 入力文字列
 * @param screenId 当該 screen ファイルの id (null の場合は process-flow 等、context 不明)
 * @param onWarn 警告コールバック
 */
function rewriteScreenRefs(
  value: string,
  screenId: string | null,
  onWarn: (msg: string) => void,
): string {
  // @<prefix>.<key> 全体を 1 単位で置換。key は `[A-Za-z0-9_][A-Za-z0-9_.-]*` (UUID は数字始まり可)。
  // 直前文字が identifier ([A-Za-z0-9_]) の場合は match から除外 (email 等の false positive 回避、
  // processFlowAntipatternValidator の REF_RE と同方針)。
  return value.replace(
    /(?<![a-zA-Z0-9_])@screen\.([A-Za-z0-9_][A-Za-z0-9_.-]*)/g,
    (whole, key: string) => {
      const segs = key.split(".");
      const head = segs[0];

      // 既に hierarchical form の場合 skip
      if (segs.length >= 3 && isUuid(head) && segs[1] === "item") {
        return whole;
      }

      // UUID 始まりだが item でない場合: 不明形式、再変換 (画面 ID 自体への参照 = 後続 segments なし) でない限り skip
      if (isUuid(head)) {
        if (segs.length === 1) {
          // `@screen.<UUID>` 単体 = screen 全体への参照、変換不要
          return whole;
        }
        onWarn(
          `@screen.${key} は UUID 始まりだが \`item\` を含まない hierarchical form。手動確認が必要。skip`,
        );
        return whole;
      }

      // flat form: simple identifier 始まり → screenId で hierarchical 化
      if (!screenId) {
        // process-flow 等 current screen context 無し → 自動変換不可
        onWarn(
          `@screen.${key} は process-flow 等 (current screen context 無し) で flat ref として検出。` +
            `手動で @screen.<screenId>.item.${head} 形式に変換が必要。skip`,
        );
        return whole;
      }

      const itemId = head;
      const rest = segs.slice(1).join(".");
      if (rest) {
        return `@screen.${screenId}.item.${itemId}.${rest}`;
      }
      return `@screen.${screenId}.item.${itemId}`;
    },
  );
}

/**
 * 文字列 value 中の `@table.<columnId>` flat ref を `@table.<tableId>.field.<columnId>` に変換する。
 *
 * 現状の examples には `@table.X` flat ref は存在しないが、将来の sample 追加で混入した場合に備え、
 * tableId が hint として与えられた場合のみ migrate する。tableId 不明な context (process-flow 等)
 * では skip + warn。
 *
 * @param value 入力文字列
 * @param tableId 当該 table ファイルの id (null の場合は flat ref を skip + warn)
 * @param onWarn 警告コールバック
 */
function rewriteTableRefs(
  value: string,
  tableId: string | null,
  onWarn: (msg: string) => void,
): string {
  return value.replace(
    /(?<![a-zA-Z0-9_])@table\.([A-Za-z0-9_][A-Za-z0-9_.-]*)/g,
    (whole, key: string) => {
      const segs = key.split(".");
      const head = segs[0];

      // 既に hierarchical form
      if (segs.length >= 3 && isUuid(head) && segs[1] === "field") {
        return whole;
      }
      if (isUuid(head)) {
        if (segs.length === 1) return whole;
        onWarn(`@table.${key} は UUID 始まりだが \`field\` を含まない hierarchical form。skip`);
        return whole;
      }
      if (!tableId) {
        onWarn(
          `@table.${key} は flat ref として検出。手動で @table.<tableId>.field.${head} 形式に変換が必要。skip`,
        );
        return whole;
      }
      const colId = head;
      const rest = segs.slice(1).join(".");
      return rest
        ? `@table.${tableId}.field.${colId}.${rest}`
        : `@table.${tableId}.field.${colId}`;
    },
  );
}

// ─── JSON 値再帰走査 ─────────────────────────────────────────────────────────

interface RewriteCounters {
  screenRewrites: number;
  tableRewrites: number;
  warnings: string[];
}

function rewriteValuesInJson(
  obj: unknown,
  ctx: { screenId: string | null; tableId: string | null },
  counters: RewriteCounters,
): unknown {
  if (typeof obj === "string") {
    const before = obj;
    let after = rewriteScreenRefs(before, ctx.screenId, (w) => counters.warnings.push(w));
    after = rewriteTableRefs(after, ctx.tableId, (w) => counters.warnings.push(w));
    if (after !== before) {
      // 大雑把に screen/table の差分件数を分けて数える
      const screenDelta = (after.match(/@screen\./g) ?? []).length;
      const screenBeforeFlat = (before.match(/@screen\.(?!.+?\.item\.)/g) ?? []).length;
      const screenAfterFlat = (after.match(/@screen\.(?!.+?\.item\.)/g) ?? []).length;
      if (screenBeforeFlat > screenAfterFlat) {
        counters.screenRewrites += screenBeforeFlat - screenAfterFlat;
      } else if (screenDelta > 0 && before !== after) {
        // fallback: 少なくとも 1 件変換した
        counters.screenRewrites += 1;
      }
      const tableBeforeFlat = (before.match(/@table\.(?!.+?\.field\.)/g) ?? []).length;
      const tableAfterFlat = (after.match(/@table\.(?!.+?\.field\.)/g) ?? []).length;
      if (tableBeforeFlat > tableAfterFlat) {
        counters.tableRewrites += tableBeforeFlat - tableAfterFlat;
      }
    }
    return after;
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => rewriteValuesInJson(v, ctx, counters));
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = rewriteValuesInJson(v, ctx, counters);
    }
    return out;
  }
  return obj;
}

// ─── 1 ファイル処理 ──────────────────────────────────────────────────────────

interface FileResult {
  file: string;
  screenRewrites: number;
  tableRewrites: number;
  warnings: string[];
  changed: boolean;
}

function processJsonFile(file: string, ctx: { screenId: string | null; tableId: string | null }): FileResult {
  const raw = readFileSync(file, "utf-8");
  const json = JSON.parse(raw) as unknown;
  const counters: RewriteCounters = { screenRewrites: 0, tableRewrites: 0, warnings: [] };
  const newJson = rewriteValuesInJson(json, ctx, counters);
  const newRaw = JSON.stringify(newJson, null, 2) + (raw.endsWith("\n") ? "\n" : "");
  const changed = counters.screenRewrites > 0 || counters.tableRewrites > 0;

  if (changed && !dryRun) {
    writeFileSync(file, newRaw, "utf-8");
  }
  return {
    file,
    screenRewrites: counters.screenRewrites,
    tableRewrites: counters.tableRewrites,
    warnings: counters.warnings,
    changed,
  };
}

// ─── 1 プロジェクト処理 ──────────────────────────────────────────────────────

interface ProjectResult {
  projectDir: string;
  fileResults: FileResult[];
}

function processProject(projectDir: string): ProjectResult {
  const dataDir = resolveDataDir(projectDir);
  const screensDir = join(dataDir, "screens");
  const flowsDir = join(dataDir, "process-flows");
  const results: FileResult[] = [];

  // screens/*.json (※ .design.json は skip)
  if (existsSync(screensDir)) {
    const screenFiles = readdirSync(screensDir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".design.json"))
      .map((f) => join(screensDir, f));
    for (const file of screenFiles) {
      // screen JSON の場合、自身の id が screenId
      const raw = readFileSync(file, "utf-8");
      let screenId: string | null = null;
      try {
        const j = JSON.parse(raw) as { id?: string };
        if (typeof j.id === "string") screenId = j.id;
      } catch {
        // skip
      }
      if (!screenId) {
        screenId = basename(file).replace(".json", "");
      }
      results.push(processJsonFile(file, { screenId, tableId: null }));
    }
  }

  // process-flows/*.json (current screen context 無し)
  if (existsSync(flowsDir)) {
    const flowFiles = readdirSync(flowsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(flowsDir, f));
    for (const file of flowFiles) {
      results.push(processJsonFile(file, { screenId: null, tableId: null }));
    }
  }

  return { projectDir, fileResults: results };
}

// ─── main ──────────────────────────────────────────────────────────────────

function main(): void {
  const projectDirs = getProjectDirs();
  console.log(
    `${dryRun ? "[dry-run] " : ""}#1269 提案 A: flat → hierarchical ref migration を ${projectDirs.length} project に実行`,
  );

  let totalScreenRewrites = 0;
  let totalTableRewrites = 0;
  let totalWarnings = 0;
  let totalFilesChanged = 0;

  for (const projectDir of projectDirs) {
    const projName = basename(projectDir);
    const result = processProject(projectDir);
    const projScreenRewrites = result.fileResults.reduce((s, r) => s + r.screenRewrites, 0);
    const projTableRewrites = result.fileResults.reduce((s, r) => s + r.tableRewrites, 0);
    const projWarnings = result.fileResults.flatMap((r) => r.warnings);
    const projFilesChanged = result.fileResults.filter((r) => r.changed).length;

    if (projScreenRewrites === 0 && projTableRewrites === 0 && projWarnings.length === 0) {
      // 変更なし & 警告なし → 簡潔に
      console.log(`  ${projName}: (no change)`);
    } else {
      console.log(
        `  ${projName}: @screen=${projScreenRewrites}, @table=${projTableRewrites}, files=${projFilesChanged}` +
          (projWarnings.length > 0 ? `, warnings=${projWarnings.length}` : ""),
      );
      // 変更ファイル詳細
      for (const r of result.fileResults) {
        if (r.changed) {
          console.log(
            `    ${r.file.replace(projectDir + "/", "")}: @screen+=${r.screenRewrites}, @table+=${r.tableRewrites}`,
          );
        }
      }
      // 警告
      for (const w of projWarnings) {
        console.warn(`    [warn] ${w}`);
      }
    }

    totalScreenRewrites += projScreenRewrites;
    totalTableRewrites += projTableRewrites;
    totalWarnings += projWarnings.length;
    totalFilesChanged += projFilesChanged;
  }

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}合計: @screen=${totalScreenRewrites}, @table=${totalTableRewrites}, files=${totalFilesChanged}` +
      (totalWarnings > 0 ? `, warnings=${totalWarnings}` : ""),
  );

  if (totalWarnings > 0) {
    console.warn(`\n⚠ ${totalWarnings} 件の warning があります。手動確認が必要です。`);
  }
}

main();
