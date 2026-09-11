import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "@playwright/test";
import { Schema } from "effect";

const port = 3211;
const fixtureBaseUrl = `http://127.0.0.1:${port}`;
const telemetryBaseUrl = `http://localhost:${port}`;
const localOrigins = new Set([fixtureBaseUrl, telemetryBaseUrl]);
const appRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(appRoot, "../..");
const artifactRoot = join(repositoryRoot, ".artifacts/posthog-identity");
const bundleRoot = join(artifactRoot, "bundle");
const fixturePath = join(
  appRoot,
  "shared/testing/posthog-identity-browser-fixture.tsx"
);
const posthogPackagePath = join(
  appRoot,
  "node_modules/posthog-js/package.json"
);
const posthogDistPath = join(appRoot, "node_modules/posthog-js/dist");
const fixtureCookieName = "posthog-identity-fixture-run";
const syntheticAuthCookieName = "better-auth.session_token";
const syntheticAuthCookieValue = "fixture-better-auth-session-token";
const fixtureModes = ["cross-host", "same-host"] as const;
type FixtureMode = (typeof fixtureModes)[number];
const fixtureBundleRequestPaths = {
  "cross-host": "/posthog-identity-browser-fixture.js",
  "same-host": "/posthog-identity-browser-fixture-same-host.js",
} satisfies Record<FixtureMode, string>;
const fixtureBundlePaths = {
  "cross-host": join(
    bundleRoot,
    "cross-host/posthog-identity-browser-fixture.js"
  ),
  "same-host": join(
    bundleRoot,
    "same-host/posthog-identity-browser-fixture.js"
  ),
} satisfies Record<FixtureMode, string>;
const posthogHostByFixtureMode = {
  "cross-host": telemetryBaseUrl,
  "same-host": fixtureBaseUrl,
} satisfies Record<FixtureMode, string>;
const fixtureQueryToken = "posthog-identity-query-token";
const fixtureHashToken = "posthog-identity-hash-token";
const fixtureReferrerQueryToken = "posthog-identity-referrer-query-token";
const legacyInitialRawQueryToken = "posthog-identity-legacy-raw-query-token";
const legacyInitialReferrerToken = "posthog-identity-legacy-referrer-token";
const legacyInitialUtmToken = "posthog-identity-legacy-utm-token";
const syntheticPinCanary = "583104729";
const posthogProjectToken = "phc_posthog_identity_browser_fixture";
const posthogSdkVersion = "1.418.1";
const localCorsHeaders = {
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-PostHog-Session-Id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": fixtureBaseUrl,
  Vary: "Origin",
} as const;

const sensitivePayloadMarkers = [
  {
    code: "synthetic-email",
    value: "posthog.identity.synthetic@example.test",
  },
  { code: "synthetic-name", value: "PostHog Identity Synthetic Name" },
  { code: "synthetic-billing", value: "Synthetic Billing Street, Test City" },
  { code: "synthetic-pin", value: syntheticPinCanary },
  { code: "query-token", value: fixtureQueryToken },
  { code: "hash-token", value: fixtureHashToken },
  { code: "referrer-query-token", value: fixtureReferrerQueryToken },
  { code: "legacy-raw-query-token", value: legacyInitialRawQueryToken },
  { code: "legacy-referrer-token", value: legacyInitialReferrerToken },
  { code: "legacy-utm-token", value: legacyInitialUtmToken },
] as const;

const legacyInitialPropertyNames = [
  "$initial_person_info",
  "$initial_referrer_info",
  "$initial_campaign_params",
  "$initial_referrer",
  "$initial_referring_domain",
  "$initial_current_url",
  "$initial_host",
  "$initial_pathname",
  "$initial_utm_source",
] as const;

const userIds = {
  A: "fixture-user-a",
  B: "fixture-user-b",
} as const;

const accountDistinctIds = {
  A: `workspace-account:${userIds.A}`,
  B: `workspace-account:${userIds.B}`,
} as const;

type SyntheticSession = "anonymous" | "A" | "B";
type SyntheticIdentityStatus =
  | "anonymous"
  | "authenticated"
  | "pending"
  | "unavailable";
type SignOutBehavior = "success" | "failure";

class CheckFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PostHogIdentityCheckFailure";
    this.code = code;
  }
}

const check: (condition: boolean, code: string) => asserts condition = (
  condition,
  code
) => {
  if (!condition) throw new CheckFailure(code);
};

const sleep = (milliseconds: number) => Bun.sleep(milliseconds);

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  code: string,
  timeoutMs = 15_000
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch {
      throw new CheckFailure(code);
    }
    await sleep(25);
  }
  throw new CheckFailure(code);
};

type JsonObject = Schema.JsonObject;

type MutableJsonObject = {
  [key: string]: JsonValue;
};

type JsonValue = Schema.Json;

const isJsonString = (value: JsonValue | undefined): value is string =>
  Object.prototype.toString.call(value) === "[object String]";

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] =>
  Array.isArray(value);

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  value !== null &&
  value !== undefined &&
  !Array.isArray(value) &&
  Object.prototype.toString.call(value) === "[object Object]";

const decodeJson = Schema.decodeUnknownOption(Schema.Json);

const parseJson = (value: string): JsonValue | undefined => {
  try {
    const parsed = decodeJson(JSON.parse(value));
    return parsed._tag === "Some" ? parsed.value : undefined;
  } catch {
    return undefined;
  }
};

const decodeBase64 = (value: string): Uint8Array | undefined => {
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.byteLength === 0) return undefined;
    return new Uint8Array(decoded);
  } catch {
    return undefined;
  }
};

const hasBytes = (bytes: Uint8Array, ...expected: number[]) =>
  expected.every((value, index) => bytes[index] === value);

const decompressedCandidates = (
  bytes: Uint8Array,
  contentEncoding: string | null
) => {
  const candidates: Uint8Array[] = [bytes];
  const encoding = contentEncoding?.toLowerCase() ?? "";
  const add = (candidate: Uint8Array | undefined) => {
    if (!candidate) return;
    if (
      candidates.some(
        (existing) =>
          existing.byteLength === candidate.byteLength &&
          existing.every((value, index) => value === candidate[index])
      )
    ) {
      return;
    }
    candidates.push(candidate);
  };

  if (encoding.includes("gzip") || hasBytes(bytes, 0x1f, 0x8b)) {
    try {
      add(new Uint8Array(gunzipSync(bytes)));
    } catch {
      // The next candidate can still be the usable plain-text body.
    }
  }
  if (encoding.includes("br")) {
    try {
      add(new Uint8Array(brotliDecompressSync(bytes)));
    } catch {
      // Keep decoding candidates bounded and deterministic.
    }
  }
  if (encoding.includes("deflate")) {
    try {
      add(new Uint8Array(inflateSync(bytes)));
    } catch {
      // Keep decoding candidates bounded and deterministic.
    }
  }

  const plainText = new TextDecoder().decode(bytes).trim();
  if (/^[A-Za-z0-9+/=_-]+$/.test(plainText) && plainText.length > 16) {
    const encoded = decodeBase64(
      plainText.replace(/-/g, "+").replace(/_/g, "/")
    );
    if (encoded) {
      add(encoded);
      try {
        add(new Uint8Array(gunzipSync(encoded)));
      } catch {
        // The encoded value may be plain JSON or another supported body.
      }
      try {
        add(new Uint8Array(brotliDecompressSync(encoded)));
      } catch {
        // The encoded value may be plain JSON or another supported body.
      }
      try {
        add(new Uint8Array(inflateSync(encoded)));
      } catch {
        // The encoded value may be plain JSON or another supported body.
      }
    }
  }

  return candidates;
};

type ParsedPayload = {
  readonly ok: boolean;
  readonly searchText: string;
  readonly value: JsonValue;
};

const parsePayloadText = (text: string): ParsedPayload => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: true, searchText: "", value: null };
  }

  const json = parseJson(trimmed);
  if (json !== undefined) {
    return {
      ok: true,
      searchText: `${trimmed}\n${JSON.stringify(json)}`,
      value: json,
    };
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => parseJson(line.trim()))
    .filter((line): line is JsonValue => line !== undefined);
  if (lines.length > 0 && lines.length === trimmed.split(/\r?\n/).length) {
    return {
      ok: true,
      searchText: `${trimmed}\n${JSON.stringify(lines)}`,
      value: lines,
    };
  }

  try {
    const form = new URLSearchParams(trimmed);
    if (form.toString() === trimmed && [...form.keys()].length > 0) {
      const entries: MutableJsonObject = {};
      const searchParts = [trimmed];
      for (const [key, value] of form.entries()) {
        const parsedValue = parseJson(value);
        entries[key] = parsedValue === undefined ? value : parsedValue;
        searchParts.push(value);
      }
      return {
        ok: true,
        searchText: `${searchParts.join("\n")}\n${JSON.stringify(entries)}`,
        value: entries,
      };
    }
  } catch {
    // An undecodable body is reported to the final check instead of ignored.
  }

  return { ok: false, searchText: text, value: null };
};

const decodePayload = (
  bytes: Uint8Array,
  contentEncoding: string | null
): ParsedPayload => {
  for (const candidate of decompressedCandidates(bytes, contentEncoding)) {
    const text = new TextDecoder().decode(candidate);
    const parsed = parsePayloadText(text);
    if (parsed.ok) return parsed;
  }

  return {
    ok: false,
    searchText: new TextDecoder().decode(bytes),
    value: null,
  };
};

type CapturedEvent = {
  readonly distinctId: JsonValue | undefined;
  readonly event: string;
  readonly properties: JsonObject;
};

const extractEvents = (value: JsonValue): CapturedEvent[] => {
  const events: CapturedEvent[] = [];
  const visited = new Set<JsonObject>();

  const visit = (candidate: JsonValue): void => {
    if (isJsonString(candidate)) {
      const parsed = parseJson(candidate);
      if (parsed !== undefined) visit(parsed);
      return;
    }
    if (isJsonArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!isJsonObject(candidate)) return;
    if (visited.has(candidate)) return;
    visited.add(candidate);

    if (isJsonString(candidate.event)) {
      const properties = isJsonObject(candidate.properties)
        ? candidate.properties
        : {};
      events.push({
        distinctId:
          candidate.distinct_id ??
          candidate.distinctId ??
          properties.distinct_id ??
          properties.$distinct_id,
        event: candidate.event,
        properties,
      });
      return;
    }

    for (const key of ["batch", "data", "events", "payload"] as const) {
      const nested = candidate[key];
      if (nested !== undefined) visit(nested);
    }
  };

  visit(value);
  return events;
};

const readCookie = (header: string | null, name: string) => {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
};

type RunState = {
  getSessionDelayMs: number;
  getSessionUnavailable: boolean;
  readonly id: string;
  readonly authorityRequests: AuthorityRequestObservation[];
  readonly authoritySequences: number[];
  sessionExpiresAtMs: number | undefined;
  signOutBehavior: SignOutBehavior;
  signOutDelayMs: number;
  session: SyntheticSession;
};

type AuthorityRequestObservation = {
  readonly startedAtMs: number;
  readonly startedSequence: number;
  completedAtMs?: number;
  completedSequence?: number;
};

type IngestRecord = {
  readonly decoded: boolean;
  readonly events: readonly CapturedEvent[];
  readonly path: string;
  readonly searchText: string;
  readonly sequence: number;
};

type PostHogRequestRecord = {
  readonly body: ParsedPayload;
  readonly authorizationForwarded: boolean;
  readonly cookieForwarded: boolean;
  readonly method: string;
  readonly path: string;
  readonly urlText: string;
};

type PostHogTransportHeaderLeak = {
  readonly endpoint: string;
  readonly forwarded: boolean;
  readonly headerName: "Authorization" | "Cookie";
};

type LocalPostHogServerReport = {
  readonly eventSummaries: readonly {
    readonly distinctId: "A" | "B" | "anonymous" | "missing" | "other";
    readonly event: string;
  }[];
  readonly ingestRecordCount: number;
  readonly localOrigins: {
    readonly app: string;
    readonly ingest: string;
  };
  readonly localRequestCount: number;
  readonly localRequestPathCounts: readonly {
    readonly count: number;
    readonly path: string;
  }[];
  readonly posthogBoundRequestCount: number;
  readonly posthogBoundRequestPathCounts: readonly {
    readonly count: number;
    readonly path: string;
  }[];
  readonly posthogTransportHeaderLeaks: readonly PostHogTransportHeaderLeak[];
  readonly recorderAssetRequestCount: number;
  readonly staticAssetRequestCount: number;
  readonly syntheticAuthCookieObserved: boolean;
  readonly unreadableIngestCount: number;
};

