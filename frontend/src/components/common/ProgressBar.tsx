/** 長い処理の進み具合 (続編 第 10 弾 #194)。「7 / 10 件」と帯、中止のボタン。読み上げには、控えめに伝える */
export function ProgressBar({ label, done, total, onCancel }: { label: string; done: number; total: number; onCancel?: () => void }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress-task" data-testid="progress-task">
      <span className="progress-task-label" role="status" aria-live="polite">{label}: {done} / {total} 件</span>
      <span className="progress-task-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}><span style={{ width: `${pct}%` }} /></span>
      {onCancel && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCancel} data-testid="progress-cancel">中止</button>}
    </div>
  );
}
