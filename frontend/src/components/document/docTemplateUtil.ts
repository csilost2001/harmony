/** 次の版の候補 (最後の版の末尾の数字を 1 増やす。読めなければ 1.0.0) */
export function nextVersion(last: string | undefined): string {
  const m = last ? /^(.*?)(\d+)$/.exec(last.trim()) : null;
  return m ? `${m[1]}${Number(m[2]) + 1}` : "1.0.0";
}

