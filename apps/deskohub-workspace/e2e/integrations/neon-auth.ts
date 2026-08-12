import { createPublicKey, randomUUID, verify } from "node:crypto";
import { Effect } from "effect";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { tryWorkspaceE2EPromise, type WorkspaceE2EError } from "../errors";
import { addRedaction, assert, parseUrl } from "../runtime";

const neonApiOrigin = "https://console.neon.tech/api/v2";
const neonApiTimeoutMs = 20_000;
const tunnelStartupTimeoutMs = 45_000;
const webhookMaximumAgeMs = 5 * 60_000;
const webhookMaximumFutureSkewMs = 60_000;

type NeonAuthConfig = NonNullable<DatasourceConfig["neonAuth"]>;

type NeonAuthDetails = {
  readonly authProvider: string;
  readonly baseUrl: URL;
  readonly branchId: string;
  readonly databaseName: string;
};

export type NeonAuthWebhookConfiguration = {
  readonly enabled: boolean;
  readonly enabled_events?: readonly string[];
  readonly timeout_seconds?: number;
  readonly webhook_url?: string;
};

type NeonAuthJwks = {
  readonly keys: readonly Record<string, unknown>[];
};

export type NeonAuthMagicLinkDelivery = {
  readonly linkUrl: string;
  readonly token: string;
};

export type NeonAuthMagicLinkCapture = {
  readonly nextVerificationUrl: (
    config: WorkspaceE2EConfig,
    callbackPath: string
  ) => Effect.Effect<string, WorkspaceE2EError>;
  readonly rememberUserId: (userId: string) => void;
};

type CaptureRuntime = {
  readonly auth: NeonAuthDetails;
  readonly capture: NeonAuthMagicLinkCapture;
  readonly close: () => Promise<void>;
};

type CloudflaredProcess = {
  readonly exited: Promise<number>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly kill: (signal?: number | NodeJS.Signals) => void;
};

export const useNeonAuthMagicLinkCapture = <A, R>(
  neonAuth: NeonAuthConfig,
  expectedEmail: string,
  use: (
    capture: NeonAuthMagicLinkCapture
  ) => Effect.Effect<A, WorkspaceE2EError, R>
): Effect.Effect<A, WorkspaceE2EError, R> =>
  Effect.acquireUseRelease(
    startNeonAuthMagicLinkCapture(neonAuth, expectedEmail),
    ({ capture }) => use(capture),
    ({ close }) =>
      tryWorkspaceE2EPromise("restore Neon Auth E2E webhook state", () =>
        close()
      )
  );

