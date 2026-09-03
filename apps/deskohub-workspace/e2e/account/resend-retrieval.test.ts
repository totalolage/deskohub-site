import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import { validE2ERuntimeEnvironment } from "../e2e-env.test-fixture";
import { redact } from "../runtime";
import {
  getAccountE2EConfig,
  makeWorkspaceE2EAccountRecipient,
  workspaceE2EAuthCorrelationTags,
} from "./config";
import { retrieveWorkspaceE2EMagicLink } from "./resend-retrieval";

const config = getAccountE2EConfig(
  makeWorkspaceE2EEnvironment({
    ...validE2ERuntimeEnvironment,
    WORKSPACE_E2E_RESEND_API_KEY: "re_full-access-retrieval-key",
  })
);

const recipient = makeWorkspaceE2EAccountRecipient(config, "retrieval");
const expectedHost = config.expectedHost;
const authOrigin = `https://${expectedHost}`;
const callbackPath = `/${config.locale}/auth/callback`;

const magicLink = (token: string) =>
  `${authOrigin}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(callbackPath)}`;

type FetchLog = {
  readonly headers: Headers;
  readonly url: string;
};

const makeRetrieval = (
  listData: unknown[],
  retrieved: {
    readonly html?: string | null;
    readonly tags?: readonly {
      readonly name: string;
      readonly value: string;
    }[];
    readonly text?: string | null;
  }
) => {
  const log: FetchLog[] = [];
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    log.push({ headers: request.headers, url: request.url });
    const payload = request.url.includes("/emails/")
      ? {
          html: `<a href="${magicLink("token")}">Sign in</a>`,
          tags: [...workspaceE2EAuthCorrelationTags],
          text: magicLink("token"),
          ...retrieved,
        }
      : { data: listData };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
  );
  const result = Effect.runPromise(
    retrieveWorkspaceE2EMagicLink(config, {
      callbackPath,
      deadlineAfterMs: 200,
      pollIntervalMs: 10,
      recipient,
      startedAt: new Date(),
    }).pipe(Effect.provide(httpClientLayer))
  );
  return { log, result };
};

const listEntry = (
  overrides: {
    readonly created_at?: string;
    readonly id?: string;
    readonly to?: readonly string[];
  } = {}
) => ({
  created_at: `${new Date(Date.now() - 1000).toISOString().replace("T", " ").replace("Z", "")}+00`,
  id: "message-1",
  to: [recipient],
  ...overrides,
});

describe("workspace e2e Resend retrieval", () => {
  test("sends the retrieval key as a bearer token and returns the validated link", async () => {
    const { log, result } = makeRetrieval([listEntry()], {});

    await expect(result).resolves.toBe(magicLink("token"));
    expect(log).toHaveLength(2);
    expect(log[0]?.url).toBe("https://api.resend.com/emails?limit=100");
    expect(log[1]?.url).toBe("https://api.resend.com/emails/message-1");
    expect(log[0]?.headers.get("authorization")).toBe(
      "Bearer re_full-access-retrieval-key"
    );
  });

  test("matches the documented Resend list timestamp format", async () => {
    const formatted = `${new Date(Date.now() - 1000).toISOString().slice(0, 19).replace("T", " ")}.123456+00`;
    const { result } = makeRetrieval(
      [listEntry({ created_at: formatted })],
      {}
    );

    await expect(result).resolves.toBeTypeOf("string");
  });

  test("rejects multiple synthetic matches for the exact recipient", async () => {
    const { result } = makeRetrieval(
      [listEntry({ id: "message-1" }), listEntry({ id: "message-2" })],
      {}
    );

    await expect(result).rejects.toThrow("multiple synthetic messages");
  });

  test("rejects a retrieved message without the fixed correlation tags", async () => {
    const { result } = makeRetrieval([listEntry()], {
      tags: [{ name: "category", value: "account-magic-link" }],
    });

    await expect(result).rejects.toThrow("fixed correlation tags");
  });

  test("rejects links whose host differs from the exact immutable preview", async () => {
    const foreignLink = magicLink("token").replace(
      authOrigin,
      "https://other.vercel.app"
    );
    const { result } = makeRetrieval([listEntry()], {
      html: foreignLink,
      text: foreignLink,
    });

    await expect(result).rejects.toThrow("exactly one auth link");
  });

  test("rejects links with a foreign callback target", async () => {
    const foreignCallback = `${authOrigin}/api/auth/magic-link/verify?token=token&callbackURL=${encodeURIComponent("https://evil.example.test/en-US/auth/callback")}`;
    const { result } = makeRetrieval([listEntry()], {
      html: foreignCallback,
      text: foreignCallback,
    });

    await expect(result).rejects.toThrow("exactly one auth link");
  });

  test("rejects message bodies without a single auth link", async () => {
    const { result } = makeRetrieval([listEntry()], {
      html: "<p>no link here</p>",
      text: null,
    });

    await expect(result).rejects.toThrow("exactly one auth link");
  });

  test("registers the returned link and token with the process redactor", async () => {
    const { result } = makeRetrieval([listEntry()], {});

    await result;
    expect(redact(`link ${magicLink("token")} end`)).toBe(
      "link [redacted] end"
    );
  });

  test("fails closed when no synthetic message appears before the deadline", async () => {
    const { result } = makeRetrieval([], {});

    await expect(result).rejects.toThrow("before the deadline");
  });
});
