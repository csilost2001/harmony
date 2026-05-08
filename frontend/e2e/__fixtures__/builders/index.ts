/**
 * e2e テスト用 v3 typed builder — re-export entry point。
 *
 * 使用例:
 * ```ts
 * import { buildProject, buildProcessFlow, buildTable } from "../__fixtures__/builders";
 * ```
 */

export { buildProject, type BuildProjectOpts } from "./projectBuilder";
export { buildProcessFlow, type BuildProcessFlowOpts } from "./processFlowBuilder";
export { buildAction, type BuildActionOpts } from "./actionBuilder";
export { buildTable, type BuildTableOpts } from "./tableBuilder";
export { buildView, type BuildViewOpts } from "./viewBuilder";
export { buildViewDefinition, type BuildViewDefinitionOpts } from "./viewDefinitionBuilder";
export { buildSequence, type BuildSequenceOpts } from "./sequenceBuilder";
export { buildScreen, type BuildScreenOpts } from "./screenBuilder";
export { buildScreenLayout, type BuildScreenLayoutOpts } from "./screenLayoutBuilder";
export { buildCustomBlock, type BuildCustomBlockOpts } from "./customBlockBuilder";
export { buildConventions, type BuildConventionsOpts } from "./conventionsBuilder";
