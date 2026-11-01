import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const configFor = (runsDir: string) => ({
  adapter: 'shim' as const,
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

const dirs: string[] = [];
function makeRunsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'digest-routes-'));
  dirs.push(dir);
  return dir;
}

function writeNight(dir: string, night: string, contents: string) {
  writeFileSync(join(dir, `${night}.jsonl`), contents, 'utf8');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('serves the page and JSON with the same sorted jobs and preserves source timestamps', async () => {
    const runsDir = makeRunsDir();
    const night = '2026-10-28';
    const alphaFirst = '2026-10-28T01:02:03.123Z';
    const alphaLast = '2026-10-28T01:05:07.456Z';
    const zetaAt = '2026-10-28T00:09:08.007Z';
    writeNight(runsDir, night, [
      JSON.stringify({ at: zetaAt, job: 'zeta', status: 'ok', owner: 'Sam' }),
      JSON.stringify({ at: alphaFirst, job: 'alpha', status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-28T01:03:00.000Z', job: 'alpha', status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-28T01:04:00.000Z', job: 'alpha', status: 'retry', owner: null }),
      JSON.stringify({ at: alphaLast, job: 'alpha', status: 'fail', owner: null, error: 'still failing' }),
    ].join('\n') + '\n');

    const app = createApp(configFor(runsDir));
    const pageResponse = await app.request(`/digest/${night}`);
    const html = await pageResponse.text();
    const jsonResponse = await app.request(`/api/digest/${night}`);
    const json = await jsonResponse.json();

    expect(pageResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(json.night).toBe(night);
    expect(json.badLines).toBe(0);
    expect(json.rows.map((row: { job: string }) => row.job)).toEqual(['alpha', 'zeta']);
    expect([...html.matchAll(/<tr\b[^>]*\bdata-job="([^"]+)"/g)].map((m) => m[1])).toEqual(
      json.rows.map((row: { job: string }) => row.job),
    );
    expect(json.rows[0]).toMatchObject({
      job: 'alpha', owner: null, runs: 4, retries: 3, lastStatus: 'fail',
      firstAt: alphaFirst, lastAt: alphaLast,
    });
    expect(json.rows[1]).toMatchObject({ job: 'zeta', firstAt: zetaAt, lastAt: zetaAt });
    expect(html).toContain('—');
    expect(html).toContain('still failing');
  });

  it('returns 404 for a night with no file and for an invalid night identifier', async () => {
    const runsDir = makeRunsDir();
    const app = createApp(configFor(runsDir));

    for (const route of ['/digest/2026-10-28', '/api/digest/2026-10-28', '/digest/not-a-night', '/api/digest/not-a-night']) {
      const response = await app.request(route);
      expect(response.status).toBe(404);
    }
  });

  it('renders an existing empty night as nothing ran with no rows', async () => {
    const runsDir = makeRunsDir();
    writeNight(runsDir, '2026-10-28', '');
    const app = createApp(configFor(runsDir));

    const page = await app.request('/digest/2026-10-28');
    const html = await page.text();
    const jsonResponse = await app.request('/api/digest/2026-10-28');
    const json = await jsonResponse.json();

    expect(page.status).toBe(200);
    expect(html.toLowerCase()).toContain('nothing ran');
    expect(jsonResponse.status).toBe(200);
    expect(json).toMatchObject({ night: '2026-10-28', rows: [], badLines: 0 });
  });

  it('counts malformed lines while returning valid rows from both routes', async () => {
    const runsDir = makeRunsDir();
    writeNight(runsDir, '2026-10-28', [
      '{not json',
      JSON.stringify({ at: '2026-10-28T03:00:00Z', job: 'kept', status: 'ok', owner: 'Lee' }),
      '',
    ].join('\n'));
    const app = createApp(configFor(runsDir));

    const page = await app.request('/digest/2026-10-28');
    const html = await page.text();
    const jsonResponse = await app.request('/api/digest/2026-10-28');
    const json = await jsonResponse.json();

    expect(page.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(json).toMatchObject({ badLines: 1, rows: [{ job: 'kept' }] });
    expect(html).toContain('data-job="kept"');
  });
  it('marks a retry threshold and a failure independently, and leaves two retries unmarked', async () => {
    const runsDir = makeRunsDir();
    const records: {at:string;job:string;status:'retry'|'ok'|'fail';owner:null}[] = [];
    for (const [job, retries] of [['two', 2], ['three', 3]] as const) {
      for (let i=0; i<retries; i++) records.push({at:`2026-10-28T00:00:0${i}Z`,job,status:'retry',owner:null});
      records.push({at:'2026-10-28T00:00:09Z',job,status:'ok',owner:null});
    }
    records.push({at:'2026-10-28T00:00:00Z',job:'failed',status:'fail',owner:null});
    writeNight(runsDir, '2026-10-28', records.map(r=>JSON.stringify(r)).join('\n'));
    const html = await (await createApp(configFor(runsDir)).request('/digest/2026-10-28')).text();
    const tagFor = (job:string) => [...html.matchAll(/<tr\b[^>]*>/g)].map(m=>m[0]).find(t=>t.includes(`data-job="${job}"`))!;
    expect(tagFor('three')).toMatch(/class="[^"]*\bwarn\b/);
    expect(tagFor('failed')).toMatch(/class="[^"]*\bwarn\b/);
    expect(tagFor('two')).not.toMatch(/class="[^"]*\bwarn\b/);
  });

  it('links both fixture nights and counts raw events rather than final job statuses', async () => {
    const html = await (await createApp(configFor('runs')).request('/')).text();
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('10 ok · 4 retry · 1 fail');
    expect(html).toContain('7 ok · 0 retry · 0 fail');
    for (const night of ['2026-10-27', '2026-10-28']) {
      expect((await createApp(configFor('runs')).request(`/digest/${night}`)).status).toBe(200);
    }
  });

});
