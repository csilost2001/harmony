import { setAppThemePref, useAppTheme, type AppThemePref } from "../../theme/appTheme";

const NEXT: Record<AppThemePref, AppThemePref> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<AppThemePref, string> = { system: "OS の設定に合わせる", light: "ライト", dark: "ダーク" };
const ICON: Record<AppThemePref, string> = { system: "bi-circle-half", light: "bi-sun", dark: "bi-moon-stars" };

/** ヘッダーのテーマ切替ボタン。押すたびに OS 設定 → ライト → ダーク の順で切り替わる。 */
export function ThemeToggle() {
  const { pref } = useAppTheme();
  return (
    <button
      type="button"
      className="common-header-icon-btn"
      data-testid="theme-toggle"
      title={`配色: ${LABEL[pref]}（クリックで「${LABEL[NEXT[pref]]}」に切替）`}
      aria-label={`配色: ${LABEL[pref]}`}
      onClick={() => setAppThemePref(NEXT[pref])}
    >
      <i className={`bi ${ICON[pref]}`} />
    </button>
  );
}
