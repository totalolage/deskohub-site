import { Schema } from "effect";
import type { create, get } from "react-native-passkeys";

/*
 * The WebAuthn JSON that crosses the native passkey bridge. Better Auth's
 * passkey endpoints send WebAuthn options JSON and verify SimpleWebAuthn's
 * `RegistrationResponseJSON` / `AuthenticationResponseJSON`. The native
 * module takes the same options JSON, but its results vary by platform: the
 * Android provider's JSON passes through unchanged, so byte fields may arrive
 * as padded or standard base64, optional fields as `null`, and the iOS
 * registration result carries a `getPublicKey` helper. The mappers below
 * keep every byte as it is and only re-encode it as unpadded base64url.
 * Absent optional fields come out `undefined`, which the JSON request body
 * leaves out.
 */

/**
 * Re-encodes base64 or base64url text as unpadded base64url. The decoded
 * bytes stay the same, so a signed value such as `clientDataJSON` still
 * verifies.
 */
export const toBase64Url = (value: string): string =>
  value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const transports = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
] as const;

type AuthenticatorTransport = (typeof transports)[number];

const isTransport = (value: string): value is AuthenticatorTransport =>
  (transports as readonly string[]).includes(value);

const credentialDescriptor = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("public-key"),
  transports: Schema.optional(Schema.Array(Schema.String)),
});

const userVerification = Schema.Literals([
  "required",
  "preferred",
  "discouraged",
]);

/**
 * `GET /passkey/generate-register-options`. Fields the native modules don't
 * take, such as `hints` and the `credProps` extension, are dropped.
 */
export const PasskeyCreationOptions = Schema.Struct({
  rp: Schema.Struct({
    id: Schema.optional(Schema.String),
    name: Schema.String,
  }),
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    displayName: Schema.String,
  }),
  challenge: Schema.String,
  pubKeyCredParams: Schema.Array(
    Schema.Struct({ type: Schema.Literal("public-key"), alg: Schema.Finite })
  ),
  timeout: Schema.optional(Schema.Finite),
  excludeCredentials: Schema.optional(Schema.Array(credentialDescriptor)),
  authenticatorSelection: Schema.optional(
    Schema.Struct({
      authenticatorAttachment: Schema.optional(
        Schema.Literals(["platform", "cross-platform"])
      ),
      residentKey: Schema.optional(userVerification),
      requireResidentKey: Schema.optional(Schema.Boolean),
      userVerification: Schema.optional(userVerification),
    })
  ),
  attestation: Schema.optional(
    Schema.Literals(["none", "indirect", "direct", "enterprise"])
  ),
});
export type PasskeyCreationOptions = typeof PasskeyCreationOptions.Type;

/** `GET /passkey/generate-authenticate-options`. */
export const PasskeyRequestOptions = Schema.Struct({
  challenge: Schema.String,
  timeout: Schema.optional(Schema.Finite),
  rpId: Schema.optional(Schema.String),
  allowCredentials: Schema.optional(Schema.Array(credentialDescriptor)),
  userVerification: Schema.optional(userVerification),
});
export type PasskeyRequestOptions = typeof PasskeyRequestOptions.Type;

/** What the native module's `create` takes. */
export type NativeCreationRequest = Parameters<typeof create>[0];

/** What the native module's `get` takes. */
export type NativeAuthenticationRequest = Parameters<typeof get>[0];

type CredentialDescriptor = typeof credentialDescriptor.Type;

const toDescriptor = ({ id, type, transports }: CredentialDescriptor) => ({
  id,
  type,
  transports: transports?.filter(isTransport),
});

/** The registration options as the native module's `create` takes them. */
export const toNativeCreationRequest = ({
  rp,
  user,
  challenge,
  pubKeyCredParams,
  timeout,
  excludeCredentials,
  authenticatorSelection,
  attestation,
}: PasskeyCreationOptions): NativeCreationRequest => ({
  rp,
  user,
  challenge,
  pubKeyCredParams: pubKeyCredParams.map(({ type, alg }) => ({ type, alg })),
  timeout,
  excludeCredentials: excludeCredentials?.map(toDescriptor),
  authenticatorSelection,
  attestation,
});

