import { Option } from "effect";

const base64UrlAlphabet = /^[A-Za-z0-9_-]+$/;

/**
 * The bytes of unpadded base64url text, or nothing unless the text is the
 * one encoding of its bytes. `Buffer.from(value, "base64url")` skips foreign
 * characters, padding and stray trailing bits, so several texts would decode
 * to the same bytes.
 */
export const decodeCanonicalBase64Url = (
  value: string
): Option.Option<Buffer> =>
  Option.some(value).pipe(
    Option.filter((text) => base64UrlAlphabet.test(text)),
    Option.map((text) => Buffer.from(text, "base64url")),
    Option.filter((bytes) => bytes.toString("base64url") === value)
  );