const startNeonAuthMagicLinkCapture = (
  neonAuth: NeonAuthConfig,
  expectedEmail: string
): Effect.Effect<CaptureRuntime, WorkspaceE2EError> =>
  tryWorkspaceE2EPromise(
    "start Neon Auth magic-link capture",
    async (signal) => {
      const auth = await readNeonAuthDetails(neonAuth, signal);
      const originalWebhook = await readWebhookConfiguration(neonAuth, signal);
      const jwks = await readNeonAuthJwks(auth, signal);
      const deliveries = makeMagicLinkDeliveryQueue();
      const eventIds = new Set<string>();
      const webhookPath = `/workspace-e2e/neon-auth/${randomUUID()}`;
      addRedaction(expectedEmail, true);
      addRedaction(webhookPath, true);

      let lastWebhookFailure: Error | undefined;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        maxRequestBodySize: 32_768,
        port: 0,
        fetch: async (request) => {
          const url = new URL(request.url);
          if (url.pathname !== webhookPath)
            return new Response(null, { status: 404 });
          if (request.method === "GET")
            return new Response(null, { status: 204 });
          if (request.method !== "POST")
            return new Response(null, { status: 405 });
          if (
            !request.headers.get("content-type")?.startsWith("application/json")
          )
            return new Response(null, { status: 415 });

          try {
            const rawBody = await request.text();
            const payload = verifyNeonAuthWebhook({
              headers: request.headers,
              jwks,
              rawBody,
            });
            const delivery = readMagicLinkDelivery(payload, {
              auth,
              expectedEmail,
              headers: request.headers,
            });
            const eventId = requireHeader(request.headers, "x-neon-event-id");
            if (!eventIds.has(eventId)) {
              eventIds.add(eventId);
              addRedaction(delivery.linkUrl, true);
              addRedaction(delivery.token, true);
              deliveries.deliver(delivery);
            }
            return new Response(null, { status: 204 });
          } catch (cause) {
            lastWebhookFailure =
              cause instanceof Error
                ? cause
                : new Error("Neon Auth webhook validation failed");
            return new Response(null, { status: 401 });
          }
        },
      });
      let tunnel: CloudflaredProcess | undefined;
      let webhookUpdateAttempted = false;

      try {
        assert(
          typeof server.port === "number",
          "Auth E2E receiver port is missing"
        );
        tunnel = startCloudflaredTunnel(server.port);
        const tunnelOrigin = await readCloudflaredTunnelOrigin(tunnel);
        void drainCloudflaredOutput(tunnel.stderr);
        const webhookUrl = new URL(webhookPath, tunnelOrigin).toString();
        addRedaction(webhookUrl, true);
        await waitForTunnelEndpoint(webhookUrl);

        webhookUpdateAttempted = true;
        await updateWebhookConfiguration(neonAuth, {
          enabled: true,
          enabled_events: ["send.magic_link"],
          timeout_seconds: 5,
          webhook_url: webhookUrl,
        });

        const capturedUserIds = new Set<string>();
        const capture: NeonAuthMagicLinkCapture = {
          nextVerificationUrl: (config, callbackPath) =>
            tryWorkspaceE2EPromise(
              "receive Neon Auth magic link",
              async (deliverySignal) => {
                const delivery = await deliveries.next(
                  deliverySignal,
                  () => lastWebhookFailure
                );
                return makePreviewMagicLinkVerificationUrl({
                  auth,
                  callbackPath,
                  config,
                  delivery,
                });
              }
            ),
          rememberUserId: (userId) => {
            assert(userId.length > 0, "Neon Auth user ID is empty");
            addRedaction(userId, true);
            capturedUserIds.add(userId);
          },
        };

        return {
          auth,
          capture,
          close: async () => {
            const errors: unknown[] = [];
            try {
              await updateWebhookConfiguration(
                neonAuth,
                getRestorableWebhookConfiguration(originalWebhook)
              );
            } catch (cause) {
              errors.push(cause);
            }
            for (const userId of capturedUserIds) {
              try {
                await deleteNeonAuthUser(neonAuth, userId);
              } catch (cause) {
                errors.push(cause);
              }
            }
            await stopCaptureRuntime(server, tunnel);
            if (errors.length > 0) {
              throw new AggregateError(
                errors,
                "Neon Auth E2E cleanup did not fully complete"
              );
            }
          },
        };
      } catch (cause) {
        const cleanupErrors: unknown[] = [];
        if (webhookUpdateAttempted) {
          try {
            await updateWebhookConfiguration(
              neonAuth,
              getRestorableWebhookConfiguration(originalWebhook)
            );
          } catch (cleanupCause) {
            cleanupErrors.push(cleanupCause);
          }
        }
        await stopCaptureRuntime(server, tunnel);
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [cause, ...cleanupErrors],
            "Neon Auth magic-link capture startup and rollback failed"
          );
        }
        throw cause;
      }
    }
  );

const readNeonAuthDetails = async (
  config: NeonAuthConfig,
  signal: AbortSignal
): Promise<NeonAuthDetails> => {
  const value = await neonApiJson(
    config,
    `/projects/${encodeURIComponent(config.projectId)}/branches/${encodeURIComponent(config.branchId)}/auth`,
    { method: "GET", signal: requestSignal(signal) }
  );
  const root = asRecord(value);
  const details = asRecord(root?.auth) ?? root;
  assert(details, "Neon Auth integration response is invalid");
  const baseUrl = requireUrl(details.base_url, "Neon Auth base URL");
  const authProvider = requireString(
    details.auth_provider,
    "Neon Auth provider"
  );
  const branchId = requireString(details.branch_id, "Neon Auth branch ID");
  const databaseName = requireString(
    details.db_name,
    "Neon Auth database name"
  );
  assert(
    authProvider === "better_auth",
    "preview branch must use Managed Better Auth"
  );
  assert(branchId === config.branchId, "Neon Auth integration branch mismatch");
  assert(
    databaseName === "neondb",
    "Neon Auth must use the preview branch default database"
  );
  assert(baseUrl.protocol === "https:", "Neon Auth base URL must use HTTPS");
  addRedaction(baseUrl.toString(), true);
  return { authProvider, baseUrl, branchId, databaseName };
};

