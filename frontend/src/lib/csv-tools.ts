import { parseCsv } from './csv';
export const CSV_EDIT_EVENT = 'inkism-csv-edit';
export type CsvEditRequest = {
    file?: File;
    url?: string;
    name?: string;
    pos?: number;
};
export const CSV_MAX_BYTES = 8 * 1024 * 1024, CSV_MAX_CELLS = 200000;
export function csvRows(source: string) { if (new Blob([source]).size > CSV_MAX_BYTES)
    throw new Error('CSV exceeds 8 MiB'); const rows = parseCsv(source, { maxCells: CSV_MAX_CELLS, maxColumns: 2000, strict: true }); let cells = 0; for (const row of rows) {
    cells += row.length;
    if (cells > CSV_MAX_CELLS || row.length > 2000)
        throw new Error('CSV exceeds 200,000 cells or 2,000 columns');
} if (!rows.length)
    throw new Error('CSV is empty'); return rows; }
export function writeCsv(rows: readonly (readonly string[])[], newline = '\r\n') { return rows.map(row => row.map(value => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value).join(',')).join(newline); }
export const escapeCsvHTML = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function csvTableHTML(rows: string[][]) { const width = rows.reduce((n, row) => Math.max(n, row.length), 0); return '<table>' + rows.map(row => '<tr>' + Array.from({ length: width }, (_, i) => '<td><p>' + escapeCsvHTML(row[i] ?? '').replace(/\r\n|\r|\n/g, '<br>') + '</p></td>').join('') + '</tr>').join('') + '</table>'; }
