import { describe, expect, test } from "bun:test";
import { parseCsv } from "@/shared/testing/csv";
import { countCsvRecords, serializeCsv } from "./csv";

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
        "=1+1",
        "＝1+1",
        "\tformula",
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
        "=1+1",
        "＝1+1",
        "\tformula",
        "",
        "",
        "42",
      ],
      ["", "only-second", "multi\nline\r\nmixed\rtext"],
    ]);
  });
});

describe("countCsvRecords", () => {
  test("counts ordinary records", () => {
    expect(countCsvRecords("a,b\r\nc,d\r\ne,f")).toBe(3);
  });

  test("does not count a record inside a quoted field with an embedded CRLF", () => {
    expect(countCsvRecords('a,"multi\r\nline"\r\nb,c')).toBe(2);
  });

  test("does not end a record on an escaped double quote", () => {
    expect(countCsvRecords('"say ""bye"" now",x\r\ny,z')).toBe(2);
  });

  test("counts a header-only document as one record", () => {
    expect(countCsvRecords("H1,H2")).toBe(1);
    expect(countCsvRecords("H1,H2\r\n")).toBe(1);
  });

  test("counts zero records for an empty document", () => {
    expect(countCsvRecords("")).toBe(0);
  });

  test("supports LF-only record ends", () => {
    expect(countCsvRecords("a,b\nc,d\n")).toBe(2);
  });

  test("counts records that serialize with embedded line breaks round-trip", () => {
    const csv = serializeCsv([
      ["id", "customer"],
      ["1", "Example\r\nCustomer"],
      ["2", 'quoted "name"'],
    ]);
    expect(countCsvRecords(csv)).toBe(3);
  });
});