const readWebhookConfiguration = async (
  config: NeonAuthConfig,
  signal: AbortSignal
): Promise<NeonAuthWebhookConfiguration> => {
  const value = await neonApiJson(
    config,
    `/projects/${encodeURIComponent(config.projectId)}/branches/${encodeURIComponent(config.branchId)}/auth/webhooks`,
    { method: "GET", signal: requestSignal(signal) }
  );
  const root = asRecord(value);
  const webhook = asRecord(root?.webhook) ?? root;
  assert(webhook, "Neon Auth webhook response is invalid");
  assert(
    typeof webhook.enabled === "boolean",
    "Neon Auth webhook enabled state is invalid"
  );
  return {
    enabled: webhook.enabled,
    ...(Array.isArray(webhook.enabled_events) &&
    webhook.enabled_events.every((event) => typeof event === "string")
      ? { enabled_events: webhook.enabled_events as string[] }
      : {}),
    ...(typeof webhook.timeout_seconds === "number"
      ? { timeout_seconds: webhook.timeout_seconds }
      : {}),
    ...(typeof webhook.webhook_url === "string"
      ? { webhook_url: webhook.webhook_url }
      : {}),
  };
};

const updateWebhookConfiguration = async (
  config: NeonAuthConfig,
  webhook: NeonAuthWebhookConfiguration
) => {
  await neonApiJson(
    config,
    `/projects/${encodeURIComponent(config.projectId)}/branches/${encodeURIComponent(config.branchId)}/auth/webhooks`,
    {
      body: JSON.stringify(webhook),
      headers: { "content-type": "application/json" },
      method: "PUT",
      signal: AbortSignal.timeout(neonApiTimeoutMs),
    }
  );
};

export const getRestorableWebhookConfiguration = (
  webhook: NeonAuthWebhookConfiguration
): NeonAuthWebhookConfiguration => {
  const url = webhook.webhook_url ? parseUrl(webhook.webhook_url) : undefined;
  if (!webhook.enabled || url?.hostname.endsWith(".trycloudflare.com")) {
    return { enabled: false };
  }
  assert(
    url?.protocol === "https:",
    "existing Neon Auth webhook URL is invalid"
  );
  assert(
    webhook.enabled_events && webhook.enabled_events.length > 0,
    "existing Neon Auth webhook event list is missing"
  );
  assert(
    webhook.timeout_seconds &&
      webhook.timeout_seconds >= 1 &&
      webhook.timeout_seconds <= 10,
    "existing Neon Auth webhook timeout is invalid"
  );
  return {
    enabled: true,
    enabled_events: webhook.enabled_events,
    timeout_seconds: webhook.timeout_seconds,
    webhook_url: url.toString(),
  };
};

