import { describe, expect, test } from "bun:test";
import { HashMap, type Logger, Option } from "effect";
import {
  CENSORED_LOG_VALUE,
  censorLoggerOptions,
  censorLogValue,
  isSensitiveLogKey,
} from "./censorship";

class CustomValue {
  constructor(readonly secret: string) {}
}

describe("isSensitiveLogKey", () => {
  test("matches common credential key shapes", () => {
    expect(isSensitiveLogKey("password")).toBe(true);
    expect(isSensitiveLogKey("passwd")).toBe(true);
    expect(isSensitiveLogKey("pwd")).toBe(true);
    expect(isSensitiveLogKey("token")).toBe(true);
    expect(isSensitiveLogKey("access_token")).toBe(true);
    expect(isSensitiveLogKey("access token")).toBe(true);
    expect(isSensitiveLogKey("access.token")).toBe(true);
    expect(isSensitiveLogKey("refresh-token")).toBe(true);
    expect(isSensitiveLogKey("idToken")).toBe(true);
    expect(isSensitiveLogKey("secret")).toBe(true);
    expect(isSensitiveLogKey("client.secret")).toBe(true);
    expect(isSensitiveLogKey("apiKey")).toBe(true);
    expect(isSensitiveLogKey("api key")).toBe(true);
    expect(isSensitiveLogKey("api.key")).toBe(true);
    expect(isSensitiveLogKey("authorization")).toBe(true);
    expect(isSensitiveLogKey("auth")).toBe(true);
    expect(isSensitiveLogKey("cookie")).toBe(true);
    expect(isSensitiveLogKey("set-cookie")).toBe(true);
    expect(isSensitiveLogKey("set cookie")).toBe(true);
    expect(isSensitiveLogKey("set_cookie")).toBe(true);
    expect(isSensitiveLogKey("set.cookie")).toBe(true);
    expect(isSensitiveLogKey("session")).toBe(true);
  });

  test("matches common prefixed camelCase credential key shapes", () => {
    expect(isSensitiveLogKey("stripeApiKey")).toBe(true);
    expect(isSensitiveLogKey("githubAccessToken")).toBe(true);
    expect(isSensitiveLogKey("userRefreshToken")).toBe(true);
    expect(isSensitiveLogKey("oauthClientSecret")).toBe(true);
    expect(isSensitiveLogKey("requestAuthorization")).toBe(true);
    expect(isSensitiveLogKey("StripeApiKey")).toBe(true);
  });

  test("matches sensitive fragments inside path-like keyed shapes", () => {
    expect(isSensitiveLogKey("user[password]")).toBe(true);
    expect(isSensitiveLogKey("headers:authorization")).toBe(true);
    expect(isSensitiveLogKey("credentials/password")).toBe(true);
    expect(isSensitiveLogKey("metadata<password>")).toBe(true);
    expect(isSensitiveLogKey("payload.access.token.value")).toBe(true);
    expect(isSensitiveLogKey("secret?")).toBe(true);
  });

  test("does not match unrelated words", () => {
    expect(isSensitiveLogKey("author")).toBe(false);
    expect(isSensitiveLogKey("authentication")).toBe(false);
    expect(isSensitiveLogKey("passwordless")).toBe(false);
    expect(isSensitiveLogKey("tokenizedLabel")).toBe(false);
    expect(isSensitiveLogKey("sessionDuration")).toBe(false);
    expect(isSensitiveLogKey("userSessionCount")).toBe(false);
    expect(isSensitiveLogKey("apiKeyDisplayName")).toBe(false);
    expect(isSensitiveLogKey("authorizationHeaderLabel")).toBe(false);
  });
});

