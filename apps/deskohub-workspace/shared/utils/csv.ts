import { Predicate } from "effect";
import { markPrivateResponse } from "./private-response";

export type CsvCell = string | number | null | undefined;

/** One CSV column: its header and how a row fills its cell. */
export type CsvColumn<Row> = {
  readonly header: string;
  readonly value: (row: Row) => CsvCell;
};

// Spreadsheets run a cell that starts with one of these as a formula.
const formulaPrefix = /^[=+\-@\t\r\n]/;
// A plain signed number, such as `-12.5` or `+420726101229`, can't call a
// function, so it keeps its sign instead of gaining a visible `'`. Anything
// with operators or separators, such as `+420 777 123 456`, gets the guard.
const numericText = /^[+-]\d+(\.\d+)?$/;
const quotedCharacters = /[",\r\n]/;

// Written as a code point because formatters turn the escape into an invisible
// character.
const utf8ByteOrderMark = String.fromCodePoint(0xfe_ff);

const formatCsvCell = (cell: CsvCell) => {
  if (cell === null || cell === undefined) return "";
  if (Predicate.isNumber(cell)) {
    return Number.isFinite(cell) ? `${cell}` : "";
  }
  const text =
    formulaPrefix.test(cell) && !numericText.test(cell) ? `'${cell}` : cell;
  return quotedCharacters.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * Writes RFC 4180 CSV: a header record, then one record per row, each ended by
 * CRLF. Text that a spreadsheet would run as a formula gets a leading `'`;
 * numbers stay numeric.
 */
export const serializeCsv = <Row>(
  columns: readonly CsvColumn<Row>[],
  rows: Iterable<Row>
) => {
  const records = [columns.map(({ header }) => formatCsvCell(header))];
  for (const row of rows) {
    records.push(columns.map(({ value }) => formatCsvCell(value(row))));
  }
  return records.map((cells) => `${cells.join(",")}\r\n`).join("");
};

/**
 * A private CSV file download. The byte order mark makes Excel read the file
 * as UTF-8, so Czech characters survive.
 */
export const createCsvDownloadResponse = <Row>({
  columns,
  filename,
  rows,
}: {
  readonly columns: readonly CsvColumn<Row>[];
  /** An ASCII file name such as `reservations-2026-10-20.csv`. */
  readonly filename: string;
  readonly rows: Iterable<Row>;
}) =>
  markPrivateResponse(
    new Response(`${utf8ByteOrderMark}${serializeCsv(columns, rows)}`, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename.replaceAll(/[^\w.-]/g, "_")}"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    })
  );
