import { describe, expect, test } from "bun:test";
import { encodeMultipartMixed, parseMultipartMixed } from "./multipart-mixed";

describe("multipart/mixed bodies", () => {
  test("frames each part with its headers between boundary delimiters", () => {
    const { contentType, body } = encodeMultipartMixed(
      [
        {
          headers: { "content-type": "application/json", "x-part": "one" },
          body: '{"a":1}',
        },
        { headers: { "content-type": "text/plain" }, body: "second" },
      ],
      "frontier"
    );

    expect(contentType).toBe("multipart/mixed; boundary=frontier");
    expect(body).toBe(
      [
        "--frontier",
        "content-type: application/json",
        "x-part: one",
        "",
        '{"a":1}',
        "--frontier",
        "content-type: text/plain",
        "",
        "second",
        "--frontier--",
        "",
      ].join("\r\n")
    );
  });

  test("encodes no parts as a body with only the closing delimiter", () => {
    expect(encodeMultipartMixed([], "frontier").body).toBe("--frontier--\r\n");
  });

  test("parses what it encodes, keeping each part's exact body", () => {
    const parts = [
      {
        headers: { "Content-Disposition": 'form-data; name="manifest"' },
        body: '{\r\n"line":"two"}',
      },
      { headers: {}, body: "" },
    ];
    const { contentType, body } = encodeMultipartMixed(parts);

    const parsed = parseMultipartMixed(contentType, body);

    expect(parsed?.map((part) => part.body)).toEqual([
      '{\r\n"line":"two"}',
      "",
    ]);
    expect(parsed?.[0]?.headers.get("content-disposition")).toBe(
      'form-data; name="manifest"'
    );
  });

  test("parses a quoted boundary and ignores preamble and epilogue", () => {
    const body = "preamble\r\n--b\r\nname: x\r\n\r\nvalue\r\n--b--\r\nepilogue";

    const parsed = parseMultipartMixed('multipart/mixed; boundary="b"', body);

    expect(
      parsed?.map((part) => [part.headers.get("name"), part.body])
    ).toEqual([["x", "value"]]);
  });

  test("rejects a body that is not multipart/mixed or never closes", () => {
    expect(parseMultipartMixed("application/json", "{}")).toBeUndefined();
    expect(
      parseMultipartMixed("multipart/mixed; boundary=b", "--b\r\n\r\nx")
    ).toBeUndefined();
  });
});
