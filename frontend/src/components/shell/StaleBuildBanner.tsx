// 画面の版がサーバの版より古いときに出すバナー (#1572)。古い画面のまま操作を続けさせず、再読み込みを促す。
export function StaleBuildBanner() {
  return (
    <div
      role="alert"
      data-testid="stale-build-banner"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9998,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        background: "var(--hm-accent-solid)", color: "var(--hm-on-solid)",
        padding: "8px 16px", fontSize: 13,
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      <span><i className="bi bi-arrow-repeat" /> Harmony が更新されました。再読み込みしてください</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          background: "var(--hm-on-solid)", color: "var(--hm-accent-solid)",
          border: "none", borderRadius: 4, padding: "3px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}
      >
        再読み込み
      </button>
    </div>
  );
}