const readNeonAuthJwks = async (
  auth: NeonAuthDetails,
  signal: AbortSignal
): Promise<NeonAuthJwks> => {
  const baseUrl = auth.baseUrl.toString().replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/.well-known/jwks.json`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: requestSignal(signal),
  });
  assert(response.ok, "Neon Auth JWKS request failed");
  const value: unknown = await response.json();
  const record = asRecord(value);
  assert(
    record && Array.isArray(record.keys),
    "Neon Auth JWKS response is invalid"
  );
  assert(
    record.keys.every((key) => asRecord(key) !== undefined),
    "Neon Auth JWKS contains an invalid key"
  );
  return { keys: record.keys as Record<string, unknown>[] };
};

export const verifyNeonAuthWebhook = ({
  headers,
  jwks,
  now = Date.now(),
  rawBody,
}: {
  readonly headers: Headers;
  readonly jwks: NeonAuthJwks;
  readonly now?: number;
  readonly rawBody: string;
}): unknown => {
  const signature = requireHeader(headers, "x-neon-signature");
  const keyId = requireHeader(headers, "x-neon-signature-kid");
  const timestamp = requireHeader(headers, "x-neon-timestamp");
  assert(/^\d+$/.test(timestamp), "Neon Auth webhook timestamp is invalid");
  const timestampMs = Number(timestamp);
  assert(
    Number.isSafeInteger(timestampMs),
    "Neon Auth webhook timestamp is invalid"
  );
  const age = now - timestampMs;
  assert(age <= webhookMaximumAgeMs, "Neon Auth webhook timestamp is too old");
  assert(
    age >= -webhookMaximumFutureSkewMs,
    "Neon Auth webhook timestamp is in the future"
  );

  const [header, detachedPayload, encodedSignature, ...extra] =
    signature.split(".");
  assert(
    header && detachedPayload === "" && encodedSignature && extra.length === 0,
    "Neon Auth webhook signature is not detached JWS"
  );
  const key = jwks.keys.find((candidate) => candidate.kid === keyId);
  assert(key, "Neon Auth webhook signing key was not found");
  const protectedHeader: unknown = JSON.parse(
    Buffer.from(header, "base64url").toString("utf8")
  );
  const protectedRecord = asRecord(protectedHeader);
  assert(
    protectedRecord?.alg === "EdDSA" && protectedRecord.kid === keyId,
    "Neon Auth webhook protected header is invalid"
  );
  const payload = `${timestamp}.${Buffer.from(rawBody, "utf8").toString("base64url")}`;
  const signingInput = `${header}.${Buffer.from(payload, "utf8").toString("base64url")}`;
  const valid = verify(
    null,
    Buffer.from(signingInput, "utf8"),
    createPublicKey({ format: "jwk", key }),
    Buffer.from(encodedSignature, "base64url")
  );
  assert(valid, "Neon Auth webhook signature is invalid");
  return JSON.parse(rawBody) as unknown;
};

const readMagicLinkDelivery = (
  value: unknown,
  {
    auth,
    expectedEmail,
    headers,
  }: {
    readonly auth: NeonAuthDetails;
    readonly expectedEmail: string;
    readonly headers: Headers;
  }
): NeonAuthMagicLinkDelivery => {
  const payload = asRecord(value);
  const user = asRecord(payload?.user);
  const eventData = asRecord(payload?.event_data);
  assert(payload, "Neon Auth webhook payload is invalid");
  assert(
    payload.event_type === "send.magic_link" &&
      requireHeader(headers, "x-neon-event-type") === "send.magic_link",
    "Neon Auth webhook event type is invalid"
  );
  assert(
    payload.event_id === requireHeader(headers, "x-neon-event-id"),
    "Neon Auth webhook event ID mismatch"
  );
  assert(user?.email === expectedEmail, "Neon Auth webhook email mismatch");
  assert(
    eventData?.link_type === "sign-in",
    "Neon Auth magic-link type is invalid"
  );
  const linkUrl = requireString(eventData.link_url, "Neon Auth magic-link URL");
  const token = requireString(eventData.token, "Neon Auth magic-link token");
  addRedaction(linkUrl, true);
  addRedaction(token, true);
  const parsedLink = requireUrl(linkUrl, "Neon Auth magic-link URL");
  assert(
    parsedLink.protocol === "https:",
    "Neon Auth magic-link URL must use HTTPS"
  );
  assert(
    parsedLink.origin === auth.baseUrl.origin &&
      parsedLink.pathname.startsWith(auth.baseUrl.pathname.replace(/\/$/, "")),
    "Neon Auth magic-link URL does not belong to the preview branch"
  );
  assert(
    parsedLink.searchParams.get("token") === token,
    "Neon Auth magic-link token mismatch"
  );
  return { linkUrl, token };
};

export const makePreviewMagicLinkVerificationUrl = ({
  auth,
  callbackPath,
  config,
  delivery,
}: {
  readonly auth: NeonAuthDetails;
  readonly callbackPath: string;
  readonly config: WorkspaceE2EConfig;
  readonly delivery: NeonAuthMagicLinkDelivery;
}) => {
  const callbackUrl = new URL(callbackPath, config.baseUrl);
  assert(
    callbackUrl.origin === config.baseUrl &&
      callbackUrl.pathname === callbackPath,
    "magic-link callback path must stay on the immutable preview"
  );
  const suppliedLink = new URL(delivery.linkUrl);
  assert(
    suppliedLink.searchParams.get("callbackURL") === callbackUrl.toString(),
    "Neon Auth magic-link callback does not target the immutable preview"
  );
  assert(
    suppliedLink.origin === auth.baseUrl.origin,
    "Neon Auth magic-link origin mismatch"
  );
  const verificationUrl = new URL(
    "/api/auth/magic-link/verify",
    config.baseUrl
  );
  verificationUrl.searchParams.set("token", delivery.token);
  verificationUrl.searchParams.set("callbackURL", callbackUrl.toString());
  addRedaction(verificationUrl.toString(), true);
  return verificationUrl.toString();
};

const startCloudflaredTunnel = (port: number): CloudflaredProcess => {
  assert(Bun.which("cloudflared"), "cloudflared is required for Auth E2E");
  return Bun.spawn(
    [
      "cloudflared",
      "tunnel",
      "--no-autoupdate",
      "--protocol",
      "http2",
      "--url",
      `http://127.0.0.1:${port}`,
    ],
    { stderr: "pipe", stdin: "ignore", stdout: "ignore" }
  );
};

export const findCloudflaredTunnelOrigin = (output: string) =>
  output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0];

