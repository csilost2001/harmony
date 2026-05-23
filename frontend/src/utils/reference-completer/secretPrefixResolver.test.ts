// #1282: secretPrefixResolver unit tests (3 件)

import { describe, expect, it } from "vitest";
import { secretPrefixResolver } from "./secretPrefixResolver";
import type { CompletionContext } from "./types";

const ctx: CompletionContext = {
  workspace: {
    screens: [],
    tables: [],
    viewDefinitions: [],
    processFlows: [],
    fragments: [],
    components: [],
    exceptionTypes: [],
    modelEndpoints: [],
    secrets: [
      { id: "stripeApiKey", name: "Stripe API Key" },
      { id: "awsSecretKey", name: "AWS Secret Key" },
      { id: "slackToken", name: "Slack Token" },
    ],
    events: [],
  },
};

describe("secretPrefixResolver", () => {
  it("@secret. 入力時に全 secrets を候補として返す", () => {
    const value = "@secret.";
    const state = secretPrefixResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(3);
    expect(state.candidates.map((c) => c.value)).toContain("stripeApiKey");
    expect(state.candidates.map((c) => c.value)).toContain("awsSecretKey");
  });

  it("@secret.stripe で prefix フィルタが効く", () => {
    const value = "@secret.stripe";
    const state = secretPrefixResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("stripeApiKey");
    expect(state.candidates[0].hint).toBe("Stripe API Key");
  });

  it("workspace がない場合は null を返す", () => {
    const value = "@secret.stripe";
    const state = secretPrefixResolver.match(value, value.length, {});
    expect(state).toBeNull();
  });
});
