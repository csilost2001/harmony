// Phase-2 (#1145): StepCard.tsx の kind 別 body sub-component の barrel export。

export { ValidationStepCardBody } from "./ValidationStepCardBody";
export { DbAccessStepCardBody } from "./DbAccessStepCardBody";
export { ExternalSystemStepCardBody } from "./ExternalSystemStepCardBody";
export { CommonProcessStepCardBody } from "./CommonProcessStepCardBody";
export { ComputeStepCardBody } from "./ComputeStepCardBody";
export { ReturnStepCardBody } from "./ReturnStepCardBody";
export { ScreenTransitionStepCardBody } from "./ScreenTransitionStepCardBody";
export { DisplayUpdateStepCardBody } from "./DisplayUpdateStepCardBody";
export { BranchStepCardBody } from "./BranchStepCardBody";
export { LoopStepCardBody } from "./LoopStepCardBody";
export { LogStepCardBody } from "./LogStepCardBody";
export { AuditStepCardBody } from "./AuditStepCardBody";
export { TransactionScopeStepCardBody } from "./TransactionScopeStepCardBody";
export { JumpStepCardBody } from "./JumpStepCardBody";
export { WorkflowStepCardBody } from "./WorkflowStepCardBody";
// Phase-3 (#1145、#1163 review Phase-2 補足): 元 StepCard.tsx で dispatch 未実装だった 3 kind を追加。
export { ComponentCallStepCardBody } from "./ComponentCallStepCardBody";
export { AiCallStepCardBody } from "./AiCallStepCardBody";
export { AiAgentStepCardBody } from "./AiAgentStepCardBody";