const readCloudflaredTunnelOrigin = async (process: CloudflaredProcess) => {
  const reader = process.stderr.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + tunnelStartupTimeoutMs;
  let output = "";
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("cloudflared tunnel startup timed out")),
            remaining
          );
        }),
      ]).finally(() => clearTimeout(timeout));
      output += decoder.decode(result.value, { stream: !result.done });
      const origin = findCloudflaredTunnelOrigin(output);
      if (origin) return origin;
      if (result.done) break;
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error("cloudflared did not publish a quick-tunnel URL");
};

const waitForTunnelEndpoint = async (url: string) => {
  const deadline = Date.now() + tunnelStartupTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status === 204) return;
    } catch {
      // A quick tunnel can be announced before its public route is ready.
    }
    await Bun.sleep(500);
  }
  throw new Error("cloudflared quick tunnel did not become reachable");
};

const drainCloudflaredOutput = async (output: ReadableStream<Uint8Array>) => {
  const reader = output.getReader();
  try {
    while (!(await reader.read()).done) {
      // Keep the child process from blocking on an unread pipe.
    }
  } catch {
    // Process shutdown can terminate the stream abruptly.
  } finally {
    reader.releaseLock();
  }
};

const stopCaptureRuntime = async (
  server: ReturnType<typeof Bun.serve>,
  tunnel: CloudflaredProcess | undefined
) => {
  try {
    await server.stop(true);
  } finally {
    if (tunnel) {
      tunnel.kill();
      const exited = await Promise.race([
        tunnel.exited.then(() => true),
        Bun.sleep(5_000).then(() => false),
      ]);
      if (!exited) {
        tunnel.kill(9);
        await Promise.race([tunnel.exited, Bun.sleep(1_000)]);
      }
    }
  }
};

const makeMagicLinkDeliveryQueue = () => {
  const queued: NeonAuthMagicLinkDelivery[] = [];
  const waiting: {
    readonly reject: (cause: unknown) => void;
    readonly resolve: (delivery: NeonAuthMagicLinkDelivery) => void;
  }[] = [];
  return {
    deliver: (delivery: NeonAuthMagicLinkDelivery) => {
      const waiter = waiting.shift();
      if (waiter) waiter.resolve(delivery);
      else queued.push(delivery);
    },
    next: (
      signal: AbortSignal,
      getLastFailure: () => Error | undefined
    ): Promise<NeonAuthMagicLinkDelivery> => {
      const delivery = queued.shift();
      if (delivery) return Promise.resolve(delivery);
      return new Promise((resolve, reject) => {
        const abort = () => {
          const index = waiting.indexOf(waiter);
          if (index >= 0) waiting.splice(index, 1);
          reject(
            getLastFailure() ??
              new Error(
                "waiting for Neon Auth magic-link delivery was interrupted"
              )
          );
        };
        const waiter = {
          reject,
          resolve: (nextDelivery: NeonAuthMagicLinkDelivery) => {
            signal.removeEventListener("abort", abort);
            resolve(nextDelivery);
          },
        };
        waiting.push(waiter);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    },
  };
};

const deleteNeonAuthUser = async (config: NeonAuthConfig, userId: string) => {
  const response = await neonApiRequest(
    config,
    `/projects/${encodeURIComponent(config.projectId)}/branches/${encodeURIComponent(config.branchId)}/auth/users/${encodeURIComponent(userId)}`,
    { method: "DELETE", signal: AbortSignal.timeout(neonApiTimeoutMs) }
  );
  if (response.status === 404) return;
  assert(response.status === 204, "Neon Auth E2E user deletion failed");
};

const neonApiJson = async (
  config: NeonAuthConfig,
  path: string,
  init: RequestInit
): Promise<unknown> => {
  const response = await neonApiRequest(config, path, init);
  assert(response.ok, `Neon API ${init.method ?? "GET"} request failed`);
  return (await response.json()) as unknown;
};

const neonApiRequest = (
  config: NeonAuthConfig,
  path: string,
  init: RequestInit
) =>
  fetch(`${neonApiOrigin}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.apiKey}`,
      ...init.headers,
    },
    redirect: "error",
  });

const requestSignal = (signal: AbortSignal) =>
  AbortSignal.any([signal, AbortSignal.timeout(neonApiTimeoutMs)]);

const requireHeader = (headers: Headers, name: string) => {
  const value = headers.get(name);
  assert(value, `Neon Auth webhook ${name} header is missing`);
  return value;
};

const requireString = (value: unknown, label: string) => {
  assert(typeof value === "string" && value.length > 0, `${label} is invalid`);
  return value;
};

const requireUrl = (value: unknown, label: string) => {
  const parsed = typeof value === "string" ? parseUrl(value) : undefined;
  assert(parsed, `${label} is invalid`);
  return parsed;
};

const asRecord = (value: unknown) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
