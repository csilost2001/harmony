/**
 * 条件式を、人が読む言葉に直す。本体は `@harmony/shared` (設計書と共有)。ここは、「流れ」表示の既存の読み込み先を保つ再公開。
 * 仕様: docs/spec/process-flow-story-view.md
 */
export { expressionSegments, hasTopLevelChar, parseVarRef, segsToText, splitTopLevel, stripOuterParens, type Seg } from "@harmony/shared";
