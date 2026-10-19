import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { getPasskeyAssertion } from "./webauthn-assertion";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

const assertion = {
  id: "credential-id",
  rawId: bytes(1, 2, 3),
  type: "public-key",
  authenticatorAttachment: "platform",
  response: {
    authenticatorData: bytes(4),
    clientDataJSON: bytes(5),
    signature: bytes(6),
    userHandle: bytes(7),
  },
};

const get = mock(
  (_options: CredentialRequestOptions): Promise<unknown> =>
    Promise.resolve(assertion)
);
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator"
);

const requestOptions = {
  challenge: "AQID",
  rpId: "workspace.invalid",
  userVerification: "preferred",
  allowCredentials: [
    { id: "BAU", type: "public-key", transports: ["internal"] },
  ],
} as const;

const requested = () => {
  const options = get.mock.calls.at(-1)?.[0];
  if (options?.publicKey === undefined) throw new Error("No request.");
  return { ...options, publicKey: options.publicKey };
};

describe("passkey assertions", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { credentials: { get } },
    });
  });

  afterAll(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  });

  afterEach(() => {
    get.mockClear();
  });

  test("asks for a modal assertion of the allowed passkeys under the signal", async () => {
    const { signal } = new AbortController();

    await expect(
      getPasskeyAssertion(requestOptions, { conditional: false, signal })
    ).resolves.toEqual({
      id: "credential-id",
      rawId: "AQID",
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        authenticatorData: "BA",
        clientDataJSON: "BQ",
        signature: "Bg",
        userHandle: "Bw",
      },
    });

    const { mediation, publicKey, signal: requestSignal } = requested();
    expect(mediation).toBeUndefined();
    expect(requestSignal).toBe(signal);
    expect(publicKey.rpId).toBe("workspace.invalid");
    expect(new Uint8Array(publicKey.challenge as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3])
    );
    const [allowed] = publicKey.allowCredentials ?? [];
    expect(new Uint8Array(allowed?.id as ArrayBuffer)).toEqual(
      new Uint8Array([4, 5])
    );
    expect(allowed?.transports).toEqual(["internal"]);
  });

  test("offers every passkey in a conditional request", async () => {
    await getPasskeyAssertion(requestOptions, {
      conditional: true,
      signal: new AbortController().signal,
    });

    expect(requested().mediation).toBe("conditional");
    expect(requested().publicKey.allowCredentials).toEqual([]);
  });

  test("leaves an empty allow list out of a modal request", async () => {
    await getPasskeyAssertion(
      { ...requestOptions, allowCredentials: [] },
      { conditional: false, signal: new AbortController().signal }
    );

    expect(requested().publicKey.allowCredentials).toBeUndefined();
  });

  test("passes the browser's error on and rejects a missing credential", async () => {
    const dismissed = new DOMException("Dismissed", "NotAllowedError");
    get.mockRejectedValueOnce(dismissed);
    const request = () =>
      getPasskeyAssertion(requestOptions, {
        conditional: false,
        signal: new AbortController().signal,
      });

    await expect(request()).rejects.toBe(dismissed);
    get.mockResolvedValueOnce(null);
    await expect(request()).rejects.toThrow("No passkey was picked.");
  });
});
