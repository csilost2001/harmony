# Java Spring Boot — AI Runtime Service テンプレート (Phase 2-C)

ProcessFlow に `kind ∈ {aiCall, aiAgent}` の step が含まれる場合、生成 backend には
`AiRuntimeService` クラスを 1 つ追加する。各 `@Service` は本クラスを inject して
`invoke()` だけを呼ぶ (provider 別 SDK 差は本クラス内に閉じ込める)。

> **設計原則** (typescript-nestjs 版と共通):
> - 業務 Service は **provider 中立** (`modelRef` だけを参照、SDK 名は出てこない)
> - provider / model / auth は `context.catalogs.modelEndpoints` で解決 (catalog 編集だけで切替)
> - 戻り値は spec `docs/spec/process-flow-ai-step-kind.md` §「outputBinding の値構造」に従う **正規化形式**
> - method 名 `invoke` / 引数 `AiInvocationRequest` / 戻り値 `AiInvocationResult` は固定契約

## 推奨 SDK 選択

Java Spring Boot では以下 2 系統が候補。**default は Spring AI** (Spring 公式統合、
`spring-ai-bom` で provider を依存切替)。複雑な agent loop / vector store / RAG が要件なら
`langchain4j` 併用 (本テンプレートは依存追加方法のみ示す)。

| 用途 | 推奨 SDK | 備考 |
|---|---|---|
| 単純な aiCall (text / json / structuredObject) | `spring-ai-starter-model-{anthropic,openai,bedrock-converse,vertexai-gemini,azure-openai,ollama}` (1.0.0 GA 以降の新 naming) | provider ごとに starter を切替、`ChatClient` 抽象化 |
| aiAgent (tool use loop) | `spring-ai-*` の `ChatClient` + `tools()` | maxIterations は手書きで loop |
| 高度な agent / memory / RAG | `langchain4j` | OptIn、追加依存が必要 |

provider が `aws-bedrock` の場合は **Spring AI Bedrock starter** を使うと IAM role 認証が
AWS SDK の credential chain で自動解決される。`anthropic` 直接 (Anthropic API) と
`aws-bedrock + Anthropic model` は別 modelEndpoint key として catalog に書き分ける。

## 出力ファイル

```
<出力先>/src/main/java/com/example/<projectName>/ai/
  AiRuntimeService.java         — provider 中立 service (本テンプレート)
  AiInvocationRequest.java      — 入力 record
  AiInvocationResult.java       — 出力 record
  AiMessage.java / AiContentBlock.java / AiImageSource.java — 値オブジェクト群
  AiResponseFormat.java / AiToolRef.java / AiToolChoice.java
  AiInferenceParameters.java
  ModelEndpointEntry.java / SecretEntry.java
  AiCatalogProvider.java        — catalog 解決 interface
  AiCatalogService.java         — harmony.json + ProcessFlow merge 実装
  provider/
    AnthropicAiProvider.java     — provider 別実装 (利用 provider のみ)
    OpenAiAiProvider.java
    BedrockAiProvider.java
    AzureOpenAiAiProvider.java
    GoogleAiProvider.java
    OllamaAiProvider.java
```

## AiRuntimeService の実装

