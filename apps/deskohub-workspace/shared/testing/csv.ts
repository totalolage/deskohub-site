/** Minimal RFC 4180 reader used only by CSV tests. */
export const parseCsv = (csv: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;
  while (index < csv.length) {
    const char = csv[index];
    if (inQuotes) {
      if (char === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 2;
        } else {
          inQuotes = false;
          index += 1;
        }
      } else {
        field += char;
        index += 1;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r" && csv[index + 1] === "\n") {
      rows.push([...row, field]);
      row = [];
      field = "";
      index += 2;
      continue;
    }
    field += char;
    index += 1;
  }
  if (row.length > 0 || field !== "") rows.push([...row, field]);
  return rows;
};
