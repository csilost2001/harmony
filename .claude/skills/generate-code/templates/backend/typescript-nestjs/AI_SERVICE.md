# TypeScript NestJS — AI Runtime Service テンプレート (Phase 2-C)

ProcessFlow に `kind ∈ {aiCall, aiAgent}` の step が含まれる場合、生成 backend には
`AiRuntimeService` クラスを 1 ファイル追加する。各業務 Service は本クラスを DI 注入して
`invoke()` 1 メソッドだけを呼ぶ (provider 別 SDK 差は本クラス内に閉じ込める)。

> **設計原則**:
> - 業務 Service は **provider 中立** (`modelRef` だけを参照、SDK 名は出てこない)
> - provider / model / auth は `context.catalogs.modelEndpoints` で解決 (catalog 編集だけで切替)
> - 戻り値は spec `docs/spec/process-flow-ai-step-kind.md` §「outputBinding の値構造」に従う **正規化形式**
> - `/generate-tests` Phase 2-B の mock helper (`mocks/ai-runtime.ts`) と method 名 / interface が一致

## 出力ファイル

```
<出力先>/src/ai/
  ai-runtime.service.ts   — provider-中立 service (1 ファイル、本テンプレート)
  ai.module.ts            — @Module 定義 + AiRuntimeService export
  types.ts                — AiInvocationRequest / AiInvocationResult / AiMessage 等の型 (任意分割)
```

`<projectName>Module` の `imports` に `AiModule` を追加し、業務 Service の constructor で
`private readonly aiRuntime: AiRuntimeService` を受け取る。

## AiRuntimeService の interface (固定契約)

`/generate-tests` (Phase 2-B) の `mocks/ai-runtime.ts` がこの interface を mock するため、
**method 名 / 引数構造 / 戻り値構造は変更不可**。provider 追加時は本クラス内 dispatch を拡張する。

