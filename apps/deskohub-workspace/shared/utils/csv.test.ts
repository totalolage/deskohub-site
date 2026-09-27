import { describe, expect, test } from "bun:test";
import { serializeCsv } from "./csv";

describe("serializeCsv", () => {
  test("serializes plain rows without unnecessary quoting", () => {
    expect(
      serializeCsv([
        ["a", 1, "plain"],
        ["b", null, "x"],
      ])
    ).toBe("a,1,plain\r\nb,,x");
  });

  test("quotes fields containing commas", () => {
    expect(serializeCsv([["has,comma"]])).toBe('"has,comma"');
  });

  test("quotes fields containing double quotes and doubles inner quotes", () => {
    expect(serializeCsv([['say "hi" now']])).toBe('"say ""hi"" now"');
  });

  test("quotes fields containing carriage returns, newlines, and CRLF", () => {
    expect(serializeCsv([["line\nbreak"]])).toBe('"line\nbreak"');
    expect(serializeCsv([["line\rreturn"]])).toBe('"line\rreturn"');
    expect(serializeCsv([["line\r\nboth"]])).toBe('"line\r\nboth"');
  });

  test("preserves empty fields and embedded line breaks exactly", () => {
    expect(serializeCsv([["", "kept"], ["multi\nline", ""], []])).toBe(
      ',kept\r\n"multi\nline",\r\n'
    );
  });

  test("treats undefined and null as empty fields", () => {
    expect(serializeCsv([[undefined, null, "v"]])).toBe(",,v");
  });

  test("parses back to the original fields, including CR, LF, quotes, commas, and empty fields", () => {
    const rows = [
      [
        "a,b",
        'say "hi"',
        "line\nbreak",
        "cr\rreturn",
        "crlf\r\nboth",
        "",
        null,
        42,
      ],
      ["", "only-second", "multi\nline\r\nmixed\rtext"],
    ];
    const csv = serializeCsv(rows);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([
      [
        "a,b",
        'say "hi"',
        "line\nbreak",
        "cr\rreturn",
        "crlf\r\nboth",
        "",
        "",
        "42",
      ],
      ["", "only-second", "multi\nline\r\nmixed\rtext"],
    ]);
  });
});

/** Minimal RFC 4180 reader used only to verify the serializer round-trips. */
const parseCsv = (csv: string): string[][] => {
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