class LocalPostHogServer {
  private readonly runs = new Map<string, RunState>();
  private readonly ingestRecords: IngestRecord[] = [];
  private readonly ingestHistory: IngestRecord[] = [];
  private readonly posthogRequests: PostHogRequestRecord[] = [];
  private readonly staticAssets = new Map<string, string>();
  private sequence = 0;
  private authorityRequestSequence = 0;
  private runCounter = 0;
  private server: ReturnType<typeof Bun.serve> | undefined;
  private unreadableIngestCount = 0;
  private localRequestCount = 0;
  private readonly localRequestPathCounts = new Map<string, number>();
  private staticAssetRequestCount = 0;
  private recorderAssetRequestCount = 0;
  private syntheticAuthCookieObserved = false;

  async start() {
    const packageJson = parseJson(await readFile(posthogPackagePath, "utf8"));
    check(isJsonObject(packageJson), "posthog-sdk-package-json");
    check(packageJson.version === posthogSdkVersion, "posthog-sdk-version");

    for (const entry of await readdir(posthogDistPath, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      this.staticAssets.set(entry.name, join(posthogDistPath, entry.name));
    }

    try {
      this.server = Bun.serve({
        fetch: (request) => this.handle(request),
        hostname: "127.0.0.1",
        port,
      });
    } catch {
      throw new CheckFailure("local-server-start");
    }
  }

  async stop() {
    await this.server?.stop(true);
    this.server = undefined;
  }

  createRun({
    getSessionDelayMs = 0,
    getSessionUnavailable = false,
    session,
    sessionExpiresAtMs,
    signOutBehavior = "success",
    signOutDelayMs = 0,
  }: {
    readonly getSessionDelayMs?: number;
    readonly getSessionUnavailable?: boolean;
    readonly session: SyntheticSession;
    readonly sessionExpiresAtMs?: number;
    readonly signOutBehavior?: SignOutBehavior;
    readonly signOutDelayMs?: number;
  }) {
    const id = `fixture-run-${++this.runCounter}`;
    this.runs.set(id, {
      authoritySequences: [],
      authorityRequests: [],
      getSessionDelayMs,
      getSessionUnavailable,
      id,
      sessionExpiresAtMs,
      session,
      signOutBehavior,
      signOutDelayMs,
    });
    return id;
  }

  updateRun(
    runId: string,
    patch: Partial<
      Pick<
        RunState,
        | "getSessionDelayMs"
        | "getSessionUnavailable"
        | "session"
        | "sessionExpiresAtMs"
        | "signOutBehavior"
        | "signOutDelayMs"
      >
    >
  ) {
    const state = this.runs.get(runId);
    check(state !== undefined, "fixture-run-missing");
    Object.assign(state, patch);
  }

  resetRunAuthorityObservation(runId: string) {
    const state = this.runs.get(runId);
    check(state !== undefined, "fixture-run-missing");
    state.authoritySequences.length = 0;
  }

  latestAuthoritySequence(runId: string) {
    const state = this.runs.get(runId);
    check(state !== undefined, "fixture-run-missing");
    return state.authoritySequences.at(-1) ?? 0;
  }

  authorityRequestCount(runId: string) {
    const state = this.runs.get(runId);
    check(state !== undefined, "fixture-run-missing");
    return state.authoritySequences.length;
  }

  authorityRequestStartedCount(runId: string) {
    const state = this.runs.get(runId);
    check(state !== undefined, "fixture-run-missing");
    return state.authorityRequests.length;
  }

  authorityRequestObservations(runId: string) {
    const state = this.runs.get(runId);
    check(state !== undefined, "fixture-run-missing");
    return state.authorityRequests.map((request) => ({ ...request }));
  }

  clearIngest() {
    this.ingestRecords.length = 0;
  }

  ingestMark() {
    return this.ingestRecords.length;
  }

  ingestRecordsSince(mark: number) {
    return this.ingestRecords.slice(mark);
  }

  allIngestRecords() {
    return [...this.ingestRecords];
  }

  allIngestHistory() {
    return [...this.ingestHistory];
  }

  localRequestPathCount(pathname: string) {
    return this.localRequestPathCounts.get(pathname) ?? 0;
  }

  allPostHogRequests() {
    return [...this.posthogRequests];
  }

  report(): LocalPostHogServerReport {
    const posthogBoundRequestPathCounts = new Map<string, number>();
    const posthogTransportHeaderLeaks = new Map<
      string,
      PostHogTransportHeaderLeak
    >();
    for (const request of this.posthogRequests) {
      posthogBoundRequestPathCounts.set(
        request.path,
        (posthogBoundRequestPathCounts.get(request.path) ?? 0) + 1
      );
      const endpoint = `${request.method} ${request.path}`;
      if (request.cookieForwarded) {
        posthogTransportHeaderLeaks.set(`${endpoint}\u0000Cookie`, {
          endpoint,
          forwarded: true,
          headerName: "Cookie",
        });
      }
      if (request.authorizationForwarded) {
        posthogTransportHeaderLeaks.set(`${endpoint}\u0000Authorization`, {
          endpoint,
          forwarded: true,
          headerName: "Authorization",
        });
      }
    }

    return {
      eventSummaries: this.ingestHistory.flatMap((record) =>
        record.events.map((event) => ({
          distinctId: classifyDistinctId(eventDistinctId(event)),
          event: event.event,
        }))
      ),
      ingestRecordCount: this.ingestHistory.length,
      localOrigins: {
        app: fixtureBaseUrl,
        ingest: telemetryBaseUrl,
      },
      localRequestCount: this.localRequestCount,
      localRequestPathCounts: [...this.localRequestPathCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, count]) => ({ count, path })),
      posthogBoundRequestCount: this.posthogRequests.length,
      posthogBoundRequestPathCounts: [
        ...posthogBoundRequestPathCounts.entries(),
      ]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, count]) => ({ count, path })),
      posthogTransportHeaderLeaks: [
        ...posthogTransportHeaderLeaks.values(),
      ].sort(
        (left, right) =>
          left.endpoint.localeCompare(right.endpoint) ||
          left.headerName.localeCompare(right.headerName)
      ),
      recorderAssetRequestCount: this.recorderAssetRequestCount,
      staticAssetRequestCount: this.staticAssetRequestCount,
      syntheticAuthCookieObserved: this.syntheticAuthCookieObserved,
      unreadableIngestCount: this.unreadableIngestCount,
    };
  }

  private json(value: JsonValue, init: ResponseInit = {}) {
    return new Response(JSON.stringify(value), {
      ...init,
      headers: {
        ...localCorsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        ...init.headers,
      },
    });
  }

  private sessionBody(
    session: SyntheticSession,
    sessionExpiresAtMs: number | undefined
  ) {
    if (session === "anonymous") return { session: null, user: null };

    const userId = userIds[session];
    return {
      session: {
        expiresAt: new Date(
          sessionExpiresAtMs ?? Date.now() + 60 * 60 * 1_000
        ).toISOString(),
        id: `fixture-session-${session.toLowerCase()}`,
        userId,
      },
      user: {
        email: "posthog.identity.synthetic@example.test",
        emailVerified: true,
        id: userId,
        name: "PostHog Identity Synthetic Name",
      },
    };
  }

  private async handleSession(runId: string | undefined) {
    const state = runId ? this.runs.get(runId) : undefined;
    if (!state) return this.json({ session: null, user: null });
    const delayMs = state.getSessionDelayMs;
    const getSessionUnavailable = state.getSessionUnavailable;
    const session = state.session;
    const sessionExpiresAtMs = state.sessionExpiresAtMs;
    const requestObservation: AuthorityRequestObservation = {
      startedAtMs: Date.now(),
      startedSequence: ++this.authorityRequestSequence,
    };
    state.authorityRequests.push(requestObservation);
    if (delayMs > 0) await sleep(delayMs);
    if (getSessionUnavailable) {
      return this.json(
        { code: "synthetic-session-unavailable", message: "Unavailable" },
        { status: 503 }
      );
    }

    const sequence = ++this.sequence;
    state.authoritySequences.push(sequence);
    requestObservation.completedAtMs = Date.now();
    requestObservation.completedSequence = sequence;
    return this.json(this.sessionBody(session, sessionExpiresAtMs), {
      headers: { "X-Fixture-Authority": "authoritative" },
    });
  }

  private async handleSignOut(runId: string | undefined) {
    const state = runId ? this.runs.get(runId) : undefined;
    if (!state || state.signOutBehavior === "success") {
      if (state) state.session = "anonymous";
      if (state && state.signOutDelayMs > 0) await sleep(state.signOutDelayMs);
      return this.json({ success: true });
    }

    if (state.signOutDelayMs > 0) await sleep(state.signOutDelayMs);
    return this.json(
      { code: "synthetic-sign-out-failed", message: "Unavailable" },
      { status: 503 }
    );
  }

  private remoteConfig() {
    return {
      featureFlags: {},
      featureFlagPayloads: {},
      flags: {},
      quotaLimited: false,
      sessionRecording: {
        enabled: false,
        recording_sample_rate: 0,
        sample_rate: 0,
      },
      supportedCompression: ["gzip", "gzip-js"],
    };
  }

  private isRemoteConfigPath(pathname: string) {
    return (
      pathname === "/decide" ||
      pathname.startsWith("/decide/") ||
      pathname === "/flags" ||
      pathname.startsWith("/flags/") ||
      /^\/array\/[^/]+\/config$/.test(pathname)
    );
  }

  private isRemoteConfigScriptPath(pathname: string) {
    return /^\/array\/[^/]+\/config\.js$/.test(pathname);
  }

  private isPostHogPath(pathname: string) {
    return (
      this.isRemoteConfigPath(pathname) ||
      this.isRemoteConfigScriptPath(pathname) ||
      this.isIngestPath(pathname) ||
      pathname.startsWith("/static/")
    );
  }

  private isIngestPath(pathname: string) {
    return ["/batch", "/capture", "/e", "/engage", "/i/v0/e", "/s"].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
  }

  private handleIngest(pathname: string, parsed: ParsedPayload) {
    if (!parsed.ok) this.unreadableIngestCount += 1;
    const record: IngestRecord = {
      decoded: parsed.ok,
      events: extractEvents(parsed.value),
      path: pathname,
      searchText: parsed.searchText,
      sequence: ++this.sequence,
    };
    this.ingestRecords.push(record);
    this.ingestHistory.push(record);
    return this.json({ status: 1 });
  }

  private async recordPostHogRequest(request: Request, url: URL) {
    const body = new Uint8Array(await request.arrayBuffer());
    const parsed = decodePayload(body, request.headers.get("content-encoding"));
    this.posthogRequests.push({
      authorizationForwarded: request.headers.has("authorization"),
      body: parsed,
      cookieForwarded: request.headers.has("cookie"),
      method: request.method,
      path: url.pathname,
      urlText: `${url.pathname}${url.search}`,
    });
    return parsed;
  }

  private async handleStaticAsset(url: URL) {
    if (url.pathname === "/static/array.js") {
      this.staticAssetRequestCount += 1;
    }
    const name = basename(url.pathname);
    if (name.includes("recorder") || name === "array.js") {
      this.recorderAssetRequestCount += 1;
    }
    const assetPath = this.staticAssets.get(name);
    if (!assetPath) return new Response(null, { status: 404 });
    return new Response(await readFile(assetPath), {
      headers: {
        ...localCorsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8",
      },
    });
  }

  private async handleFixtureBundle(mode: FixtureMode) {
    return new Response(await readFile(fixtureBundlePaths[mode]), {
      headers: {
        ...localCorsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8",
      },
    });
  }

  private async handle(request: Request) {
    this.localRequestCount += 1;
    const url = new URL(request.url);
    const pathname = url.pathname;
    this.localRequestPathCounts.set(
      pathname,
      (this.localRequestPathCounts.get(pathname) ?? 0) + 1
    );
    if (
      url.origin === fixtureBaseUrl &&
      pathname.startsWith("/api/auth/") &&
      readCookie(request.headers.get("cookie"), syntheticAuthCookieName) ===
        syntheticAuthCookieValue
    ) {
      this.syntheticAuthCookieObserved = true;
    }
    const runId = readCookie(request.headers.get("cookie"), fixtureCookieName);
    const shouldRecordPostHogRequest =
      url.origin === telemetryBaseUrl ||
      (url.origin === fixtureBaseUrl && this.isPostHogPath(pathname));
    const posthogPayload = shouldRecordPostHogRequest
      ? await this.recordPostHogRequest(request, url)
      : undefined;

    if (request.method === "OPTIONS")
      return new Response(null, { headers: localCorsHeaders, status: 204 });

    if (
      request.method === "GET" &&
      (pathname === "/" || pathname === "/index.html")
    ) {
      const runFromQuery = url.searchParams.get("run");
      const fixtureMode: FixtureMode =
        url.searchParams.get("fixtureMode") === "same-host"
          ? "same-host"
          : "cross-host";
      const html = this.html(fixtureMode);
      return new Response(html, {
        headers: {
          ...localCorsHeaders,
          "Cache-Control": "no-store",
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": `${fixtureCookieName}=${encodeURIComponent(
            runFromQuery ?? ""
          )}; Path=/; SameSite=Lax`,
        },
      });
    }

    if (pathname.startsWith("/static/") && request.method === "GET") {
      return this.handleStaticAsset(url);
    }

    if (request.method === "GET") {
      const fixtureMode = fixtureModes.find(
        (mode) => fixtureBundleRequestPaths[mode] === pathname
      );
      if (fixtureMode !== undefined)
        return this.handleFixtureBundle(fixtureMode);
    }

    if (pathname === "/api/auth/get-session" && request.method === "GET") {
      return this.handleSession(runId);
    }

    if (pathname === "/api/auth/sign-out" && request.method === "POST") {
      return this.handleSignOut(runId);
    }

    if (this.isRemoteConfigScriptPath(pathname) && request.method === "GET") {
      return new Response("", {
        headers: {
          ...localCorsHeaders,
          "Cache-Control": "no-store",
          "Content-Type": "text/javascript; charset=utf-8",
        },
      });
    }

    if (this.isRemoteConfigPath(pathname)) {
      return this.json(this.remoteConfig());
    }

    if (request.method === "POST" && this.isIngestPath(pathname)) {
      const parsedPayload =
        posthogPayload ??
        decodePayload(
          new Uint8Array(await request.arrayBuffer()),
          request.headers.get("content-encoding")
        );
      return this.handleIngest(pathname, parsedPayload);
    }

    return new Response(null, { status: 404 });
  }

  private html(mode: FixtureMode) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PostHog identity browser fixture</title>
  </head>
  <body>
    <div id="posthog-identity-fixture-root"></div>
    <script type="module" src="${fixtureBundleRequestPaths[mode]}"></script>
  </body>
</html>`;
  }
}

type FixtureBrowserProblems = {
  readonly pageErrorNames: Set<string>;
  consoleErrors: number;
  expectedConsoleErrors: number;
  externalRequests: number;
  pageErrors: number;
};

type ExpiryStateSnapshot = {
  readonly atMs: number;
  readonly expiresAtMs: number | null;
  readonly hasSession: boolean;
  readonly identityStatus: SyntheticIdentityStatus;
  readonly isRefetching: boolean;
  readonly pending: boolean;
  readonly unavailable: boolean;
};

type ExpiryScenarioDiagnostics = {
  readonly runId: string;
  readonly scenarioStartedAtMs: number;
  deadlineAtMs?: number;
  nullSwitchAtMs?: number;
  stage: string;
  readonly stateSnapshots: ExpiryStateSnapshot[];
};

const runnerProblems: FixtureBrowserProblems = {
  consoleErrors: 0,
  expectedConsoleErrors: 0,
  externalRequests: 0,
  pageErrorNames: new Set(),
  pageErrors: 0,
};

let latestExpiryDiagnostics: ExpiryScenarioDiagnostics | undefined;

const createContext = async (
  browser: Browser,
  problems: FixtureBrowserProblems
) => {
  const context = await browser.newContext({
    locale: "en-US",
    reducedMotion: "reduce",
    viewport: { height: 800, width: 1_280 },
  });
  await context.addCookies([
    {
      httpOnly: true,
      name: syntheticAuthCookieName,
      sameSite: "Lax",
      secure: false,
      url: fixtureBaseUrl,
      value: syntheticAuthCookieValue,
    },
  ]);
  const syntheticAuthCookie = (await context.cookies(fixtureBaseUrl)).find(
    (cookie) => cookie.name === syntheticAuthCookieName
  );
  check(syntheticAuthCookie?.httpOnly === true, "synthetic-auth-cookie-setup");

  await context.route("**/*", async (route) => {
    try {
      const requestUrl = new URL(route.request().url());
      if (!localOrigins.has(requestUrl.origin)) {
        problems.externalRequests += 1;
        await route.abort();
        return;
      }
      await route.continue();
    } catch {
      problems.externalRequests += 1;
      await route.abort();
    }
  });

  return context;
};

const waitForFixtureControl = (page: Page) =>
  page.waitForFunction(
    () => window.__posthogIdentityBrowserFixture !== undefined,
    undefined,
    { timeout: 15_000 }
  );

const openPage = async (
  context: BrowserContext,
  runId: string,
  consent: "on" | "off",
  problems: FixtureBrowserProblems,
  fixtureMode: FixtureMode = "cross-host"
) => {
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    problems.pageErrors += 1;
    problems.pageErrorNames.add(error.name);
  });
  page.on("console", (message) => {
    if (message.type() === "error") problems.consoleErrors += 1;
  });

  try {
    await page.goto(
      `${fixtureBaseUrl}/?run=${encodeURIComponent(runId)}&consent=${consent}&fixtureMode=${fixtureMode}&query=${fixtureQueryToken}#hash=${fixtureHashToken}`,
      {
        referer: `${fixtureBaseUrl}/referrer?query=${fixtureReferrerQueryToken}`,
        timeout: 15_000,
        waitUntil: "load",
      }
    );
    await waitForFixtureControl(page);
    await page
      .locator(
        `main[data-fixture-consent='${consent === "on" ? "accepted" : "denied"}']`
      )
      .waitFor({ state: "attached", timeout: 5_000 });
  } catch {
    await page.close().catch(() => undefined);
    throw new CheckFailure("fixture-page-load");
  }
  return page;
};

