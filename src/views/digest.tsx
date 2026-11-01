import type { DigestRow } from '../digest/types.js';

export function DigestPage(props: { night: string; rows: DigestRow[]; badLines: number }) {
  const rows = [...props.rows].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);

  return (
    <>
      <h1>Digest · {props.night}</h1>
      <p>Bad lines: {props.badLines}</p>
      {rows.length === 0 ? (
        <p>nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first time</th>
              <th>last time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const warning = row.retries >= 3 || row.lastStatus === 'fail';
              return (
                <tr class={warning ? 'warn' : undefined} data-job={row.job}>
                  <td>{row.job}</td>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastError ?? '—'}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
