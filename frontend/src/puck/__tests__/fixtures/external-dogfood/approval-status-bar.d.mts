/**
 * approval-status-bar.d.mts — dogfood fixture (#1413 P-5) の型宣言。
 *
 * 同ディレクトリの `approval-status-bar.mjs` は外部 component の実 vite build 成果物
 * (ESM、JS only) のため型宣言を持たない。dogfoodExternalComponents.test.tsx が
 * 動的 import (`import("./...approval-status-bar.mjs")`) する際の implicit-any (TS7016) を
 * 避けるための最小宣言。moduleResolution=bundler では `*.mjs` import の宣言は `*.d.mts`。
 *
 * 実体 (default export) は React FunctionComponent だが、テストは loader 契約
 * (ComponentType<any> として受け取り createElement で render) を検証するのみのため、
 * ここでは緩い型 (default: unknown) で十分。
 */
declare const ApprovalStatusBar: unknown;
export default ApprovalStatusBar;