```typescript
// src/ai/ai-runtime.service.ts
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv'; // npm i ajv

/**
 * spec docs/spec/process-flow-ai-step-kind.md §「outputBinding の値構造」に対応する
 * provider 中立の正規化レスポンス。responseFormat.kind 別に使用フィールドが変わる:
 *   text             → text のみ
 *   json             → object + raw
 *   structuredObject → object (schema 準拠) + raw
 *   streaming        → text (本層では assembled テキストのみ。partial chunks は別層)
 *   tools 使用 / aiAgent → toolCalls を併用
 */
export interface AiInvocationResult {
  text?: string;
  object?: unknown;
  raw?: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
}

/**
 * runtime 用の正規化 message。ProcessFlow JSON 上の schema (`AiMessage.role`) は
 * `system | user | assistant` の 3 値のみ。`'tool'` は **SDK 呼び出し後の会話ターン**
 * (tool_use への返り値として AI に渡すメッセージ) を表す runtime 拡張で、aiAgent ループ内で
 * `AiRuntimeService` が組み立てる。生成 ProcessFlow JSON で `role: 'tool'` を書くことは無い。
 */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | AiContentBlock[];
  toolCallId?: string; // role='tool' のとき必須
  name?: string;
}

export interface AiContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: AiImageSource;
  toolUse?: { id: string; name: string; arguments: unknown };
  toolResult?: { toolCallId: string; result: unknown; isError?: boolean };
}

/**
 * spec の `AiImageSource` (oneOf 3 形式) に対応する discriminated union。
 * field 名は schema の各 branch に正確に一致 (fileRef は `ref`、url は `url`、base64 は `data`+`mediaType`)。
 */
export type AiImageSource =
  | { kind: 'fileRef'; ref: string }            // schema: ExpressionString (例: '@inputs.photo')
  | { kind: 'url'; url: string }                // schema: literal URI または ExpressionString
  | { kind: 'base64'; data: string; mediaType: string };

export interface AiResponseFormat {
  kind: 'text' | 'json' | 'structuredObject' | 'streaming';
  schema?: object; // structuredObject のとき必須 (JSON Schema)
}

/**
 * spec の `AiToolRef` (oneOf 2 形式) に対応する discriminated union。
 * functionRef は context.catalogs.functions[ref] を解決して provider 形式に変換、
 * inline は name/description/parameters をそのまま provider 形式へ詰め替える。
 */
export type AiToolRef =
  | { kind: 'functionRef'; ref: string }
  | { kind: 'inline'; name: string; description: string; parameters: Record<string, unknown> };

/**
 * runtime 用の正規化形式。ProcessFlow JSON 上の schema は
 *   AiToolChoice = oneOf [ string enum('auto'|'any'|'none'), { name: string } ]
 * という discriminated union のため、業務 Service 生成器側で次のように詰め替える:
 *   "auto"        → { mode: 'auto' }
 *   "any"         → { mode: 'any' }
 *   "none"        → { mode: 'none' }
 *   { name: "X" } → { mode: 'tool', toolName: 'X' }
 */
export interface AiToolChoice {
  mode: 'auto' | 'any' | 'none' | 'tool';
  toolName?: string; // mode='tool' のとき必須
}

export interface AiInferenceParameters {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

export interface AiInvocationRequest {
  modelRef: string;
  messages: AiMessage[];
  responseFormat?: AiResponseFormat; // 省略時 {kind:'text'}
  tools?: AiToolRef[];
  toolChoice?: AiToolChoice;
  inferenceParameters?: AiInferenceParameters;
  agent?: { maxIterations: number; toolRunner?: AgentToolRunner };
}

export type AgentToolRunner = (
  call: { id: string; name: string; arguments: unknown },
) => Promise<unknown>;

export interface ModelEndpointEntry {
  provider:
    | 'anthropic'
    | 'openai'
    | 'google'
    | 'aws-bedrock'
    | 'azure-openai'
    | 'ollama'
    | string; // namespace:custom (拡張 provider)
  model: string;
  endpoint?: string;
  auth: {
    kind: 'bearer' | 'apiKey' | 'basic' | 'oauth2' | 'iamRole' | 'azureAd' | 'none';
    tokenRef?: string; // '@secret.<key>'
  };
  defaults?: AiInferenceParameters;
  fallback?: string;
}

export interface SecretEntry {
  source: 'env' | 'vault' | string;
  name: string; // env source: process.env のキー名
}

/**
 * project + flow level catalog の merge 結果。実装は ConfigService や
 * harmony.json loader 経由で構築する (本テンプレートでは inject 想定で抽象化)。
 */
export interface AiCatalogProvider {
  resolveModelEndpoint(modelRef: string): ModelEndpointEntry | undefined;
  resolveSecret(secretKey: string): SecretEntry | undefined;
}

export const AI_CATALOG_PROVIDER = 'AiCatalogProvider';

@Injectable()
export class AiRuntimeService {
  private readonly logger = new Logger(AiRuntimeService.name);

  // interface は実行時消失するため文字列トークン経由で DI 解決する。
  // ai.module.ts の providers と provide キーが一致している必要あり。
  constructor(
    @Inject(AI_CATALOG_PROVIDER) private readonly catalogs: AiCatalogProvider,
  ) {}

  async invoke(request: AiInvocationRequest): Promise<AiInvocationResult> {
    const endpoint = this.catalogs.resolveModelEndpoint(request.modelRef);
    if (!endpoint) {
      throw new HttpException(
        {
          code: 'UNKNOWN_MODEL_REF',
          message: `modelRef="${request.modelRef}" が catalog に存在しません`,
        },
        500,
      );
    }

    // AI-2: auth.kind=bearer/apiKey で secret 未設定なら 503 (provider 呼び出し前に fail-fast)
    const apiKey = this.resolveApiKey(endpoint);
    if (this.requiresApiKey(endpoint) && !apiKey) {
      const envName = this.resolveSecretEnvName(endpoint);
      throw new HttpException(
        {
          code: 'AI_CREDENTIAL_MISSING',
          message: `AI provider credentials not configured (env=${envName ?? '?'})`,
        },
        503,
      );
    }

    try {
      const raw = await this.dispatchByProvider(endpoint, request, apiKey);
      // AI-3: responseFormat=json|structuredObject の検証 (失敗 → 502)
      return this.normalizeAndValidate(raw, request.responseFormat);
    } catch (err) {
      // AI-3 / AI-4 を 502 に集約 (catalog.errors.AI_API_ERROR.responseId が紐付いている前提)
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `AI provider call failed (modelRef=${request.modelRef})`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new HttpException(
        { code: 'AI_API_ERROR', message: (err as Error).message },
        502,
      );
    }
  }

  // ── private ──────────────────────────────────────────────────

  private requiresApiKey(endpoint: ModelEndpointEntry): boolean {
    return endpoint.auth.kind === 'bearer' || endpoint.auth.kind === 'apiKey';
  }

  private resolveApiKey(endpoint: ModelEndpointEntry): string | undefined {
    const envName = this.resolveSecretEnvName(endpoint);
    return envName ? process.env[envName] || undefined : undefined;
  }

  private resolveSecretEnvName(endpoint: ModelEndpointEntry): string | undefined {
    const ref = endpoint.auth.tokenRef;
    if (!ref || !ref.startsWith('@secret.')) return undefined;
    const key = ref.slice('@secret.'.length);
    const secret = this.catalogs.resolveSecret(key);
    return secret?.source === 'env' ? secret.name : undefined;
  }

  private async dispatchByProvider(
    endpoint: ModelEndpointEntry,
    request: AiInvocationRequest,
    apiKey: string | undefined,
  ): Promise<AiInvocationResult> {
    // apiKey は呼び出し前に requiresApiKey() ガード済 (bearer/apiKey でない限り undefined)。
    // azure-openai は azureAd / apiKey の両方を許容するため provider 内で auth.kind を見て分岐する。
    switch (endpoint.provider) {
      case 'anthropic':
        return this.invokeAnthropic(endpoint, request, apiKey!);
      case 'openai':
        return this.invokeOpenAI(endpoint, request, apiKey!);
      case 'google':
        return this.invokeGoogle(endpoint, request, apiKey!);
      case 'aws-bedrock':
        return this.invokeBedrock(endpoint, request); // IAM role (apiKey 不要)
      case 'azure-openai':
        return this.invokeAzureOpenAI(endpoint, request, apiKey); // apiKey は azureAd 時 undefined
      case 'ollama':
        return this.invokeOllama(endpoint, request); // auth.kind='none' 想定
      default:
        if (endpoint.provider.includes(':')) {
          return this.invokeCustomProvider(endpoint, request, apiKey);
        }
        throw new HttpException(
          { code: 'AI_PROVIDER_UNSUPPORTED', provider: endpoint.provider },
          500,
        );
    }
  }

  // AJV インスタンスは constructor で 1 回だけ構築し、validator は schema ごとにキャッシュする。
  private readonly ajv = new Ajv({ strict: false, allErrors: true });
  private readonly validatorCache = new WeakMap<object, ValidateFunction>();

  private normalizeAndValidate(
    raw: AiInvocationResult,
    responseFormat?: AiResponseFormat,
  ): AiInvocationResult {
    const kind = responseFormat?.kind ?? 'text';
    if (kind === 'text' || kind === 'streaming') return raw;

    // json / structuredObject: object が無ければ raw を JSON.parse
    if (raw.object === undefined && typeof raw.raw === 'string') {
      try {
        raw.object = JSON.parse(raw.raw);
      } catch (e) {
        throw new HttpException(
          {
            code: 'AI_RESPONSE_FORMAT_VIOLATION',
            kind,
            message: 'AI response is not valid JSON',
          },
          502,
        );
      }
    }

    if (kind === 'structuredObject' && responseFormat?.schema) {
      let validate = this.validatorCache.get(responseFormat.schema);
      if (!validate) {
        validate = this.ajv.compile(responseFormat.schema);
        this.validatorCache.set(responseFormat.schema, validate);
      }
      if (!validate(raw.object)) {
        throw new HttpException(
          {
            code: 'AI_RESPONSE_FORMAT_VIOLATION',
            kind,
            message: 'AI response does not satisfy declared responseFormat.schema',
            errors: validate.errors,
          },
          502,
        );
      }
    }
    return raw;
  }

  // ── provider 別実装 (provider ごとに導入したい SDK のみ実装すれば OK) ──
  // 本テンプレートは "雛形 + コメント" レベル。利用 provider に応じて 1〜2 種を実装し、
  // 残りは throw HttpException(..., 500) のままにしてよい。

  private async invokeAnthropic(
    endpoint: ModelEndpointEntry,
    request: AiInvocationRequest,
    apiKey: string,
  ): Promise<AiInvocationResult> {
    // npm i @anthropic-ai/sdk
    // import Anthropic from '@anthropic-ai/sdk';
    // const client = new Anthropic({ apiKey, baseURL: endpoint.endpoint });
    //
    // // messages 変換: AiMessage[] → Anthropic Messages API 形式
    // // - system role は messages から抽出して system パラメータに移す
    // // - content は string なら [{type:'text',text}]、AiContentBlock[] はそのまま
    // // - role='tool' → tool_result content block に変換
    // const { system, messages } = toAnthropicMessages(request.messages);
    //
    // // tools / responseFormat / agent loop の振り分け
    // if (request.agent) {
    //   return runAnthropicAgentLoop(client, endpoint, request, system, messages);
    // }
    //
    // const resp = await client.messages.create({
    //   model: endpoint.model,
    //   system,
    //   messages,
    //   tools: request.tools?.map(toAnthropicTool),
    //   tool_choice: toAnthropicToolChoice(request.toolChoice),
    //   max_tokens: request.inferenceParameters?.maxTokens
    //     ?? endpoint.defaults?.maxTokens ?? 1024,
    //   temperature: request.inferenceParameters?.temperature ?? endpoint.defaults?.temperature,
    //   ...(request.responseFormat?.kind === 'structuredObject'
    //     ? { /* prompt engineering で JSON 強制、または tool_use を使った structured output */ }
    //     : {}),
    // });
    //
    // return {
    //   text: extractText(resp.content),
    //   raw: extractRawJson(resp.content),
    //   object: tryParseJson(resp.content),
    //   finishReason: resp.stop_reason ?? undefined,
    //   usage: { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens },
    //   toolCalls: extractToolCalls(resp.content),
    // };

    throw new HttpException({ code: 'AI_PROVIDER_NOT_IMPLEMENTED', provider: 'anthropic' }, 500);
  }

  private async invokeOpenAI(
    endpoint: ModelEndpointEntry,
    request: AiInvocationRequest,
    apiKey: string,
  ): Promise<AiInvocationResult> {
    // npm i openai
    // import OpenAI from 'openai';
    // const client = new OpenAI({ apiKey, baseURL: endpoint.endpoint });
    //
    // if (request.agent) return runOpenAIAgentLoop(client, endpoint, request);
    //
    // const resp = await client.chat.completions.create({
    //   model: endpoint.model,
    //   messages: toOpenAIMessages(request.messages),
    //   tools: request.tools?.map(toOpenAITool),
    //   tool_choice: toOpenAIToolChoice(request.toolChoice),
    //   temperature: request.inferenceParameters?.temperature ?? endpoint.defaults?.temperature,
    //   max_tokens: request.inferenceParameters?.maxTokens ?? endpoint.defaults?.maxTokens,
    //   response_format:
    //     request.responseFormat?.kind === 'json'
    //       ? { type: 'json_object' }
    //       : request.responseFormat?.kind === 'structuredObject' && request.responseFormat.schema
    //         ? { type: 'json_schema', json_schema: { name: 'Output', schema: request.responseFormat.schema, strict: true } }
    //         : undefined,
    // });
    //
    // const choice = resp.choices[0];
    // return {
    //   text: choice.message.content ?? undefined,
    //   raw: choice.message.content ?? undefined,
    //   object: tryParseJson(choice.message.content),
    //   finishReason: choice.finish_reason,
    //   usage: { inputTokens: resp.usage?.prompt_tokens, outputTokens: resp.usage?.completion_tokens },
    //   toolCalls: choice.message.tool_calls?.map(tc => ({
    //     id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments),
    //   })),
    // };

    throw new HttpException({ code: 'AI_PROVIDER_NOT_IMPLEMENTED', provider: 'openai' }, 500);
  }

  private async invokeGoogle(
    endpoint: ModelEndpointEntry,
    request: AiInvocationRequest,
    apiKey: string,
  ): Promise<AiInvocationResult> {
    // npm i @google/generative-ai
    // import { GoogleGenerativeAI } from '@google/generative-ai';
    // const client = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: endpoint.model });
    //
    // const result = await client.generateContent({
    //   contents: toGoogleContents(request.messages),
    //   tools: request.tools && [{ functionDeclarations: request.tools.map(toGoogleTool) }],
    //   generationConfig: {
    //     temperature: request.inferenceParameters?.temperature ?? endpoint.defaults?.temperature,
    //     maxOutputTokens: request.inferenceParameters?.maxTokens ?? endpoint.defaults?.maxTokens,
    //     responseMimeType: request.responseFormat?.kind === 'structuredObject' ? 'application/json' : undefined,
    //     responseSchema: request.responseFormat?.schema,
    //   },
    // });
    // ... (略)

    throw new HttpException({ code: 'AI_PROVIDER_NOT_IMPLEMENTED', provider: 'google' }, 500);
  }

  private async invokeBedrock(
    endpoint: ModelEndpointEntry,
    request: AiInvocationRequest,
  ): Promise<AiInvocationResult> {
    // npm i @aws-sdk/client-bedrock-runtime
    // import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
    // const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
    //   ↑ IAM role は AWS SDK の credential chain で自動解決 (apiKey 不要)
    // ... (略、Anthropic on Bedrock の場合は messages API 形式が利用可)

    throw new HttpException({ code: 'AI_PROVIDER_NOT_IMPLEMENTED', provider: 'aws-bedrock' }, 500);
  }

  private async invokeAzureOpenAI(
    endpoint: ModelEndpointEntry,
    request: AiInvocationRequest,
    apiKey: string | undefined,
  ): Promise<AiInvocationResult> {
    // npm i openai (Azure 互換 client) + (azureAd 時) @azure/identity
    // import { AzureOpenAI } from 'openai';
    // import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
    //
    // const isAzureAd = endpoint.auth.kind === 'azureAd';
    // const client = new AzureOpenAI({
    //   endpoint: endpoint.endpoint,
    //   deployment: endpoint.model,
    //   apiVersion: '2024-10-21',
    //   ...(isAzureAd
    //     ? { azureADTokenProvider: getBearerTokenProvider(
    //         new DefaultAzureCredential(),
    //         'https://cognitiveservices.azure.com/.default',
    //       ) }
    //     : { apiKey }),
    // });
    // ... (略、OpenAI と同形)

    throw new HttpException({ code: 'AI_PROVIDER_NOT_IMPLEMENTED', provider: 'azure-openai' }, 500);
  }

  private async invokeOllama(
    endpoint: ModelEndpointEntry,
    request: AiInvocationRequest,
  ): Promise<AiInvocationResult> {
    // ローカル Ollama (auth.kind='none' 想定、endpoint='http://localhost:11434' 等)
    // const url = `${endpoint.endpoint ?? 'http://localhost:11434'}/api/chat`;
    // const resp = await fetch(url, {
    //   method: 'POST',
    //   headers: { 'content-type': 'application/json' },
    //   body: JSON.stringify({
    //     model: endpoint.model,
    //     messages: toOllamaMessages(request.messages),
    //     stream: request.responseFormat?.kind === 'streaming',
    //     format: request.responseFormat?.kind === 'json' || request.responseFormat?.kind === 'structuredObject' ? 'json' : undefined,
    //     options: {
    //       temperature: request.inferenceParameters?.temperature ?? endpoint.defaults?.temperature,
    //       num_predict: request.inferenceParameters?.maxTokens ?? endpoint.defaults?.maxTokens,
    //     },
    //   }),
    // });
    // ... (略)

    throw new HttpException({ code: 'AI_PROVIDER_NOT_IMPLEMENTED', provider: 'ollama' }, 500);
  }

  private async invokeCustomProvider(
    endpoint: ModelEndpointEntry,
    request: AiInvocationRequest,
    apiKey: string | undefined,
  ): Promise<AiInvocationResult> {
    // namespace:custom (例: 'acme:chatbot') 用の拡張ポイント。
    // CustomAiProviderRegistry を inject して registry.dispatch(endpoint.provider, ...) する設計を推奨。
    throw new HttpException(
      { code: 'AI_PROVIDER_NOT_IMPLEMENTED', provider: endpoint.provider },
      500,
    );
  }
}
```