type ReadControlMethod =
  | "completeAnalyticsAccountSignOut"
  | "captureSensitiveEvent"
  | "mutateReadonlyDom"
  | "registerLegacyInitialProperties"
  | "removeConsentCookie"
  | "readConsentState"
  | "readIdentityState"
  | "readSdkState"
  | "readSessionState";

const readControl = async <T>(
  page: Page,
  method: ReadControlMethod
): Promise<T> => {
  try {
    const value = await page.evaluate((methodName) => {
      const control = window.__posthogIdentityBrowserFixture;
      if (!control) throw new Error("fixture-control-missing");

      switch (methodName) {
        case "completeAnalyticsAccountSignOut":
          return control.completeAnalyticsAccountSignOut();
        case "captureSensitiveEvent":
          return control.captureSensitiveEvent();
        case "mutateReadonlyDom":
          return control.mutateReadonlyDom();
        case "registerLegacyInitialProperties":
          return control.registerLegacyInitialProperties();
        case "removeConsentCookie":
          return control.removeConsentCookie();
        case "readConsentState":
          return control.readConsentState();
        case "readIdentityState":
          return control.readIdentityState();
        case "readSdkState":
          return control.readSdkState();
        case "readSessionState":
          return control.readSessionState();
      }
    }, method);
    return value as T;
  } catch {
    throw new CheckFailure("fixture-control-call");
  }
};

const readSdkState = (page: Page) =>
  readControl<{
    readonly autocaptureDisabled: boolean;
    readonly capturedEvents: number;
    readonly capturing: boolean;
    readonly deviceId: string | null;
    readonly distinctId: string;
    readonly exceptionsDisabled: boolean;
    readonly heatmapsDisabled: boolean;
    readonly hasAutocapture: boolean;
    readonly hasSessionRecording: boolean;
    readonly identified: boolean;
    readonly loaded: boolean;
    readonly queuedEvents: number;
    readonly rageclickDisabled: boolean;
    readonly recordingConfigured: boolean;
    readonly recordingStarted: boolean;
    readonly sessionRecordingDisabled: boolean;
    readonly surveysDisabled: boolean;
  }>(page, "readSdkState");

const readConsentState = (page: Page) =>
  readControl<{
    readonly analyticsAccepted: boolean;
    readonly cookiePresent: boolean;
    readonly necessaryAccepted: boolean;
  }>(page, "readConsentState");

const assertFixtureConsentCookie = async (
  page: Page,
  analyticsAccepted: boolean
) => {
  const consent = await readConsentState(page);
  check(consent.cookiePresent, "fixture-consent-cookie-missing");
  check(consent.necessaryAccepted, "fixture-consent-cookie-invalid");
  check(
    consent.analyticsAccepted === analyticsAccepted,
    "fixture-consent-cookie-mismatch"
  );
};

const waitForFixtureConsentView = (page: Page, analyticsAccepted: boolean) =>
  page
    .locator(
      `main[data-fixture-consent='${analyticsAccepted ? "accepted" : "denied"}']`
    )
    .waitFor({ state: "attached", timeout: 5_000 });

const readIdentityState = (page: Page) =>
  readControl<{ readonly status: SyntheticIdentityStatus }>(
    page,
    "readIdentityState"
  );

const completeAnalyticsAccountSignOut = (page: Page) =>
  readControl<void>(page, "completeAnalyticsAccountSignOut");

const readSessionState = (page: Page) =>
  readControl<{
    readonly expiresAtMs: number | null;
    readonly expiresAtIsDate: boolean;
    readonly hasSession: boolean;
    readonly pending: boolean;
    readonly refetching: boolean;
    readonly unavailable: boolean;
  }>(page, "readSessionState");

const refreshSession = (page: Page) =>
  page.evaluate(async () => {
    const control = window.__posthogIdentityBrowserFixture;
    if (!control) throw new Error("fixture-control-missing");
    await control.refreshSession();
  });

const refreshAnalyticsAccountIdentity = (page: Page) =>
  page.evaluate(async () => {
    const control = window.__posthogIdentityBrowserFixture;
    if (!control) throw new Error("fixture-control-missing");
    await control.refreshAnalyticsAccountIdentity();
  });

const setFixtureConsent = (page: Page, accepted: boolean) =>
  page.evaluate((nextAccepted) => {
    const control = window.__posthogIdentityBrowserFixture;
    if (!control) throw new Error("fixture-control-missing");
    control.setConsent(nextAccepted);
  }, accepted);

const signOut = (page: Page) =>
  page.evaluate(async () => {
    const control = window.__posthogIdentityBrowserFixture;
    if (!control) throw new Error("fixture-control-missing");
    return control.signOut();
  });

const mutateReadonlyDom = (page: Page) =>
  readControl<void>(page, "mutateReadonlyDom");

const registerLegacyInitialProperties = (page: Page) =>
  readControl<boolean>(page, "registerLegacyInitialProperties");

const removeConsentCookie = (page: Page) =>
  readControl<void>(page, "removeConsentCookie");

const eventNamed = (records: readonly IngestRecord[], name: string) =>
  records.flatMap((record) =>
    record.events.filter((event) => event.event === name)
  );

const fixtureEvents = (records: readonly IngestRecord[]) =>
  records.flatMap((record) =>
    record.events.filter((event) => event.event === "fixture-sensitive-event")
  );

const eventDistinctId = (event: CapturedEvent) =>
  isJsonString(event.distinctId) ? event.distinctId : undefined;

type SensitivePostHogRequestHit = {
  readonly count: number;
  readonly endpoint: string;
  readonly markerCode: string;
  readonly propertyPath: string;
};

const containsSensitiveMarker = (
  text: string,
  marker: SensitivePayloadMarker
) => {
  const lower = text.toLowerCase();
  let decoded = text;
  try {
    decoded = decodeURIComponent(text.replaceAll("+", " "));
  } catch {
    // The direct and encoded forms still provide useful coverage.
  }
  return (
    lower.includes(marker.value.toLowerCase()) ||
    lower.includes(encodeURIComponent(marker.value).toLowerCase()) ||
    decoded.toLowerCase().includes(marker.value.toLowerCase())
  );
};

