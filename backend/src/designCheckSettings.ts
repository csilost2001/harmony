/**
 * 設計の点検の設定 (`<データフォルダ>/design-check.json`): 要確認の抑制と、独自の検査ルール。
 * 設計の原本ではなく運用の設定。形の検証は shared の `parseCheckSettings`。読み込みのたびに検証し、壊れた項目は捨てて理由を返す
 * (手で書き換えた 1 行の誤りで、点検全体を止めない)。書き込むときは、検証に通らなければ書かずにエラーにする。
 * 仕様: docs/spec/design-check.md
 */
import path from "node:path";
import { emptyCheckSettings, isValidDate, issueKey, parseCheckSettings, type CheckSettings, type IssueSeverity, type CustomRule } from "@harmony/shared";
import { ensureDataDirFromRoot, readJSON, resolveDataRoot, withFileLock, writeJSON } from "./storageCore.js";

export const designCheckFile = (dataRoot: string): string => path.join(dataRoot, "design-check.json");

export interface LoadedCheckSettings { settings: CheckSettings; problems: string[] }

export async function readCheckSettings(root: string): Promise<LoadedCheckSettings> {
  const dataRoot = await resolveDataRoot(root);
  return parseCheckSettings(await readJSON<unknown>(designCheckFile(dataRoot)));
}

async function update(root: string, mutate: (s: CheckSettings) => CheckSettings): Promise<LoadedCheckSettings> {
  const dataRoot = await ensureDataDirFromRoot(root);
  const file = designCheckFile(dataRoot);
  return withFileLock(file, async () => {
    // 読み込みで捨てられる項目 (手書きの誤り) があるまま書くと、その項目が消えてしまう。直すまで、書き換えない
    const loaded = parseCheckSettings(await readJSON<unknown>(file));
    if (loaded.problems.length) throw new Error(`design-check.json に読めない項目があるため、書き換えません。ファイルを直してください: ${loaded.problems.join(" / ")}`);
    const next = mutate(structuredClone(loaded.settings));
    // 書く前に、もう一度検証する (利用者の入力の誤りは、書かずにエラーにする)
    const checked = parseCheckSettings(next);
    if (checked.problems.length) throw new Error(checked.problems.join(" / "));
    await writeJSON(file, checked.settings);
    return checked;
  });
}

export interface SuppressInput { key: string; reason: string; expiresOn?: string; by?: string; severity: IssueSeverity; section: string; message: string }

/** 要確認を、理由つきで抑制する (同じ key は上書き)。理由は必須 */
export async function suppressIssue(root: string, input: SuppressInput, now = new Date()): Promise<LoadedCheckSettings> {
  if (typeof input.reason !== "string" || !input.reason.trim()) throw new Error("抑制する理由を書いてください");
  if (typeof input.key !== "string" || !/^i-[0-9a-f]{16}$/.test(input.key)) throw new Error("抑制する指摘の印が正しくありません");
  // 印は、重大度・対象・内容から決まる。送られた内容と印が合わないものは受け付けない (別の指摘を止めてしまわないように)
  if (issueKey({ severity: input.severity, section: input.section, message: input.message }) !== input.key) throw new Error("指摘の内容と印が合いません。画面を読み込み直してください");
  if (input.expiresOn !== undefined && input.expiresOn !== "" && !isValidDate(input.expiresOn)) throw new Error("期限は YYYY-MM-DD の日付で書いてください");
  return update(root, (s) => {
    const entry = {
      key: input.key, reason: input.reason.trim(), at: now.toISOString(), severity: input.severity, section: input.section, message: input.message,
      ...(input.expiresOn ? { expiresOn: input.expiresOn } : {}), ...(input.by?.trim() ? { by: input.by.trim() } : {}),
    };
    return { ...s, suppressions: [...s.suppressions.filter((x) => x.key !== input.key), entry] };
  });
}

export async function unsuppressIssue(root: string, key: string): Promise<LoadedCheckSettings> {
  if (typeof key !== "string" || !key) throw new Error("抑制を外す指摘の印を指定してください");
  return update(root, (s) => ({ ...s, suppressions: s.suppressions.filter((x) => x.key !== key) }));
}

/** 期限切れ・該当のなくなった抑制を、まとめて外す */
export async function removeSuppressions(root: string, keys: string[]): Promise<LoadedCheckSettings> {
  const set = new Set(keys);
  return update(root, (s) => ({ ...s, suppressions: s.suppressions.filter((x) => !set.has(x.key)) }));
}

/** 独自ルールを、まとめて置き換える (形が正しくなければ書かずにエラー) */
export async function saveRules(root: string, rules: unknown): Promise<LoadedCheckSettings> {
  if (!Array.isArray(rules)) throw new Error("ルールの一覧の形が正しくありません");
  const probe = parseCheckSettings({ version: 1, suppressions: [], rules });
  if (probe.problems.length || probe.settings.rules.length !== rules.length) throw new Error(probe.problems.join(" / ") || "ルールを読めませんでした");
  return update(root, (s) => ({ ...s, rules: probe.settings.rules as CustomRule[] }));
}

export { emptyCheckSettings };