## ai.module.ts

```typescript
import { Module } from '@nestjs/common';
import { AiRuntimeService, AI_CATALOG_PROVIDER } from './ai-runtime.service';
import { AiCatalogService } from './ai-catalog.service'; // catalog 解決を担当

@Module({
  providers: [
    AiRuntimeService,
    { provide: AI_CATALOG_PROVIDER, useClass: AiCatalogService },
  ],
  exports: [AiRuntimeService],
})
export class AiModule {}
```

`AiCatalogService` は `harmony.json` (project level) と各 ProcessFlow JSON (flow level)
の `context.catalogs.modelEndpoints` を merge してメモリにロードする。実装方針:

1. ビルド時 (script) に `examples/<project>/harmony/catalogs/external.json` と
   全 ProcessFlow の `context.catalogs.modelEndpoints` を merge した JSON を `dist/ai-catalogs.json` に書き出す
2. ランタイムで `AiCatalogService` が `dist/ai-catalogs.json` を読む
3. `secrets.json` は同様に merge し、`source=env` の場合は実 env の値を `process.env[name]` から都度参照

## ProcessFlow step → 業務 Service のコード生成

業務 Service の constructor に `private readonly aiRuntime: AiRuntimeService` を追加し、
`step.kind=aiCall|aiAgent` を以下のパターンで展開する。

