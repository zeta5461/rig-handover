import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const temporary: string[] = [];
function night(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  temporary.push(dir);
  writeFileSync(join(dir, '2026-10-28.jsonl'), contents);
  return dir;
}
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true }); });

describe('night reader', () => {
  it('reads the real fixture, retaining null owners, errors, and original offsets', () => {
    const result = readNight('runs', '2026-10-28');
    expect(result.missing).toBe(false);
    expect(result.badLines).toBe(1);
    expect(result.statusCounts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result.rows.map((r) => r.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result.rows[0].owner).toBeNull();
    expect(result.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(result.rows[3].lastStatus).toBe('fail');
  });

  it('distinguishes missing, empty, and malformed nights', () => {
    const dir = night('');
    expect(readNight(dir, '2026-10-28')).toEqual({ rows: [], badLines: 0, missing: false, statusCounts: { ok: 0, retry: 0, fail: 0 } });
    expect(readNight(dir, '2026-10-29')).toEqual({ rows: [], badLines: 0, missing: true, statusCounts: { ok: 0, retry: 0, fail: 0 } });
    writeFileSync(join(dir, '2026-10-28.jsonl'), 'broken\nnull\n{}\n\n');
    expect(readNight(dir, '2026-10-28')).toEqual({ rows: [], badLines: 4, missing: false, statusCounts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('rejects traversal identifiers', () => {
    expect(readNight('/not-read', '../2026-10-28')).toEqual({ rows: [], badLines: 0, missing: true, statusCounts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('uses chronological boundaries and latest error even when records arrive out of order', () => {
    const records = [
      { at: '2026-10-28T10:00:00+02:00', job: 'a', owner: null, status: 'ok' },
      { at: '2026-10-28T08:30:00+01:00', job: 'a', owner: 'old', status: 'retry', error: 'earlier' },
      { at: '2026-10-28T09:00:00+01:00', job: 'a', owner: 'latest', status: 'fail', error: 'latest' },
      { at: 'bad', job: 'a', owner: null, status: 'ok' },
      { at: '2026-10-28T10:00:00+02:00', job: 'b', owner: 1, status: 'ok' },
    ];
    const result = readNight(night(records.map((r) => JSON.stringify(r)).join('\n')), '2026-10-28');
    expect(result.badLines).toBe(2);
    expect(result.rows).toEqual([{
      job: 'a', owner: 'latest', runs: 3, retries: 1, lastStatus: 'fail', lastError: 'latest',
      firstAt: '2026-10-28T08:30:00+01:00', lastAt: '2026-10-28T09:00:00+01:00',
    }]);
  });
});
