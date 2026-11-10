import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  CustomerApi,
  type CustomerApiTransport,
  CustomerAuthApi,
} from "./customer-api.service";
import {
  nativeCustomerApiTransport,
  webCustomerApiTransport,
} from "./platform-transports";

const apiOrigin = "https://workspace.deskohub.test";
const cookie = "deskohub.session_token=abc";

interface SentRequest {
  readonly url: string;
  readonly credentials: RequestCredentials | undefined;
  readonly headers: Headers;
}

/** A fetch that records what the adapter sends and answers `body`. */
const recordingFetch = (body: unknown) => {
  const sent: SentRequest[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      credentials: init?.credentials,
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
};

const account = {
  kind: "deletion-pending",
  email: testEmailAddress("customer"),
  deletion: "pending",
  locale: null,
};

const run = <A, E>(
  effect: Effect.Effect<A, E, CustomerApi | CustomerAuthApi>,
  transport: Layer.Layer<CustomerApiTransport>,
  fetch: typeof globalThis.fetch
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(CustomerApi.Default, CustomerAuthApi.Default).pipe(
          Layer.provide(transport),
          Layer.provide(FetchHttpClient.layer)
        )
      ),
      Effect.provideService(FetchHttpClient.Fetch, fetch)
    )
  );

const native = nativeCustomerApiTransport({
  apiOrigin,
  readSessionCookie: Effect.succeed(cookie),
});

describe("native customer API transport", () => {
  test("sends the stored cookie without the platform cookie jar or an origin", async () => {
    const { fetch, sent } = recordingFetch(account);

    await run(
      Effect.flatMap(Effect.service(CustomerApi), (api) =>
        api.account.getAccount({ headers: {} })
      ),
      native,
      fetch
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${apiOrigin}/api/customer/account`);
    expect(sent[0]?.credentials).toBe("omit");
    expect(sent[0]?.headers.get("cookie")).toBe(cookie);
    expect(sent[0]?.headers.get("x-deskohub-client")).toBe(
      "workspace-customer-api"
    );
    expect(sent[0]?.headers.has("origin")).toBe(false);
    expect(sent[0]?.headers.has("expo-origin")).toBe(false);
  });

  test("marks Better Auth mutations with the trusted app origin", async () => {
    const { fetch, sent } = recordingFetch({ status: true });

    await run(
      Effect.flatMap(Effect.service(CustomerAuthApi), (auth) =>
        auth.auth.deletePasskey({ payload: { id: "passkey-1" } })
      ),
      native,
      fetch
    );

    expect(sent[0]?.credentials).toBe("omit");
    expect(sent[0]?.headers.get("cookie")).toBe(cookie);
    expect(sent[0]?.headers.get("expo-origin")).toBe("deskohub://");
  });

  test("sends no cookie header while signed out", async () => {
    const { fetch, sent } = recordingFetch(account);

    await run(
      Effect.flatMap(Effect.service(CustomerApi), (api) =>
        api.account.getAccount({ headers: {} })
      ),
      nativeCustomerApiTransport({
        apiOrigin,
        readSessionCookie: Effect.succeed(""),
      }),
      fetch
    );

    expect(sent[0]?.headers.has("cookie")).toBe(false);
  });
});

describe("web customer API transport", () => {
  test("leaves the cookie and origin to the browser", async () => {
    const { fetch, sent } = recordingFetch(account);

    await run(
      Effect.flatMap(Effect.service(CustomerApi), (api) =>
        api.account.getAccount({ headers: {} })
      ),
      webCustomerApiTransport({ apiOrigin }),
      fetch
    );

    expect(sent[0]?.credentials).toBe("same-origin");
    expect(sent[0]?.headers.has("cookie")).toBe(false);
    expect(sent[0]?.headers.has("expo-origin")).toBe(false);
  });
});
