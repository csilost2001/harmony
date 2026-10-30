/**
 * 運用の記録 (承認・レビューコメント・権限・体裁・生成の記録・通知) を、JSON のファイルとして持つ共通の道具。
 * 設計の原本ではない。`design-check.json` と同じ作法: 読み込みのたびに検証し、読めない項目は捨てて理由を返す。
 * 読めない項目があるファイルへは、書かない (書くとその項目が消えるため)。`discardUnreadable` を明示したときだけ、捨てて書く。
 *
 * 置き場所:
 * - "data"   `<データフォルダ>/<file>`  (チームで共有する記録。git に載る)
 * - "hidden" `<ワークスペース>/.harmony-ops/<file>`  (秘密・個人の記録。`.harmony-ops/.gitignore` で git に載せない)
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Parsed } from "@harmony/shared";
import { resolveDataRoot, withFileLock, writeJSON } from "../storageCore.js";
import { ensureWorkDir } from "../workDirs.js";

export const OPS_DIR = ".harmony-ops";

export interface OpsSpec<T> {
  file: string;
  scope: "data" | "hidden";
  parse: (raw: unknown) => Parsed<T>;
  empty: () => T;
}
export interface Loaded<T> { value: T; problems: string[] }

export interface OpsStore<T> {
  file(root: string): Promise<string>;
  read(root: string): Promise<Loaded<T>>;
  /** 読み込み・検証して、`mutate` で変えて、書く。mutate の中で throw すれば書かない */
  update(root: string, mutate: (v: T) => T | Promise<T>, opts?: { discardUnreadable?: boolean }): Promise<Loaded<T>>;
}

async function ensureHiddenDir(root: string): Promise<string> {
  const dir = path.join(root, OPS_DIR);
  // 秘密 (通知先の URL など) や個人の記録を、利用者の git に載せない (中に .gitignore を置く)
  await ensureWorkDir(dir);
  return dir;
}

export function opsDirOf(root: string): string { return path.join(root, OPS_DIR); }

export function makeOpsStore<T>(spec: OpsSpec<T>): OpsStore<T> {
  const fileOf = async (root: string): Promise<string> => (spec.scope === "hidden" ? path.join(root, OPS_DIR, spec.file) : path.join(await resolveDataRoot(root), spec.file));
  const readAndParse = async (file: string): Promise<Loaded<T>> => {
    let text: string;
    try { text = await fs.readFile(file, "utf-8"); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { value: spec.empty(), problems: [] };
      return { value: spec.empty(), problems: [`${spec.file} を読めません (${e instanceof Error ? e.message : String(e)})`] };
    }
    if (!text.trim()) return { value: spec.empty(), problems: [] };
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) {
      return { value: spec.empty(), problems: [`${spec.file} が JSON として読めません (${e instanceof Error ? e.message : String(e)})。ファイルを直してください`] };
    }
    return spec.parse(raw);
  };
  return {
    file: fileOf,
    read: async (root) => readAndParse(await fileOf(root)),
    update: async (root, mutate, opts = {}) => {
      const file = await fileOf(root);
      return withFileLock(file, async () => {
        const loaded = await readAndParse(file);
        const syntaxBroken = loaded.problems.some((m) => m.includes("JSON として読めません") || m.includes("を読めません"));
        if (loaded.problems.length && (!opts.discardUnreadable || syntaxBroken)) throw new Error(`${spec.file} に読めない項目があるため、書き換えません。ファイルを直してください: ${loaded.problems.join(" / ")}`);
        const next = await mutate(structuredClone(loaded.value));
        // 書く前に、もう一度検証する (入力の誤りは、書かずにエラーにする)
        const checked = spec.parse(next);
        if (checked.problems.length) throw new Error(checked.problems.join(" / "));
        if (spec.scope === "hidden") await ensureHiddenDir(root);
        await writeJSON(file, checked.value);
        return checked;
      });
    },
  };
}

export { ensureHiddenDir };
