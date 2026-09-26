export type CsvFieldValue = string | number | null | undefined;

const csvQuotingPattern = /[",\r\n]/;

const serializeCsvField = (value: CsvFieldValue): string => {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  return csvQuotingPattern.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
};

/**
 * Serializes rows as an RFC 4180 CSV document: fields containing commas,
 * double quotes, or line breaks are quoted with inner quotes doubled, and
 * rows are joined with CRLF. Empty and absent fields serialize as empty.
 */
export const serializeCsv = (
  rows: readonly (readonly CsvFieldValue[])[]
): string =>
  rows.map((row) => row.map(serializeCsvField).join(",")).join("\r\n");
