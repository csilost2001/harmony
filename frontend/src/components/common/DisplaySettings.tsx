/**
 * ヘッダーの「表示の設定」。文字サイズ・密度 (表の行の余白)・コントラストを選ぶ。このブラウザにだけ保存される。
 */
import { useEffect, useRef, useState } from "react";
import {
  CONTRAST_LABELS, DEFAULT_DISPLAY_PREFS, DENSITY_LABELS, FONT_SCALE_LABELS, setDisplayPrefs, useDisplayPrefs,
  type Contrast, type Density, type FontScale,
} from "../../theme/displayPrefs";
import { MOTION_LABELS, setMotionPref, useMotionPref, type MotionPref } from "../../theme/motionPrefs";
import { onHeaderPanelRequest } from "../../utils/headerPanels";
import { SettingsBackupDialog } from "./SettingsBackupDialog";
import "../../styles/displaySettings.css";

function Choice<T extends string>({ name, label, value, labels, onChange }: { name: string; label: string; value: T; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <fieldset className="disp-field">
      <legend>{label}</legend>
      <div className="disp-choices">
        {(Object.keys(labels) as T[]).map((k) => (
          <label key={k} className={`disp-choice${value === k ? " is-on" : ""}`}>
            <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} data-testid={`disp-${name}-${k}`} />
            {labels[k]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function DisplaySettings() {
  const prefs = useDisplayPrefs();
  const motion = useMotionPref();
  const [open, setOpen] = useState(false);
  const [backup, setBackup] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => onHeaderPanelRequest("display", () => setOpen(true)), []);
  useEffect(() => onHeaderPanelRequest("settings-backup", () => setBackup(true)), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const changed = prefs.fontScale !== "standard" || prefs.density !== "standard" || prefs.contrast !== "standard" || motion !== "auto";

  return (
    <span className="disp-wrap" ref={rootRef} onKeyDown={(e) => { if (open && e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className="common-header-icon-btn" data-testid="display-settings-open"
        title="表示の設定 (文字サイズ・密度・コントラスト)" aria-label="表示の設定" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <i className="bi bi-type" />
        {changed && <span className="disp-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="disp-pop" role="dialog" aria-label="表示の設定" data-testid="display-settings">
          <Choice<FontScale> name="fontScale" label="文字サイズ" value={prefs.fontScale} labels={FONT_SCALE_LABELS} onChange={(v) => setDisplayPrefs({ fontScale: v })} />
          <Choice<Density> name="density" label="密度 (表の行の余白)" value={prefs.density} labels={DENSITY_LABELS} onChange={(v) => setDisplayPrefs({ density: v })} />
          <Choice<Contrast> name="contrast" label="コントラスト (淡い文字と罫線)" value={prefs.contrast} labels={CONTRAST_LABELS} onChange={(v) => setDisplayPrefs({ contrast: v })} />
          <Choice<MotionPref> name="motion" label="動き (図のズーム・パネルの開閉・通知のアニメーション)" value={motion} labels={MOTION_LABELS} onChange={setMotionPref} />
          <small>このブラウザにだけ保存されます。配色 (ライト / ダーク) は、隣の月と太陽の印で切り替えます。設計の見本 (画面デザインの紙面・帳票) と印刷は、この設定を受けません。</small>
          <div className="disp-actions">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setOpen(false); setBackup(true); }} title="表示・通知・お気に入り・スニペット・一覧の設定を、ファイルで持ち出す・読み込む" data-testid="settings-backup-open">設定の書き出し・読み込み…</button>
            <button type="button" className="btn btn-sm btn-secondary" disabled={!changed} data-testid="display-settings-reset"
              onClick={() => { setDisplayPrefs(DEFAULT_DISPLAY_PREFS); setMotionPref("auto"); }}>標準に戻す</button>
          </div>
        </div>
      )}
      {backup && <SettingsBackupDialog onClose={() => setBackup(false)} />}
    </span>
  );
}
