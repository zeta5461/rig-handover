export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type DigestResult = {
  rows: DigestRow[];
  badLines: number;
  missing: boolean;
  statusCounts: Record<RunStatus, number>;
};

// Invalid night identifiers are rejected as missing, without reading a file.
export type ReadNight = (runsDir: string, night: string) => DigestResult;
