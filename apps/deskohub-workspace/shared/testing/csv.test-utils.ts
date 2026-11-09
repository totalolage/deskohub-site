const byteOrderMark = String.fromCodePoint(0xfe_ff);

/**
 * Reads RFC 4180 CSV text into its records, each a list of cell texts, as a
 * spreadsheet would: a leading byte order mark is dropped, quoted cells keep
 * their commas, line breaks and doubled quotes, and the final record's line
 * break ends it.
 */
export const parseCsv = (text: string): string[][] => {
  const source = text.startsWith(byteOrderMark) ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(cell);
      cell = "";
    } else if (character === "\r" && source[index + 1] === "\n") {
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
      index += 1;
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("The CSV text ends inside a quoted cell.");
  if (cell !== "" || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  return records;
};
