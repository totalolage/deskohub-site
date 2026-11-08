import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import {
  encodeBase64Url,
  isPkceVerifier,
  pkceChallengeFromDigest,
  pkceVerifierFromBytes,
} from "./pkce";

// RFC 7636 appendix B.
const rfcVerifierOctets = Uint8Array.from([
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186,
  22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
]);
const rfcVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const rfcChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const sha256 = (text: string) =>
  new Uint8Array(createHash("sha256").update(text, "ascii").digest());

describe("PKCE", () => {
  test("encodes the RFC 7636 verifier octets", () => {
    expect(pkceVerifierFromBytes(rfcVerifierOctets)).toBe(rfcVerifier);
  });

  test("derives the RFC 7636 S256 challenge", () => {
    expect(pkceChallengeFromDigest(sha256(rfcVerifier))).toBe(rfcChallenge);
  });

  test("makes 43-character verifiers from the unreserved charset", () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const verifier = pkceVerifierFromBytes(new Uint8Array(randomBytes(32)));
      expect(verifier).toHaveLength(43);
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
      expect(isPkceVerifier(verifier)).toBe(true);
    }
  });

  test("refuses verifier input shorter than 32 bytes", () => {
    expect(() => pkceVerifierFromBytes(new Uint8Array(31))).toThrow();
  });

  test("checks the verifier length and charset bounds", () => {
    expect(isPkceVerifier("a".repeat(42))).toBe(false);
    expect(isPkceVerifier("a".repeat(43))).toBe(true);
    expect(isPkceVerifier("a".repeat(128))).toBe(true);
    expect(isPkceVerifier("a".repeat(129))).toBe(false);
    expect(isPkceVerifier(`${"a".repeat(42)}+`)).toBe(false);
    expect(isPkceVerifier(`${"a".repeat(42)}=`)).toBe(false);
  });

  test("encodes base64url without padding", () => {
    expect(encodeBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(encodeBase64Url(new Uint8Array([]))).toBe("");
  });
});
