import { expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  findCloudflaredTunnelOrigin,
  getRestorableWebhookConfiguration,
  makePreviewMagicLinkVerificationUrl,
  verifyNeonAuthWebhook,
} from "./neon-auth";

test("verifies Neon Auth detached Ed25519 webhook signatures", () => {
  const timestamp = "1786449600000";
  const payload = JSON.stringify({
    event_id: "event-1",
    event_type: "send.magic_link",
  });
  const signed = signWebhook(payload, timestamp);

  expect(
    verifyNeonAuthWebhook({
      headers: signed.headers,
      jwks: { keys: [signed.publicJwk] },
      now: Number(timestamp) + 1_000,
      rawBody: payload,
    })
  ).toEqual({ event_id: "event-1", event_type: "send.magic_link" });
});

test("rejects stale or modified Neon Auth webhooks", () => {
  const timestamp = "1786449600000";
  const payload = JSON.stringify({ event_id: "event-1" });
  const signed = signWebhook(payload, timestamp);

  expect(() =>
    verifyNeonAuthWebhook({
      headers: signed.headers,
      jwks: { keys: [signed.publicJwk] },
      now: Number(timestamp) + 5 * 60_000 + 1,
      rawBody: payload,
    })
  ).toThrow("timestamp is too old");
  expect(() =>
    verifyNeonAuthWebhook({
      headers: signed.headers,
      jwks: { keys: [signed.publicJwk] },
      now: Number(timestamp),
      rawBody: `${payload} `,
    })
  ).toThrow("signature is invalid");
});

test("extracts only a Cloudflare quick-tunnel origin", () => {
  expect(
    findCloudflaredTunnelOrigin(
      "INF Your quick Tunnel has been created! https://quiet-tree.trycloudflare.com"
    )
  ).toBe("https://quiet-tree.trycloudflare.com");
  expect(findCloudflaredTunnelOrigin("https://example.com")).toBeUndefined();
});

test("restores normal webhook configuration and disables stale E2E tunnels", () => {
  expect(
    getRestorableWebhookConfiguration({
      enabled: true,
      enabled_events: ["user.created"],
      timeout_seconds: 8,
      webhook_url: "https://auth-events.example.com/neon",
    })
  ).toEqual({
    enabled: true,
    enabled_events: ["user.created"],
    timeout_seconds: 8,
    webhook_url: "https://auth-events.example.com/neon",
  });
  expect(
    getRestorableWebhookConfiguration({
      enabled: true,
      enabled_events: ["send.magic_link"],
      timeout_seconds: 5,
      webhook_url: "https://stale.trycloudflare.com/workspace-e2e/neon-auth/id",
    })
  ).toEqual({ enabled: false });
});

test("builds a secret app-proxy verification URL for the exact preview", () => {
  const config = makeConfig();
  const callbackURL = `${config.baseUrl}/en-US/account`;
  const verificationUrl = makePreviewMagicLinkVerificationUrl({
    auth: {
      authProvider: "better_auth",
      baseUrl: new URL("https://auth.example.neon.tech/neondb/auth"),
      branchId: "br-preview-123",
      databaseName: "neondb",
    },
    callbackPath: "/en-US/account",
    config,
    delivery: {
      linkUrl: `https://auth.example.neon.tech/neondb/auth/magic-link/verify?token=secret-token&callbackURL=${encodeURIComponent(callbackURL)}`,
      token: "secret-token",
    },
  });
  const parsed = new URL(verificationUrl);

  expect(parsed.origin).toBe(config.baseUrl);
  expect(parsed.pathname).toBe("/api/auth/magic-link/verify");
  expect(parsed.searchParams.get("token")).toBe("secret-token");
  expect(parsed.searchParams.get("callbackURL")).toBe(callbackURL);
});

const signWebhook = (rawBody: string, timestamp: string) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = "test-key";
  const protectedHeader = Buffer.from(
    JSON.stringify({ alg: "EdDSA", kid: keyId, typ: "JWS" }),
    "utf8"
  ).toString("base64url");
  const payload = `${timestamp}.${Buffer.from(rawBody, "utf8").toString("base64url")}`;
  const signingInput = `${protectedHeader}.${Buffer.from(payload, "utf8").toString("base64url")}`;
  const signature = sign(
    null,
    Buffer.from(signingInput, "utf8"),
    privateKey
  ).toString("base64url");
  const publicJwk: Record<string, unknown> = {
    ...publicKey.export({ format: "jwk" }),
    kid: keyId,
  };
  return {
    headers: new Headers({
      "x-neon-signature": `${protectedHeader}..${signature}`,
      "x-neon-signature-kid": keyId,
      "x-neon-timestamp": timestamp,
    }),
    publicJwk,
  };
};

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
});
