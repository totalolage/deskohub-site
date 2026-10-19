import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

/**
 * A request the test settles by hand. Like `fetch` and `credentials.get`,
 * it rejects as soon as its signal aborts, unless it `ignoresAbort`: a
 * response that still arrives afterwards.
 */
type Answer =
  | { readonly id: string }
  | {
      readonly data: unknown;
      readonly error: { readonly code?: string } | null;
    };

type PendingRequest = {
  readonly path: string;
  readonly signal: AbortSignal;
  /** Whether a request before this one had been aborted when it started. */
  readonly earlierAborted: readonly boolean[];
  readonly resolve: (value: Answer) => void;
  readonly reject: (cause: unknown) => void;
};

const requests: PendingRequest[] = [];
let ignoresAbort = false;

const pending = (path: string, signal: AbortSignal) => {
  const { promise, resolve, reject } = Promise.withResolvers<Answer>();
  const earlierAborted = requests.map((request) => request.signal.aborted);
  requests.push({ path, signal, earlierAborted, resolve, reject });
  if (!ignoresAbort) {
    signal.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError"))
    );
  }
  return promise;
};

const $fetch = mock((path: string, options: { readonly signal: AbortSignal }) =>
  pending(path, options.signal)
);
const notify = mock((_signal: string) => undefined);
const getPasskeyAssertion = mock(
  (
    _options: PublicKeyCredentialRequestOptionsJSON,
    { conditional, signal }: { conditional: boolean; signal: AbortSignal }
  ) => pending(conditional ? "conditional" : "modal", signal)
);

mock.module("./auth.client", () => ({
  authClient: { $fetch, $store: { notify } },
}));
mock.module("@/shared/browser/webauthn-assertion", () => ({
  getPasskeyAssertion,
}));

const optionsPath = "/passkey/generate-authenticate-options";
const verifyPath = "/passkey/verify-authentication";
const options = { data: { challenge: "c2lnbi1pbg" }, error: null };
const signedIn = {
  data: { session: { userId: "account-1" }, user: { id: "account-1" } },
  error: null,
};
const cancelled = { data: null, error: { code: "AUTH_CANCELLED" } };

let signIn: typeof import("./passkey-sign-in").requestPasskeySignIn;
const attempts: Promise<unknown>[] = [];

/** Starts an attempt that the test's cleanup settles. */
const requestPasskeySignIn: typeof signIn = (request) => {
  const attempt = signIn(request);
  attempts.push(attempt.catch(() => undefined));
  return attempt;
};

/** Lets every settled request's continuation run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const lastRequest = (path: string) => {
  const request = requests.findLast((candidate) => candidate.path === path);
  if (request === undefined) throw new Error(`No ${path} request.`);
  return request;
};

const startedPaths = () => requests.map((request) => request.path);

/** Answers the button attempt's requests until it signs in. */
const completeButton = async () => {
  lastRequest(optionsPath).resolve(options);
  await flush();
  lastRequest("modal").resolve({ id: "credential" });
  await flush();
  lastRequest(verifyPath).resolve(signedIn);
};

