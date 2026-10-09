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

/**
 * Counts RFC 4180 records without materializing them: quoted fields may
 * contain commas, doubled quotes, and CRLF or LF line breaks, and the final
 * record may lack a trailing line break. An empty document has zero records.
 */
export const countCsvRecords = (csv: string): number => {
  let records = 0;
  let inQuotes = false;
  let recordHasContent = false;
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (inQuotes) {
      if (character === '"') {
        if (csv[index + 1] === '"') index++;
        else inQuotes = false;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      recordHasContent = true;
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && csv[index + 1] === "\n") index++;
      records++;
      recordHasContent = false;
      continue;
    }
    recordHasContent = true;
  }
  return recordHasContent ? records + 1 : records;
};