describe("censorLogValue", () => {
  test("redacts nested sensitive object keys without mutating input", () => {
    const input = {
      user: "deskohub",
      nested: {
        apiKey: "secret-api-key",
        stripeApiKey: "secret-stripe-api-key",
        githubAccessToken: "secret-github-access-token",
        userRefreshToken: "secret-user-refresh-token",
        oauthClientSecret: "secret-oauth-client-secret",
        requestAuthorization: "Bearer secret",
        visible: "safe",
        sessionDuration: 123,
        userSessionCount: 2,
      },
      credentials: [{ password: "secret-password", name: "Ada" }],
    };

    const censored = censorLogValue(input);

    expect(censored).toEqual({
      user: "deskohub",
      nested: {
        apiKey: CENSORED_LOG_VALUE,
        stripeApiKey: CENSORED_LOG_VALUE,
        githubAccessToken: CENSORED_LOG_VALUE,
        userRefreshToken: CENSORED_LOG_VALUE,
        oauthClientSecret: CENSORED_LOG_VALUE,
        requestAuthorization: CENSORED_LOG_VALUE,
        visible: "safe",
        sessionDuration: 123,
        userSessionCount: 2,
      },
      credentials: [{ password: CENSORED_LOG_VALUE, name: "Ada" }],
    });
    expect(input.nested.apiKey).toBe("secret-api-key");
    expect(input.credentials[0]?.password).toBe("secret-password");
  });

  test("handles cycles while preserving the censored cycle shape", () => {
    const input: { name: string; self?: unknown; token?: string } = {
      name: "cycle",
      token: "secret-token",
    };
    input.self = input;

    const censored = censorLogValue(input) as typeof input;

    expect(censored).not.toBe(input);
    expect(censored.token).toBe(CENSORED_LOG_VALUE);
    expect(censored.self).toBe(censored);
  });

  test("preserves non-plain objects", () => {
    const error = new Error("boom");
    const date = new Date("2026-05-30T00:00:00.000Z");
    const set = new Set(["secret"]);
    const custom = new CustomValue("secret");
    const promise = Promise.resolve("secret");

    const input = { error, date, set, custom, promise };
    const censored = censorLogValue(input) as typeof input;

    expect(censored).toEqual(input);
    expect(censored.error).toBe(error);
    expect(censored.date).toBe(date);
    expect(censored.set).toBe(set);
    expect(censored.custom).toBe(custom);
    expect(censored.promise).toBe(promise);
    expect((censorLogValue(error) as Error).message).toBe("boom");
  });

  test("redacts Map entries by sensitive string keys without mutating input", () => {
    const input = new Map<unknown, unknown>([
      ["password", "secret-password"],
      ["headers:authorization", "Bearer secret"],
      ["sessionDuration", 123],
      ["nested", { apiKey: "secret-api-key" }],
      [{ secret: "key-secret" }, "visible"],
    ]);

    const censored = censorLogValue(input) as Map<unknown, unknown>;

    expect(censored).not.toBe(input);
    expect(censored.get("password")).toBe(CENSORED_LOG_VALUE);
    expect(censored.get("headers:authorization")).toBe(CENSORED_LOG_VALUE);
    expect(censored.get("sessionDuration")).toBe(123);
    expect(censored.get("nested")).toEqual({ apiKey: CENSORED_LOG_VALUE });
    expect(censored.get([...input.keys()][4])).toBe("visible");
    expect(input.get("password")).toBe("secret-password");
    expect(input.get("headers:authorization")).toBe("Bearer secret");
    expect(input.get("nested")).toEqual({ apiKey: "secret-api-key" });
  });

  test("redacts Headers and URLSearchParams by key without mutating input", () => {
    const headers = new Headers([
      ["authorization", "Bearer secret"],
      ["x-visible", "safe"],
    ]);
    const searchParams = new URLSearchParams([
      ["client_secret", "secret-client"],
      ["sessionDuration", "123"],
    ]);
    const input = { headers, searchParams };

    const censored = censorLogValue(input) as {
      headers: Headers;
      searchParams: URLSearchParams;
    };

    expect(censored.headers).not.toBe(headers);
    expect(censored.headers.get("authorization")).toBe(CENSORED_LOG_VALUE);
    expect(censored.headers.get("x-visible")).toBe("safe");
    expect(headers.get("authorization")).toBe("Bearer secret");
    expect(censored.searchParams).not.toBe(searchParams);
    expect(censored.searchParams.get("client_secret")).toBe(CENSORED_LOG_VALUE);
    expect(censored.searchParams.get("sessionDuration")).toBe("123");
    expect(searchParams.get("client_secret")).toBe("secret-client");
  });
});

describe("censorLoggerOptions", () => {
  test("redacts message values and annotation values or sensitive annotation keys", () => {
    const annotations = HashMap.set(
      HashMap.set(HashMap.empty<string, unknown>(), "request", {
        headers: { authorization: "Bearer secret" },
      }),
      "session",
      "session-secret"
    );
    const options = {
      message: { password: "secret", safe: "visible" },
      annotations,
    } as Logger.Logger.Options<unknown>;

    const censored = censorLoggerOptions(options);

    expect(censored.message).toEqual({
      password: CENSORED_LOG_VALUE,
      safe: "visible",
    });
    expect(
      Option.getOrThrow(HashMap.get(censored.annotations, "request"))
    ).toEqual({
      headers: { authorization: CENSORED_LOG_VALUE },
    });
    expect(
      Option.getOrThrow(HashMap.get(censored.annotations, "session"))
    ).toEqual(CENSORED_LOG_VALUE);
    expect(Option.getOrThrow(HashMap.get(options.annotations, "session"))).toBe(
      "session-secret"
    );
  });
});
