// SHA-256 of the release signing certificate (alias deskohub-workspace). The
// same fingerprint is published in /.well-known/assetlinks.json, so an APK
// signed with any other key breaks App Links and passkeys.
export const releaseCertificateSha256 =
  "69428e71150175fc0e8452035442a8a119864c21d0abe9c8e233a0542ec94aa0";

const sha256Hex = /^[0-9a-f]{64}$/;
const signerDigestLine =
  /^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$/;

export const normalizeCertificateSha256 = (digest: string): string => {
  const hex = digest.replaceAll(":", "").toLowerCase();
  if (!sha256Hex.test(hex)) {
    throw new Error(`${JSON.stringify(digest)} is not a SHA-256 digest.`);
  }
  return hex;
};

export const formatCertificateSha256 = (digest: string): string =>
  (normalizeCertificateSha256(digest).match(/../g) ?? [])
    .join(":")
    .toUpperCase();

// Reads `apksigner verify --print-certs` output.
export const signerCertificateSha256s = (apksignerOutput: string): string[] =>
  apksignerOutput
    .split("\n")
    .map((line) => signerDigestLine.exec(line.trim())?.[1])
    .filter((digest) => digest !== undefined)
    .map(normalizeCertificateSha256);

export const verifyReleaseSigners = (
  apksignerOutput: string,
  expectedSha256: string = releaseCertificateSha256
): string[] => {
  const expected = normalizeCertificateSha256(expectedSha256);
  const signers = signerCertificateSha256s(apksignerOutput);
  if (signers.length === 0) {
    throw new Error("apksigner reported no signer certificates.");
  }
  const unexpected = signers.filter((digest) => digest !== expected);
  if (unexpected.length > 0) {
    throw new Error(
      `The APK is signed with ${unexpected.map(formatCertificateSha256).join(", ")}, not the release certificate ${formatCertificateSha256(expected)}.`
    );
  }
  return signers;
};
