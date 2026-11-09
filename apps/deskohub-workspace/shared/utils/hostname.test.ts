import { describe, expect, test } from "bun:test";
import { isLoopbackHostname } from "./hostname";

const hostnameOf = (url: string) => new URL(url).hostname;

describe("isLoopbackHostname", () => {
  test.each([
    "http://localhost:53122/callback",
    "http://LOCALHOST./callback",
    "https://app.localhost/callback",
    "http://127.0.0.1:8080/callback",
    "http://127.1/callback",
    "http://127.255.0.9/callback",
    "http://[::1]:8080/callback",
    "http://[0:0:0:0:0:0:0:1]/callback",
  ])("is loopback for %s", (url) => {
    expect(isLoopbackHostname(hostnameOf(url))).toBe(true);
  });

  test.each([
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://claude.ai/api/mcp/auth_callback",
    "https://localhost.attacker.example/callback",
    "https://notlocalhost/callback",
    "http://128.0.0.1/callback",
    "http://0.0.0.0/callback",
    "http://[::2]/callback",
  ])("is not loopback for %s", (url) => {
    expect(isLoopbackHostname(hostnameOf(url))).toBe(false);
  });
});