const findSensitiveJsonPaths = (
  value: JsonValue,
  marker: SensitivePayloadMarker,
  path = "$body"
) => {
  const paths: string[] = [];

  const visit = (candidate: JsonValue, candidatePath: string): void => {
    if (isJsonString(candidate)) {
      if (containsSensitiveMarker(candidate, marker)) paths.push(candidatePath);
      return;
    }
    if (isJsonArray(candidate)) {
      for (const [index, item] of candidate.entries()) {
        visit(item, `${candidatePath}[${index}]`);
      }
      return;
    }
    if (!isJsonObject(candidate)) return;

    for (const key of Object.keys(candidate)) {
      const nested = candidate[key];
      if (nested !== undefined) visit(nested, `${candidatePath}.${key}`);
    }
  };

  visit(value, path);
  return paths;
};

type SensitivePayloadMarker = (typeof sensitivePayloadMarkers)[number];

const assertSyntheticPinCanary = async (page: Page) => {
  const marker = sensitivePayloadMarkers.find(
    (candidate) => candidate.code === "synthetic-pin"
  );
  check(marker !== undefined, "synthetic-pin-marker-missing");

  const readonlyText = await page
    .locator("[data-fixture-readonly-text]")
    .textContent();
  check(
    readonlyText?.includes(syntheticPinCanary) === true,
    "synthetic-pin-readonly-dom"
  );
  check(
    containsSensitiveMarker(syntheticPinCanary, marker),
    "synthetic-pin-plaintext-matcher"
  );

  const plaintextPaths = findSensitiveJsonPaths(
    { injectedPin: syntheticPinCanary },
    marker
  );
  check(
    plaintextPaths.length === 1 && plaintextPaths[0] === "$body.injectedPin",
    "synthetic-pin-plaintext-property"
  );

  const encodedPaths = findSensitiveJsonPaths(
    { injectedPin: encodeURIComponent(syntheticPinCanary) },
    marker
  );
  check(
    encodedPaths.length === 1 && encodedPaths[0] === "$body.injectedPin",
    "synthetic-pin-url-encoded-property"
  );
};

const findJsonPropertyPaths = (
  value: JsonValue,
  propertyNames: readonly string[],
  path = "$body"
) => {
  const paths: string[] = [];

  const visit = (candidate: JsonValue, candidatePath: string): void => {
    if (isJsonArray(candidate)) {
      for (const [index, item] of candidate.entries()) {
        visit(item, `${candidatePath}[${index}]`);
      }
      return;
    }
    if (!isJsonObject(candidate)) return;

    for (const key of Object.keys(candidate)) {
      const nestedPath = `${candidatePath}.${key}`;
      if (propertyNames.includes(key)) paths.push(nestedPath);
      const nested = candidate[key];
      if (nested !== undefined) visit(nested, nestedPath);
    }
  };

  visit(value, path);
  return paths;
};

const findSensitivePostHogRequestHitsForRequests = (
  requests: readonly PostHogRequestRecord[]
) => {
  const hits = new Map<string, SensitivePostHogRequestHit>();
  const addHit = (
    markerCode: string,
    endpoint: string,
    propertyPath: string
  ) => {
    const key = `${markerCode}\u0000${endpoint}\u0000${propertyPath}`;
    const previous = hits.get(key);
    hits.set(key, {
      count: (previous?.count ?? 0) + 1,
      endpoint,
      markerCode,
      propertyPath,
    });
  };

  for (const request of requests) {
    const endpoint = `${request.method} ${request.path}`;
    for (const marker of sensitivePayloadMarkers) {
      if (containsSensitiveMarker(request.urlText, marker)) {
        addHit(marker.code, endpoint, "$url");
      }

      let bodyPaths: readonly string[] = [];
      if (request.body.ok) {
        bodyPaths = findSensitiveJsonPaths(request.body.value, marker);
      } else if (containsSensitiveMarker(request.body.searchText, marker)) {
        bodyPaths = ["$body"];
      }
      for (const propertyPath of new Set(bodyPaths)) {
        addHit(marker.code, endpoint, propertyPath);
      }
    }

    for (const propertyName of legacyInitialPropertyNames) {
      if (request.urlText.includes(propertyName)) {
        addHit("legacy-initial-property", endpoint, "$url");
      }
    }
    const legacyPropertyPaths = request.body.ok
      ? findJsonPropertyPaths(request.body.value, legacyInitialPropertyNames)
      : legacyInitialPropertyNames
          .filter((propertyName) =>
            request.body.searchText.includes(propertyName)
          )
          .map(() => "$body");
    for (const propertyPath of new Set(legacyPropertyPaths)) {
      addHit("legacy-initial-property", endpoint, propertyPath);
    }
  }

  return [...hits.values()].sort(
    (left, right) =>
      left.endpoint.localeCompare(right.endpoint) ||
      left.propertyPath.localeCompare(right.propertyPath) ||
      left.markerCode.localeCompare(right.markerCode)
  );
};

const findSensitivePostHogRequestHits = (server: LocalPostHogServer) =>
  findSensitivePostHogRequestHitsForRequests(server.allPostHogRequests());

const summarizeSensitivePostHogRequestHits = (
  hits: readonly SensitivePostHogRequestHit[]
) => {
  const summaries = new Map<
    string,
    {
      readonly count: number;
      readonly endpoint: string;
      readonly propertyPath: string;
    }
  >();
  for (const hit of hits) {
    const key = `${hit.endpoint}\u0000${hit.propertyPath}`;
    const previous = summaries.get(key);
    summaries.set(key, {
      count: (previous?.count ?? 0) + hit.count,
      endpoint: hit.endpoint,
      propertyPath: hit.propertyPath,
    });
  }
  return [...summaries.values()].sort(
    (left, right) =>
      left.endpoint.localeCompare(right.endpoint) ||
      left.propertyPath.localeCompare(right.propertyPath)
  );
};

const assertPositiveIngest = (server: LocalPostHogServer) => {
  const records = server.allIngestHistory();
  check(records.length > 0, "positive-ingest-missing");
  check(
    eventNamed(records, "$identify").length > 0,
    "positive-identify-missing"
  );
  check(
    eventNamed(records, "$pageview").length > 0,
    "positive-pageview-missing"
  );
  check(fixtureEvents(records).length > 0, "positive-fixture-event-missing");
};

const assertPostHogTransportSecurity = (server: LocalPostHogServer) => {
  const report = server.report();
  check(
    report.syntheticAuthCookieObserved,
    "synthetic-auth-cookie-not-observed"
  );
  check(
    report.posthogTransportHeaderLeaks.length === 0,
    "posthog-transport-header-forwarded"
  );
};

const classifyDistinctId = (
  distinctId: string | undefined
): "A" | "B" | "anonymous" | "missing" | "other" => {
  if (distinctId === accountDistinctIds.A) return "A";
  if (distinctId === accountDistinctIds.B) return "B";
  if (distinctId === undefined) return "missing";
  if (distinctId.startsWith("workspace-account:")) return "other";
  return "anonymous";
};

const propertyString = (event: CapturedEvent, key: string) => {
  const value = event.properties[key];
  return isJsonString(value) ? value : undefined;
};

const waitForAuthenticated = async (page: Page) =>
  waitFor(async () => {
    const state = await readSessionState(page);
    return (
      state.expiresAtIsDate &&
      state.hasSession &&
      !state.pending &&
      !state.refetching &&
      !state.unavailable
    );
  }, "auth-session-not-ready");

const waitForAuthenticatedIdentity = async (page: Page) =>
  waitFor(
    async () => (await readIdentityState(page)).status === "authenticated",
    "analytics-identity-not-ready"
  );

const waitForAnonymous = async (page: Page) =>
  waitFor(async () => {
    const state = await readSessionState(page);
    return (
      !state.hasSession &&
      !state.pending &&
      !state.refetching &&
      !state.unavailable
    );
  }, "anonymous-session-not-ready");

const waitForSessionUnavailable = async (page: Page) =>
  waitFor(async () => {
    const state = await readSessionState(page);
    return state.unavailable && !state.refetching;
  }, "session-unavailable-not-observed");

const waitForEvent = async (
  server: LocalPostHogServer,
  eventName: string,
  timeoutMs = 8_000
) => {
  await waitFor(
    () => eventNamed(server.allIngestRecords(), eventName).length > 0,
    `event-${eventName}`,
    timeoutMs
  );
};

const waitForFixtureEvent = async (server: LocalPostHogServer) =>
  waitForEvent(server, "fixture-sensitive-event");

const isFeatureFlagsRequest = (request: PostHogRequestRecord) =>
  request.path === "/flags" || request.path.startsWith("/flags/");

const waitForNextFeatureFlagsRequest = async (
  server: LocalPostHogServer,
  mark: number
) => {
  await waitFor(
    () =>
      server
        .allPostHogRequests()
        .slice(mark)
        .some((request) => isFeatureFlagsRequest(request)),
    "legacy-flags-request"
  );
  const request = server
    .allPostHogRequests()
    .slice(mark)
    .find((candidate) => isFeatureFlagsRequest(candidate));
  check(request !== undefined, "legacy-flags-request");
  return request;
};

const assertFeatureFlagsRequestIsClean = (request: PostHogRequestRecord) => {
  check(
    findSensitivePostHogRequestHitsForRequests([request]).length === 0,
    "legacy-flags-payload-leak"
  );
};

const grantConsent = async (page: Page) => {
  await page.getByRole("button", { name: "Grant analytics consent" }).click();
  await page.locator("[data-fixture-consent='accepted']").waitFor({
    state: "attached",
    timeout: 5_000,
  });
  await assertFixtureConsentCookie(page, true);
};

const withdrawConsent = async (page: Page) => {
  await page
    .getByRole("button", { name: "Withdraw analytics consent" })
    .click();
  await page.locator("[data-fixture-consent='denied']").waitFor({
    state: "attached",
    timeout: 5_000,
  });
  await assertFixtureConsentCookie(page, false);
};

type FixtureCaptureResult = {
  readonly accepted: boolean;
  readonly identityStatus: SyntheticIdentityStatus;
};

const captureFixtureEvent = (page: Page) =>
  readControl<FixtureCaptureResult>(page, "captureSensitiveEvent");

const assertRejectedCapture = async (
  page: Page,
  expectedIdentityStatus: SyntheticIdentityStatus,
  code: string
) => {
  const capture = await captureFixtureEvent(page);
  check(
    capture.identityStatus === expectedIdentityStatus,
    `${code}-identity-status`
  );
  check(!capture.accepted, `${code}-accepted`);
};

const waitForSessionSettled = async (page: Page) =>
  waitFor(async () => {
    const state = await readSessionState(page);
    return !state.pending && !state.refetching;
  }, "auth-session-did-not-settle");

type FixtureHandle = {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly problems: FixtureBrowserProblems;
  readonly runId: string;
};

