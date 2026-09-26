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

  test("round-trips a quoting-heavy document without corrupting fields", () => {
    const rows = [
      ["name, with comma", 'quote " inside', "line\nbreak"],
      ["plain", 42, null],
    ];
    const csv = serializeCsv(rows);
    expect(csv).toBe(
      '"name, with comma","quote "" inside","line\nbreak"\r\nplain,42,'
    );
    // Every CRLF inside the document belongs to a quoted field except the
    // row separators: two rows means exactly one unquoted CRLF separator.
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});