```java
package com.example.{{project.meta.name | camelCase}}.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion.VersionFlag;
import com.networknt.schema.ValidationMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
@Slf4j
public class AiRuntimeService {

    private final AiCatalogProvider catalogs;
    private final Map<String, AiProvider> providers; // bean name = provider key (anthropic, openai, ...)
    private final ObjectMapper objectMapper;

    // schema map (System.identityHashCode キー) → コンパイル済 JsonSchema をキャッシュ
    private final Map<Integer, JsonSchema> validatorCache = new ConcurrentHashMap<>();
    private final JsonSchemaFactory schemaFactory =
            JsonSchemaFactory.getInstance(VersionFlag.V202012);

    /**
     * provider 中立の AI 呼び出し。
     *
     * spec: docs/spec/process-flow-ai-step-kind.md §「outputBinding の値構造」
     */
    public AiInvocationResult invoke(AiInvocationRequest request) {
        ModelEndpointEntry endpoint = catalogs.resolveModelEndpoint(request.modelRef())
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.INTERNAL_SERVER_ERROR,
                        "modelRef=" + request.modelRef() + " が catalog に存在しません"));

        // AI-2: secret 必須 provider で env 未設定なら 503 fail-fast
        String apiKey = resolveApiKey(endpoint);
        if (requiresApiKey(endpoint) && (apiKey == null || apiKey.isBlank())) {
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "AI provider credentials not configured (env="
                            + resolveSecretEnvName(endpoint) + ")");
        }

        try {
            AiProvider provider = resolveProvider(endpoint.provider());
            AiInvocationResult raw = provider.invoke(endpoint, request, apiKey);
            // AI-3: responseFormat=json|structuredObject の検証
            return normalizeAndValidate(raw, request.responseFormat());
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            log.error("AI provider call failed (modelRef={})", request.modelRef(), e);
            // AI-4: outcomes.failure へ伝搬される 502
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "AI_API_ERROR: " + e.getMessage(),
                    e);
        }
    }

    private boolean requiresApiKey(ModelEndpointEntry endpoint) {
        return endpoint.auth().kind().equals("bearer") || endpoint.auth().kind().equals("apiKey");
    }

    private String resolveApiKey(ModelEndpointEntry endpoint) {
        String envName = resolveSecretEnvName(endpoint);
        return envName == null ? null : System.getenv(envName);
    }

    private String resolveSecretEnvName(ModelEndpointEntry endpoint) {
        String ref = endpoint.auth().tokenRef();
        if (ref == null || !ref.startsWith("@secret.")) return null;
        String key = ref.substring("@secret.".length());
        return catalogs.resolveSecret(key)
                .filter(s -> "env".equals(s.source()))
                .map(SecretEntry::name)
                .orElse(null);
    }

    private AiProvider resolveProvider(String providerKey) {
        AiProvider p = providers.get(providerKey);
        if (p != null) return p;
        if (providerKey.contains(":")) {
            // namespace:custom — 拡張ポイント。CustomAiProviderRegistry を別途定義する設計を推奨。
            throw new ResponseStatusException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "Custom provider not implemented: " + providerKey);
        }
        throw new ResponseStatusException(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "Unsupported provider: " + providerKey);
    }

    private AiInvocationResult normalizeAndValidate(
            AiInvocationResult raw, AiResponseFormat responseFormat) throws Exception {
        String kind = responseFormat == null ? "text" : responseFormat.kind();
        if (kind.equals("text") || kind.equals("streaming")) return raw;

        // json / structuredObject: object が無ければ raw を JSON.parse
        Object obj = raw.object();
        if (obj == null && raw.raw() != null) {
            try {
                obj = objectMapper.readValue(raw.raw(), Object.class);
                raw = raw.withObject(obj);
            } catch (Exception e) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "AI_RESPONSE_FORMAT_VIOLATION: invalid JSON",
                        e);
            }
        }

        if (kind.equals("structuredObject") && responseFormat.schema() != null) {
            JsonSchema validator = validatorCache.computeIfAbsent(
                    System.identityHashCode(responseFormat.schema()),
                    k -> schemaFactory.getSchema(objectMapper.valueToTree(responseFormat.schema())));
            JsonNode node = objectMapper.valueToTree(obj);
            Set<ValidationMessage> errors = validator.validate(node);
            if (!errors.isEmpty()) {
                log.warn("AI_RESPONSE_FORMAT_VIOLATION: {}", errors);
                throw new ResponseStatusException(
                        HttpStatus.BAD_GATEWAY,
                        "AI_RESPONSE_FORMAT_VIOLATION: AI response does not satisfy declared responseFormat.schema");
            }
        }
        return raw;
    }
}
```

## AiProvider interface (provider 別実装)

```java
package com.example.{{project.meta.name | camelCase}}.ai;

public interface AiProvider {
    /**
     * provider 別 SDK で実 API を呼び出す。失敗時は実装内で例外を throw すれば
     * AiRuntimeService が AI_API_ERROR / 502 に集約する。
     */
    AiInvocationResult invoke(
            ModelEndpointEntry endpoint,
            AiInvocationRequest request,
            String apiKey);
}
```

provider 別実装は **利用する provider のみ Bean 化** する (未使用は generate しない)。
Bean 名 = provider 文字列 (`anthropic`, `openai`, ...) にして `Map<String, AiProvider>` の
auto-wiring を機能させる。

### provider/AnthropicAiProvider.java (Spring AI 例)