const openFixture = async (
  browser: Browser,
  server: LocalPostHogServer,
  options: {
    readonly consent: "on" | "off";
    readonly fixtureMode?: FixtureMode;
    readonly getSessionDelayMs?: number;
    readonly getSessionUnavailable?: boolean;
    readonly session: SyntheticSession;
    readonly sessionExpiresAtMs?: number;
  }
): Promise<FixtureHandle> => {
  const problems = runnerProblems;
  const runId = server.createRun(options);
  const context = await createContext(browser, problems);
  try {
    const page = await openPage(
      context,
      runId,
      options.consent,
      problems,
      options.fixtureMode
    );
    await assertFixtureConsentCookie(page, options.consent === "on");
    return { context, page, problems, runId };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
};

const closeFixture = async (fixture: FixtureHandle) => {
  await fixture.context.close().catch(() => undefined);
};

const assertBrowserProblems = (fixture: FixtureHandle) => {
  check(fixture.problems.externalRequests === 0, "external-request");
  check(fixture.problems.pageErrors === 0, "page-error");
  check(
    fixture.problems.consoleErrors === fixture.problems.expectedConsoleErrors,
    "console-error"
  );
};

const runSameHostFailClosedScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const posthogRequestMark = server.allPostHogRequests().length;
  const ingestMark = server.ingestMark();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    fixtureMode: "same-host",
    session: "A",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);
    check(
      (await readConsentState(fixture.page)).analyticsAccepted,
      "same-host-consent"
    );
    await sleep(500);

    const sdk = await readSdkState(fixture.page);
    check(!sdk.loaded, "same-host-sdk-init");
    check(
      server.ingestRecordsSince(ingestMark).length === 0,
      "same-host-ingest"
    );
    await assertRejectedCapture(
      fixture.page,
      "authenticated",
      "same-host-capture"
    );
    const posthogRequests = server
      .allPostHogRequests()
      .slice(posthogRequestMark);
    check(posthogRequests.length === 0, "same-host-posthog-request");
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runConsentOffScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "off",
    session: "A",
  });
  try {
    await assertSyntheticPinCanary(fixture.page);
    await sleep(500);
    await waitForAuthenticatedIdentity(fixture.page);
    check(server.ingestMark() === 0, "consent-off-ingest");
    const sdk = await readSdkState(fixture.page);
    check(!sdk.loaded, "consent-off-sdk-init");
    await assertRejectedCapture(
      fixture.page,
      "authenticated",
      "consent-off-capture"
    );
    check(server.ingestMark() === 0, "consent-off-capture");
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runConsentCookieGateScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "A",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);
    await waitForEvent(server, "$identify");
    await waitForEvent(server, "$pageview");
    server.clearIngest();

    await removeConsentCookie(fixture.page);
    const acceptedProp = fixture.page.locator(
      "main[data-fixture-consent='accepted']"
    );
    await acceptedProp.waitFor({ state: "attached", timeout: 5_000 });
    const removedConsent = await readConsentState(fixture.page);
    check(!removedConsent.cookiePresent, "consent-cookie-removal");
    check(!removedConsent.analyticsAccepted, "consent-cookie-removal");
    await triggerVisibilityRefresh(fixture.page);
    await waitFor(
      async () => !(await readSdkState(fixture.page)).capturing,
      "consent-cookie-removal-not-paused"
    );
    await waitForAuthenticatedIdentity(fixture.page);
    await assertRejectedCapture(
      fixture.page,
      "authenticated",
      "consent-cookie-removal-capture"
    );
    check(server.ingestMark() === 0, "consent-cookie-removal-capture");

    await grantConsent(fixture.page);
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);
    await waitForEvent(server, "$identify");
    await waitForEvent(server, "$pageview");
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    check(
      fixtureEvents(server.allIngestRecords()).some(
        (event) => eventDistinctId(event) === accountDistinctIds.A
      ),
      "consent-cookie-regrant-identity"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runDelayedFirstPageviewScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    getSessionDelayMs: 600,
    session: "A",
  });
  try {
    await sleep(150);
    check(
      eventNamed(server.allIngestRecords(), "$pageview").length === 0,
      "delayed-pageview-before-auth"
    );
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);
    await waitFor(
      async () => (await readSdkState(fixture.page)).loaded,
      "delayed-sdk-not-loaded"
    );
    const sdk = await readSdkState(fixture.page);
    check(sdk.capturing, "delayed-sdk-not-capturing");
    check(sdk.identified, "delayed-sdk-not-identified");
    await captureFixtureEvent(fixture.page);
    const afterCaptureSdk = await readSdkState(fixture.page);
    check(
      afterCaptureSdk.capturedEvents > sdk.capturedEvents,
      "delayed-event-dropped-before-transport"
    );
    await waitForFixtureEvent(server);
    const authoritySequence = server.latestAuthoritySequence(fixture.runId);
    await waitForEvent(server, "$pageview");
    const pageviews = eventNamed(server.allIngestRecords(), "$pageview");
    check(pageviews.length > 0, "delayed-pageview-missing");
    const firstPageview = pageviews[0];
    check(firstPageview !== undefined, "delayed-pageview-missing");
    check(
      eventDistinctId(firstPageview) === accountDistinctIds.A,
      "delayed-pageview-identity"
    );
    const firstPageviewRecord = server
      .allIngestRecords()
      .find((record) => record.events.includes(firstPageview));
    check(
      firstPageviewRecord !== undefined &&
        firstPageviewRecord.sequence > authoritySequence,
      "delayed-pageview-before-authority"
    );
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runAnonymousIdentifyScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "anonymous",
  });
  try {
    await waitForAnonymous(fixture.page);
    await waitForEvent(server, "$pageview");
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    const anonymousEvents = fixtureEvents(server.allIngestRecords()).filter(
      (event) => eventDistinctId(event) !== undefined
    );
    check(anonymousEvents.length > 0, "anonymous-capture-missing");
    const anonymousDistinctId = eventDistinctId(anonymousEvents.at(-1)!);
    check(anonymousDistinctId !== undefined, "anonymous-distinct-id-missing");
    check(
      anonymousDistinctId !== accountDistinctIds.A,
      "anonymous-capture-not-anonymous"
    );

    server.updateRun(fixture.runId, { session: "A" });
    await refreshAnalyticsAccountIdentity(fixture.page);
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    const identifies = eventNamed(
      server.allIngestRecords(),
      "$identify"
    ).filter((event) => eventDistinctId(event) === accountDistinctIds.A);
    check(identifies.length === 1, "anonymous-identify-count");
    const identify = identifies[0];
    check(identify !== undefined, "anonymous-identify-count");
    check(
      propertyString(identify, "$anon_distinct_id") === anonymousDistinctId,
      "anonymous-identify-alias"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runSameIdentityRefreshScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "A",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    server.clearIngest();
    await refreshAnalyticsAccountIdentity(fixture.page);
    await waitForSessionSettled(fixture.page);
    await sleep(250);
    check(
      eventNamed(server.allIngestRecords(), "$identify").length === 0,
      "same-identity-duplicate-identify"
    );
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    const captures = fixtureEvents(server.allIngestRecords());
    check(captures.length === 1, "same-identity-capture-count");
    const capture = captures[0];
    check(capture !== undefined, "same-identity-capture-count");
    check(
      eventDistinctId(capture) === accountDistinctIds.A,
      "same-identity-capture-identity"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runLegacyFlagsInitialPropertiesScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "A",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);
    await waitForEvent(server, "$identify");
    await waitForEvent(server, "$pageview");
    await waitFor(
      () =>
        server
          .allPostHogRequests()
          .some((request) => isFeatureFlagsRequest(request)),
      "legacy-initial-flags-request"
    );
    await sleep(100);

    const before = await readSdkState(fixture.page);
    check(before.distinctId === accountDistinctIds.A, "legacy-before-user");
    check(before.deviceId !== null, "legacy-before-anonymous-id");
    const posthogRequestMark = server.allPostHogRequests().length;
    server.clearIngest();

    check(
      await registerLegacyInitialProperties(fixture.page),
      "legacy-initial-properties-not-persisted"
    );
    await fixture.page.reload({ timeout: 15_000, waitUntil: "load" });
    await waitForFixtureControl(fixture.page);
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);

    const flagsRequest = await waitForNextFeatureFlagsRequest(
      server,
      posthogRequestMark
    );
    assertFeatureFlagsRequestIsClean(flagsRequest);

    const after = await readSdkState(fixture.page);
    check(after.distinctId === before.distinctId, "legacy-user-changed");
    check(after.deviceId === before.deviceId, "legacy-anonymous-id-changed");
    check(after.identified, "legacy-user-not-identified");
    check(
      eventNamed(server.allIngestRecords(), "$identify").length === 0,
      "legacy-initial-properties-reset-identity"
    );

    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    check(
      fixtureEvents(server.allIngestRecords()).some(
        (event) => eventDistinctId(event) === accountDistinctIds.A
      ),
      "legacy-capture-identity"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runReloadSwitchScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "A",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    await waitForEvent(server, "$pageview");
    const initialIdentify = eventNamed(
      server.allIngestRecords(),
      "$identify"
    ).find((event) => eventDistinctId(event) === accountDistinctIds.A);
    check(initialIdentify !== undefined, "reload-initial-identify");
    const initialAnonymousDistinctId = propertyString(
      initialIdentify,
      "$anon_distinct_id"
    );
    check(
      initialAnonymousDistinctId !== undefined,
      "reload-initial-anonymous-id"
    );

    server.clearIngest();
    server.resetRunAuthorityObservation(fixture.runId);
    server.updateRun(fixture.runId, { session: "B" });
    await fixture.page.reload({ timeout: 15_000, waitUntil: "load" });
    await waitForFixtureControl(fixture.page);
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    const records = server.allIngestRecords();
    const identifyB = eventNamed(records, "$identify").find(
      (event) => eventDistinctId(event) === accountDistinctIds.B
    );
    check(identifyB !== undefined, "reload-switch-identify");
    const switchedAnonymousDistinctId = propertyString(
      identifyB,
      "$anon_distinct_id"
    );
    check(
      switchedAnonymousDistinctId !== undefined,
      "reload-switch-anonymous-id"
    );
    check(
      switchedAnonymousDistinctId !== initialAnonymousDistinctId,
      "reload-switch-old-anonymous-alias"
    );
    check(
      switchedAnonymousDistinctId !== accountDistinctIds.A,
      "reload-switch-persisted-user-alias"
    );
    check(
      records
        .flatMap((record) => record.events)
        .filter(
          (event) => event.event !== "$pageleave" && event.event !== "$snapshot"
        )
        .every((event) => eventDistinctId(event) !== accountDistinctIds.A),
      "reload-switch-stale-user-event"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runFailedLogoutScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "A",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    server.clearIngest();
    server.updateRun(fixture.runId, {
      signOutBehavior: "failure",
      signOutDelayMs: 400,
    });
    const consoleErrorsBeforeFailedSignOut = fixture.problems.consoleErrors;
    const signOutPromise = signOut(fixture.page);
    await waitFor(
      async () => (await readIdentityState(fixture.page)).status === "pending",
      "failed-logout-pending-not-observed"
    );
    await assertRejectedCapture(
      fixture.page,
      "pending",
      "failed-logout-pending-capture"
    );
    await signOutPromise;
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);
    check(
      fixture.problems.consoleErrors === consoleErrorsBeforeFailedSignOut + 1,
      "failed-logout-console-error"
    );
    fixture.problems.expectedConsoleErrors += 1;
    const postFailureCapture = await captureFixtureEvent(fixture.page);
    check(
      postFailureCapture.identityStatus === "authenticated",
      "failed-logout-postfailure-identity"
    );
    check(postFailureCapture.accepted, "failed-logout-postfailure-capture");
    await waitForFixtureEvent(server);
    const captures = fixtureEvents(server.allIngestRecords());
    check(captures.length === 1, "failed-logout-capture-count");
    check(
      captures.every(
        (event) => eventDistinctId(event) === accountDistinctIds.A
      ),
      "failed-logout-identity-reset"
    );
    check(
      eventNamed(server.allIngestRecords(), "$identify").length === 0,
      "failed-logout-identify"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runSuccessfulLogoutScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "A",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    server.clearIngest();
    server.updateRun(fixture.runId, {
      signOutBehavior: "success",
      signOutDelayMs: 250,
    });
    const didSignOut = await signOut(fixture.page);
    check(didSignOut, "successful-logout-result");
    await waitForAnonymous(fixture.page);
    await sleep(150);
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    const captures = fixtureEvents(server.allIngestRecords());
    check(captures.length === 1, "successful-logout-capture-count");
    const capture = captures[0];
    check(capture !== undefined, "successful-logout-capture-count");
    check(
      eventDistinctId(capture) !== accountDistinctIds.A,
      "successful-logout-stale-identity"
    );
    check(
      eventNamed(server.allIngestRecords(), "$identify").length === 0,
      "successful-logout-identify"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runUnavailableSessionScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "A",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    server.clearIngest();
    server.updateRun(fixture.runId, {
      getSessionDelayMs: 400,
      getSessionUnavailable: true,
    });
    const consoleErrorsBeforeUnavailableRefresh =
      fixture.problems.consoleErrors;
    const refreshPromise = refreshSession(fixture.page);
    await waitFor(
      async () => (await readSessionState(fixture.page)).refetching,
      "unavailable-refresh-not-pending"
    );
    await assertRejectedCapture(
      fixture.page,
      "pending",
      "unavailable-pending-capture"
    );
    check(server.ingestMark() === 0, "unavailable-pending-stale-ingest");
    await refreshPromise;
    await waitForSessionUnavailable(fixture.page);
    check(
      fixture.problems.consoleErrors ===
        consoleErrorsBeforeUnavailableRefresh + 1,
      "unavailable-console-error"
    );
    fixture.problems.expectedConsoleErrors += 1;
    server.clearIngest();
    await assertRejectedCapture(
      fixture.page,
      "unavailable",
      "unavailable-stale-capture"
    );
    check(server.ingestMark() === 0, "unavailable-stale-ingest");

    server.updateRun(fixture.runId, {
      getSessionDelayMs: 0,
      getSessionUnavailable: false,
      session: "B",
    });
    await refreshAnalyticsAccountIdentity(fixture.page);
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    const captures = fixtureEvents(server.allIngestRecords());
    check(
      captures.some((event) => eventDistinctId(event) === accountDistinctIds.B),
      "unavailable-recovery-identity"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runExpiryRefreshNullScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const scenarioStartedAtMs = Date.now();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "A",
  });
  const diagnostics: ExpiryScenarioDiagnostics = {
    runId: fixture.runId,
    scenarioStartedAtMs,
    stage: "await-initial-authority",
    stateSnapshots: [],
  };
  latestExpiryDiagnostics = diagnostics;
  const captureState = async () => {
    const [session, identity] = await Promise.all([
      readSessionState(fixture.page),
      readIdentityState(fixture.page),
    ]);
    diagnostics.stateSnapshots.push({
      atMs: Date.now(),
      expiresAtMs: session.expiresAtMs,
      hasSession: session.hasSession,
      identityStatus: identity.status,
      isRefetching: session.refetching,
      pending: session.pending,
      unavailable: session.unavailable,
    });
  };
  try {
    diagnostics.stage = "await-initial-authenticated";
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);
    await waitForEvent(server, "$identify");
    const initialIdentify = eventNamed(
      server.allIngestHistory(),
      "$identify"
    ).find((event) => eventDistinctId(event) === accountDistinctIds.A);
    check(initialIdentify !== undefined, "expiry-initial-identify-missing");
    const initialAnonymousDistinctId = propertyString(
      initialIdentify,
      "$anon_distinct_id"
    );
    check(
      initialAnonymousDistinctId !== undefined &&
        initialAnonymousDistinctId !== accountDistinctIds.A,
      "expiry-initial-anonymous-id"
    );
    await waitForEvent(server, "$pageview");
    await waitForSessionSettled(fixture.page);
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    server.clearIngest();
    await captureState();

    diagnostics.stage = "install-short-expiry-deadline";
    const authorityRequestCountBeforeShortDeadline =
      server.authorityRequestCount(fixture.runId);
    const authorityRequestStartedCountBeforeShortDeadline =
      server.authorityRequestStartedCount(fixture.runId);
    server.updateRun(fixture.runId, {
      getSessionDelayMs: 0,
      session: "A",
      sessionExpiresAtMs: Date.now() + 1_500,
    });
    await refreshAnalyticsAccountIdentity(fixture.page);
    check(
      server.authorityRequestCount(fixture.runId) ===
        authorityRequestCountBeforeShortDeadline + 1,
      "expiry-short-refresh-request-count"
    );
    check(
      server.authorityRequestStartedCount(fixture.runId) ===
        authorityRequestStartedCountBeforeShortDeadline + 1,
      "expiry-short-refresh-start-count"
    );
    await waitForAuthenticated(fixture.page);
    await waitForSessionSettled(fixture.page);
    const initialSession = await readSessionState(fixture.page);
    check(initialSession.expiresAtIsDate, "expiry-snapshot-not-date");
    check(
      initialSession.expiresAtMs !== null &&
        Number.isFinite(initialSession.expiresAtMs),
      "expiry-snapshot-deadline-missing"
    );
    diagnostics.deadlineAtMs = initialSession.expiresAtMs;
    check(
      diagnostics.deadlineAtMs > Date.now(),
      "expiry-short-deadline-missing"
    );

    const initialAuthorityRequestCount = server.authorityRequestCount(
      fixture.runId
    );
    const initialAuthorityRequestStartedCount =
      server.authorityRequestStartedCount(fixture.runId);
    diagnostics.stage = "switch-authority-null-before-deadline";
    server.updateRun(fixture.runId, {
      getSessionDelayMs: 400,
      session: "anonymous",
    });
    diagnostics.nullSwitchAtMs = Date.now();
    check(
      diagnostics.nullSwitchAtMs < diagnostics.deadlineAtMs,
      "expiry-authority-switched-after-deadline"
    );
    check(
      server.authorityRequestStartedCount(fixture.runId) ===
        initialAuthorityRequestStartedCount,
      "expiry-authoritative-refresh-started-before-null"
    );
    await captureState();

    diagnostics.stage = "await-expiry-authoritative-refresh-start";
    await waitFor(
      () =>
        server.authorityRequestStartedCount(fixture.runId) >
        initialAuthorityRequestStartedCount,
      "expiry-authoritative-refresh-missing"
    );
    await captureState();

    diagnostics.stage = "await-expiry-authoritative-refresh-complete";
    await waitFor(
      () =>
        server.authorityRequestCount(fixture.runId) >
        initialAuthorityRequestCount,
      "expiry-authoritative-refresh-completion-missing"
    );
    await captureState();

    diagnostics.stage = "await-expiry-anonymous-session";
    await waitForAnonymous(fixture.page);
    await waitFor(
      async () =>
        (await readIdentityState(fixture.page)).status === "anonymous",
      "expiry-identity-not-reset"
    );
    await captureState();
    const consent = await readConsentState(fixture.page);
    check(consent.analyticsAccepted, "expiry-consent-withdrawn");
    check(consent.cookiePresent, "expiry-consent-cookie-missing");

    const anonymousSdk = await readSdkState(fixture.page);
    check(!anonymousSdk.identified, "expiry-anonymous-identified");
    check(
      anonymousSdk.distinctId !== accountDistinctIds.A,
      "expiry-stale-account-id"
    );
    check(
      anonymousSdk.distinctId !== initialAnonymousDistinctId,
      "expiry-stale-initial-anonymous-id"
    );

    await sleep(150);
    const anonymousCaptureMark = server.ingestMark();
    await captureFixtureEvent(fixture.page);
    await waitFor(
      () =>
        fixtureEvents(server.ingestRecordsSince(anonymousCaptureMark)).length >
        0,
      "expiry-anonymous-capture-missing"
    );
    const anonymousCaptures = fixtureEvents(
      server.ingestRecordsSince(anonymousCaptureMark)
    );
    check(
      anonymousCaptures.every(
        (event) => eventDistinctId(event) === anonymousSdk.distinctId
      ),
      "expiry-anonymous-capture-id"
    );
    check(
      anonymousCaptures.every(
        (event) => !JSON.stringify(event).includes(accountDistinctIds.A)
      ),
      "expiry-old-account-property"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

type ReplayCoverage = {
  limitation: string | null;
  mode: "disabled" | "unknown";
  recorderAssetLoaded: boolean;
  snapshots: number;
  autocaptures: number;
};

const runReplayScenario = async (
  browser: Browser,
  server: LocalPostHogServer
): Promise<ReplayCoverage> => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "anonymous",
  });
  let coverage: ReplayCoverage = {
    autocaptures: 0,
    limitation:
      "Production replay is disabled; no replay masking capability was exercised.",
    mode: "disabled",
    recorderAssetLoaded: false,
    snapshots: 0,
  };
  try {
    await waitForAnonymous(fixture.page);
    await waitForEvent(server, "$pageview");
    await waitFor(
      async () => (await readSdkState(fixture.page)).loaded,
      "replay-sdk-not-loaded"
    );
    await waitFor(async () => {
      const state = await readSdkState(fixture.page);
      return (
        state.sessionRecordingDisabled &&
        !state.recordingConfigured &&
        !state.recordingStarted
      );
    }, "replay-mode-not-settled");

    const sdk = await readSdkState(fixture.page);
    check(sdk.sessionRecordingDisabled, "replay-not-disabled");
    check(!sdk.recordingConfigured, "replay-configured");
    check(!sdk.recordingStarted, "replay-started");
    check(sdk.autocaptureDisabled, "autocapture-configured");
    check(sdk.exceptionsDisabled, "exceptions-configured");
    check(sdk.heatmapsDisabled, "heatmaps-configured");
    check(sdk.rageclickDisabled, "rageclick-configured");
    check(sdk.surveysDisabled, "surveys-configured");

    const mark = server.ingestMark();
    await mutateReadonlyDom(fixture.page);
    await fixture.page
      .locator("[data-fixture-readonly-text]")
      .click({ force: true });
    await captureFixtureEvent(fixture.page);
    await sleep(500);
    const records = server.ingestRecordsSince(mark);
    coverage = {
      ...coverage,
      snapshots: eventNamed(records, "$snapshot").length,
      autocaptures: eventNamed(records, "$autocapture").length,
    };
    check(coverage.snapshots === 0, "replay-disabled-snapshot");
    check(coverage.autocaptures === 0, "replay-disabled-autocapture");
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
  return coverage;
};

const triggerVisibilityRefresh = async (page: Page) => {
  await page.evaluate(() => {
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
    } catch {
      // Chromium is visible by default; the event remains the focus signal.
    }
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

const runCrossTabAndFocusScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const problems = runnerProblems;
  const runId = server.createRun({ session: "A" });
  const context = await createContext(browser, problems);
  let pageOne: Page | undefined;
  let pageTwo: Page | undefined;
  try {
    pageOne = await openPage(context, runId, "on", problems);
    pageTwo = await openPage(context, runId, "on", problems);
    await waitForAuthenticated(pageOne);
    await waitForAuthenticated(pageTwo);
    await waitForAuthenticatedIdentity(pageOne);
    await waitForAuthenticatedIdentity(pageTwo);
    await waitForEvent(server, "$identify");
    server.clearIngest();

    server.updateRun(runId, {
      getSessionDelayMs: 400,
      session: "B",
    });
    const secondTabRefresh = refreshAnalyticsAccountIdentity(pageTwo);
    await waitFor(
      async () => (await readSessionState(pageOne!)).refetching,
      "cross-tab-refresh-not-pending"
    );
    await assertRejectedCapture(pageOne, "pending", "cross-tab-stale-capture");
    await secondTabRefresh;
    await waitForAuthenticated(pageTwo);
    await waitForAuthenticatedIdentity(pageTwo);
    await waitForAuthenticated(pageOne);
    await waitForAuthenticatedIdentity(pageOne);
    await captureFixtureEvent(pageOne);
    await waitForFixtureEvent(server);
    check(
      fixtureEvents(server.allIngestRecords()).some(
        (event) => eventDistinctId(event) === accountDistinctIds.B
      ),
      "cross-tab-recovery-identity"
    );

    server.clearIngest();
    server.updateRun(runId, {
      getSessionDelayMs: 400,
      session: "A",
    });
    await triggerVisibilityRefresh(pageTwo);
    await waitFor(
      async () => (await readSessionState(pageTwo!)).refetching,
      "focus-refresh-not-pending"
    );
    await assertRejectedCapture(pageTwo, "pending", "focus-stale-capture");
    await waitForAuthenticated(pageTwo);
    await waitForEvent(server, "$identify");
    await captureFixtureEvent(pageTwo);
    await waitForFixtureEvent(server);
    check(
      fixtureEvents(server.allIngestRecords()).some(
        (event) => eventDistinctId(event) === accountDistinctIds.A
      ),
      "focus-recovery-identity"
    );
  } finally {
    await context.close().catch(() => undefined);
  }
  check(problems.externalRequests === 0, "external-request");
  check(problems.pageErrors === 0, "page-error");
  check(
    problems.consoleErrors === problems.expectedConsoleErrors,
    "console-error"
  );
};

// This is a domain-notification integration case, not a full provider-delete
// E2E. It exercises the callback invoked after confirmed deletion without
// calling Better Auth's native sign-out path.
const runDomainNotificationIntegrationScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const problems = runnerProblems;
  const runId = server.createRun({ session: "A" });
  const context = await createContext(browser, problems);
  let pageOne: Page | undefined;
  let pageTwo: Page | undefined;
  try {
    pageOne = await openPage(context, runId, "on", problems);
    pageTwo = await openPage(context, runId, "on", problems);
    await waitForAuthenticated(pageOne);
    await waitForAuthenticated(pageTwo);
    await waitForAuthenticatedIdentity(pageOne);
    await waitForAuthenticatedIdentity(pageTwo);
    await waitForEvent(server, "$identify");
    server.clearIngest();

    const initialAuthorityRequestCount = server.authorityRequestCount(runId);
    const nativeSignOutRequestCount =
      server.localRequestPathCount("/api/auth/sign-out");

    // The fake authority is now anonymous. Page one invokes the actual domain
    // completion callback; it deliberately does not call authClient.signOut.
    server.updateRun(runId, { getSessionDelayMs: 400, session: "anonymous" });
    await completeAnalyticsAccountSignOut(pageOne);

    await waitFor(
      async () => (await readSessionState(pageTwo!)).refetching,
      "domain-notification-refetch-not-pending"
    );
    await waitFor(
      async () => (await readIdentityState(pageTwo!)).status === "pending",
      "domain-notification-pause-not-observed"
    );

    await assertRejectedCapture(
      pageTwo,
      "pending",
      "domain-notification-stale-capture"
    );

    await waitFor(
      () => server.authorityRequestCount(runId) > initialAuthorityRequestCount,
      "domain-notification-authority-refetch-missing"
    );
    await waitForAnonymous(pageTwo);
    await waitFor(
      async () => (await readIdentityState(pageTwo!)).status === "anonymous",
      "domain-notification-anonymous-identity-missing"
    );
    await sleep(150);

    const anonymousSdk = await readSdkState(pageTwo);
    check(!anonymousSdk.identified, "domain-notification-identified-state");
    check(
      anonymousSdk.distinctId !== accountDistinctIds.A,
      "domain-notification-stale-sdk-id"
    );
    check(
      server.localRequestPathCount("/api/auth/sign-out") ===
        nativeSignOutRequestCount,
      "domain-notification-native-sign-out"
    );

    const anonymousCaptureMark = server.ingestMark();
    await captureFixtureEvent(pageTwo);
    await waitFor(
      () =>
        fixtureEvents(server.ingestRecordsSince(anonymousCaptureMark)).length >
        0,
      "domain-notification-anonymous-capture-missing"
    );
    const anonymousCaptures = fixtureEvents(
      server.ingestRecordsSince(anonymousCaptureMark)
    );
    check(
      anonymousCaptures.every(
        (event) => eventDistinctId(event) !== accountDistinctIds.A
      ),
      "domain-notification-anonymous-capture-identity"
    );
  } finally {
    await context.close().catch(() => undefined);
  }
  check(problems.externalRequests === 0, "external-request");
  check(problems.pageErrors === 0, "page-error");
  check(
    problems.consoleErrors === problems.expectedConsoleErrors,
    "console-error"
  );
};

const runCrossTabConsentWithdrawalScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const problems = runnerProblems;
  const runId = server.createRun({ session: "B" });
  const context = await createContext(browser, problems);
  let pageOne: Page | undefined;
  let pageTwo: Page | undefined;
  try {
    pageOne = await openPage(context, runId, "on", problems);
    pageTwo = await openPage(context, runId, "on", problems);
    await waitForAuthenticated(pageOne);
    await waitForAuthenticated(pageTwo);
    await waitForAuthenticatedIdentity(pageOne);
    await waitForAuthenticatedIdentity(pageTwo);
    await waitForEvent(server, "$identify");
    await waitFor(
      () =>
        server.allPostHogRequests().filter(isFeatureFlagsRequest).length >= 2,
      "cross-tab-consent-initial-flags"
    );
    await waitForFixtureConsentView(pageOne, true);
    await waitForFixtureConsentView(pageTwo, true);
    await sleep(150);

    server.clearIngest();
    const flagsBeforeWithdrawal = server
      .allPostHogRequests()
      .filter(isFeatureFlagsRequest).length;
    await setFixtureConsent(pageOne, false);
    await waitForFixtureConsentView(pageOne, false);
    await waitForFixtureConsentView(pageTwo, false);
    await waitFor(async () => {
      const [one, two] = await Promise.all([
        readSdkState(pageOne!),
        readSdkState(pageTwo!),
      ]);
      return (
        !one.capturing &&
        !two.capturing &&
        !one.identified &&
        !two.identified &&
        one.distinctId !== accountDistinctIds.B &&
        two.distinctId !== accountDistinctIds.B
      );
    }, "cross-tab-consent-withdrawal-opt-out");
    await waitForAuthenticatedIdentity(pageOne);
    await waitForAuthenticatedIdentity(pageTwo);
    await assertRejectedCapture(
      pageOne,
      "authenticated",
      "cross-tab-consent-withdrawal-one-capture"
    );
    await assertRejectedCapture(
      pageTwo,
      "authenticated",
      "cross-tab-consent-withdrawal-two-capture"
    );
    check(
      server.allPostHogRequests().filter(isFeatureFlagsRequest).length ===
        flagsBeforeWithdrawal,
      "cross-tab-consent-withdrawal-flag-restart"
    );

    server.clearIngest();
    const flagsBeforeReconsent = server
      .allPostHogRequests()
      .filter(isFeatureFlagsRequest).length;
    const authorityRequestsBeforeReconsent =
      server.authorityRequestCount(runId);
    server.updateRun(runId, {
      getSessionDelayMs: 400,
      session: "B",
    });
    await setFixtureConsent(pageOne, true);
    await waitForFixtureConsentView(pageOne, true);
    await waitForFixtureConsentView(pageTwo, true);
    await waitFor(
      async () => (await readSessionState(pageTwo!)).refetching,
      "cross-tab-consent-reconsent-refresh-not-pending"
    );
    await waitFor(
      async () => (await readIdentityState(pageTwo!)).status === "pending",
      "cross-tab-consent-reconsent-identity-not-pending"
    );
    await assertRejectedCapture(
      pageTwo,
      "pending",
      "cross-tab-consent-reconsent-pending-capture"
    );
    check(
      server.allPostHogRequests().filter(isFeatureFlagsRequest).length ===
        flagsBeforeReconsent,
      "cross-tab-consent-reconsent-early-flag-restart"
    );

    await waitFor(
      () =>
        server.authorityRequestCount(runId) > authorityRequestsBeforeReconsent,
      "cross-tab-consent-reconsent-authority-refresh"
    );
    await waitForAuthenticated(pageOne);
    await waitForAuthenticatedIdentity(pageOne);
    await waitForAuthenticated(pageTwo);
    await waitForAuthenticatedIdentity(pageTwo);
    await waitFor(
      () =>
        server.allPostHogRequests().filter(isFeatureFlagsRequest).length >
        flagsBeforeReconsent,
      "cross-tab-consent-reconsent-flag-restart"
    );
    const [reconsentedSdkOne, reconsentedSdkTwo] = await Promise.all([
      readSdkState(pageOne),
      readSdkState(pageTwo),
    ]);
    for (const [label, sdk] of [
      ["one", reconsentedSdkOne],
      ["two", reconsentedSdkTwo],
    ] as const) {
      check(sdk.capturing, `cross-tab-consent-reconsent-${label}-capturing`);
      check(sdk.identified, `cross-tab-consent-reconsent-${label}-identified`);
      check(
        sdk.distinctId === accountDistinctIds.B,
        `cross-tab-consent-reconsent-${label}-identity`
      );
    }

    const reconsentedCaptureMark = server.ingestMark();
    await captureFixtureEvent(pageTwo);
    await waitFor(
      () =>
        fixtureEvents(server.ingestRecordsSince(reconsentedCaptureMark))
          .length > 0,
      "cross-tab-consent-reconsent-capture"
    );
    const reconsentedCaptures = fixtureEvents(
      server.ingestRecordsSince(reconsentedCaptureMark)
    );
    check(
      reconsentedCaptures.every(
        (event) => eventDistinctId(event) === accountDistinctIds.B
      ),
      "cross-tab-consent-reconsent-capture-identity"
    );
  } finally {
    await context.close().catch(() => undefined);
  }
  check(problems.externalRequests === 0, "external-request");
  check(problems.pageErrors === 0, "page-error");
  check(
    problems.consoleErrors === problems.expectedConsoleErrors,
    "console-error"
  );
};

const runFocusRefreshRaceScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "A",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);
    await waitForEvent(server, "$identify");
    await waitForEvent(server, "$pageview");
    await waitForSessionSettled(fixture.page);
    await sleep(100);
    server.clearIngest();

    const initialAuthorityRequestCount = server.authorityRequestCount(
      fixture.runId
    );
    server.updateRun(fixture.runId, {
      getSessionDelayMs: 500,
      session: "A",
    });
    await triggerVisibilityRefresh(fixture.page);
    await waitFor(
      async () => (await readSessionState(fixture.page)).refetching,
      "focus-race-initial-refresh-not-pending"
    );
    await sleep(100);

    server.updateRun(fixture.runId, {
      getSessionDelayMs: 300,
      session: "B",
    });
    await triggerVisibilityRefresh(fixture.page);
    await waitFor(
      () =>
        server.authorityRequestCount(fixture.runId) >
        initialAuthorityRequestCount,
      "focus-race-old-a-response-missing"
    );
    await waitFor(
      async () => (await readIdentityState(fixture.page)).status === "pending",
      "focus-race-old-a-not-pending"
    );
    check(
      eventNamed(server.allIngestRecords(), "$pageview").length === 0,
      "focus-race-old-a-pageview"
    );
    await assertRejectedCapture(
      fixture.page,
      "pending",
      "focus-race-pending-capture"
    );
    check(server.ingestMark() === 0, "focus-race-pending-capture");

    await waitFor(
      () =>
        server.authorityRequestCount(fixture.runId) >
        initialAuthorityRequestCount + 1,
      "focus-race-fresh-b-response-missing"
    );
    await waitForAuthenticated(fixture.page);
    await waitForAuthenticatedIdentity(fixture.page);
    await waitForEvent(server, "$identify");
    await waitForEvent(server, "$pageview");
    const pageviews = eventNamed(server.allIngestRecords(), "$pageview");
    check(pageviews.length > 0, "focus-race-pageview-missing");
    check(
      pageviews.every(
        (event) => eventDistinctId(event) === accountDistinctIds.B
      ),
      "focus-race-pageview-identity"
    );
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    check(
      fixtureEvents(server.allIngestRecords()).some(
        (event) => eventDistinctId(event) === accountDistinctIds.B
      ),
      "focus-race-fresh-b-capture"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const runConsentWithdrawalScenario = async (
  browser: Browser,
  server: LocalPostHogServer
) => {
  server.clearIngest();
  const fixture = await openFixture(browser, server, {
    consent: "on",
    session: "B",
  });
  try {
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    const previousIdentify = eventNamed(
      server.allIngestRecords(),
      "$identify"
    ).find((event) => eventDistinctId(event) === accountDistinctIds.B);
    check(previousIdentify !== undefined, "withdrawal-initial-identify");
    const previousAnonymousDistinctId = propertyString(
      previousIdentify,
      "$anon_distinct_id"
    );
    check(
      previousAnonymousDistinctId !== undefined,
      "withdrawal-initial-anonymous-id"
    );

    server.clearIngest();
    await withdrawConsent(fixture.page);
    await waitFor(
      async () => !(await readSdkState(fixture.page)).capturing,
      "withdrawal-capturing"
    );
    await waitForAuthenticatedIdentity(fixture.page);
    const sdkAfterWithdrawal = await readSdkState(fixture.page);
    check(!sdkAfterWithdrawal.capturing, "withdrawal-capturing");
    check(!sdkAfterWithdrawal.recordingStarted, "withdrawal-recording");
    await assertRejectedCapture(
      fixture.page,
      "authenticated",
      "withdrawal-capture"
    );
    check(server.ingestMark() === 0, "withdrawal-ingest");

    server.updateRun(fixture.runId, { session: "B" });
    await grantConsent(fixture.page);
    await waitForAuthenticated(fixture.page);
    await waitForEvent(server, "$identify");
    await captureFixtureEvent(fixture.page);
    await waitForFixtureEvent(server);
    const records = server.allIngestRecords();
    const identifyB = eventNamed(records, "$identify").find(
      (event) => eventDistinctId(event) === accountDistinctIds.B
    );
    check(identifyB !== undefined, "withdrawal-reconsent-identify");
    const reconsentAnonymousDistinctId = propertyString(
      identifyB,
      "$anon_distinct_id"
    );
    check(
      reconsentAnonymousDistinctId !== undefined,
      "withdrawal-reconsent-anonymous-id"
    );
    check(
      reconsentAnonymousDistinctId !== previousAnonymousDistinctId,
      "withdrawal-old-anonymous-alias"
    );
    const captures = fixtureEvents(records);
    check(
      captures.some((event) => eventDistinctId(event) === accountDistinctIds.B),
      "withdrawal-reconsent-capture"
    );
  } finally {
    await closeFixture(fixture);
  }
  assertBrowserProblems(fixture);
};

const createBuildPlugin = (posthogHost: string): Bun.BunPlugin => ({
  name: "posthog-identity-browser-build",
  setup(build) {
    const envNamespace = "posthog-identity-fixture-env";
    const navigationNamespace = "posthog-identity-fixture-navigation";
    const sourceExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

    const fileExists = async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    };

    const resolveAppModule = async (specifier: string) => {
      const candidate = join(appRoot, specifier);
      for (const extension of sourceExtensions) {
        const path = `${candidate}${extension}`;
        if (await fileExists(path)) return path;
      }
      for (const extension of sourceExtensions.slice(1)) {
        const path = join(candidate, `index${extension}`);
        if (await fileExists(path)) return path;
      }
      throw new Error(`missing app module: ${specifier}`);
    };

    build.onResolve({ filter: /^@\/env$/ }, () => ({
      namespace: envNamespace,
      path: "env",
    }));
    build.onLoad({ filter: /^env$/, namespace: envNamespace }, () => ({
      contents: `export const env = { NEXT_PUBLIC_POSTHOG_HOST: ${JSON.stringify(
        posthogHost
      )}, NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: ${JSON.stringify(
        posthogProjectToken
      )} } as const;`,
      loader: "ts",
    }));

    build.onResolve({ filter: /^@\// }, async (args) => ({
      path: await resolveAppModule(args.path.slice(2)),
    }));

    build.onResolve({ filter: /^next\/navigation$/ }, () => ({
      namespace: navigationNamespace,
      path: "navigation",
    }));
    build.onLoad(
      { filter: /^navigation$/, namespace: navigationNamespace },
      () => ({
        contents: `
          export const usePathname = () => globalThis.location.pathname;
          export const useSearchParams = () => new URLSearchParams(globalThis.location.search);
          export const useParams = () => ({});
          export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {} });
          export const redirect = () => {};
          export const notFound = () => {};
        `,
        loader: "js",
      })
    );
  },
});

