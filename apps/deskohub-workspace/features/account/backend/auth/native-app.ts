import { Schema, SchemaGetter } from "effect";

/**
 * The Deskohub Workspace native app as this server trusts it: the app scheme
 * its Better Auth Expo client sends as the origin, the Android application id
 * (also the iOS bundle id), and the SHA-256 fingerprint of the release
 * signing certificate, as `keytool -list -v` prints it. Android refuses an
 * update signed with any other key, so rotating the key means adding the new
 * fingerprint next to this one rather than replacing it.
 */
export const nativeApp = {
  scheme: "deskohub",
  applicationId: "cz.deskohub.workspace",
  androidReleaseCertificate:
    "69:42:8E:71:15:01:75:FC:0E:84:52:03:54:42:A8:A1:19:86:4C:21:D0:AB:E9:C8:E2:33:A0:54:2E:C9:4A:A0",
} as const;

/** The origin the app's Better Auth requests carry, as a trusted origin. */
export const nativeAppOrigin = `${nativeApp.scheme}://`;

/**
 * The WebAuthn origin Android Credential Manager reports for an app signed
 * with the given certificate: the fingerprint bytes in unpadded base64url
 * after `android:apk-key-hash:`.
 */
export const androidApkKeyHashOrigin = (certificateFingerprint: string) =>
  `android:apk-key-hash:${Buffer.from(
    certificateFingerprint.replaceAll(":", ""),
    "hex"
  ).toString("base64url")}`;

/**
 * A SHA-256 signing-certificate fingerprint: 32 colon-separated hex bytes,
 * in either letter case, decoded to upper case.
 */
export const signingCertificateFingerprintSchema = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((value: string) => value.toUpperCase()),
    encode: SchemaGetter.passthrough(),
  }),
  Schema.check(Schema.isPattern(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/))
);