```java
package com.example.{{project.meta.name | camelCase}}.ai.provider;

// build.gradle: implementation 'org.springframework.ai:spring-ai-starter-model-anthropic'
import com.example.{{project.meta.name | camelCase}}.ai.AiProvider;
// ...
import org.springframework.ai.anthropic.AnthropicChatModel;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;

@Component("anthropic")
public class AnthropicAiProvider implements AiProvider {

    @Override
    public AiInvocationResult invoke(
            ModelEndpointEntry endpoint,
            AiInvocationRequest request,
            String apiKey) {

        // ChatClient を endpoint.endpoint / model で構築 (アプリ起動時に @Bean 化しても良い)
        // var chatModel = AnthropicChatModel.builder()
        //     .anthropicApi(new AnthropicApi(endpoint.endpoint(), apiKey))
        //     .defaultOptions(AnthropicChatOptions.builder()
        //         .model(endpoint.model())
        //         .maxTokens(request.inferenceParameters() != null && request.inferenceParameters().maxTokens() != null
        //             ? request.inferenceParameters().maxTokens() : endpoint.defaults().maxTokens())
        //         .temperature(...)
        //         .build())
        //     .build();
        //
        // var prompt = new Prompt(toSpringAiMessages(request.messages()));
        // if (request.agent() != null) {
        //   return runAgentLoop(chatModel, prompt, request);
        // }
        // var response = chatModel.call(prompt);
        // var content = response.getResult().getOutput().getText();
        //
        // return AiInvocationResult.builder()
        //     .text(content)
        //     .raw(content)
        //     .object(tryParseJson(content))
        //     .finishReason(response.getResult().getMetadata().getFinishReason())
        //     .usage(toUsage(response.getMetadata().getUsage()))
        //     .toolCalls(extractToolCalls(response))
        //     .build();

        throw new UnsupportedOperationException("AnthropicAiProvider 未実装");
    }
}
```

### provider/OpenAiAiProvider.java

```java
// build.gradle: implementation 'org.springframework.ai:spring-ai-starter-model-openai'
@Component("openai")
public class OpenAiAiProvider implements AiProvider {
    // OpenAiChatModel + ChatClient で同様に実装
    // structuredObject は OpenAiChatOptions.builder().responseFormat(...) で json_schema を指定
}
```

### provider/BedrockAiProvider.java

```java
// build.gradle: implementation 'org.springframework.ai:spring-ai-starter-model-bedrock-converse'
@Component("aws-bedrock")
public class BedrockAiProvider implements AiProvider {
    // BedrockConverseChatModel を使うと provider 中立 (Anthropic / Meta / Mistral 全部叩ける)。
    // IAM role は AWS SDK の credential chain で自動解決 (apiKey 引数は無視してよい)。
}
```

### provider/AzureOpenAiAiProvider.java

```java
// build.gradle: implementation 'org.springframework.ai:spring-ai-starter-model-azure-openai'
@Component("azure-openai")
public class AzureOpenAiAiProvider implements AiProvider {
    // apiKey は endpoint.auth.kind="azureAd" の場合 null で渡される。
    // その場合は DefaultAzureCredentialBuilder().build() で TokenCredential を構築し、
    // AzureOpenAiChatModel.builder().tokenCredential(...) に渡す。
    //   if (apiKey == null && "azureAd".equals(endpoint.auth().kind())) { ... }
}
```

### provider/GoogleAiProvider.java

```java
// build.gradle: implementation 'org.springframework.ai:spring-ai-starter-model-vertexai-gemini'
@Component("google")
public class GoogleAiProvider implements AiProvider {
    // VertexAiGeminiChatModel
}
```

### provider/OllamaAiProvider.java

```java
// build.gradle: implementation 'org.springframework.ai:spring-ai-starter-model-ollama'
@Component("ollama")
public class OllamaAiProvider implements AiProvider {
    // ローカル Ollama 用、auth.kind='none' 想定
}
```

## record / DTO 定義 (Java 17 record + Lombok)