### aiCall (single-shot)

```typescript
// ProcessFlow step:
//   { id: "step-03", kind: "aiCall", modelRef: "tagSuggestModel",
//     messages: [
//       { role: "system", content: "あなたはタグを提案する..." },
//       { role: "user",   content: "@inputs.title\n\n@inputs.body" }
//     ],
//     responseFormat: { kind: "structuredObject", schema: { ... } },
//     outputBinding: { name: "aiResponse" } }
//
// 生成パターン:
const aiResponse = await this.aiRuntime.invoke({
  modelRef: 'tagSuggestModel',
  messages: [
    { role: 'system', content: 'あなたはタグを提案する...' },
    { role: 'user', content: `${dto.title}\n\n${dto.body}` },
  ],
  responseFormat: {
    kind: 'structuredObject',
    schema: { /* responseFormat.schema をそのまま埋め込み */ },
  },
});

// 後続 compute step は @aiResponse.object.tags を直接参照:
const candidates = (aiResponse.object as { tags: TagCandidate[] }).tags
  .filter(t => t.confidence >= TAG_SUGGEST_THRESHOLD)
  .map(t => ({ ...t, isNew: !existingSlugs.includes(t.slug) }));
```

### aiAgent (tool use loop)

```typescript
// ProcessFlow step (schema: AiAgentStep):
//   { id: "step-05", kind: "aiAgent", modelRef: "researchAgent",
//     messages: [...],
//     tools: [
//       { name: "searchWeb", schema: {...} },
//       { name: "fetchUrl",  schema: {...} },
//     ],
//     toolChoice: "auto",        // schema: oneOf [string enum, {name}]、本例は string 形式
//     maxIterations: 8,          // schema: AiAgentStep 直下の integer (default 10)
//     outputBinding: { name: "agentResult" } }
//
// 生成パターン: tool 実行関数を toolRunner として渡す
// runtime invocation 側 (内部 type): step.maxIterations を agent.maxIterations に詰め直し、
// step.toolChoice (schema oneOf) を runtime 用の {mode, toolName?} に正規化して渡す
const agentResult = await this.aiRuntime.invoke({
  modelRef: 'researchAgent',
  messages: [...],
  tools: [
    { name: 'searchWeb', schema: { /* ... */ } },
    { name: 'fetchUrl',  schema: { /* ... */ } },
  ],
  toolChoice: { mode: 'auto' },   // step.toolChoice="auto" を runtime 表現に変換
  agent: {
    maxIterations: 8,             // step.maxIterations から渡す (step 直下、schema 準拠)
    toolRunner: async (call) => {
      switch (call.name) {
        case 'searchWeb': return this.searchWebTool.run(call.arguments);
        case 'fetchUrl':  return this.fetchUrlTool.run(call.arguments);
        default: throw new Error(`Unknown tool: ${call.name}`);
      }
    },
  },
});
// agentResult.text — 最終 assistant text
// agentResult.toolCalls — 最後の turn で発行された tool call (履歴ではない)
```