const buildFixtureBundle = async () => {
  await rm(artifactRoot, { force: true, recursive: true });
  await mkdir(bundleRoot, { recursive: true });
  for (const mode of fixtureModes) {
    let result: Awaited<ReturnType<typeof Bun.build>>;
    try {
      result = await Bun.build({
        define: { "process.env.NODE_ENV": JSON.stringify("development") },
        entrypoints: [fixturePath],
        format: "esm",
        minify: false,
        outdir: join(bundleRoot, mode),
        plugins: [createBuildPlugin(posthogHostByFixtureMode[mode])],
        sourcemap: "none",
        target: "browser",
      });
    } catch {
      throw new CheckFailure("fixture-bundle-build");
    }
    if (!result.success) throw new CheckFailure("fixture-bundle-build");
    const output = result.outputs.find((candidate) =>
      candidate.path.endsWith(".js")
    );
    check(output !== undefined, "fixture-bundle-output");
    const outputPath = isAbsolute(output.path)
      ? output.path
      : resolve(bundleRoot, output.path);
    check(
      outputPath === fixtureBundlePaths[mode],
      "fixture-bundle-output-name"
    );
  }
};

const expiryDiagnosticsReport = (server: LocalPostHogServer) => {
  const diagnostics = latestExpiryDiagnostics;
  if (diagnostics === undefined) return null;

  const relativeMs = (timestamp: number | undefined) =>
    timestamp === undefined
      ? null
      : timestamp - diagnostics.scenarioStartedAtMs;
  const authorityRequests = server
    .authorityRequestObservations(diagnostics.runId)
    .map((request) => ({
      completedAtMs: relativeMs(request.completedAtMs),
      completedSequence: request.completedSequence ?? null,
      startedAtMs: relativeMs(request.startedAtMs),
      startedSequence: request.startedSequence,
    }));

  return {
    authorityRequests,
    completedRequestCount: authorityRequests.filter(
      (request) => request.completedSequence !== null
    ).length,
    deadlineAtMs: relativeMs(diagnostics.deadlineAtMs),
    nullSwitchAtMs: relativeMs(diagnostics.nullSwitchAtMs),
    nullSwitchBeforeDeadline:
      diagnostics.deadlineAtMs !== undefined &&
      diagnostics.nullSwitchAtMs !== undefined
        ? diagnostics.nullSwitchAtMs < diagnostics.deadlineAtMs
        : null,
    stage: diagnostics.stage,
    startedRequestCount: authorityRequests.length,
    stateSnapshots: diagnostics.stateSnapshots.map((snapshot) => ({
      atMs: relativeMs(snapshot.atMs),
      expiresAtMs: relativeMs(snapshot.expiresAtMs ?? undefined),
      hasSession: snapshot.hasSession,
      identityStatus: snapshot.identityStatus,
      isRefetching: snapshot.isRefetching,
      pending: snapshot.pending,
      unavailable: snapshot.unavailable,
    })),
  };
};