```java
public record AiInvocationRequest(
        String modelRef,
        java.util.List<AiMessage> messages,
        AiResponseFormat responseFormat,        // null 可 (省略時 text)
        java.util.List<AiToolRef> tools,        // null 可
        AiToolChoice toolChoice,                // null 可
        AiInferenceParameters inferenceParameters, // null 可
        AgentSpec agent                         // null 可 (aiAgent のみ)
) {
    public record AgentSpec(int maxIterations, AgentToolRunner toolRunner) {}
    @FunctionalInterface
    public interface AgentToolRunner {
        // callId は provider の tool_use ブロック ID。同一 turn で同名 tool が複数回呼ばれた際に
        // 各呼び出しを区別するために必要。NestJS 版 `(call: { id, name, arguments })` と一致。
        Object run(String callId, String name, Object arguments) throws Exception;
    }
}

public record AiInvocationResult(
        String text,
        Object object,
        String raw,
        String finishReason,
        Usage usage,
        java.util.List<ToolCall> toolCalls
) {
    public record Usage(Integer inputTokens, Integer outputTokens) {}
    public record ToolCall(String id, String name, Object arguments) {}

    public AiInvocationResult withObject(Object newObject) {
        return new AiInvocationResult(text, newObject, raw, finishReason, usage, toolCalls);
    }

    // builder は Lombok @Builder か手書きで
}

/**
 * runtime 用の正規化 message。ProcessFlow JSON 上の schema (`AiMessage.role`) は
 * `system | user | assistant` の 3 値のみ。`"tool"` は SDK 呼び出し後の会話ターン
 * (tool_use への返り値) を表す runtime 拡張で、aiAgent ループ内で AiRuntimeService が組み立てる。
 * 生成 ProcessFlow JSON で `role: "tool"` を書くことは無い。
 */
public record AiMessage(String role, Object content, String toolCallId, String name) {
    // content は String or List<AiContentBlock>
}

public record AiContentBlock(String type, String text, AiImageSource source,
                             ToolUseRef toolUse, ToolResultRef toolResult) {
    public record ToolUseRef(String id, String name, Object arguments) {}
    public record ToolResultRef(String toolCallId, Object result, Boolean isError) {}
}

/**
 * spec の `AiImageSource` (oneOf 3 形式) に対応する sealed interface。
 * field 名は schema の各 branch に正確に一致 (fileRef は `ref`、url は `url`、base64 は `data`+`mediaType`)。
 */
public sealed interface AiImageSource {
    record FileRef(String ref) implements AiImageSource {}                       // schema: ExpressionString (例: '@inputs.photo')
    record Url(String url) implements AiImageSource {}                           // schema: literal URI または ExpressionString
    record Base64(String data, String mediaType) implements AiImageSource {}
}

public record AiResponseFormat(String kind, java.util.Map<String, Object> schema) {}

/**
 * spec の `AiToolRef` (oneOf 2 形式) に対応する sealed interface。
 * functionRef は context.catalogs.functions[ref] を解決して provider 形式に変換、
 * inline は name/description/parameters をそのまま provider 形式へ詰め替える。
 */
public sealed interface AiToolRef {
    record FunctionRef(String ref) implements AiToolRef {}
    record Inline(String name, String description, java.util.Map<String, Object> parameters) implements AiToolRef {}
}

/**
 * runtime 用の正規化形式。ProcessFlow JSON 上の schema は
 *   AiToolChoice = oneOf [ string enum('auto'|'any'|'none'), { name: String } ]
 * の discriminated union のため、業務 Service 生成器側で詰め替える:
 *   "auto"  → new AiToolChoice("auto", null)
 *   "any"   → new AiToolChoice("any", null)
 *   "none"  → new AiToolChoice("none", null)
 *   {name:"X"} → new AiToolChoice("tool", "X")
 */
public record AiToolChoice(String mode, String toolName) {}

public record AiInferenceParameters(
        Double temperature, Integer maxTokens, Double topP, Integer topK,
        java.util.List<String> stopSequences) {}

public record ModelEndpointEntry(
        String provider, String model, String endpoint,
        AuthSpec auth, AiInferenceParameters defaults, String fallback) {
    public record AuthSpec(String kind, String tokenRef) {}
}

public record SecretEntry(String source, String name) {}

public interface AiCatalogProvider {
    java.util.Optional<ModelEndpointEntry> resolveModelEndpoint(String modelRef);
    java.util.Optional<SecretEntry> resolveSecret(String secretKey);
}
```

## ProcessFlow step → 業務 Service のコード生成

業務 `@Service` の constructor (Lombok `@RequiredArgsConstructor`) に `private final AiRuntimeService aiRuntime;`
を追加し、step.kind を以下のパターンで展開する。

### aiCall (single-shot)

