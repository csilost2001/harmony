// backend 接続失敗エラー画面 (#795-C)
// splash で永遠に止まらず、サーバ未起動 / half-dead / network 障害を明示的に伝える
export function ConnectionFailedView({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", flexDirection: "column", gap: "16px", padding: "24px",
      color: "var(--muted-text, #ccc)",
      backgroundColor: "var(--bg-color, #1a1a1a)",
    }}>
      <div style={{ fontSize: "3rem", color: "color-mix(in srgb, var(--hm-hue-red) 80%, var(--hm-fg))" }}>
        <i className="bi bi-plug-fill" />
      </div>
      <h2 style={{ margin: 0, fontSize: "1.25rem", color: "var(--text-color, #fff)" }}>
        backend サーバに接続できません
      </h2>
      <div style={{
        maxWidth: 480, fontSize: "0.875rem", lineHeight: 1.6,
        color: "var(--muted-text, #aaa)", textAlign: "center",
      }}>
        <p style={{ marginTop: 0 }}>
          backend サーバ (port 5179) が起動しているか確認してください。
        </p>
        <pre style={{
          background: "var(--hm-surface-2)", padding: "12px 16px", borderRadius: 6,
          fontSize: "0.8125rem", textAlign: "left", margin: "12px auto",
        }}>cd backend{"\n"}npm run dev</pre>
        <p style={{ margin: "12px 0 0" }}>
          すでに起動している場合は、port 5179 を別プロセスが握っている可能性があります。
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: "8px 24px", fontSize: "0.9375rem",
          background: "#0d6efd", color: "var(--hm-on-solid)", border: "none", borderRadius: 6,
          cursor: "pointer", marginTop: 8,
        }}
      >
        <i className="bi bi-arrow-clockwise" style={{ marginRight: 6 }} />
        再試行
      </button>
    </div>
  );
}
