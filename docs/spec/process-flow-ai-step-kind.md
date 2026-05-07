# ProcessFlow AI Step Kind (#935)

**初版: 2026-05-08**

## 目的

業務アプリにおける LLM / AI agent 呼び出しを ProcessFlow の **一級概念** として表現する。Anthropic / OpenAI / Google / AWS Bedrock / Ollama / Azure OpenAI の現代的 AI provider を、step 側に provider 直書きせず catalog 経由で抽象化する。tool use / structured output / vision input / agent loop を業界標準形式で扱う。

## 背景

ProcessFlow には従来 AI 呼び出し専用の step kind が無く、各 sample がアドホックに表現していた:

| sample | 表現方法 | 限界 |
|---|---|---|
| `examples/diary` | `externalSystem` step + `catalogs.externalSystems.claudeApi` (Anthropic 固有) | provider 直書き、provider 切替は catalog 全体の書換必要、tool use / structured output が semantic に表現できない |
| `examples/english-learning` | `english-learning:LlmDialog` namespace 拡張 stepKind (extensions/english-learning.v3.json) | namespace ごとに同じ概念を再発明、core 標準化されておらず、業界共通の tool / response_format 構造を持てない |

N=2 で表現方法が分裂しており、放置すると後続 sample (CRM / EC / 製造業 etc.) が独自表現を作り、移行コストが指数的に増える。リリース前のため breaking change / migration コストが発生しないタイミングで core 標準化する (#935 設計者承認 2026-05-08)。

## 業界共通パターン (採用根拠)

公式 doc 調査結果 (Azure AI Foundry Prompt Flow / Dify Workflow / LangChain LCEL / OpenAI Responses / Anthropic Messages / AWS Bedrock Agents / Camunda BPMN AI Connectors) より:

1. **modality 別分割は少数派** — ほぼ全プラットフォームが「LLM 呼び出し」を 1 概念で扱い、画像/音声は messages 内 content block か別 endpoint
2. **single-shot vs agent loop の 2 分は普遍** — Camunda (Task vs Sub-process) / OpenAI (Responses vs Conversations) / LangGraph
3. **provider 切替は connection / endpoint catalog 型** — 個別 step に provider 直書きせず参照キーで間接化
4. **tool は array of `{name, description, parameters: JSON Schema}`** が事実上の標準
5. **structured output は JSON Schema で response_format / schema として宣言**

→ 上記 5 パターンに準拠した設計を採用する。

## 採用設計

### Step kinds (2 種類)

| kind | 用途 | 業界対応 |
|---|---|---|
| `aiCall` | single-shot LLM 呼び出し (text + vision multimodal + tool use + structured output) | OpenAI Responses / Anthropic Messages / Camunda AI Agent Task |
| `aiAgent` | multi-step agent loop (`maxIterations` 制御、tool call 連鎖) | LangGraph / Camunda AI Agent Sub-process / OpenAI Conversations |

`aiCall` は tool 結果を後続 step (compute / dbAccess) で評価する用途、`aiAgent` は LLM 自身が tool 結果を見て次の tool を選ぶ自律 loop。tool が無い単発呼び出しは `aiCall` を使う。

### catalog: `context.catalogs.modelEndpoints`

```json
"modelEndpoints": {
  "summarizeModel": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "endpoint": "https://api.anthropic.com",
    "auth": { "kind": "bearer", "tokenRef": "@secret.anthropicApiKey" },
    "defaults": { "temperature": 0.7, "maxTokens": 1024 },
    "fallback": "summarizeModelFallback"
  }
}
```

- **provider** (enum): `anthropic` / `openai` / `google` / `aws-bedrock` / `ollama` / `azure-openai` または拡張 `namespace:provider` 形式
- **model**: provider 固有のモデル ID
- **endpoint**: API base URL (省略時は provider のデフォルト、Ollama / 自前 BYO endpoint で必須)
- **auth**: `ExternalAuth` (kind: bearer / basic / apiKey / oauth2 / iamRole / azureAd / none、tokenRef は `@secret.<key>` 参照)
- **defaults**: temperature / maxTokens 等のデフォルト推論パラメータ (step 側 parameters で override)
- **fallback**: プライマリ失敗時の fallback endpoint key (推奨: 別 provider)

### `AiCallStep` の field

| field | 型 | 必須 | 説明 |
|---|---|---|---|
| `kind` | `"aiCall"` | ✓ | const |
| `modelRef` | Identifier | ✓ | `modelEndpoints` のキー参照 |
| `messages` | `AiMessage[]` (minItems=1) | ✓ | system / user / assistant の role 別 |
| `tools` | `AiToolRef[]` | | LLM に提供する tool 群 |
| `toolChoice` | `auto` / `any` / `none` / `{name}` | | tool 選択戦略 |
| `responseFormat` | `AiResponseFormat` | | text / json / structuredObject (JSON Schema) / streaming |
| `parameters` | `AiInferenceParameters` | | modelEndpoint.defaults を override |
| `outputBinding` | from `StepBaseProps` | | LLM 応答全体を変数に bind |
| `outcomes` | `ExternalCallOutcomes` | | 失敗 / timeout 時の挙動 (既存パターン流用) |

### `AiAgentStep` の field

`AiCallStep` の上位互換。差分のみ:
- `tools` が **必須** (`minItems=1`、tool なしなら `aiCall` を使う)
- `maxIterations` (integer, default 10) で tool call ループ上限を指定

### `AiMessage.content`

`string` (シンプルテキスト) または content blocks 配列 (text / image)。Anthropic / OpenAI と整合。

```json
{ "role": "user", "content": "本文を要約してください: @inputs.body" }
```

```json
{ "role": "user", "content": [
  { "type": "text", "text": "この画像の alt を生成してください。" },
  { "type": "image", "source": { "kind": "fileRef", "ref": "@inputs.photo" } }
]}
```

`image.source` は 3 形式: `fileRef` (推奨、ScreenItem type=file / step output 参照) / `url` / `base64` (test fixture 等限定)。

### `AiToolRef`

```json
{ "kind": "functionRef", "ref": "lookupGlossary" }
```

または

```json
{ "kind": "inline", "name": "suggestTag", "description": "...", "parameters": { ... JSON Schema ... } }
```

`functionRef` は `context.catalogs.functions` の既存 entry を再利用 (DRY)。`inline` はアドホック使用。

### `AiResponseFormat`

| kind | 追加 field | 説明 |
|---|---|---|
| `text` | (なし) | デフォルト、自由テキスト。`kind` 以外の field は不可 (`additionalProperties: false`) |
| `json` | `description?` | free-form JSON、parse のみ (schema 制約なし) |
| `structuredObject` | `schema` (必須) + `name?` | JSON Schema 準拠の構造化出力 (Anthropic / OpenAI / Dify 共通) |
| `streaming` | `description?` | SSE / WebSocket、partial response |

各 variant は schema で `additionalProperties: false`。`text` は `kind` のみ、他 variant も列挙された field 以外は不可。

## 使用例

### 1. シンプル要約 (text)

```json
{
  "id": "step-summarize",
  "kind": "aiCall",
  "description": "本文を 3-5 文で要約する",
  "modelRef": "summarizeModel",
  "messages": [
    { "role": "system", "content": "あなたは日本語要約の専門家です。" },
    { "role": "user", "content": "@inputs.body" }
  ],
  "outputBinding": { "name": "summaryResponse" }
}
```

### 2. structured output (タグ提案)

```json
{
  "id": "step-suggest",
  "kind": "aiCall",
  "description": "本文からタグ候補を構造化出力する",
  "modelRef": "tagSuggestModel",
  "messages": [{ "role": "user", "content": "@inputs.body" }],
  "responseFormat": {
    "kind": "structuredObject",
    "name": "TagSuggestResult",
    "schema": {
      "type": "object",
      "properties": {
        "tags": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
            },
            "required": ["name", "confidence"]
          }
        }
      },
      "required": ["tags"]
    }
  },
  "outputBinding": { "name": "tagsResponse" }
}
```

### 3. vision input (画像 alt 生成)

```json
{
  "id": "step-alt",
  "kind": "aiCall",
  "description": "写真の alt text を生成する",
  "modelRef": "altTextModel",
  "messages": [
    { "role": "user", "content": [
      { "type": "text", "text": "この画像の alt テキストを 40-100 字で生成してください。" },
      { "type": "image", "source": { "kind": "fileRef", "ref": "@inputs.photo" } }
    ] }
  ],
  "outputBinding": { "name": "altResponse" }
}
```

### 4. agent loop (顧客サポート)

```json
{
  "id": "step-agent",
  "kind": "aiAgent",
  "description": "顧客問い合わせを agent loop で解決する",
  "modelRef": "supportAgent",
  "messages": [
    { "role": "system", "content": "あなたはサポートエージェントです。" },
    { "role": "user", "content": "@inputs.query" }
  ],
  "tools": [
    { "kind": "functionRef", "ref": "searchKnowledgeBase" },
    { "kind": "functionRef", "ref": "createTicket" },
    { "kind": "functionRef", "ref": "escalateToHuman" }
  ],
  "maxIterations": 5,
  "outputBinding": { "name": "agentResult" }
}
```

## provider 切替の運用

`modelEndpoints` catalog で `provider` / `model` / `endpoint` / `auth` を **1 か所に集約** することで、provider 切替は catalog の編集だけで完結する。step 側は `modelRef` のキー参照のみで provider 非依存。

env 切替の典型:

```json
"modelEndpoints": {
  "summarizeModel": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "auth": { "kind": "bearer", "tokenRef": "@secret.anthropicApiKey" }
  }
}
```

別環境では同 endpoint key を別 provider で再定義 (例: ローカル開発で Ollama に切替):

```json
"modelEndpoints": {
  "summarizeModel": {
    "provider": "ollama",
    "model": "llama3.1:70b",
    "endpoint": "http://localhost:11434",
    "auth": { "kind": "none" }
  }
}
```

## ドメイン固有 AI 機能 (TTS / STT / Embedding / ImageGen) との関係

本 spec は **LLM 呼び出し (text + vision + tool use)** の core 標準化に絞る。TTS (Text-to-Speech) / STT (Speech-to-Text) / Embedding / ImageGen は別 endpoint で別概念のため、当面は以下のいずれかで対応:

1. **namespace 拡張 stepKind**: `examples/english-learning` の `english-learning:TtsGenerate` / `:SttEvaluate` のように、業界別の namespace 拡張で表現
2. **将来 core 化**: 業務アプリ横断の汎用ニーズが見えた時点 (N=3+ で複数 sample が同じ概念を再発明している状況) で `aiTts` / `aiStt` / `aiEmbedding` / `aiImageGen` を core に追加する候補

英語学習 sample の domain 固有 fieldType (`cefrLevel` / `ipa` / `audioUrl` / `pronunciationScore` / `dialogTurn`) は業務ドメイン固有のため namespace 拡張に残す (core 化対象外)。

## 既存表現からの移行 (Phase 2、別 PR)

本 spec を含む PR (Phase 1) は schema 改変 + spec + test fixture のみ。既存 sample (diary AI 4 flow + english-learning AI 3 flow) の `aiCall` / `aiAgent` への書き換えは **別セッションで Phase 2 として実施** する。Phase 2 完了時に:

- `examples/diary` の `externalSystem` step + `catalogs.externalSystems.claudeApi` を `aiCall` + `catalogs.modelEndpoints.<key>` に移行
- `examples/english-learning` の `english-learning:LlmDialog` を `aiAgent` (multi-turn) に移行
- `examples/english-learning/harmony/extensions/english-learning.v3.json` から `LlmDialog` stepKind 定義を削除 (`TtsGenerate` / `SttEvaluate` は当面残す)
- `/generate-tests` skill の AI flow 検出ロジックを **`kind=aiCall|aiAgent`** に対応させる (現状 `kind=externalSystem` + `systemRef=claudeApi` 等の旧パターン検出のままだと、Phase 2 移行後の sample で AI flow が検出されず、生成テストが旧 fixture 期待のままになる)
- `/generate-code` skill のテンプレート (`templates/backend/typescript-nestjs/` / `templates/backend/java-spring-boot/`) に `aiCall` / `aiAgent` step の SDK 切替コード生成ロジックを追加 (現状 `SKILL.md` の step kind table に方針記述のみで、テンプレート本体は未対応)

## 関連

- 起票元 ISSUE: #935 (本 spec)
- supersede: #865 (examples/diary AI provider 抽象化、本 spec が正規解決策)
- 連動: #867 (Codex App Server BYOS、Harmony 本体側 AI 統合 — 別レイヤー)
- supersede memory: `project_phase2_modelEndpoint_rfc_2026_05_07.md` (RFC 起票方針 → 即実施に変更)
- 上位 memory: `project_ai_step_kind_core_2026_05_08.md`