```java
// ProcessFlow step:
//   { kind:"aiCall", modelRef:"tagSuggestModel",
//     messages:[ {role:"system",content:"..."}, {role:"user",content:"@inputs.title\n\n@inputs.body"} ],
//     responseFormat:{ kind:"structuredObject", schema:{...} },
//     outputBinding:{ name:"aiResponse" } }
//
// 生成パターン:
AiInvocationResult aiResponse = aiRuntime.invoke(new AiInvocationRequest(
        "tagSuggestModel",
        java.util.List.of(
                new AiMessage("system", "あなたはタグを提案する...", null, null),
                new AiMessage("user", request.title() + "\n\n" + request.body(), null, null)),
        new AiResponseFormat("structuredObject", /* schema map */),
        null, null,
        null, // catalog defaults を使う
        null  // aiAgent ではない
));

// 後続 compute step は aiResponse.object() を直接参照:
@SuppressWarnings("unchecked")
var tags = (java.util.List<java.util.Map<String, Object>>)
        ((java.util.Map<String, Object>) aiResponse.object()).get("tags");
var candidates = tags.stream()
        .filter(t -> ((Number) t.get("confidence")).doubleValue() >= TAG_SUGGEST_THRESHOLD)
        .toList();
```

### aiAgent (tool use loop)

```java
AiInvocationResult agentResult = aiRuntime.invoke(new AiInvocationRequest(
        "researchAgent",
        messages,
        null,
        java.util.List.of(
                new AiToolRef("searchWeb", "Web 検索", searchSchema),
                new AiToolRef("fetchUrl", "URL 取得", fetchSchema)),
        new AiToolChoice("auto", null),
        null,
        new AiInvocationRequest.AgentSpec(8, (callId, name, args) -> switch (name) {
            case "searchWeb" -> searchWebTool.run(args);
            case "fetchUrl" -> fetchUrlTool.run(args);
            default -> throw new IllegalArgumentException("Unknown tool: " + name);
        })
));
```

### responseFormat 別の outputBinding 参照

| responseFormat.kind | 参照例 |
|---|---|
| `text` (default) | `aiResponse.text()` |
| `json` | `aiResponse.object()` (Map<String,Object>) / `aiResponse.raw()` |
| `structuredObject` | キャストして field 参照 |
| `streaming` | `aiResponse.text()` (assembled) |

### AiMessageSpread / AiImageSource

typescript-nestjs 版 `AI_SERVICE.md` と同じ規約。`messages[]` 構築時に変数解決を行い、
flat な `List<AiMessage>` として `invoke()` に渡す。

## outcomes.failure の業務 Service 側ハンドリング

`AiRuntimeService.invoke()` が `ResponseStatusException(BAD_GATEWAY)` を throw するため、
業務 Service は **何も catch しなければ outcomes.failure.action="abort"** の挙動になる。

schema enum: `continue` / `abort` / `compensate` (3 値のみ)。

| outcomes.failure.action | 業務 Service 側の処理 |
|---|---|
| `abort` (default) | catch しない (502 がそのまま伝搬) |
| `continue` | `try/catch` で吸収 + 代替パス step を実行 |
| `compensate` | `try/catch` + 補償 step (`sideEffects[]`) 実行。TX 内なら DB rollback も併用 |

`jumpTo` は **action 値ではなく補助フィールド** (LocalId、任意文字列)。`continue` / `compensate` と
**併用** して「失敗時にこの step に goto」を表現する。LocalId は連番でないため命名規約推測は不可 —
codegen は **`Map<String LocalId, generated method name>`** を保持して dispatch する。生成パターン:

```java
// codegen が dispatch table を生成 (各 step を method 化)
private Object dispatchStep(String stepId, StepCtx ctx) {
    return switch (stepId) {
        case "step-09" -> runStepStep09(ctx);    // codegen 内 Map で LocalId → method 名を解決
        case "tx-recover" -> runStepTxRecover(ctx);
        default -> throw new IllegalStateException("Unknown step id: " + stepId);
    };
}

try {
    AiInvocationResult aiResponse = aiRuntime.invoke(...);
} catch (ResponseStatusException e) {
    if (e.getStatusCode().value() == 502) {
        // outcomes.failure: { action: "continue", jumpTo: "step-09" }
        return dispatchStep("step-09", ctx);
    }
    throw e;
}
```

## 制約

- `AiRuntimeService.invoke()` の **method 名 / 引数 record / 戻り値 record は変更不可** (test 側 mock が前提)
- 単一 method 設計: aiCall / aiAgent は `AiInvocationRequest.agent` の有無で分岐
- provider 切替は **catalog 編集だけで完結** (業務 Service コードは変更しない)
- secrets は `System.getenv()` で都度参照 (jar build 時に key を漏らさない)
- 利用しない provider の `*AiProvider.java` は generate しない (依存も不要)