### responseFormat 別の後続 step 参照

| responseFormat.kind | outputBinding 参照例 | 説明 |
|---|---|---|
| `text` (default) | `aiResponse.text` | 文字列としてそのまま |
| `json` | `aiResponse.object` / `aiResponse.raw` | runtime が JSON parse 済 |
| `structuredObject` | `aiResponse.object.<field>` | schema 準拠で型注釈推論可 |
| `streaming` | `aiResponse.text` (assembled) | partial chunks は本層で扱わない |

### AiMessageSpread (英会話 96118ae1 等)

```typescript
// step.messages:
//   [
//     { role: "system", content: "..." },
//     { kind: "spread", ref: "@turnContext", description: "過去 N turns" },
//     { role: "user", content: "@inputs.userInput" }
//   ]
//
// 生成パターン: ref 解決後にフラット化
const turnContext = JSON.parse(dto.turnContext) as AiMessage[]; // または DB 由来
const messages: AiMessage[] = [
  { role: 'system', content: '...' },
  ...turnContext,
  { role: 'user', content: dto.userInput },
];
const aiResponse = await this.aiRuntime.invoke({ modelRef: 'dialogModel', messages });
```

### AiImageSource (vision、diary b0c1d2e3 等)

```typescript
// step.messages[1].content[0] = { type: "image", source: { kind: "url", url: "@targetImageUrl" } }
const imageUrl = photoRow?.url ?? dto.imageUrl; // step-04 (compute) で算出した変数
const aiResponse = await this.aiRuntime.invoke({
  modelRef: 'altTextModel',
  messages: [
    { role: 'user', content: [
      { type: 'text', text: 'この画像の alt テキストを日本語で生成してください。' },
      { type: 'image', source: { kind: 'url', url: imageUrl } },
    ]},
  ],
});
```

