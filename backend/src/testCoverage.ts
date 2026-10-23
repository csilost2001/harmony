/**
 * 生成したテストが、テスト観点表のどれだけを覆うか (designer__check_test_coverage)。
 *
 * 読むのは、`record_generation` で記録された生成物のうち、テストらしいもの (`test` / `spec` を含むパス) だけ。
 * 観点の ID (`<処理 ID>.<アクション ID>.TV-<連番>`・`<画面 ID>.<項目 ID>.<規則>`) が、テストの本文に書かれていれば「覆っている」。
 * ID をテスト名やコメントに書く約束は docs/spec/test-viewpoints.md。書き方が違う (ID を書いていない) テストは、覆っていないと数える。
 */
import { deriveTestViewpointSheet } from "@harmony/shared";
import { loadDesignInputFromRoot } from "./designInput.js";
import { readGeneratedText } from "./ops/service.js";
import { generationStore } from "./ops/stores.js";

/** 絞り込み: 画面か処理フローの一方だけを指定したら、もう一方は対象にしない (両方なければ、全部) */
export interface CoverageOptions { screenIds?: string[]; flowIds?: string[] }

export async function checkTestCoverage(root: string, opts: CoverageOptions = {}): Promise<Record<string, unknown>> {
  const { input } = await loadDesignInputFromRoot(root);
  const onlyFlows = !!opts.flowIds?.length && !opts.screenIds?.length, onlyScreens = !!opts.screenIds?.length && !opts.flowIds?.length;
  const pick = <T,>(items: T[], ids: string[] | undefined, idOf: (x: T) => string) => (ids?.length ? items.filter((x) => ids.includes(idOf(x))) : items);
  const sheet = deriveTestViewpointSheet({
    limits: input.limits, regex: input.regex, messages: input.messages,
    screens: onlyFlows ? [] : pick(input.screens.filter((s) => s.purpose !== "gadget"), opts.screenIds, (s) => s.id),
    flows: onlyScreens ? [] : pick(input.flows, opts.flowIds, (f) => f.meta.id),
  });

  const { value, problems } = await generationStore.read(root);
  const testFiles = value.outputs.filter((o) => /(^|[/._-])(test|tests|spec|specs)([/._-]|$)/i.test(o.path));
  let corpus = "";
  const read: string[] = [], unreadable: string[] = [];
  for (const o of testFiles) {
    const t = await readGeneratedText(root, o.path, o.base);
    if (t === null) unreadable.push(o.path); else { corpus += `\n${t}`; read.push(o.path); }
  }

  const rows: Array<{ id: string; target: string; category: string; covered: boolean }> = [];
  for (const s of sheet.screens) for (const c of s.cases) rows.push({ id: c.id, target: `画面 ${s.screenName ?? s.screenId}`, category: c.category, covered: corpus.includes(c.id) });
  for (const f of sheet.flows) for (const c of f.cases) rows.push({ id: c.id, target: `処理 ${f.flowName ?? f.flowId}`, category: c.category, covered: corpus.includes(c.id) });

  const byTarget = new Map<string, { total: number; covered: number }>();
  for (const r of rows) { const t = byTarget.get(r.target) ?? { total: 0, covered: 0 }; t.total++; if (r.covered) t.covered++; byTarget.set(r.target, t); }
  const covered = rows.filter((r) => r.covered).length;
  const uncovered = rows.filter((r) => !r.covered);
  const LIMIT = 100;
  return {
    total: rows.length, covered, percent: rows.length ? Math.round((covered / rows.length) * 1000) / 10 : null,
    testFiles: read, ...(unreadable.length ? { unreadableFiles: unreadable } : {}),
    byTarget: [...byTarget].map(([target, v]) => ({ target, ...v })),
    uncovered: uncovered.slice(0, LIMIT).map(({ id, target, category }) => ({ id, target, category })),
    ...(uncovered.length > LIMIT ? { moreUncovered: uncovered.length - LIMIT } : {}),
    ...(problems.length ? { recordProblems: problems } : {}),
    note: testFiles.length === 0
      ? "テストらしい生成物の記録がありません。テストを生成したら record_generation で記録してください (パスに test / spec を含める)。観点の ID をテスト名に書く約束は docs/spec/test-viewpoints.md"
      : "観点の ID がテストの本文に書かれているかで数えます。ID を書いていないテストは、覆っていないと数えます",
  };
}