const browserReport = (
  server: LocalPostHogServer,
  problems: FixtureBrowserProblems,
  replay: ReplayCoverage,
  passedScenarios: readonly string[],
  failedScenario: string | null,
  failureCode: string | null,
  status: "failed" | "passed"
) => {
  const sensitivePostHogRequestHits = findSensitivePostHogRequestHits(server);
  const payloadMarkerHits = [
    ...new Set(sensitivePostHogRequestHits.map((hit) => hit.markerCode)),
  ].sort();

  return {
    browser: {
      engine: "Chromium",
      ephemeralContext: true,
      externalRequestsAborted: problems.externalRequests,
      expectedConsoleErrors: problems.expectedConsoleErrors,
      pageErrorNames: [...problems.pageErrorNames].sort(),
      pageErrors: problems.pageErrors,
      consoleErrors: problems.consoleErrors,
      unexpectedConsoleErrors:
        problems.consoleErrors - problems.expectedConsoleErrors,
    },
    checks: {
      consentCookieGate: passedScenarios.includes("consent-cookie-gate"),
      consentOff: passedScenarios.includes("consent-off"),
      consentWithdrawal: passedScenarios.includes("consent-withdrawal"),
      crossTabAndFocus: passedScenarios.includes("cross-tab-focus"),
      crossTabConsentWithdrawal: passedScenarios.includes(
        "cross-tab-consent-withdrawal"
      ),
      domainNotificationIntegration: passedScenarios.includes(
        "domain-notification-integration"
      ),
      delayedFirstPageview: passedScenarios.includes("delayed-first-pageview"),
      failedLogout: passedScenarios.includes("failed-logout"),
      expiryRefreshNull: passedScenarios.includes("expiry-refresh-null"),
      focusRefreshRace: passedScenarios.includes("focus-refresh-race"),
      legacyFlagsInitialProperties: passedScenarios.includes(
        "legacy-flags-initial-properties"
      ),
      reloadSwitch: passedScenarios.includes("reload-switch"),
      sameIdentityRefresh: passedScenarios.includes("same-identity-refresh"),
      sameHostFailClosed: passedScenarios.includes("same-host-fail-closed"),
      successfulLogout: passedScenarios.includes("successful-logout"),
      unavailableSession: passedScenarios.includes("unavailable-session"),
    },
    failureCode,
    failedScenario,
    ingest: server.report(),
    payloadMarkerHits,
    payloadMarkersAbsent: sensitivePostHogRequestHits.length === 0,
    posthogPrivacyHits: summarizeSensitivePostHogRequestHits(
      sensitivePostHogRequestHits
    ),
    replay,
    sdk: { package: "posthog-js", version: posthogSdkVersion },
    expiryDiagnostics: expiryDiagnosticsReport(server),
    status,
    passedScenarios,
    schemaVersion: 1,
  };
};

