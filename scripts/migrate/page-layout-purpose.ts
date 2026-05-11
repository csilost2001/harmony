#!/usr/bin/env tsx
/**
 * scripts/migrate/page-layout-purpose.ts
 *
 * examples/<project-id>/harmony/screens/*.json の全 Screen に
 * `purpose` フィールドが存在しない場合 `"page"` を付与するマイグレーションスクリプト (#1022)。
 *
 * 使用法:
 *   tsx scripts/migrate/page-layout-purpose.ts [--dry-run] [<projectDir>]
 *
 * 引数:
 *   --dry-run    変更内容を表示するのみで実書き込みしない (デフォルト: false)
 *   <projectDir> 対象プロジェクトディレクトリ。省略時は examples/ 配下の全プロジェクトを対象とする。
 *
 * 例:
 *   tsx scripts/migrate/page-layout-purpose.ts --dry-run
 *   tsx scripts/migrate/page-layout-purpose.ts ../examples/retail
 *   tsx scripts/migrate/page-layout-purpose.ts
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
// scripts/ の親がリポジトリルートと仮定
const repoRoot = resolve(scriptDir, "..");

// ─── 対象ディレクトリ一覧 ─────────────────────────────────────────────────────

function getProjectDirs(): string[] {
  if (explicitProjectDir) {
    const abs = resolve(explicitProjectDir);
    if (!existsSync(abs)) {
      console.error(`エラー: 指定したプロジェクトディレクトリが存在しません: ${abs}`);
      process.exit(1);
    }
    return [abs];
  }
  // examples/ 配下の全ディレクトリ
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
      // parse error → フォールバック
    }
  }
  return projectDir;
}

// ─── path 重複検出 ────────────────────────────────────────────────────────────

interface ScreenJson {
  id?: string;
  purpose?: string;
  path?: string;
  [key: string]: unknown;
}

function detectPathDuplicates(screens: Array<{ file: string; json: ScreenJson }>): boolean {
  // purpose が "gadget" の Screen は path なしが許容されるため除外
  const pageScreens = screens.filter((s) => {
    const purposeValue = s.json.purpose;
    // purpose 未定義 → デフォルト "page" とみなす
    return purposeValue === undefined || purposeValue === "page";
  });

  const pathMap = new Map<string, string[]>();
  for (const { file, json } of pageScreens) {
    if (typeof json.path === "string") {
      const existing = pathMap.get(json.path) ?? [];
      existing.push(file);
      pathMap.set(json.path, existing);
    }
  }

  let hasDuplicate = false;
  for (const [path, files] of pathMap.entries()) {
    if (files.length > 1) {
      hasDuplicate = true;
      console.error(`[path 重複] path="${path}" が複数の Screen で重複しています:`);
      for (const f of files) {
        const id = basename(f).replace(".json", "");
        console.error(`  - ${f} (id: ${id})`);
      }
    }
  }
  return hasDuplicate;
}

// ─── 1 プロジェクトの処理 ─────────────────────────────────────────────────────

interface ProcessResult {
  projectDir: string;
  totalScreens: number;
  addedCount: number;
  skippedCount: number;
}

function processProject(projectDir: string): ProcessResult {
  const dataDir = resolveDataDir(projectDir);
  const screensDir = join(dataDir, "screens");

  if (!existsSync(screensDir)) {
    return { projectDir, totalScreens: 0, addedCount: 0, skippedCount: 0 };
  }

  // .design.json を除く Screen JSON ファイルを収集
  const files = readdirSync(screensDir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".design.json"))
    .map((f) => join(screensDir, f));

  if (files.length === 0) {
    return { projectDir, totalScreens: 0, addedCount: 0, skippedCount: 0 };
  }

  // 全 Screen を読み込み
  const screens = files.map((file) => ({
    file,
    raw: readFileSync(file, "utf-8"),
    json: JSON.parse(readFileSync(file, "utf-8")) as ScreenJson,
  }));

  // path 重複検出 (page 系 Screen のみ対象)
  const hasDuplicate = detectPathDuplicates(screens.map((s) => ({ file: s.file, json: s.json })));
  if (hasDuplicate) {
    console.error(`\npath 重複が検出されたため処理を中断します: ${projectDir}`);
    process.exit(1);
  }

  let addedCount = 0;
  let skippedCount = 0;

  for (const { file, raw, json } of screens) {
    if (json.purpose !== undefined) {
      // 既に purpose フィールドが存在する → skip
      skippedCount++;
      continue;
    }

    // purpose フィールドを追加 (JSON プロパティ順: $schema の直後、kind の前に挿入)
    // JSON.stringify で再フォーマットする代わりに、既存のインデントを維持する
    const id = json.id ?? basename(file).replace(".json", "");
    const oldJson = json;
    const newJson: Record<string, unknown> = {};

    // 既存フィールドを順番通りコピー、kind の前に purpose を挿入
    let purposeInserted = false;
    for (const [key, value] of Object.entries(oldJson)) {
      if (!purposeInserted && key === "kind") {
        newJson.purpose = "page";
        purposeInserted = true;
      }
      newJson[key] = value;
    }
    // kind フィールドが存在しなかった場合は末尾近くに追加
    if (!purposeInserted) {
      // name の後に挿入できるよう、再度再構築
      const finalJson: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(oldJson)) {
        finalJson[key] = value;
        if (key === "name" && !purposeInserted) {
          finalJson.purpose = "page";
          purposeInserted = true;
        }
      }
      if (!purposeInserted) {
        finalJson.purpose = "page";
      }
      Object.assign(newJson, finalJson);
    }

    // 元のインデント (2 スペース想定) を維持して JSON 文字列化
    const newJsonStr = JSON.stringify(newJson, null, 2);

    // 末尾改行の維持: 元ファイルが末尾改行ありの場合は付与
    const trailingNewline = raw.endsWith("\n") ? "\n" : "";
    const output = newJsonStr + trailingNewline;

    if (dryRun) {
      console.log(`\n[DRY-RUN] ${file} (id: ${id})`);
      console.log(`  変更前: purpose フィールドなし`);
      console.log(`  変更後: "purpose": "page" を追加`);
    } else {
      writeFileSync(file, output, "utf-8");
      console.log(`[UPDATED] ${file} → purpose: "page" を付与`);
    }

    addedCount++;
  }

  return {
    projectDir,
    totalScreens: screens.length,
    addedCount,
    skippedCount,
  };
}

// ─── メイン処理 ───────────────────────────────────────────────────────────────

function main(): void {
  const mode = dryRun ? "[DRY-RUN]" : "[実行]";
  console.log(`page-layout-purpose migration ${mode}`);
  console.log(`スクリプトルート: ${repoRoot}`);
  if (explicitProjectDir) {
    console.log(`対象: ${resolve(explicitProjectDir)}`);
  } else {
    console.log(`対象: examples/ 配下の全プロジェクト`);
  }
  console.log();

  const projectDirs = getProjectDirs();
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalScreens = 0;

  for (const projectDir of projectDirs) {
    const projectName = basename(projectDir);
    console.log(`\n── プロジェクト: ${projectName} (${projectDir})`);
    const result = processProject(projectDir);
    totalScreens += result.totalScreens;
    totalAdded += result.addedCount;
    totalSkipped += result.skippedCount;
    console.log(`   ${result.totalScreens} 件の Screen: ${result.addedCount} 件に purpose 付与, ${result.skippedCount} 件スキップ`);
  }

  console.log();
  console.log("────────────────────────────────────────────");
  console.log(`合計: ${totalScreens} Screen / purpose 付与: ${totalAdded} 件 / スキップ: ${totalSkipped} 件`);
  if (dryRun) {
    console.log("(--dry-run モードのため実際の書き込みは行われていません)");
  } else {
    console.log("マイグレーション完了。");
  }
}

main();
