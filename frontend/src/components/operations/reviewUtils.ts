/** 日時 (ISO) を、画面に出す形 (YYYY-MM-DD HH:MM。ブラウザの時刻) にする */
export const formatTime = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
