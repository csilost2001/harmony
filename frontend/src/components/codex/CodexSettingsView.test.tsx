/**
 * CodexSettingsView rendering tests.
 *
 * `codexClient` singleton の `account.read` を mocking して、状態別の
 * 表示パネルが正しく描画されることを確認する。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CodexSettingsView } from "./CodexSettingsView";
import { codexClient } from "../../codex/codexClient";

// Stub window.open so the unauthenticated → login start path doesn't error.
beforeEach(() => {
  vi.spyOn(codexClient, "subscribeNotification").mockImplementation(() => () => {});
});

function mockAccountRead(value: unknown, isError = false) {
  if (isError) {
    return vi.spyOn(codexClient.account, "read").mockRejectedValue(value);
  }
  return vi.spyOn(codexClient.account, "read").mockResolvedValue(value as never);
}

function renderView() {
  return render(
    <MemoryRouter>
      <CodexSettingsView />
    </MemoryRouter>,
  );
}

describe("CodexSettingsView", () => {
  it("renders the no-cli setup guide on ENOENT", async () => {
    mockAccountRead(new Error("spawn codex ENOENT"), true);
    renderView();
    await waitFor(() =>
      expect(screen.getByText(/Codex CLI が見つかりません/)).toBeInTheDocument()
    );
    expect(screen.getByText(/npm install -g @openai\/codex/)).toBeInTheDocument();
  });

  it("renders no-server panel on transport closed", async () => {
    mockAccountRead(new Error("transport closed"), true);
    renderView();
    await waitFor(() =>
      expect(screen.getByText(/Codex App Server に接続できません/)).toBeInTheDocument()
    );
  });

  it("renders unauthenticated panel with login button", async () => {
    mockAccountRead({ kind: "unauthenticated", requiresOpenaiAuth: false });
    renderView();
    await waitFor(() =>
      expect(screen.getByText(/ChatGPT へのログインが必要です/)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /ChatGPT にログイン/ })).toBeEnabled();
  });

  it("renders authenticated panel with account info", async () => {
    mockAccountRead({
      kind: "authenticated",
      account: { type: "chatgpt", email: "u@x.com", planType: "plus" },
    });
    // rateLimits も呼ばれるので mock しておく
    vi.spyOn(codexClient.account, "rateLimits").mockResolvedValue({
      rateLimits: {
        limitId: null, limitName: null, primary: null, secondary: null,
        credits: null, planType: "plus", rateLimitReachedType: null,
      },
      rateLimitsByLimitId: null,
    });
    renderView();
    await waitFor(() =>
      expect(screen.getByText(/ログイン済み/)).toBeInTheDocument()
    );
    expect(screen.getByText("u@x.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ログアウト/ })).toBeEnabled();
  });

  it("renders generic error panel for unknown errors", async () => {
    mockAccountRead(new Error("internal something"), true);
    renderView();
    await waitFor(() =>
      expect(screen.getByText(/想定外のエラーが発生しました/)).toBeInTheDocument()
    );
  });
});
