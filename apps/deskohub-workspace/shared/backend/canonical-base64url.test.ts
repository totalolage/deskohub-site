import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { decodeCanonicalBase64Url } from "./canonical-base64url";

describe("canonical base64url", () => {
  test("decodes the one unpadded encoding of some bytes", () => {
    const bytes = Buffer.from([0xfb, 0xff, 0x00, 0x7e]);

    expect(decodeCanonicalBase64Url(bytes.toString("base64url"))).toEqual(
      Option.some(bytes)
    );
  });

  test("rejects other texts that decode to the same bytes", () => {
    // "-_8Afg" is the canonical encoding of the bytes above.
    for (const text of [
      "",
      "-_8Afg==",
      "-_8Afh",
      "+/8Afg",
      "-_8A fg",
      "-_8Af",
    ]) {
      expect(decodeCanonicalBase64Url(text)).toEqual(Option.none());
    }
  });
});
