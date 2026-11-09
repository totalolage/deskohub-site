import { describe, expect, test } from "bun:test";
import { HttpClientRequest } from "effect/unstable/http";
import {
  nativeAuthOrigin,
  withNativeAuthOrigin,
  withSessionCookie,
} from "./session-cookie";

const apiOrigin = "https://workspace.deskohub.test";
const cookie = "deskohub.session_token=abc";

describe("withSessionCookie", () => {
  test("attaches the cookie to a request for the API origin", () => {
    const request = withSessionCookie(
      apiOrigin,
      cookie
    )(HttpClientRequest.get(`${apiOrigin}/api/customer/account`));

    expect(request.headers.cookie).toBe(cookie);
  });

  test("keeps the cookie off a request for another origin", () => {
    const request = withSessionCookie(
      apiOrigin,
      cookie
    )(HttpClientRequest.get("https://elsewhere.test/api/customer/account"));

    expect(request.headers.cookie).toBeUndefined();
  });

  test("keeps the cookie off a look-alike or protocol-relative host", () => {
    const attach = withSessionCookie(apiOrigin, cookie);

    expect(
      attach(
        HttpClientRequest.get("https://workspace.deskohub.test.evil.test/x")
      ).headers.cookie
    ).toBeUndefined();
    expect(
      attach(HttpClientRequest.get("//elsewhere.test/x")).headers.cookie
    ).toBeUndefined();
  });

  test("attaches the cookie to a path the client will send to the API origin", () => {
    const request = withSessionCookie(
      apiOrigin,
      cookie
    )(HttpClientRequest.get("/api/customer/account"));

    expect(request.headers.cookie).toBe(cookie);
  });

  test("sends no cookie header while signed out", () => {
    const request = withSessionCookie(
      apiOrigin,
      ""
    )(HttpClientRequest.get(`${apiOrigin}/api/customer/account`));

    expect(request.headers.cookie).toBeUndefined();
  });
});

describe("withNativeAuthOrigin", () => {
  const mark = withNativeAuthOrigin(apiOrigin);

  test("marks a mutation for the API origin with the trusted app origin", () => {
    const request = mark(
      HttpClientRequest.post(`${apiOrigin}/api/auth/passkey/delete-passkey`)
    );

    expect(request.headers["expo-origin"]).toBe(nativeAuthOrigin);
  });

  test("leaves reads and other origins unmarked", () => {
    expect(
      mark(HttpClientRequest.get(`${apiOrigin}/api/auth/get-session`)).headers[
        "expo-origin"
      ]
    ).toBeUndefined();
    expect(
      mark(HttpClientRequest.post("https://elsewhere.test/api/auth/sign-out"))
        .headers["expo-origin"]
    ).toBeUndefined();
  });
});
