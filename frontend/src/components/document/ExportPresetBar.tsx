/** 書き出しの設定の組 (続編 第 9 弾 #175): 形式と載せない章に名前をつけて保存し、ワンクリックで同じ内容を出し直す。保存先は設計書の体裁 (プロジェクトの全員が使える) */
import { useState } from "react";
import { emptyDocTemplate, EXPORT_FORMATS, type DesignDocInput, type ExportFormat } from "@harmony/shared";
import { reportFailure } from "../../utils/failureToast";
import { EXPORT_FORMAT_LABELS, presetFromInput, removePreset, upsertPreset } from "../../utils/exportPresets";
import { opsApi } from "../../utils/opsApi";
import { showToast } from "../../utils/toast";

interface Props {
  input: DesignDocInput;
  /** 設定の形式で、載せない章を差し替えた入力を使って書き出す */
  onRun: (format: ExportFormat, excludeChapters: string[]) => void;
  /** 保存したあとに、設計書を読み直す */
  onSaved: () => void;
}

export function ExportPresetBar({ input, onRun, onSaved }: Props) {
  const presets = input.template?.exportPresets ?? [];
  const [pick, setPick] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<ExportFormat>("html");
  const [busy, setBusy] = useState(false);
  const chosen = presets.find((p) => p.name === pick);

  const persist = async (next: typeof presets, done: string) => {
    setBusy(true);
    try {
      await opsApi.templateSave({ ...(input.template ?? emptyDocTemplate()), exportPresets: next });
      showToast(done);
      onSaved();
    } catch (e) { reportFailure(e, "書き出しの設定の保存"); } finally { setBusy(false); }
  };
  const save = async () => {
    const next = upsertPreset(presets, presetFromInput(name, format, input));
    if (!next) { showToast("設定を保存できません (名前が空・長すぎる・20 件の上限)", "error"); return; }
    await persist(next, `書き出しの設定「${name.trim()}」を保存しました`);
    setPick(name.trim()); setNaming(false); setName("");
  };

  return (
    <span className="ddv-presets" data-testid="ddv-presets">
      <select className="ddv-preset-select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="保存した書き出しの設定" data-testid="ddv-preset-select">
        <option value="">書き出しの設定…</option>
        {presets.map((p) => <option key={p.name} value={p.name}>{p.name} ({EXPORT_FORMAT_LABELS[p.format]})</option>)}
      </select>
      <button type="button" className="ddv-btn" disabled={!chosen} onClick={() => chosen && onRun(chosen.format, chosen.excludeChapters)} title="選んだ設定で、すぐに書き出す" data-testid="ddv-preset-run"><i className="bi bi-play-fill" /> 実行</button>
      <button type="button" className="ddv-btn" disabled={!chosen || busy} onClick={() => chosen && void persist(removePreset(presets, chosen.name), `「${chosen.name}」を消しました`).then(() => setPick(""))} title="選んだ設定を消す" aria-label="選んだ設定を消す" data-testid="ddv-preset-remove"><i className="bi bi-trash" /></button>
      {naming ? (
        <span className="ddv-preset-new">
          <input className="ddv-preset-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="例: 顧客への納品用" aria-label="設定の名前" data-testid="ddv-preset-name"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && name.trim()) { e.preventDefault(); void save(); } if (e.key === "Escape") { e.stopPropagation(); setNaming(false); } }} />
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} aria-label="形式" data-testid="ddv-preset-format">{EXPORT_FORMATS.map((f) => <option key={f} value={f}>{EXPORT_FORMAT_LABELS[f]}</option>)}</select>
          <button type="button" className="ddv-btn primary" disabled={busy || !name.trim()} onClick={() => void save()} data-testid="ddv-preset-save">保存</button>
          <button type="button" className="ddv-btn" onClick={() => setNaming(false)}>やめる</button>
        </span>
      ) : (
        <button type="button" className="ddv-btn" onClick={() => setNaming(true)} title="いまの「載せる章」の設定を、形式と一緒に名前をつけて保存する" data-testid="ddv-preset-new"><i className="bi bi-bookmark-plus" /> 設定を保存</button>
      )}
    </span>
  );
}
