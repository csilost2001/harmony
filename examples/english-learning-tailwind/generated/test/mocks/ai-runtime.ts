// Shim: re-exports from the top-level mocks/ai-runtime.ts
// This allows the e2e fixture (test/96118ae1-ai-mock.e2e-spec.ts) to import
// from './mocks/ai-runtime' without modification.
export { mockAiText, mockAiFailure } from '../../mocks/ai-runtime';
export type { AiInvocationResult } from '../../mocks/ai-runtime';