`source.kind` 別の生成パターン:

- `url` (literal) → `source: { kind: 'url', url: 'https://...' }` (リテラル埋め込み)
- `url` (expression `@<var>`) → 上記のように変数参照
- `fileRef` → multipart upload 等で受けた Buffer を `source: { kind: 'base64', data, mediaType }` に変換
- `base64` → `source: { kind: 'base64', data: dto.imageBase64, mediaType: 'image/jpeg' }`

## outcomes.failure の Service 側ハンドリング

`AiRuntimeService.invoke()` が `HttpException(502)` を throw するため、業務 Service は
**何も catch しなければ outcomes.failure.action="abort" の挙動になる** (NestJS が exception filter で
502 をそのままレスポンス化)。

`outcomes.failure.action` 別の追加パターン (schema enum: `continue` / `abort` / `compensate`):

| action | 業務 Service 側の処理 |
|---|---|
| `abort` (default) | 何もしない (502 がそのまま伝搬) |
| `continue` | `try { ... } catch (e) { ... }` で吸収 + alternative path の step を実行 |
| `compensate` | catch + 補償 step (`sideEffects[]`) を実行。TX 内なら DB rollback を併用 |

`jumpTo` は `action` の値ではなく **補助フィールド** (LocalId、任意文字列)。`continue` / `compensate` と
**併用** して「失敗時にこの step に goto」を表現する。LocalId は連番でないため命名規約推測は不可 —
codegen は **`Map<LocalId, generatedMethodName>`** を保持して dispatch する。生成パターン:

