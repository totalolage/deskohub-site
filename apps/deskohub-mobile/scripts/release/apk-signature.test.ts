import { describe, expect, test } from "bun:test";
import {
  formatCertificateSha256,
  normalizeCertificateSha256,
  releaseCertificateSha256,
  signerCertificateSha256s,
  verifyNonReleaseSigners,
  verifyReleaseSigners,
} from "./apk-signature";

const releaseDigest = releaseCertificateSha256;
const otherDigest = "b".repeat(64);

const apksignerOutput = (...digests: readonly string[]) =>
  [
    "Verifies",
    "Verified using v1 scheme (JAR signing): false",
    "Verified using v2 scheme (APK Signature Scheme v2): true",
    "Verified using v3 scheme (APK Signature Scheme v3): true",
    "Number of signers: 1",
    ...digests.flatMap((digest, index) => [
      `Signer #${index + 1} certificate DN: CN=Deskohub`,
      `Signer #${index + 1} certificate SHA-256 digest: ${digest}`,
      `Signer #${index + 1} certificate SHA-1 digest: ${"c".repeat(40)}`,
      `Signer #${index + 1} certificate MD5 digest: ${"d".repeat(32)}`,
    ]),
  ].join("\n");

describe("signerCertificateSha256s", () => {
  test("reads every signer's SHA-256 digest", () => {
    expect(
      signerCertificateSha256s(apksignerOutput(releaseDigest, otherDigest))
    ).toEqual([releaseDigest, otherDigest]);
  });

  test("reads per-scheme signer lines that --verbose prints", () => {
    const verbose = [
      "Verifies",
      "Verified using v2 scheme (APK Signature Scheme v2): true",
      "Number of signers: 1",
      "V2 Signer: certificate DN: CN=Deskohub",
      `V2 Signer: certificate SHA-256 digest: ${releaseDigest}`,
      `V2 Signer: certificate SHA-1 digest: ${"c".repeat(40)}`,
      `V2 Signer: public key SHA-256 digest: ${otherDigest}`,
      `V3.1 Signer #2: certificate SHA-256 digest: ${otherDigest}`,
    ].join("\n");
    expect(signerCertificateSha256s(verbose)).toEqual([
      releaseDigest,
      otherDigest,
    ]);
  });

  test("ignores SHA-1 and MD5 digests", () => {
    expect(signerCertificateSha256s(apksignerOutput())).toEqual([]);
  });
});

describe("verifyReleaseSigners", () => {
  test("accepts an APK signed only with the release certificate", () => {
    expect(verifyReleaseSigners(apksignerOutput(releaseDigest))).toEqual([
      releaseDigest,
    ]);
  });

  test("rejects an APK signed with another certificate", () => {
    expect(() => verifyReleaseSigners(apksignerOutput(otherDigest))).toThrow(
      formatCertificateSha256(otherDigest)
    );
  });

  test("rejects an APK with an extra signer", () => {
    expect(() =>
      verifyReleaseSigners(apksignerOutput(releaseDigest, otherDigest))
    ).toThrow();
  });

  test("rejects output without signers", () => {
    expect(() => verifyReleaseSigners(apksignerOutput())).toThrow();
  });
});

describe("verifyNonReleaseSigners", () => {
  test("accepts an APK signed with another certificate", () => {
    expect(verifyNonReleaseSigners(apksignerOutput(otherDigest))).toEqual([
      otherDigest,
    ]);
  });

  test("rejects an APK signed with the release certificate", () => {
    expect(() =>
      verifyNonReleaseSigners(apksignerOutput(releaseDigest))
    ).toThrow(formatCertificateSha256(releaseDigest));
  });

  test("rejects an APK with the release certificate among its signers", () => {
    expect(() =>
      verifyNonReleaseSigners(apksignerOutput(otherDigest, releaseDigest))
    ).toThrow();
  });

  test("rejects output without signers", () => {
    expect(() => verifyNonReleaseSigners(apksignerOutput())).toThrow();
  });
});

describe("certificate digest formats", () => {
  test("round-trips between apksigner hex and keytool colon form", () => {
    const digest = `0a1b${"f".repeat(60)}`;
    const colon = formatCertificateSha256(digest);
    expect(colon).toBe(`0A:1B${":FF".repeat(30)}`);
    expect(normalizeCertificateSha256(colon)).toBe(digest);
  });

  test("rejects a digest of the wrong length", () => {
    expect(() => normalizeCertificateSha256("69:42")).toThrow();
  });
});
