import type { Sequence } from "../../types/v3";

export function generateSequenceDdl(seq: Sequence): string {
  const physical = seq.physicalName || seq.id;
  const lines: string[] = [`CREATE SEQUENCE ${physical}`];

  if (seq.startValue !== undefined && seq.startValue !== 1) {
    lines.push(`  START ${seq.startValue}`);
  } else {
    lines.push(`  START 1`);
  }

  if (seq.increment !== undefined && seq.increment !== 1) {
    lines.push(`  INCREMENT ${seq.increment}`);
  } else {
    lines.push(`  INCREMENT 1`);
  }

  if (seq.minValue !== undefined) {
    lines.push(`  MINVALUE ${seq.minValue}`);
  }

  if (seq.maxValue !== undefined) {
    lines.push(`  MAXVALUE ${seq.maxValue}`);
  }

  if (seq.cache !== undefined && seq.cache !== 1) {
    lines.push(`  CACHE ${seq.cache}`);
  } else {
    lines.push(`  CACHE 1`);
  }

  if (seq.cycle) {
    lines.push(`  CYCLE`);
  } else {
    lines.push(`  NO CYCLE`);
  }

  lines[lines.length - 1] += ";";

  const comments: string[] = [];
  if (seq.conventionRef) {
    comments.push(`-- ${seq.conventionRef}`);
  }
  if (seq.usedBy && seq.usedBy.length > 0) {
    for (const u of seq.usedBy) {
      comments.push(`-- 使用先: ${u.tableId}.${u.columnId}`);
    }
  }

  return [...lines, ...comments].join("\n");
}