/** The sign-in options as the native module's `get` takes them. */
export const toNativeAuthenticationRequest = ({
  challenge,
  timeout,
  rpId,
  allowCredentials,
  userVerification,
}: PasskeyRequestOptions): NativeAuthenticationRequest => ({
  challenge,
  timeout,
  rpId,
  allowCredentials: allowCredentials?.map(toDescriptor),
  userVerification,
});

/** A `null` the native module may send in place of an absent field. */
const optionalOrNull = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.NullOr(schema));

const nativeCredentialFields = {
  id: Schema.String,
  rawId: optionalOrNull(Schema.String),
  type: optionalOrNull(Schema.String),
  authenticatorAttachment: optionalOrNull(Schema.String),
  clientExtensionResults: optionalOrNull(
    Schema.Record(Schema.String, Schema.Unknown)
  ),
};

/** A registration result as the native module resolves it. */
export const NativeRegistration = Schema.Struct({
  ...nativeCredentialFields,
  response: Schema.Struct({
    clientDataJSON: Schema.String,
    attestationObject: Schema.String,
    authenticatorData: optionalOrNull(Schema.String),
    transports: optionalOrNull(Schema.Array(Schema.String)),
    publicKeyAlgorithm: optionalOrNull(Schema.Finite),
    publicKey: optionalOrNull(Schema.String),
  }),
});
export type NativeRegistration = typeof NativeRegistration.Type;

/** An authentication result as the native module resolves it. */
export const NativeAuthentication = Schema.Struct({
  ...nativeCredentialFields,
  response: Schema.Struct({
    clientDataJSON: Schema.String,
    authenticatorData: Schema.String,
    signature: Schema.String,
    userHandle: optionalOrNull(Schema.String),
  }),
});
export type NativeAuthentication = typeof NativeAuthentication.Type;

type AuthenticatorAttachment = "platform" | "cross-platform";

type CredentialJSON = {
  readonly id: string;
  readonly rawId: string;
  readonly type: "public-key";
  readonly authenticatorAttachment?: AuthenticatorAttachment;
  readonly clientExtensionResults: Readonly<Record<string, unknown>>;
};

/** SimpleWebAuthn's `RegistrationResponseJSON`. */
export type RegistrationResponseJSON = CredentialJSON & {
  readonly response: {
    readonly clientDataJSON: string;
    readonly attestationObject: string;
    readonly authenticatorData?: string;
    readonly transports?: readonly AuthenticatorTransport[];
    readonly publicKeyAlgorithm?: number;
    readonly publicKey?: string;
  };
};

/** SimpleWebAuthn's `AuthenticationResponseJSON`. */
export type AuthenticationResponseJSON = CredentialJSON & {
  readonly response: {
    readonly clientDataJSON: string;
    readonly authenticatorData: string;
    readonly signature: string;
    readonly userHandle?: string;
  };
};

/** Re-encodes an optional byte field; a missing or `null` one stays absent. */
const optionalBytes = (value: string | null | undefined) =>
  value ? toBase64Url(value) : undefined;

const toAttachment = (
  value: string | null | undefined
): AuthenticatorAttachment | undefined =>
  value === "platform" || value === "cross-platform" ? value : undefined;

const toCredentialJSON = (
  credential: NativeRegistration | NativeAuthentication
): CredentialJSON => {
  return {
    id: toBase64Url(credential.id),
    rawId: toBase64Url(credential.rawId ?? credential.id),
    type: "public-key",
    authenticatorAttachment: toAttachment(credential.authenticatorAttachment),
    clientExtensionResults: credential.clientExtensionResults ?? {},
  };
};

export const toRegistrationResponseJSON = (
  registration: NativeRegistration
): RegistrationResponseJSON => {
  const { response } = registration;
  return {
    ...toCredentialJSON(registration),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      authenticatorData: optionalBytes(response.authenticatorData),
      transports: response.transports?.filter(isTransport),
      publicKeyAlgorithm: response.publicKeyAlgorithm ?? undefined,
      publicKey: optionalBytes(response.publicKey),
    },
  };
};

export const toAuthenticationResponseJSON = (
  authentication: NativeAuthentication
): AuthenticationResponseJSON => {
  const { response } = authentication;
  return {
    ...toCredentialJSON(authentication),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: optionalBytes(response.userHandle),
    },
  };
};
