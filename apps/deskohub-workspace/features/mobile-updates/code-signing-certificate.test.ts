import { describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

const codeSigningUsage = "1.3.6.1.5.5.7.3.3";

const certificate = new X509Certificate(
  readFileSync(new URL("./code-signing-certificate.pem", import.meta.url))
);

describe("mobile update code-signing certificate", () => {
  test("is a self-signed RSA certificate for code signing", () => {
    expect(certificate.verify(certificate.publicKey)).toBe(true);
    expect(certificate.publicKey.asymmetricKeyType).toBe("rsa");
    expect(certificate.publicKey.asymmetricKeyDetails?.modulusLength).toBe(
      2048
    );
    expect(certificate.keyUsage).toContain(codeSigningUsage);
  });

  test("stays valid for released apps well beyond their support window", () => {
    expect(
      new Date(certificate.validTo).getUTCFullYear()
    ).toBeGreaterThanOrEqual(2050);
  });
});