```typescript
// codegen が以下のような dispatch table を生成 (各 step に対し 1 method)
private async dispatchStep(stepId: string, ctx: StepCtx): Promise<unknown> {
  switch (stepId) {
    case 'step-09': return this.runStepStep09(ctx);   // step.id → method 名は codegen 内 Map で解決
    case 'tx-recover': return this.runStepTxRecover(ctx);
    // ...
    default: throw new Error(`Unknown step id: ${stepId}`);
  }
}

try {
  const aiResponse = await this.aiRuntime.invoke({ ... });
} catch (e) {
  if (e instanceof HttpException && e.getStatus() === 502) {
    // outcomes.failure: { action: 'continue', jumpTo: 'step-09' }
    return await this.dispatchStep('step-09', ctx);
  }
  throw e;
}
```

`catalog.errors[<code>].responseId` → `action.responses[responseId].status` で別 status を返す場合:

```typescript
try {
  const aiResponse = await this.aiRuntime.invoke({ ... });
} catch (e) {
  if (e instanceof HttpException && e.getStatus() === 502) {
    // step.outcomes.failure → catalog.errors.AI_API_ERROR.responseId="502-ai-error"
    //   → responses["502-ai-error"].status=502, body={code:"AI_API_ERROR", ...}
    throw new HttpException({ code: 'AI_API_ERROR', message: '...' }, 502);
  }
  throw e;
}
```

## smoke 検証 (ProcessFlow 側ヒント)

生成 backend の AI flow に対する手動 smoke は `/generate-tests` Phase 2-B で生成された
`<flowName>.e2e-spec.ts` を実行する (mock mode は AI key 不要、live mode は
`RUN_AI_INTEGRATION=1 <ENV>=<key> npx jest ...`)。

## 制約

- `AiRuntimeService.invoke()` の **method 名 / 戻り値 interface は変更不可** (`/generate-tests` mock helper が前提)
- 単一 method 設計: aiCall / aiAgent は `request.agent` field の有無で分岐 (method 分離禁止)
- provider 切替は **catalog 編集だけで完結** (業務 Service コードは変更しない)
- secrets はビルド時には読まず、ランタイムで `process.env` から都度参照 (image build 時に key を漏らさない)
