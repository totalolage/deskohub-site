import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import fixtures from "./passkey.test-fixtures.json";
import {
  type AuthenticationResponseJSON,
  NativeAuthentication,
  NativeRegistration,
  PasskeyCreationOptions,
  PasskeyRequestOptions,
  type RegistrationResponseJSON,
  toAuthenticationResponseJSON,
  toBase64Url,
  toNativeAuthenticationRequest,
  toNativeCreationRequest,
  toRegistrationResponseJSON,
} from "./passkey-credential";

// Synthetic options from SimpleWebAuthn and a software authenticator's
// responses that verify against them; no key material.
const { registrationOptions, authenticationOptions } = fixtures;
const registrationResponse =
  fixtures.registrationResponse as RegistrationResponseJSON;
const authenticationResponse = fixtures.authenticationResponse as Omit<
  AuthenticationResponseJSON,
  "response"
> & {
  readonly response: AuthenticationResponseJSON["response"] & {
    readonly userHandle: string;
  };
};

/** The same bytes as padded, standard base64, as some providers send it. */
const toStandardBase64 = (base64Url: string) =>
  Buffer.from(base64Url, "base64url").toString("base64");

const bytes = (base64: string) => Buffer.from(base64, "base64");

const decodeRegistration = Schema.decodeUnknownSync(NativeRegistration);
const decodeAuthentication = Schema.decodeUnknownSync(NativeAuthentication);

describe("toBase64Url", () => {
  test("re-encodes padded standard base64 without changing the bytes", () => {
    const value = Buffer.from([0xfb, 0xff, 0xbf, 0x3e, 0x00]);
    const standard = value.toString("base64");
    expect(standard).toContain("+");
    expect(standard).toContain("/");
    expect(standard).toEndWith("=");

    const encoded = toBase64Url(standard);

    expect(encoded).toBe(value.toString("base64url"));
    expect(bytes(encoded)).toEqual(value);
  });

  test("keeps unpadded base64url as it is", () => {
    const value = registrationResponse.response.clientDataJSON;
    expect(toBase64Url(value)).toBe(value);
  });
});

describe("toRegistrationResponseJSON", () => {
  test("posts a result that already matches unchanged", () => {
    expect(
      toRegistrationResponseJSON(decodeRegistration(registrationResponse))
    ).toEqual(registrationResponse);
  });

  test("normalizes base64, nulls and a missing rawId, keeping the signed bytes", () => {
    const { response } = registrationResponse;
    const native = {
      id: toStandardBase64(registrationResponse.id),
      type: null,
      authenticatorAttachment: null,
      clientExtensionResults: null,
      response: {
        clientDataJSON: toStandardBase64(response.clientDataJSON),
        attestationObject: toStandardBase64(response.attestationObject),
        authenticatorData: null,
        publicKeyAlgorithm: null,
        publicKey: null,
        transports: ["internal", "hybrid", "carrier-pigeon"],
        getPublicKey: () => "not JSON",
      },
    };

    const mapped = toRegistrationResponseJSON(decodeRegistration(native));

    expect(mapped).toEqual({
      ...registrationResponse,
      authenticatorAttachment: undefined,
    });
    expect(Object.keys(mapped.response)).not.toContain("getPublicKey");
    expect(bytes(mapped.response.clientDataJSON)).toEqual(
      bytes(native.response.clientDataJSON)
    );
    expect(JSON.parse(JSON.stringify(mapped))).not.toHaveProperty(
      "authenticatorAttachment"
    );
  });

  test("fills a missing clientExtensionResults with an empty object", () => {
    const { clientExtensionResults: _, ...withoutExtensions } =
      registrationResponse;

    expect(
      toRegistrationResponseJSON(decodeRegistration(withoutExtensions))
        .clientExtensionResults
    ).toEqual({});
  });

  test("keeps the optional response fields a provider sends", () => {
    const mapped = toRegistrationResponseJSON(
      decodeRegistration({
        ...registrationResponse,
        response: {
          ...registrationResponse.response,
          authenticatorData: "AAEC+/8=",
          publicKeyAlgorithm: -7,
          publicKey: "MFkw/+==",
        },
      })
    );

    expect(mapped.response).toMatchObject({
      authenticatorData: "AAEC-_8",
      publicKeyAlgorithm: -7,
      publicKey: "MFkw_-",
    });
  });

  test("rejects a result without the attestation", () => {
    const { attestationObject: _, ...response } = registrationResponse.response;

    expect(() =>
      decodeRegistration({ ...registrationResponse, response })
    ).toThrow();
  });
});

describe("toAuthenticationResponseJSON", () => {
  test("posts a result that already matches unchanged", () => {
    expect(
      toAuthenticationResponseJSON(decodeAuthentication(authenticationResponse))
    ).toEqual(authenticationResponse);
  });

  test("normalizes base64 and nulls, keeping the signed bytes", () => {
    const { response } = authenticationResponse;
    const native = {
      ...authenticationResponse,
      rawId: null,
      clientExtensionResults: undefined,
      response: {
        clientDataJSON: toStandardBase64(response.clientDataJSON),
        authenticatorData: toStandardBase64(response.authenticatorData),
        signature: toStandardBase64(response.signature),
        userHandle: toStandardBase64(response.userHandle),
        attestationObject: null,
      },
    };

    const mapped = toAuthenticationResponseJSON(decodeAuthentication(native));

    expect(mapped).toEqual(authenticationResponse);
    expect(bytes(mapped.response.clientDataJSON)).toEqual(
      bytes(native.response.clientDataJSON)
    );
    expect(bytes(mapped.response.signature)).toEqual(
      bytes(native.response.signature)
    );
    expect(Object.keys(mapped.response)).not.toContain("attestationObject");
  });

  test("leaves out a userHandle the authenticator didn't return", () => {
    const mapped = toAuthenticationResponseJSON(
      decodeAuthentication({
        ...authenticationResponse,
        response: { ...authenticationResponse.response, userHandle: null },
      })
    );

    expect(JSON.parse(JSON.stringify(mapped.response))).not.toHaveProperty(
      "userHandle"
    );
  });
});

describe("server options", () => {
  const decodeCreation = Schema.decodeUnknownSync(PasskeyCreationOptions);
  const decodeRequest = Schema.decodeUnknownSync(PasskeyRequestOptions);

  test("reach the native module as the server sent them, without what it doesn't take", () => {
    const { extensions: _, hints: __, ...taken } = registrationOptions;

    expect<unknown>(
      toNativeCreationRequest(decodeCreation(registrationOptions))
    ).toEqual(taken);
    expect<unknown>(
      toNativeAuthenticationRequest(decodeRequest(authenticationOptions))
    ).toEqual(authenticationOptions);
  });

  test("drop transports the module doesn't know", () => {
    const [allowed] = authenticationOptions.allowCredentials;
    const request = toNativeAuthenticationRequest(
      decodeRequest({
        ...authenticationOptions,
        allowCredentials: [
          { ...allowed, transports: ["internal", "carrier-pigeon"] },
        ],
      })
    );

    expect(request.allowCredentials?.[0]?.transports).toEqual(["internal"]);
  });

  test("reject options without a challenge", () => {
    const { challenge: _, ...withoutChallenge } = authenticationOptions;

    expect(() => decodeRequest(withoutChallenge)).toThrow();
  });
});