describe("passkey sign-in attempts", () => {
  beforeAll(async () => {
    ({ requestPasskeySignIn: signIn } = await import("./passkey-sign-in"));
  });

  afterEach(async () => {
    ignoresAbort = false;
    // Settle what a test left pending, so no attempt stays the current one.
    for (const request of requests) request.reject(new Error("test ended"));
    await Promise.all(attempts);
    attempts.length = 0;
    requests.length = 0;
    for (const fn of [$fetch, notify, getPasskeyAssertion]) fn.mockClear();
  });

  test("signs in through the options, the ceremony, and the verification", async () => {
    const attempt = requestPasskeySignIn({ autoFill: false });
    await completeButton();

    await expect(attempt).resolves.toEqual(signedIn);
    expect(startedPaths()).toEqual([optionsPath, "modal", verifyPath]);
    expect($fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: { response: { id: "credential" } },
    });
    expect(notify).toHaveBeenCalledWith("$sessionSignal");
  });

  test("aborts the autofill options request before the button asks for its own", async () => {
    const autofill = requestPasskeySignIn({ autoFill: true });
    const button = requestPasskeySignIn({ autoFill: false });

    // The challenge cookie of the aborted request can't replace the
    // button's: it was aborted before the button's request started.
    expect(lastRequest(optionsPath).earlierAborted).toEqual([true]);
    await expect(autofill).resolves.toEqual(cancelled);
    await completeButton();
    await expect(button).resolves.toEqual(signedIn);
    expect(startedPaths()).toEqual([
      optionsPath,
      optionsPath,
      "modal",
      verifyPath,
    ]);
  });

  test("aborts a pending autofill ceremony before the button asks for options", async () => {
    const autofill = requestPasskeySignIn({ autoFill: true });
    lastRequest(optionsPath).resolve(options);
    await flush();
    expect(startedPaths()).toEqual([optionsPath, "conditional"]);

    const button = requestPasskeySignIn({ autoFill: false });

    expect(lastRequest(optionsPath).earlierAborted).toEqual([true, true]);
    await expect(autofill).resolves.toEqual(cancelled);
    await completeButton();
    await expect(button).resolves.toEqual(signedIn);
  });

  test("never starts an autofill ceremony when its options arrive after the click", async () => {
    // The options body was still on its way when the customer clicked.
    ignoresAbort = true;
    const autofill = requestPasskeySignIn({ autoFill: true });
    const button = requestPasskeySignIn({ autoFill: false });

    requests[0]?.resolve(options);
    await expect(autofill).resolves.toEqual(cancelled);
    await completeButton();

    await expect(button).resolves.toEqual(signedIn);
    expect(startedPaths()).not.toContain("conditional");
    expect(lastRequest("modal").signal.aborted).toBe(false);
  });

  test("starts no autofill once the customer has clicked", async () => {
    // A slow autofill capability check that resolves after the click.
    const button = requestPasskeySignIn({ autoFill: false });
    const autofill = requestPasskeySignIn({ autoFill: true });

    await expect(autofill).resolves.toEqual(cancelled);
    expect(startedPaths()).toEqual([optionsPath]);
    expect(requests[0]?.signal.aborted).toBe(false);
    await completeButton();
    await expect(button).resolves.toEqual(signedIn);

    // Once the button attempt settled, autofill starts again.
    void requestPasskeySignIn({ autoFill: true });
    expect(startedPaths().at(-1)).toBe(optionsPath);
  });

  test("lets the button through a hung autofill options request that answers much later", async () => {
    ignoresAbort = true;
    const autofill = requestPasskeySignIn({ autoFill: true });
    const button = requestPasskeySignIn({ autoFill: false });

    await completeButton();
    await expect(button).resolves.toEqual(signedIn);

    requests[0]?.resolve(options);
    await expect(autofill).resolves.toEqual(cancelled);
    expect(startedPaths()).toEqual([
      optionsPath,
      optionsPath,
      "modal",
      verifyPath,
    ]);
  });

  test("replaces an older card's autofill, whose late options start nothing", async () => {
    ignoresAbort = true;
    const older = requestPasskeySignIn({ autoFill: true });
    const newer = requestPasskeySignIn({ autoFill: true });

    requests[0]?.resolve(options);
    await expect(older).resolves.toEqual(cancelled);
    requests[1]?.resolve(options);
    await flush();

    expect(startedPaths()).toEqual([optionsPath, optionsPath, "conditional"]);
    expect(lastRequest("conditional").signal).toBe(requests[1]!.signal);
    lastRequest("conditional").resolve({ id: "credential" });
    await flush();
    lastRequest(verifyPath).resolve(signedIn);
    await expect(newer).resolves.toEqual(signedIn);
  });

  test("an attempt its owner cancelled sends no further request", async () => {
    ignoresAbort = true;
    const card = new AbortController();
    const autofill = requestPasskeySignIn({
      autoFill: true,
      signal: card.signal,
    });

    card.abort();
    expect(requests[0]?.signal.aborted).toBe(true);
    requests[0]?.resolve(options);
    await expect(autofill).resolves.toEqual(cancelled);
    expect(startedPaths()).toEqual([optionsPath]);

    await expect(
      requestPasskeySignIn({ autoFill: false, signal: card.signal })
    ).resolves.toEqual(cancelled);
    expect(startedPaths()).toEqual([optionsPath]);
  });

  test("cancels a button attempt whose card closed during the verification", async () => {
    const card = new AbortController();
    const button = requestPasskeySignIn({
      autoFill: false,
      signal: card.signal,
    });
    lastRequest(optionsPath).resolve(options);
    await flush();
    lastRequest("modal").resolve({ id: "credential" });
    await flush();

    card.abort();
    await expect(button).resolves.toEqual(cancelled);
    expect(notify).not.toHaveBeenCalled();
  });

  test("reports the sign-in of an attempt cancelled once the session exists", async () => {
    const card = new AbortController();
    notify.mockImplementationOnce(() => card.abort());
    const button = requestPasskeySignIn({
      autoFill: false,
      signal: card.signal,
    });
    await completeButton();

    await expect(button).resolves.toEqual(signedIn);
    expect(card.signal.aborted).toBe(true);
  });

  test("returns a refused options or verification response unchanged", async () => {
    const refusedOptions = { data: null, error: { code: "RATE_LIMITED" } };
    const first = requestPasskeySignIn({ autoFill: false });
    lastRequest(optionsPath).resolve(refusedOptions);
    await expect(first).resolves.toEqual(refusedOptions);

    const refused = { data: null, error: { code: "AUTHENTICATION_FAILED" } };
    const second = requestPasskeySignIn({ autoFill: false });
    lastRequest(optionsPath).resolve(options);
    await flush();
    lastRequest("modal").resolve({ id: "credential" });
    await flush();
    lastRequest(verifyPath).resolve(refused);
    await expect(second).resolves.toEqual(refused);
    expect(notify).not.toHaveBeenCalled();
  });

  test.each([
    ["NotAllowedError", "AUTH_CANCELLED"],
    ["AbortError", "AUTH_CANCELLED"],
    ["SecurityError", "PASSKEY_CEREMONY_FAILED"],
  ] as const)("reads a ceremony %s as %s", async (name, code) => {
    const attempt = requestPasskeySignIn({ autoFill: false });
    lastRequest(optionsPath).resolve(options);
    await flush();
    lastRequest("modal").reject(new DOMException("synthetic", name));

    await expect(attempt).resolves.toEqual({ data: null, error: { code } });
    expect(startedPaths()).not.toContain(verifyPath);
  });

  test("rejects with a network failure the attempt didn't cause", async () => {
    const attempt = requestPasskeySignIn({ autoFill: false });
    lastRequest(optionsPath).reject(new TypeError("synthetic network"));

    await expect(attempt).rejects.toThrow("synthetic network");
  });
});
