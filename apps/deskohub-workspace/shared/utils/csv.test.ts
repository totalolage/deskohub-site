import { describe, expect, test } from "bun:test";
import { type CsvColumn, createCsvDownloadResponse, serializeCsv } from "./csv";

type Row = { readonly name: string | null; readonly amount?: number };

const columns: readonly CsvColumn<Row>[] = [
  { header: "Name", value: (row) => row.name },
  { header: "Amount", value: (row) => row.amount },
];

describe("serializeCsv", () => {
  test("writes a header record and CRLF-terminated records", () => {
    expect(
      serializeCsv(columns, [
        { name: "Jana", amount: 12.5 },
        { name: "Petr", amount: 0 },
      ])
    ).toBe("Name,Amount\r\nJana,12.5\r\nPetr,0\r\n");
  });

  test("writes only the header for no rows", () => {
    expect(serializeCsv(columns, [])).toBe("Name,Amount\r\n");
  });

  test("quotes cells with commas, quotes, and line breaks", () => {
    expect(
      serializeCsv(
        [{ header: "Value", value: (value: string) => value }],
        ["a,b", 'say "hi"', "line\nbreak", "carriage\rreturn", "both\r\nends"]
      )
    ).toBe(
      'Value\r\n"a,b"\r\n"say ""hi"""\r\n"line\nbreak"\r\n"carriage\rreturn"\r\n"both\r\nends"\r\n'
    );
  });

  test("leaves empty, null, and undefined cells empty", () => {
    expect(
      serializeCsv(columns, [{ name: "" }, { name: null, amount: undefined }])
    ).toBe("Name,Amount\r\n,\r\n,\r\n");
  });

  test("writes numbers as plain numbers and drops non-finite ones", () => {
    expect(
      serializeCsv(
        [{ header: "Value", value: (value: number) => value }],
        [-12.34, 1500, Number.NaN, Number.POSITIVE_INFINITY]
      )
    ).toBe("Value\r\n-12.34\r\n1500\r\n\r\n\r\n");
  });

  test("defuses text a spreadsheet would run as a formula", () => {
    expect(
      serializeCsv(
        [{ header: "Value", value: (value: string) => value }],
        [
          "=SUM(A1)",
          "+cmd|' /C calc'!A0",
          "-2+3+cmd|' /C calc'!A0",
          "@cmd",
          "\tindent",
          "\rlead",
          "\n=SUM(A1)",
          "+",
          "-1-2",
          "+(1)",
          "+420-777-123-456",
          "+420 777 123 456",
          "-1.",
          "a=b",
        ]
      )
    ).toBe(
      "Value\r\n'=SUM(A1)\r\n'+cmd|' /C calc'!A0\r\n'-2+3+cmd|' /C calc'!A0\r\n'@cmd\r\n'\tindent\r\n\"'\rlead\"\r\n\"'\n=SUM(A1)\"\r\n'+\r\n'-1-2\r\n'+(1)\r\n'+420-777-123-456\r\n'+420 777 123 456\r\n'-1.\r\na=b\r\n"
    );
  });

  test("keeps plain signed numbers as written", () => {
    expect(
      serializeCsv(
        [{ header: "Value", value: (value: string) => value }],
        ["+420726101229", "-12", "-12.5", "+0.25"]
      )
    ).toBe("Value\r\n+420726101229\r\n-12\r\n-12.5\r\n+0.25\r\n");
  });

  test("defuses formula headers too", () => {
    expect(serializeCsv([{ header: "=Name", value: () => "x" }], [])).toBe(
      "'=Name\r\n"
    );
  });
});

describe("createCsvDownloadResponse", () => {
  test("returns a private UTF-8 CSV attachment with a byte order mark", async () => {
    const response = createCsvDownloadResponse({
      columns,
      filename: "reservations-2026-10-20.csv",
      rows: [{ name: "Žluťoučký kůň", amount: 1 }],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="reservations-2026-10-20.csv"'
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe(
      "Name,Amount\r\nŽluťoučký kůň,1\r\n"
    );
  });

  test("keeps the file name inside its quotes", () => {
    const response = createCsvDownloadResponse({
      columns,
      filename: 'evil"; filename=x.csv',
      rows: [],
    });

    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="evil___filename_x.csv"'
    );
  });
});
