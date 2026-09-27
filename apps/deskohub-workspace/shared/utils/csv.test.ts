import { describe, expect, test } from "bun:test";
import { parseCsv } from "@/shared/testing/csv";
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
