import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  androidApkKeyHashOrigin,
  nativeApp,
  nativeAppOrigin,
  signingCertificateFingerprintSchema,
} from "./native-app";

describe("native app identity", () => {
  test("derives the Android passkey origin of the release signing key", () => {
    expect(androidApkKeyHashOrigin(nativeApp.androidReleaseCertificate)).toBe(
      "android:apk-key-hash:aUKOcRUBdfwOhFIDVEKooRmGTCHQq-nI4jOgVC7JSqA"
    );
  });

  test("names the app scheme as a Better Auth trusted origin", () => {
    expect(nativeAppOrigin).toBe("deskohub://");
  });

  test("accepts a SHA-256 certificate fingerprint as keytool prints it", () => {
    const decode = Schema.decodeUnknownOption(
      signingCertificateFingerprintSchema
    );
    const lowercase = nativeApp.androidReleaseCertificate.toLowerCase();

    expect(decode(nativeApp.androidReleaseCertificate)).toEqual(
      expect.objectContaining({ value: nativeApp.androidReleaseCertificate })
    );
    expect(decode(lowercase)).toEqual(
      expect.objectContaining({ value: nativeApp.androidReleaseCertificate })
    );
    for (const rejected of [
      "",
      nativeApp.androidReleaseCertificate.replaceAll(":", ""),
      nativeApp.androidReleaseCertificate.slice(3),
      `${nativeApp.androidReleaseCertificate}:00`,
      nativeApp.androidReleaseCertificate.replace("69", "6G"),
    ]) {
      expect(decode(rejected)._tag).toBe("None");
    }
  });
});
