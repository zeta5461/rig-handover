import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type Run = { at: string; job: string; status: RunStatus; owner: string | null; error?: string };

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v.at)
    && Number.isFinite(Date.parse(v.at))
    && typeof v.job === 'string' && v.job.trim().length > 0
    && (v.status === 'ok' || v.status === 'retry' || v.status === 'fail')
    && (typeof v.owner === 'string' || v.owner === null)
    && (v.error === undefined || typeof v.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return { rows: [], badLines: 0, missing: true, statusCounts: { ok: 0, retry: 0, fail: 0 } };
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { rows: [], badLines: 0, missing: true, statusCounts: { ok: 0, retry: 0, fail: 0 } };
    }
    throw error;
  }

  const jobs = new Map<string, { row: DigestRow; errorAt: number }>();
  let badLines = 0;
  const statusCounts = { ok: 0, retry: 0, fail: 0 };
  const lines = contents.split(/\r?\n/);
  // A terminal newline terminates the preceding record; it is not another record.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { badLines++; continue; }
    if (!isRun(value)) { badLines++; continue; }
    statusCounts[value.status]++;
    const time = Date.parse(value.at);
    const existing = jobs.get(value.job);
    if (!existing) {
      jobs.set(value.job, {
        row: {
          job: value.job, owner: value.owner, runs: 1, retries: Number(value.status === 'retry'),
          lastStatus: value.status, lastError: value.error ?? null, firstAt: value.at, lastAt: value.at,
        },
        errorAt: value.error === undefined ? -Infinity : time,
      });
      continue;
    }
    const { row } = existing;
    row.runs++;
    if (value.status === 'retry') row.retries++;
    if (time < Date.parse(row.firstAt)) row.firstAt = value.at;
    if (time >= Date.parse(row.lastAt)) {
      row.lastAt = value.at;
      row.lastStatus = value.status;
      row.owner = value.owner;
    }
    if (value.error !== undefined && time >= existing.errorAt) {
      row.lastError = value.error;
      existing.errorAt = time;
    }
  }
  const rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { rows, badLines, missing: false, statusCounts };
};
