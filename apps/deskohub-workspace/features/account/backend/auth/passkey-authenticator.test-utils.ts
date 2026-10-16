import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

/**
 * A software WebAuthn authenticator for handler tests: one ES256 credential
 * that answers registration and authentication options the way a platform
 * authenticator would, with `none` attestation.
 */

type CBORValue = Parameters<typeof isoCBOR.encode>[0];

const sha256 = (data: Uint8Array | string) =>
  new Uint8Array(createHash("sha256").update(data).digest());

const uint32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
};

const uint16 = (value: number) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
};

const concat = (...parts: readonly Uint8Array[]) => {
  const bytes = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

const aaguidBytes = (aaguid: string) =>
  new Uint8Array(Buffer.from(aaguid.replaceAll("-", ""), "hex"));

const userPresent = 0x01;
const userVerifiedFlag = 0x04;
const attestedCredentialData = 0x40;

/** The all-zero AAGUID privacy-preserving platforms report. */
export const anonymousAaguid = "00000000-0000-0000-0000-000000000000";

/** Google Password Manager's AAGUID in the plugin's provider map. */
export const googlePasswordManagerAaguid =
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4";

export type SoftwarePasskey = ReturnType<typeof makeSoftwarePasskey>;

export const makeSoftwarePasskey = ({
  rpID,
  origin,
  aaguid = anonymousAaguid,
}: {
  readonly rpID: string;
  readonly origin: string;
  readonly aaguid?: string;
}) => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = new Uint8Array(randomBytes(16));
  const id = isoBase64URL.fromBuffer(credentialId);
  const coseKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ])
  );
  let counter = 0;

  const clientData = (type: string, challenge: string) =>
    new TextEncoder().encode(
      JSON.stringify({ type, challenge, origin, crossOrigin: false })
    );

  return {
    id,
    /** Answers `/passkey/generate-register-options`. */
    register: (options: { readonly challenge: string }) => {
      const authenticatorData = concat(
        sha256(rpID),
        new Uint8Array([
          userPresent | userVerifiedFlag | attestedCredentialData,
        ]),
        uint32(counter),
        aaguidBytes(aaguid),
        uint16(credentialId.length),
        credentialId,
        coseKey
      );
      const attestationObject = isoCBOR.encode(
        new Map<string, CBORValue>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authenticatorData],
        ])
      );
      return {
        id,
        rawId: id,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(
            clientData("webauthn.create", options.challenge)
          ),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
          transports: ["internal", "hybrid"],
        },
      };
    },
    /** Answers `/passkey/generate-authenticate-options`. */
    authenticate: (
      options: { readonly challenge: string },
      { userVerified = true }: { readonly userVerified?: boolean } = {}
    ) => {
      counter += 1;
      const authenticatorData = concat(
        sha256(rpID),
        new Uint8Array([userPresent | (userVerified ? userVerifiedFlag : 0)]),
        uint32(counter)
      );
      const clientDataJSON = clientData("webauthn.get", options.challenge);
      const signature = sign(
        "sha256",
        concat(authenticatorData, sha256(clientDataJSON)),
        privateKey
      );
      return {
        id,
        rawId: id,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
          authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
          signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
        },
      };
    },
  };
};
