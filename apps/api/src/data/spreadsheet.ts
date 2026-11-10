import ExcelJS from 'exceljs';
import { parseCsv, toCsv } from '@relay-desk/domain';

export type FileFormat = 'csv' | 'xlsx';

/** Rows (first row = headers) from an uploaded CSV or XLSX file. */
export async function readTable(data: Buffer, filename: string): Promise<string[][]> {
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).text ?? '');
      rows.push(cells);
    });
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }
  return parseCsv(data.toString('utf8'));
}

/** A download in the chosen format. Formula-looking cells are neutralised in both. */
export async function writeTable(rows: unknown[][], format: FileFormat, sheetName = 'Export') {
  if (format === 'csv') return { data: Buffer.from(toCsv(rows), 'utf8'), mime: 'text/csv; charset=utf-8', ext: 'csv' };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  for (const r of rows)
    ws.addRow(
      r.map((v) => {
        const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
        return /^[=+\-@]/.test(s) ? `'${s}` : s;
      }),
    );
  ws.getRow(1).font = { bold: true };
  return {
    data: Buffer.from(await wb.xlsx.writeBuffer()),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  };
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** DD/MM/YYYY HH:mm in the user's timezone (CLAUDE.md: dates). */
export function ukDateTime(v: unknown, tz: string): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f.format(d).replace(',', '');
}