const writeReport = async (report: ReturnType<typeof browserReport>) => {
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(
    join(artifactRoot, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
};

const main = async () => {
  const server = new LocalPostHogServer();
  let browser: Browser | undefined;
  const problems = runnerProblems;
  const passedScenarios: string[] = [];
  let replay: ReplayCoverage = {
    autocaptures: 0,
    limitation: null,
    mode: "unknown",
    recorderAssetLoaded: false,
    snapshots: 0,
  };
  let currentScenario: string | null = null;
  let failureCode: string | null = null;

  try {
    await buildFixtureBundle();
    await server.start();
    browser = await chromium.launch({ headless: true });

    const scenarios: readonly [
      string,
      (browser: Browser, server: LocalPostHogServer) => Promise<void>,
    ][] = [
      ["same-host-fail-closed", runSameHostFailClosedScenario],
      ["consent-off", runConsentOffScenario],
      ["consent-cookie-gate", runConsentCookieGateScenario],
      ["delayed-first-pageview", runDelayedFirstPageviewScenario],
      ["anonymous-identify", runAnonymousIdentifyScenario],
      ["same-identity-refresh", runSameIdentityRefreshScenario],
      [
        "legacy-flags-initial-properties",
        runLegacyFlagsInitialPropertiesScenario,
      ],
      ["reload-switch", runReloadSwitchScenario],
      ["failed-logout", runFailedLogoutScenario],
      ["successful-logout", runSuccessfulLogoutScenario],
      ["unavailable-session", runUnavailableSessionScenario],
      ["expiry-refresh-null", runExpiryRefreshNullScenario],
      ["cross-tab-focus", runCrossTabAndFocusScenario],
      [
        "domain-notification-integration",
        runDomainNotificationIntegrationScenario,
      ],
      ["cross-tab-consent-withdrawal", runCrossTabConsentWithdrawalScenario],
      ["focus-refresh-race", runFocusRefreshRaceScenario],
      ["consent-withdrawal", runConsentWithdrawalScenario],
    ];

    for (const [name, scenario] of scenarios) {
      currentScenario = name;
      await scenario(browser, server);
      passedScenarios.push(name);
    }

    currentScenario = "replay-pii";
    replay = await runReplayScenario(browser, server);

    assertPositiveIngest(server);
    assertPostHogTransportSecurity(server);
    check(server.report().unreadableIngestCount === 0, "ingest-decode");
    check(
      eventNamed(server.allIngestHistory(), "$snapshot").length === 0,
      "snapshot-captured"
    );
    check(
      eventNamed(server.allIngestHistory(), "$autocapture").length === 0,
      "autocapture-captured"
    );
    const report = browserReport(
      server,
      problems,
      replay,
      passedScenarios,
      null,
      null,
      "passed"
    );
    check(report.payloadMarkersAbsent, "payload-marker-leak");
    await writeReport(report);
    process.stdout.write(
      `${JSON.stringify({
        externalRequests: problems.externalRequests,
        ingestRecords: server.report().ingestRecordCount,
        payloadMarkersAbsent: true,
        replayMode: replay.mode,
        scenarios: passedScenarios.length + 1,
        status: "passed",
      })}\n`
    );
  } catch (error) {
    failureCode = error instanceof CheckFailure ? error.code : "runner-error";
    const report = browserReport(
      server,
      problems,
      replay,
      passedScenarios,
      currentScenario,
      failureCode,
      "failed"
    );
    await writeReport(report);
    process.stdout.write(
      `${JSON.stringify({
        externalRequests: problems.externalRequests,
        failureCode,
        passedScenarios: passedScenarios.length,
        privacyHits: report.posthogPrivacyHits,
        expiryDiagnostics: report.expiryDiagnostics,
        transportHeaderLeaks: report.ingest.posthogTransportHeaderLeaks,
        status: "failed",
      })}\n`
    );
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => undefined);
    await server.stop().catch(() => undefined);
  }
};

await main();
