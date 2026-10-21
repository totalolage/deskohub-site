import { describe, expect, test } from "bun:test";
import {
  customerAgentRedirectUri,
  customerMcpResourceFor,
  isCustomerAgentCallbackUrl,
  isCustomerAgentConsentUrl,
  localizeCustomerAgentConsentUrl,
  readCustomerAgentCallback,
} from "./authorization";

const baseUrl = "https://deskohub-workspace-abc123.vercel.app";

const callback = (params: Record<string, string>) =>
  `${customerAgentRedirectUri}?${new URLSearchParams(params)}`;

describe("customer agent authorization helpers", () => {
  test("binds tokens to the deployment's MCP resource", () => {
    expect(customerMcpResourceFor(baseUrl)).toBe(`${baseUrl}/api/mcp`);
  });

  test("recognizes the consent page in either locale on the deployment only", () => {
    expect(
      isCustomerAgentConsentUrl(`${baseUrl}/en-US/auth/consent?sig=1`, baseUrl)
    ).toBe(true);
    expect(
      isCustomerAgentConsentUrl(`${baseUrl}/cs-CZ/auth/consent?sig=1`, baseUrl)
    ).toBe(true);
    expect(
      isCustomerAgentConsentUrl(`${baseUrl}/en-US/auth/connect?sig=1`, baseUrl)
    ).toBe(false);
    expect(
      isCustomerAgentConsentUrl(
        "https://elsewhere.example/en-US/auth/consent",
        baseUrl
      )
    ).toBe(false);
  });

  test("switches the consent page locale and keeps the signed query", () => {
    const query = "client_id=agent&scope=reservations%3Aread&sig=abc";
    expect(
      localizeCustomerAgentConsentUrl(
        `${baseUrl}/en-US/auth/consent?${query}`,
        "cs-CZ"
      )
    ).toBe(`${baseUrl}/cs-CZ/auth/consent?${query}`);
  });

  test("recognizes only the agent's redirect URI", () => {
    expect(isCustomerAgentCallbackUrl(callback({ code: "c" }))).toBe(true);
    expect(
      isCustomerAgentCallbackUrl("https://e2e-agent.invalid/other?code=c")
    ).toBe(false);
    expect(isCustomerAgentCallbackUrl(`${baseUrl}/callback?code=c`)).toBe(
      false
    );
  });

  test("reads a granted code with its issuer", () => {
    expect(
      readCustomerAgentCallback(
        callback({ code: "c", iss: `${baseUrl}/api/auth`, state: "s" }),
        "s"
      )
    ).toEqual({ code: "c", iss: `${baseUrl}/api/auth`, kind: "code" });
  });

  test("reads a denial", () => {
    expect(
      readCustomerAgentCallback(
        callback({ error: "access_denied", state: "s" }),
        "s"
      )
    ).toEqual({ error: "access_denied", kind: "error" });
  });

  test("rejects another request's response or an empty one", () => {
    expect(() =>
      readCustomerAgentCallback(callback({ code: "c", state: "other" }), "s")
    ).toThrow("another state");
    expect(() =>
      readCustomerAgentCallback(callback({ state: "s" }), "s")
    ).toThrow("neither code nor error");
    expect(() =>
      readCustomerAgentCallback(`${baseUrl}/callback?state=s`, "s")
    ).toThrow("redirect URI");
  });
});
