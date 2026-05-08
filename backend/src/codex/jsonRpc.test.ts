import { describe, expect, it, vi } from "vitest";
import { JsonRpcClient, JsonRpcError } from "./jsonRpc.js";
import { JsonRpcTransport } from "./transport.js";

class MockTransport extends JsonRpcTransport {
  sent: string[] = [];
  send(message: string): void {
    this.sent.push(message);
  }
  async close(): Promise<void> {
    this.emit("close", { kind: "local" });
  }
  inject(message: object): void {
    this.emit("message", JSON.stringify(message));
  }
}

describe("JsonRpcClient", () => {
  it("correlates request id with response result", async () => {
    const transport = new MockTransport();
    const client = new JsonRpcClient({ transport });
    const promise = client.request<{ ok: boolean }>("foo", { a: 1 });

    expect(transport.sent).toHaveLength(1);
    const sent = JSON.parse(transport.sent[0]!);
    expect(sent.method).toBe("foo");
    expect(sent.params).toEqual({ a: 1 });
    expect(sent.jsonrpc).toBe("2.0");

    transport.inject({ jsonrpc: "2.0", id: sent.id, result: { ok: true } });
    await expect(promise).resolves.toEqual({ ok: true });
    await client.close();
  });

  it("rejects with JsonRpcError on error response", async () => {
    const transport = new MockTransport();
    const client = new JsonRpcClient({ transport });
    const promise = client.request("foo");
    const id = JSON.parse(transport.sent[0]!).id;
    transport.inject({
      jsonrpc: "2.0",
      id,
      error: { code: -32001, message: "overloaded" },
    });
    await expect(promise).rejects.toBeInstanceOf(JsonRpcError);
    await expect(promise).rejects.toMatchObject({ code: -32001 });
    await client.close();
  });

  it("delivers notifications via onNotification", () => {
    const transport = new MockTransport();
    const onNotification = vi.fn();
    new JsonRpcClient({ transport, onNotification });
    transport.inject({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { delta: "hi" },
    });
    expect(onNotification).toHaveBeenCalledTimes(1);
    expect(onNotification.mock.calls[0]![0]).toMatchObject({
      method: "item/agentMessage/delta",
      params: { delta: "hi" },
    });
  });

  it("answers server-initiated requests via onServerRequest", async () => {
    const transport = new MockTransport();
    const onServerRequest = vi.fn().mockResolvedValue({ approved: true });
    new JsonRpcClient({ transport, onServerRequest });
    transport.inject({
      jsonrpc: "2.0",
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: {},
    });
    await new Promise((r) => setImmediate(r));
    expect(transport.sent).toHaveLength(1);
    const reply = JSON.parse(transport.sent[0]!);
    expect(reply).toEqual({ jsonrpc: "2.0", id: 99, result: { approved: true } });
  });

  it("returns -32601 when no server-request handler is registered (default)", async () => {
    const transport = new MockTransport();
    new JsonRpcClient({ transport });
    transport.inject({
      jsonrpc: "2.0",
      id: 5,
      method: "applyPatchApproval",
      params: {},
    });
    await new Promise((r) => setImmediate(r));
    const reply = JSON.parse(transport.sent[0]!);
    expect(reply.error?.code).toBe(-32601);
  });

  it("rejects pending requests when the transport closes", async () => {
    const transport = new MockTransport();
    const client = new JsonRpcClient({ transport });
    const promise = client.request("foo");
    transport.emit("close", { kind: "remote" });
    await expect(promise).rejects.toThrow(/transport closed/);
  });

  it("aborts a request via AbortSignal", async () => {
    const transport = new MockTransport();
    const client = new JsonRpcClient({ transport });
    const ac = new AbortController();
    const promise = client.request("foo", undefined, { signal: ac.signal });
    ac.abort();
    await expect(promise).rejects.toBeDefined();
    await client.close();
  });
});
