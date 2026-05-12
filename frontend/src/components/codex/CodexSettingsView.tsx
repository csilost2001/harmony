/**
 * AI 設定画面 (Codex App Server 接続/認証)。
 *
 * 状態に応じて 4 パネルを切り替える:
 *   - no-cli         セットアップガイド (CLI インストール手順)
 *   - no-server / error  エラー詳細 + 再試行
 *   - unauthenticated    ChatGPT ログインボタン + (進行中なら待機表示)
 *   - authenticated      アカウント情報 + Rate limits + ログアウト
 */

import { useCallback, useEffect, useState } from "react";
import { codexClient } from "../../codex/codexClient";
import { useCodexStatus } from "../../codex/useCodexStatus";
import type { GetAccountRateLimitsResponse } from "../../codex/types";
import "../../styles/codexSettings.css";

const CODEX_INSTALL_URL = "https://developers.openai.com/codex/app-server";

interface PendingLogin {
  loginId: string;
  authUrl: string;
}

export function CodexSettingsView() {
  const { status, refresh } = useCodexStatus();
  const [pendingLogin, setPendingLogin] = useState<PendingLogin | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rateLimits, setRateLimits] = useState<GetAccountRateLimitsResponse | null>(null);
  const [rateLimitsError, setRateLimitsError] = useState<string | null>(null);

  // 認証状態が変わったら pending login を解除
  useEffect(() => {
    if (status.kind === "authenticated") {
      setPendingLogin(null);
      setLoginError(null);
    }
  }, [status.kind]);

  // 認証済みになったら rate limits を読む
  useEffect(() => {
    if (status.kind !== "authenticated") {
      setRateLimits(null);
      setRateLimitsError(null);
      return;
    }
    let alive = true;
    codexClient.account
      .rateLimits()
      .then((r) => { if (alive) setRateLimits(r); })
      .catch((err: unknown) => {
        if (!alive) return;
        setRateLimitsError(err instanceof Error ? err.message : String(err));
      });
    return () => { alive = false; };
  }, [status.kind]);

  const handleStartLogin = useCallback(async () => {
    setBusy(true);
    setLoginError(null);
    try {
      const result = await codexClient.account.startChatgptLogin();
      setPendingLogin({ loginId: result.loginId, authUrl: result.authUrl });
      window.open(result.authUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCancelLogin = useCallback(async () => {
    if (!pendingLogin) return;
    setBusy(true);
    try {
      await codexClient.account.cancelChatgptLogin(pendingLogin.loginId);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingLogin(null);
      setBusy(false);
    }
  }, [pendingLogin]);

  const handleLogout = useCallback(async () => {
    setBusy(true);
    try {
      await codexClient.account.logout();
      await refresh();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="codex-settings">
      <div className="codex-settings-header">
        <h2>
          <i className="bi bi-robot" /> AI 設定
        </h2>
        <p className="codex-settings-subtitle">
          ProcessFlow 生成・画面デザイン生成などのアプリ内 AI 機能には、ChatGPT サブスクリプションへのログインが必要です。
        </p>
      </div>

      {status.kind === "checking" && (
        <Panel kind="info" title="接続状態を確認しています…">
          <div className="codex-settings-spinner"><i className="bi bi-arrow-repeat" /></div>
        </Panel>
      )}

      {status.kind === "no-cli" && (
        <Panel kind="warn" title="Codex CLI が見つかりません">
          <p>
            アプリ内 AI 機能には OpenAI Codex CLI のインストールが必要です。
            ターミナルで次のコマンドを実行してください:
          </p>
          <pre className="codex-settings-code">npm install -g @openai/codex</pre>
          <p>
            詳細は <a href={CODEX_INSTALL_URL} target="_blank" rel="noreferrer">公式ドキュメント</a> を参照してください。
          </p>
          <details className="codex-settings-error-details">
            <summary>エラー詳細</summary>
            <pre>{status.error}</pre>
          </details>
          <div className="codex-settings-actions">
            <button className="codex-btn codex-btn-primary" onClick={() => refresh()}>
              <i className="bi bi-arrow-clockwise" /> 再試行
            </button>
          </div>
        </Panel>
      )}

      {status.kind === "no-server" && (
        <Panel kind="warn" title="Codex App Server に接続できません">
          <p>
            Codex CLI は見つかりましたが、App Server プロセスに接続できませんでした。
            別プロセスで起動済みの App Server に接続する場合は環境変数を確認してください。
          </p>
          <ul className="codex-settings-env-list">
            <li><code>HARMONY_CODEX_TRANSPORT</code> = <code>spawn</code> (デフォルト) または <code>websocket</code></li>
            <li><code>HARMONY_CODEX_WS_URL</code> (websocket 利用時)</li>
            <li><code>HARMONY_CODEX_SPAWN_COMMAND</code> (CLI コマンドの上書き)</li>
          </ul>
          <details className="codex-settings-error-details">
            <summary>エラー詳細</summary>
            <pre>{status.error}</pre>
          </details>
          <div className="codex-settings-actions">
            <button className="codex-btn codex-btn-primary" onClick={() => refresh()}>
              <i className="bi bi-arrow-clockwise" /> 再試行
            </button>
          </div>
        </Panel>
      )}

      {status.kind === "error" && (
        <Panel kind="error" title="想定外のエラーが発生しました">
          <pre className="codex-settings-error-message">{status.error}</pre>
          <div className="codex-settings-actions">
            <button className="codex-btn codex-btn-primary" onClick={() => refresh()}>
              <i className="bi bi-arrow-clockwise" /> 再試行
            </button>
          </div>
        </Panel>
      )}

      {status.kind === "unauthenticated" && (
        <Panel kind="info" title="ChatGPT へのログインが必要です">
          <p>
            ご自身の ChatGPT Plus / Pro / Business / Enterprise アカウントでログインしてください。
            このアプリは API キーや従量課金を必要としません。
          </p>
          {!pendingLogin && (
            <div className="codex-settings-actions">
              <button
                className="codex-btn codex-btn-primary"
                onClick={() => void handleStartLogin()}
                disabled={busy}
              >
                <i className="bi bi-box-arrow-in-right" /> ChatGPT にログイン
              </button>
            </div>
          )}
          {pendingLogin && (
            <div className="codex-settings-pending">
              <p>
                <i className="bi bi-hourglass-split" /> 別ウィンドウで開いた認証ページでログインを完了してください。
              </p>
              <p className="codex-settings-auth-url">
                ブラウザが自動で開かなかった場合は、このリンクを開いてください:{" "}
                <a href={pendingLogin.authUrl} target="_blank" rel="noreferrer">{pendingLogin.authUrl}</a>
              </p>
              <div className="codex-settings-actions">
                <button
                  className="codex-btn"
                  onClick={() => void handleCancelLogin()}
                  disabled={busy}
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
          {loginError && (
            <p className="codex-settings-error-message">{loginError}</p>
          )}
        </Panel>
      )}

      {status.kind === "authenticated" && (
        <Panel kind="success" title="ログイン済み">
          <AccountSummary account={status.account} />
          <RateLimitsSummary rateLimits={rateLimits} error={rateLimitsError} />
          <div className="codex-settings-actions">
            <button
              className="codex-btn"
              onClick={() => void handleLogout()}
              disabled={busy}
            >
              <i className="bi bi-box-arrow-right" /> ログアウト
            </button>
          </div>
          {loginError && (
            <p className="codex-settings-error-message">{loginError}</p>
          )}
        </Panel>
      )}
    </div>
  );
}

// ── 内部コンポーネント ─────────────────────────────────────────────────────

interface PanelProps {
  kind: "info" | "warn" | "error" | "success";
  title: string;
  children: React.ReactNode;
}

function Panel({ kind, title, children }: PanelProps) {
  const icon = {
    info: "bi-info-circle",
    warn: "bi-exclamation-triangle",
    error: "bi-x-octagon",
    success: "bi-check-circle",
  }[kind];
  return (
    <section className={`codex-settings-panel codex-settings-panel-${kind}`}>
      <h3><i className={`bi ${icon}`} /> {title}</h3>
      {children}
    </section>
  );
}

function AccountSummary({ account }: { account: import("../../codex/types").CodexAccount }) {
  if (account.type === "chatgpt") {
    return (
      <dl className="codex-settings-account">
        <dt>種別</dt><dd>ChatGPT</dd>
        <dt>メールアドレス</dt><dd>{account.email}</dd>
        <dt>プラン</dt><dd>{account.planType}</dd>
      </dl>
    );
  }
  if (account.type === "apiKey") {
    return (
      <dl className="codex-settings-account">
        <dt>種別</dt><dd>API キー</dd>
      </dl>
    );
  }
  return (
    <dl className="codex-settings-account">
      <dt>種別</dt><dd>Amazon Bedrock</dd>
    </dl>
  );
}

function RateLimitsSummary({
  rateLimits,
  error,
}: {
  rateLimits: GetAccountRateLimitsResponse | null;
  error: string | null;
}) {
  if (error) {
    return (
      <details className="codex-settings-rate-limits codex-settings-rate-limits-error">
        <summary>利用上限の取得に失敗</summary>
        <pre>{error}</pre>
      </details>
    );
  }
  if (!rateLimits) {
    return (
      <p className="codex-settings-rate-limits-loading">
        <i className="bi bi-hourglass" /> 利用上限を取得中…
      </p>
    );
  }
  const r = rateLimits.rateLimits;
  return (
    <div className="codex-settings-rate-limits">
      <h4>利用上限</h4>
      <dl>
        {r.planType && (<><dt>プラン</dt><dd>{r.planType}</dd></>)}
        {r.limitName && (<><dt>制限名</dt><dd>{r.limitName}</dd></>)}
        {r.rateLimitReachedType && (
          <><dt>到達状態</dt><dd>{r.rateLimitReachedType}</dd></>
        )}
      </dl>
      <details>
        <summary>詳細 (raw)</summary>
        <pre>{JSON.stringify(rateLimits, null, 2)}</pre>
      </details>
    </div>
  );
}
