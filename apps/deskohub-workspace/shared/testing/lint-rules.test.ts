import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "@/scripts/shared/command";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const fixtureRoot = mkdtempSync(join(tmpdir(), "deskohub-lint-rules-"));
const config = join(fixtureRoot, "biome.json");

const repositoryConfig = JSON.parse(
  readFileSync(join(repositoryRoot, "biome.json"), "utf8")
) as {
  readonly plugins: readonly string[];
  readonly overrides: readonly { readonly includes: readonly string[] }[];
};

// Every case lives in its own `case-<n>/` directory beside its siblings, so the
// repository's path-scoped overrides gain one leading directory segment.
const caseScoped = (glob: string) =>
  glob.startsWith("!") ? `!*/${glob.slice(1)}` : `*/${glob}`;

// biome-ignore format: compact configuration literal.
writeFileSync(config, JSON.stringify({
  linter: { enabled: true },
  plugins: repositoryConfig.plugins.map((plugin) => join(repositoryRoot, plugin)),
  overrides: repositoryConfig.overrides.map((override) => ({ ...override, includes: override.includes.map(caseScoped) })),
}));

type Row = readonly [string, string, boolean, string?];

const gen =
  "(input: string) => Effect.gen(function* () { return yield* Effect.succeed(input); })";
const piped =
  '() => Effect.gen(function* () { return yield* Effect.succeed("seat-1"); }).pipe(Effect.andThen((value) => value))';
const multiPiped =
  '() => Effect.gen(function* () { return yield* Effect.succeed("seat-1"); }).pipe(Effect.tap(() => Effect.void), Effect.andThen((value) => value))';
const transform =
  ", (effect) => effect.pipe(Effect.catchAll(() => Effect.succeed(null)))";
const twoTransforms = `${transform}, (e) => e.pipe(Effect.map((v) => v))`;
const threeTransforms = `${twoTransforms}, (e) => e.pipe(Effect.tap(() => Effect.void))`;
const traced = (callback: string, extra = "") =>
  `export const loadReservation = Effect.fn("ReservationService.loadReservation")(${callback}${extra});\n`;
const untracedGen =
  "export const loadAnalytics = (input: string) => Effect.gen(function* () { return yield* Effect.succeed(input); });\n";
const arrowGen = (body: string) => `export const probe = ${body}\n`;
const applyDiscountCodeOriginal = `export const applyDiscountCodeToPayState = Effect.fn(
  "checkout.applyDiscountCodeToPayState"
)(
  ${gen},
  (effect) => effect.pipe(Effect.catchTags({ PromotionCodeUnavailableError: () => Effect.succeed("unavailable") }))
);
`;

const nestedCatchTag = `export const recoverReservation = Effect.fn("ReservationService.recover")(function* (input: string) {
  return yield* Effect.succeed(input).pipe(
    Effect.catchTag("ReservationNotFoundError", (error) => Effect.gen(function* () { return yield* Effect.succeed("fallback"); }))
  );
});
`;
const nestedAnonymousCallback = `export const enrichReservation = Effect.fn("ReservationService.enrich")(function* (input: string) {
  return yield* Effect.succeed(input).pipe(
    Effect.andThen((value) => Effect.gen(function* () { return yield* Effect.succeed(value); }))
  );
});
`;
const tracedAnonymous =
  'export const loadReservation = Effect.fn("ReservationService.loadReservation")(function* () { return yield* Effect.succeed("seat-1"); });\n';
const directGenValue =
  'export const loadReservation = Effect.gen(function* () { return yield* Effect.succeed("seat-1"); });\n';

const tracedLazyValue = (effectConstructor: string, suffix = "") =>
  `export const loadValue = Effect.fn("Workspace.loadValue")(() => Effect.${effectConstructor}${suffix});\n`;

const blockBodiedComposed = `export const deliver = (request: string): Effect.Effect<string> => {
  const routed = Effect.succeed(request);
  return routed.pipe(Effect.andThen((value) => value));
};\n`;
const blockBodiedDirectPiped = `export const deliverPiped = (request: string): Effect.Effect<string> => {
  return Effect.succeed(request).pipe(Effect.andThen((value) => value));
};\n`;
const blockBodiedEffectGen = `export const deliverGen = (request: string): Effect.Effect<string> => {
  return Effect.gen(function* () { return yield* Effect.succeed(request); });
};\n`;
const blockBodiedMethodProperty = `export const makeDelivery = () => ({
  deliver: (request: string): Effect.Effect<string> => {
    return Effect.succeed(request).pipe(Effect.andThen((value) => value));
  }
});\n`;
const blockBodiedPromise = `export const fetchUser = (id: string): Promise<string> => {
  return Promise.resolve(id);
};\n`;
const blockBodiedNonEffect = `export const formatId = (id: string): string => {
  return \`value-\${id}\`;
};\n`;
const blockBodiedEffectFnCallback = `export const loadValue = Effect.fn("Workspace.loadValue")((input: string): Effect.Effect<string> => {
  return Effect.succeed(input).pipe(Effect.andThen((value) => value));
});\n`;
const blockBodiedBareSucceed = `export const makeValue = (input: string): Effect.Effect<string> => {
  return Effect.succeed(input);
};\n`;

const blockBodiedInferred = `export const deliver = (request: string) => {
  const routed = Effect.succeed(request);
  return routed.pipe(Effect.andThen((value) => value));
};\n`;
const blockBodiedInferredDirect = `export const deliver = (request: string) => {
  return Effect.succeed(request).pipe(Effect.map(value => value));
};\n`;
const blockBodiedAsyncPromise = `export const deliver = async (request: string) => {
  return await fetch(request);
};\n`;
const blockBodiedInferredNonEffect = `export const deliver = (request: string) => {
  return request.toUpperCase();
};\n`;
const blockBodiedMethod = `export const service = {
  deliver(request: string) {
    return Effect.succeed(request).pipe(Effect.map(value => value));
  },
};\n`;

const servicePropertyInferred = `const implementation = Effect.gen(function* () {
  return {
    deliver: (request: string) => {
      return Effect.succeed(request).pipe(Effect.map(value => value));
    },
  };
});\n`;
const servicePropertyTyped = `const implementation = Effect.gen(function* () {
  return {
    deliver: (request: string): Effect.Effect<string> => {
      return Effect.succeed(request).pipe(Effect.map(value => value));
    },
  };
});\n`;
const inlineCallback = `export const load = Effect.fn("Workspace.load")(() => Effect.succeed("value").pipe(Effect.map((value) => value)));\n`;
const inlineCallbackMethod = `export const load = Effect.fn("Workspace.load")(function* () { return yield* Effect.succeed("value").pipe(Effect.map((value) => value)); });\n`;
const blockBodiedInlineCallback = `export const run = Effect.succeed("value").pipe(Effect.map((value) => { return Effect.succeed(value).pipe(Effect.map(v => v)); }));\n`;
const blockBodiedInlineHandler = `export const run = Effect.succeed("value").pipe(Effect.catchTag("NotFound", (error) => { return Effect.succeed(error).pipe(Effect.map(value => value)); }));\n`;

const reservations = "apps/deskohub-workspace/features/reservations";
const booking = `${reservations}/book-seat.ts`;
const generated =
  "apps/deskohub-workspace/shared/backend/generated/dotypos-client.ts";

const account = "apps/deskohub-workspace/features/account";
const browserRunner =
  "apps/deskohub-workspace/shared/browser/workspace-browser-effect.ts";
const accountBackend = `${account}/backend`;
const authServer = `${accountBackend}/auth/auth-server.ts`;
const authOptions = `${accountBackend}/auth/auth-options.ts`;
const admin = "apps/deskohub-workspace/app/[locale]/admin";
const capabilityClass =
  'export class ReservationService extends Context.Service<ReservationService, { readonly hold: () => Effect.Effect<void> }>()("ReservationService") {\n  static Default = Layer.succeed(this, { hold: () => Effect.void });\n}\n';
const breadcrumbLoader =
  "apps/deskohub-workspace/features/accounting/admin/invoice-breadcrumb.server.ts";
const breadcrumbs =
  "apps/deskohub-workspace/features/administration/breadcrumb.server.tsx";
const featureFlags =
  "apps/deskohub-workspace/features/feature-flags/backend/workspace-feature-flag.service.ts";
const checkoutActions =
  "apps/deskohub-workspace/features/checkout/components/checkout-actions.tsx";
const button = (attributes: string) =>
  `export const Action = () => <Button ${attributes}>Save</Button>;\n`;

// biome-ignore format: the case table stays one row per line on purpose.
const rules: { name: string; diagnostic: string; module: string; cases: Row[] }[] = [
  {
    name: "no-wildcard-reexport", diagnostic: "re-exports must be explicit",
    module: `${reservations}/index.ts`,
    cases: [
      ["rejects value wildcards", 'export * from "./reservation";\n', true],
      ["rejects type wildcards", 'export type * from "./reservation-types";\n', true],
      ["permits explicit namespaces", 'export * as Reservations from "./reservations";\n', false],
      ["permits explicit type namespaces", 'export type * as ReservationTypes from "./reservation-types";\n', false],
      ["permits named re-exports", 'export { reserveSeat, cancelReservation } from "./reservation";\n', false],
      ["permits ordinary imports", 'import { reserveSeat } from "./reservation";\n', false, booking],
      ["permits namespace imports", 'import * as reservations from "./reservations";\n', false, booking],
      ["permits test modules", 'export * from "./reservation-fixtures";\n', false, `${reservations}/index.test.ts`],
      ["permits generated modules", 'export * from "./dotypos-types";\n', false, generated],
      ["permits modules outside Workspace", 'export * from "./catalog";\n', false, "apps/dhw/src/barrel.ts"],
    ],
  },
  {
    name: "no-raw-environment-in-e2e-launcher", diagnostic: "The E2E launcher forwards only toPlaywrightEnvironment",
    module: "apps/deskohub-workspace/scripts/workspace-e2e.ts",
    cases: [
      ["rejects spreading process.env into the Playwright spawn", 'Bun.spawn(["bunx", "playwright", "test"], { env: { ...process.env, CI: "true" } });\n', true],
      ["rejects reading a raw process variable", "export const baseUrl = process.env.WORKSPACE_E2E_BASE_URL;\n", true],
      ["rejects spreading Bun.env", 'Bun.spawn(["bunx", "playwright", "test"], { env: { ...Bun.env } });\n', true],
      ["permits the decoded Playwright environment", 'Bun.spawn(["bunx", "playwright", "test"], { env: { ...toPlaywrightEnvironment(environment), CI: "true" } });\n', false],
      ["permits process.env in other scripts", "export const baseUrl = process.env.WORKSPACE_E2E_BASE_URL;\n", false, "apps/deskohub-workspace/scripts/workspace-e2e-allocation.ts"],
    ],
  },
  {
    name: "prefer-effect-fn", diagnostic: "Define Effect generator functions with Effect.fn",
    module: "apps/deskohub-workspace/features/reservation/load-reservation.ts",
    cases: [
      ["rejects a traced direct generator", traced(gen), true],
      ["rejects a traced piped generator", traced(piped), true],
      ["rejects generators piped to multiple operators", traced(multiPiped), true],
      ["rejects piped generators with a trailing transform", traced(piped, transform), true],
      ["rejects a generator with two trailing transforms", traced(piped, twoTransforms), true],
      ["rejects a generator with three trailing transforms", traced(gen, threeTransforms), true],
      ["rejects the original apply-discount-code wrapper", applyDiscountCodeOriginal, true],
      ["rejects a block-bodied arrow returning composed Effects", blockBodiedComposed, true],
      ["rejects a block-bodied arrow returning Effect.succeed(...).pipe(...)", blockBodiedDirectPiped, true],
      ["rejects a block-bodied arrow returning Effect.gen", blockBodiedEffectGen, true],
      ["rejects a block-bodied method property returning composed Effects", blockBodiedMethodProperty, true],
      ["rejects a block-bodied arrow with inferred return type", blockBodiedInferred, true],
      ["rejects a block-bodied arrow with inferred return type returning direct pipe", blockBodiedInferredDirect, true],
      ["rejects an inferred-return service property nested in Effect.gen", servicePropertyInferred, true],
      ["rejects a typed-return service property nested in Effect.gen", servicePropertyTyped, true],
      ["permits the canonical generator callback", traced("function* (input: string) { return yield* Effect.succeed(input); }"), false],
      ["permits the canonical callback with many transforms", traced("function* (input: string) { return yield* Effect.succeed(input); }", threeTransforms), false],
      ["permits a non-generator Effect callback", arrowGen('Effect.fn("WorkspaceFeatureFlagService.isEnabled")((key: string) => Effect.succeed(key).pipe(Effect.andThen((value) => value)));'), false],
      ["permits an async server bridge", 'export const bridgeReservation = async (input: string) => { "use server"; return Effect.runPromise(Effect.succeed(input)); };\n', false],
      ["permits a block-bodied arrow returning Promise", blockBodiedPromise, false],
      ["permits a block-bodied non-Effect arrow", blockBodiedNonEffect, false],
      ["permits a block-bodied arrow already using Effect.fn", blockBodiedEffectFnCallback, false],
      ["permits a block-bodied arrow returning bare Effect.succeed without pipe", blockBodiedBareSucceed, false],
      ["permits a block-bodied async arrow returning a Promise", blockBodiedAsyncPromise, false],
      ["permits a block-bodied arrow with inferred non-Effect return", blockBodiedInferredNonEffect, false],
      ["permits an object shorthand method returning composed Effects", blockBodiedMethod, false],
      ["permits a direct inline callback", inlineCallback, false],
      ["permits a direct inline generator callback", inlineCallbackMethod, false],
      ["permits a block-bodied inline callback argument", blockBodiedInlineCallback, false],
      ["permits a block-bodied inline handler argument", blockBodiedInlineHandler, false],
    ],
  },
  {
    name: "prefer-effect-fn-generator-arrows",
    diagnostic: "Define Effect generator functions with Effect.fn",
    module: "apps/deskohub-workspace/features/reservation/load-reservation.ts",
    cases: [
      ["rejects a nested catchTag recovery handler", nestedCatchTag, true],
      ["rejects an anonymous nested generator callback", nestedAnonymousCallback, true],
      ["rejects a top-level arrow generator", untracedGen, true],
      ["permits an anonymous Effect.fn generator handler", tracedAnonymous, false],
      ["permits a direct Effect.gen value", directGenValue, false],
      ["permits a non-generator arrow", arrowGen('Effect.fn("WorkspaceFeatureFlagService.isEnabled")((key: string) => Effect.succeed(key));'), false],
      ["permits test modules", untracedGen, false, `${reservations}/load-reservation.test.ts`],
      ["permits test-utils modules", untracedGen, false, `${reservations}/load-reservation.test-utils.ts`],
      ["permits generated modules", untracedGen, false, generated],
      ["permits modules outside Workspace", untracedGen, false, "apps/dhw/src/load-reservation.ts"],
    ],
  },
  {
    name: "prefer-effect-value", diagnostic: "Define a lazy Effect value",
    module: "apps/deskohub-workspace/features/reservation/load-value.ts",
    cases: [
      ["rejects Effect.tryPromise", tracedLazyValue('tryPromise({ try: () => headers(), catch: (cause) => cause })'), true],
      ["rejects Effect.promise", tracedLazyValue("promise(() => headers())"), true],
      ["rejects Effect.sync", tracedLazyValue("sync(() => headers())"), true],
      ["rejects Effect.try", tracedLazyValue("try({ try: () => headers(), catch: (cause) => cause })"), true],
      ["rejects Effect.suspend", tracedLazyValue("suspend(() => headers())"), true],
      ["rejects a lazy Effect with a pipe chain", tracedLazyValue("sync(() => headers())", ".pipe(Effect.withSpan(\"loadValue\"))"), true],
      ["permits a direct Effect value", 'export const loadValue = Effect.fn("Workspace.loadValue")(() => Effect.succeed("value"));\n', false],
      ["permits a parameterized lazy callback", 'export const loadValue = Effect.fn("Workspace.loadValue")((input: string) => Effect.sync(() => input));\n', false],
      ["permits a zero-argument generator callback", 'export const loadValue = Effect.fn("Workspace.loadValue")(function* () { return yield* Effect.sync(() => headers()); });\n', false],
      ["permits an unrelated factory", 'export const loadValue = Effect.fn("Workspace.loadValue")(() => database.query("headers"));\n', false],
      ["permits an Effect.all composition factory", 'export const loadValue = Effect.fn("Workspace.loadValue")(() => Effect.all([Effect.sync(() => headers()), Effect.sync(() => headers())]));\n', false],
      ["permits test modules", tracedLazyValue("sync(() => headers())"), false, "apps/deskohub-workspace/features/reservation/load-value.test.ts"],
      ["permits generated modules", tracedLazyValue("sync(() => headers())"), false, generated],
      ["permits modules outside Workspace", tracedLazyValue("sync(() => headers())"), false, "apps/dhw/src/load-value.ts"],
    ],
  },
  {
    name: "no-synchronous-subprocess", diagnostic: "Run subprocesses with runCommand or commandOutput",
    module: "apps/deskohub-workspace/scripts/probe.test.ts",
    cases: [
      ["rejects Bun.spawnSync", 'Bun.spawnSync({ cmd: ["git", "status"] });\n', true],
      ["rejects a namespaced child_process spawnSync", 'import childProcess from "node:child_process";\nchildProcess.spawnSync("git", ["status"]);\n', true],
      ["rejects an imported execSync", 'import { execSync } from "node:child_process";\nexecSync("git status");\n', true],
      ["rejects an imported execFileSync", 'import { execFileSync } from "node:child_process";\nexecFileSync("git", ["status"]);\n', true],
      ["rejects synchronous spawns outside tests", 'import { spawnSync } from "node:child_process";\nspawnSync("git", ["status"]);\n', true, "apps/deskohub-workspace/scripts/probe.ts"],
      ["rejects a destructured Bun alias", 'const { spawnSync: run } = Bun;\nrun({ cmd: ["git", "status"] });\n', true],
      ["rejects an aliased child_process import", 'import { execSync as run } from "node:child_process";\nrun("git status");\n', true],
      ["rejects an aliased execFileSync import", 'import { execFileSync as run } from "child_process";\nrun("git", ["status"]);\n', true],
      ["rejects passing Bun.spawnSync as a value", 'const run = Bun.spawnSync;\nrun({ cmd: ["git", "status"] });\n', true],
      ["permits unrelated names containing Sync", 'const syncSpawnSummary = "spawned";\nvoid syncSpawnSummary;\n', false],
      ["permits asynchronous Bun.spawn", 'const child = Bun.spawn(["git", "status"]);\nawait child.exited;\n', false],
      ["permits the shared command runner", 'import { runCommand } from "./shared/command";\nawait runCommand(["git", "status"]);\n', false],
      ["permits modules outside Workspace", 'Bun.spawnSync({ cmd: ["git", "status"] });\n', false, "apps/dhw/src/probe.ts"],
    ],
  },
  {
    name: "no-standalone-capability-layers", diagnostic: "instead of a standalone layer constant",
    module: `${reservations}/reservation.service.ts`,
    cases: [
      ["rejects a Live constant beside its capability", `${capabilityClass}export const ReservationServiceLive = ReservationService.Default;\n`, true],
      ["rejects a Default constant for an imported capability", 'import { ReservationService } from "./reservation.service";\nexport const ReservationServiceDefault = ReservationService.Default;\n', true],
      ["rejects a LiveWithDependencies constant", `${capabilityClass}export const ReservationServiceLiveWithDependencies = ReservationService.Default;\n`, true],
      ["rejects standalone layers in shared packages", `${capabilityClass}export const ReservationServiceLive = ReservationService.Default;\n`, true, "packages/dotypos/src/backend/reservation.ts"],
      ["permits static layer members", capabilityClass, false],
      ["permits a composed route layer", 'import { ReservationService } from "./reservation.service";\nconst ConsumerLive = Layer.mergeAll(ReservationService.Default);\nvoid ConsumerLive;\n', false],
      ["permits a layer for an imported tag without static layers", 'import { CliBearerAuthentication } from "@deskohub/workspace-admin-api";\nconst CliBearerAuthenticationLive = Layer.effect(CliBearerAuthentication, Effect.succeed({}));\nvoid CliBearerAuthenticationLive;\n', false],
      ["permits a layer named after an unbound concept", 'export const WorkspaceTracingLive = Layer.empty;\n', false],
      ["permits generated modules", `${capabilityClass}export const ReservationServiceLive = ReservationService.Default;\n`, false, generated],
    ],
  },
  {
    name: "no-standalone-capability-layers-live-name", diagnostic: "not `LiveWithDependencies`",
    module: `${reservations}/reservation.service.ts`,
    cases: [
      ["rejects a LiveWithDependencies static member", 'export class ReservationLayers {\n  static LiveWithDependencies = Layer.empty;\n}\n', true],
      ["rejects a LiveWithDependencies binding", "export const LiveWithDependencies = 1;\n", true],
      ["rejects a LiveWithDependencies type", "export type LiveWithDependencies = string;\n", true],
      ["rejects reading a LiveWithDependencies member", "export const layer = ReservationService.LiveWithDependencies;\n", true],
      ["permits a Live member", "export const layer = ReservationService.Live;\n", false],
    ],
  },
  {
    name: "no-backend-runtime-directives", diagnostic: "Backend modules must not declare",
    module: `${accountBackend}/customer-profile.service.ts`,
    cases: [
      ["rejects use client", '"use client";\nexport const profile = 1;\n', true],
      ["rejects use server", "'use server';\nexport const profile = 1;\n", true],
      ["rejects directives in nested backend modules", '"use server";\nexport const hold = 1;\n', true, "apps/deskohub-workspace/features/checkout/backend/payments/hold.ts"],
      ["permits a server action module", '"use server";\nexport const updateProfile = async () => undefined;\n', false, `${account}/actions.ts`],
      ["permits a directive-like string value", 'export const mode = "use server";\n', false],
    ],
  },
  {
    name: "no-better-auth-in-account-domain", diagnostic: "Keep Better Auth names out",
    module: `${account}/contracts.ts`,
    cases: [
      ["rejects a Better Auth type name", "export type BetterAuthSession = { readonly id: string };\n", true],
      ["rejects a better-auth string", 'export const provider = "better-auth";\n', true],
      ["rejects Better Auth names in the domain backend", 'import { readBetterAuthUser } from "./auth/auth-server";\nexport const user = readBetterAuthUser;\n', true, `${accountBackend}/customer-profile.service.ts`],
      ["permits account names", "export type CustomerSession = { readonly id: string };\n", false],
      ["permits the auth boundary", "export type BetterAuthSession = { readonly id: string };\n", false, `${accountBackend}/auth/auth-options.ts`],
    ],
  },
  {
    name: "account Better Auth import boundary", diagnostic: "Import Better Auth only inside the account auth boundary",
    module: `${accountBackend}/customer-profile.service.ts`,
    cases: [
      ["rejects the Better Auth root module", 'import { betterAuth } from "better-auth";\nexport { betterAuth };\n', true],
      ["rejects a Better Auth subpath", 'import { magicLink } from "better-auth/plugins";\nexport { magicLink };\n', true],
      ["rejects a scoped Better Auth package", 'import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";\nexport { drizzleAdapter };\n', true],
      ["permits account tests that simulate Better Auth errors", 'import { betterAuth } from "better-auth";\nexport { betterAuth };\n', false, `${account}/actions.test.ts`],
      ["permits the auth backend", 'import { betterAuth } from "better-auth";\nexport { betterAuth };\n', false, authServer],
      ["permits the session adapter", 'import { betterAuth } from "better-auth";\nexport { betterAuth };\n', false, `${accountBackend}/customer-authentication.service.ts`],
      ["permits the browser auth client", 'import { createAuthClient } from "better-auth/client";\nexport { createAuthClient };\n', false, `${account}/auth.client.ts`],
      ["permits modules outside the account feature", 'import { betterAuth } from "better-auth";\nexport { betterAuth };\n', false, "apps/deskohub-workspace/features/checkout/backend/session.ts"],
    ],
  },
  {
    name: "account auth backend client modules", diagnostic: "The browser auth client lives only",
    module: authServer,
    cases: [
      ["rejects the browser client", 'import { createAuthClient } from "better-auth/client";\nexport { createAuthClient };\n', true],
      ["rejects the React client", 'import { createAuthClient } from "better-auth/react";\nexport { createAuthClient };\n', true],
      ["permits server plugins", 'import { magicLink } from "better-auth/plugins";\nexport { magicLink };\n', false],
    ],
  },
  {
    name: "account auth backend Next handler", diagnostic: "calls auth.handler directly",
    module: authServer,
    cases: [
      ["rejects toNextJsHandler", 'import { toNextJsHandler } from "better-auth/next-js";\nexport { toNextJsHandler };\n', true],
      ["permits nextCookies", 'import { nextCookies } from "better-auth/next-js";\nexport { nextCookies };\n', false],
    ],
  },
  {
    name: "lazy feature flag providers", diagnostic: "lazily with a dynamic import",
    module: featureFlags,
    cases: [
      ["rejects a static server-only import", 'import "server-only";\nexport const flags = 1;\n', true],
      ["rejects a static Node provider import", 'import { NodeFeatureFlags } from "./node";\nexport { NodeFeatureFlags };\n', true],
      ["rejects a static subject import", 'import { readSubject } from "./subject";\nexport { readSubject };\n', true],
      ["permits lazy provider imports", 'export const loadProviders = () => Promise.all([import("./node"), import("./subject")]);\n', false],
      ["permits other feature flag modules", 'import "server-only";\nexport const flags = 1;\n', false, "apps/deskohub-workspace/features/feature-flags/backend/node.ts"],
    ],
  },
  {
    name: "no-next-runtime-imports-in-standalone-modules", diagnostic: "loaded outside the Next.js server",
    module: "apps/deskohub-workspace/db/database.service.ts",
    cases: [
      ["rejects the server environment in the database service", 'import { env } from "@/env";\nexport { env };\n', true],
      ["rejects server-only in the accounting snapshot key service", 'import "server-only";\nexport const keyId = 1;\n', true, "apps/deskohub-workspace/features/accounting/backend/accounting-snapshot-key.service.ts"],
      ["rejects a relative environment import in the auth options", 'import { env } from "../../../../env";\nexport { env };\n', true, authOptions],
      ["permits type-only Better Auth imports in the auth options", 'import type { BetterAuthOptions } from "better-auth";\nexport type Options = BetterAuthOptions;\n', false, authOptions],
      ["permits server modules", 'import "server-only";\nimport { env } from "@/env";\nexport { env };\n', false, authServer],
    ],
  },
  {
    name: "no-server-env-in-client-modules", diagnostic: "Browser modules must read the browser-visible environment from `@/client-env`",
    module: "apps/deskohub-workspace/features/cookie-consent/components/posthog-analytics.tsx",
    cases: [
      ["rejects the server environment in a client component", '"use client";\nimport { env } from "@/env";\nexport { env };\n', true],
      ["rejects a relative server environment import in the client instrumentation", 'import { env } from "./env";\nexport { env };\n', true, "apps/deskohub-workspace/instrumentation-client.ts"],
      ["rejects a dynamic server environment import in a client component", '"use client";\nexport const load = () => import("@/env");\n', true],
      ["rejects a dynamic server environment import in the client instrumentation", 'export const load = () => import("./env");\n', true, "apps/deskohub-workspace/instrumentation-client.ts"],
      ["rejects a template-literal dynamic server environment import in a client component", '"use client";\nexport const load = () => import(`@/env`);\n', true],
      ["rejects a template-literal relative dynamic server environment import in a client component", '"use client";\nexport const load = () => import(`../env`);\n', true],
      ["rejects a template-literal dynamic server environment import in the client instrumentation", "export const load = () => import(`@/env`);\n", true, "apps/deskohub-workspace/instrumentation-client.ts"],
      ["rejects a template-literal relative dynamic server environment import in the client instrumentation", "export const load = () => import(`./env`);\n", true, "apps/deskohub-workspace/instrumentation-client.ts"],
      ["rejects a commented dynamic server environment import in a client component", '"use client";\nexport const load = () => import(/* chunk */ "@/env");\n', true],
      ["rejects a template-literal server environment require in a client component", '"use client";\nexport const load = () => require(`@/env`);\n', true],
      ["permits a concatenated dynamic import specifier in a client component", '"use client";\nexport const load = () => import("@/env" + "/other");\n', false],
      ["permits a substituted template dynamic import specifier in a client component", '"use client";\nconst name = "other";\nexport const load = () => import(`@/env/$' + '{name}`);\n', false],
      ["rejects a dynamic server environment import with options in a client component", '"use client";\nexport const load = () => import("@/env", {});\n', true],
      ["permits a nested env module in a client component", '"use client";\nimport { env } from "../shared/env";\nexport { env };\n', false],
      ["rejects a server environment require in a client component", '"use client";\nexport const load = () => require("@/env");\n', true],
      ["rejects a server environment import-equals require in a client component", '"use client";\nimport env = require("@/env");\nexport { env };\n', true],
      ["rejects a server environment re-export in a client component", '"use client";\nexport { env } from "@/env";\n', true],
      ["permits a type-only server environment import in a client component", '"use client";\nimport type { env } from "@/env";\nexport type Env = typeof env;\n', false],
      ["permits a type-only server environment re-export in a client component", '"use client";\nexport type { env } from "@/env";\n', false],
      ["permits a dynamic client environment import in a client component", '"use client";\nexport const load = () => import("@/client-env");\n', false],
      ["permits a dynamic server environment import in a server module", 'export const load = () => import("@/env");\n', false, "apps/deskohub-workspace/app/[locale]/layout.tsx"],
      ["permits the client environment in a client component", '"use client";\nimport { clientEnv } from "@/client-env";\nexport { clientEnv };\n', false],
      ["permits the server environment in a server module", 'import { env } from "@/env";\nexport { env };\n', false, "apps/deskohub-workspace/app/[locale]/layout.tsx"],
    ],
  },
  {
    name: "connectionless Better Auth options", diagnostic: "Keep the Better Auth options connectionless",
    module: authOptions,
    cases: [
      ["rejects constructing the auth instance", 'import { betterAuth } from "better-auth";\nexport const auth = betterAuth({});\n', true],
      ["permits constructing it in the auth server", 'import { betterAuth } from "better-auth";\nexport const auth = betterAuth({});\n', false, authServer],
    ],
  },
  {
    name: "administration UI imports", diagnostic: "Compose administration tables through AdministrationDataTable",
    module: `${admin}/orders/page.tsx`,
    cases: [
      ["rejects table primitives in a route page", 'import { Table } from "@/shared/components/ui/table";\nexport { Table };\n', true],
      ["rejects table primitives in a feature table", 'import { Table } from "@/shared/components/ui/table";\nexport { Table };\n', true, "apps/deskohub-workspace/features/discounts/admin/admin-tables.tsx"],
      ["permits the shared data table", 'import { Table } from "@/shared/components/ui/table";\nexport { Table };\n', false, "apps/deskohub-workspace/features/administration/data-table.tsx"],
      ["permits table primitives outside administration", 'import { Table } from "@/shared/components/ui/table";\nexport { Table };\n', false, "apps/deskohub-workspace/features/account/components/history.tsx"],
    ],
  },
  {
    name: "administration UI badge imports", diagnostic: "Use the shared administration table toolbar and count badge",
    module: `${admin}/orders/page.tsx`,
    cases: [
      ["rejects badge primitives in a route page", 'import { Badge } from "@/shared/components/ui/badge";\nexport { Badge };\n', true],
      ["permits the shared table toolbar", 'import { Badge } from "@/shared/components/ui/badge";\nexport { Badge };\n', false, "apps/deskohub-workspace/features/administration/table-toolbar.tsx"],
    ],
  },
  {
    name: "administration request boundary", diagnostic: "establish the request boundary only through authorizeAdministratorPage",
    module: "apps/deskohub-workspace/features/administration/page-data.server.ts",
    cases: [
      ["rejects connection in administration page data", 'import { connection } from "next/server";\nexport { connection };\n', true],
      ["rejects connection in the administration layout", 'import { connection } from "next/server";\nexport { connection };\n', true, `${admin}/layout.tsx`],
      ["permits other next/server imports", 'import { after } from "next/server";\nexport { after };\n', false],
      ["permits the shared authorization gate", 'import { connection } from "next/server";\nexport { connection };\n', false, "apps/deskohub-workspace/features/administrators/server/administrator-authorization.server.ts"],
    ],
  },
  {
    name: "no-blocking-administration-routes", diagnostic: "must not export an async default component",
    module: `${admin}/orders/page.tsx`,
    cases: [
      ["rejects an async page", "export default async function OrdersPage() { return null; }\n", true],
      ["rejects an async layout", "export default async function AdministrationLayout() { return null; }\n", true, `${admin}/layout.tsx`],
      ["rejects an async arrow page", "export default async () => null;\n", true],
      ["permits a synchronous page", "export default function OrdersPage() { return null; }\n", false],
      ["permits an async breadcrumb slot", "export default async function OrderBreadcrumb() { return null; }\n", false, `${admin}/@breadcrumb/orders/[orderId]/page.tsx`],
      ["permits async route components", "export default async function OrdersTable() { return null; }\n", false, `${admin}/orders/orders-table.tsx`],
    ],
  },
  {
    name: "no-heavy-breadcrumb-imports", diagnostic: "Breadcrumb loaders read narrow entity labels",
    module: breadcrumbLoader,
    cases: [
      ["rejects page data", 'import { loadInvoiceAdministrationDetail } from "./page-data.server";\nexport { loadInvoiceAdministrationDetail };\n', true],
      ["rejects the invoice administration service", 'import { InvoiceAdministrationService } from "./invoice-administration.service";\nexport { InvoiceAdministrationService };\n', true],
      ["rejects Dotypos", 'import { DotyposService } from "@deskohub/dotypos";\nexport { DotyposService };\n', true],
      ["rejects the Dotypos config", 'import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";\nexport { WorkspaceDotyposLayer };\n', true],
      ["rejects invoice email delivery", 'import { InvoiceEmailDeliveryRepository } from "@/features/accounting/backend/invoice-email-delivery.repository";\nexport { InvoiceEmailDeliveryRepository };\n', true],
      ["rejects snapshots in the authorization gate", 'import { readSnapshot } from "@/features/accounting/backend/accounting-snapshot-sql";\nexport { readSnapshot };\n', true, "apps/deskohub-workspace/features/administrators/server/administrator-authorization.server.ts"],
      ["rejects detail loaders in the breadcrumb surface", 'import { loadAdministrationBooking } from "@/features/administration/page-data.server";\nexport { loadAdministrationBooking };\n', true, breadcrumbs],
      ["rejects accounting page data in the breadcrumb surface", 'import { loadInvoiceLabel } from "@/features/accounting/admin/page-data.server";\nexport { loadInvoiceLabel };\n', true, breadcrumbs],
      ["permits the breadcrumb service", 'import { InvoiceBreadcrumbService } from "./invoice-breadcrumb.service";\nexport { InvoiceBreadcrumbService };\n', false],
      ["permits label loaders in the breadcrumb surface", 'import { loadAdministrationBookingBreadcrumbLabel } from "@/features/administration/page-data.server";\nexport { loadAdministrationBookingBreadcrumbLabel };\n', false, breadcrumbs],
      ["permits page data in administration pages", 'import { loadInvoiceAdministrationDetail } from "./page-data.server";\nexport { loadInvoiceAdministrationDetail };\n', false, "apps/deskohub-workspace/features/accounting/admin/invoice-detail.tsx"],
    ],
  },
  {
    name: "no-local-administration-chrome", diagnostic: "Use the shared administration EmptyState",
    module: "apps/deskohub-workspace/features/administration/booking-table.tsx",
    cases: [
      ["rejects a local EmptyState", "function EmptyState() { return null; }\nexport const table = EmptyState;\n", true],
      ["rejects a local SortIcon", "const SortIcon = () => null;\nexport const table = SortIcon;\n", true, `${admin}/orders/page.tsx`],
      ["permits the shared EmptyState", 'import { EmptyState } from "./empty-state";\nexport const table = EmptyState;\n', false],
      ["permits the EmptyState foundation", "export function EmptyState() { return null; }\n", false, "apps/deskohub-workspace/features/administration/empty-state.tsx"],
      ["permits chrome outside administration", "function EmptyState() { return null; }\nexport const list = EmptyState;\n", false, "apps/deskohub-workspace/features/account/components/history.tsx"],
    ],
  },
  {
    name: "no-button-restyling", diagnostic: "Button className accepts parent layout only",
    module: checkoutActions,
    cases: [
      ["rejects a fill override", button('className="bg-burned-orange-ink"'), true],
      ["rejects a text colour override", button('className="text-white"'), true],
      ["rejects a height override", button('className="h-12"'), true],
      ["rejects a padding override", button('className="px-6"'), true],
      ["rejects a radius override", button('className="rounded-xl"'), true],
      ["rejects a shadow override", button('className="shadow-none"'), true],
      ["rejects a hover state override", button('className="hover:bg-navy-blue/5"'), true],
      ["rejects a restyle behind a breakpoint", button('className="md:bg-white"'), true],
      ["rejects a restyle behind a group variant", button('className="group-hover:text-white"'), true],
      ["rejects an important restyle", button('className="!px-0"'), true],
      ["rejects one restyle among layout classes", button('className="mt-8 rounded-none sm:w-auto"'), true],
      ["rejects a width outside a breakpoint", button('className="w-full"'), true],
      ["rejects a display outside a breakpoint", button('className="flex"'), true],
      ["rejects an inset shadow", button('className="inset-shadow-sm"'), true],
      ["rejects an expression-free template restyle", button("className={`px-4`}"), true],
      ["rejects a conditional cn restyle", button('className={cn("mt-4", open && "bg-white")}'), true],
      ["rejects a ternary branch restyle", button('className={open ? "mt-4" : "text-xs"}'), true],
      ["rejects a NavItem restyle", 'export const Tab = () => <NavItem active className="bg-navy-blue" href="/account">Account</NavItem>;\n', true],
      ["rejects a ChoiceCard restyle", 'export const Option = () => <ChoiceCard className="border-burned-orange" />;\n', true],
      ["rejects a SegmentedControl restyle", 'export const Picker = () => <SegmentedControl className="rounded-full" />;\n', true],
      ["rejects a DisclosureButton restyle", 'export const Toggle = () => <DisclosureButton className="text-xs" expanded />;\n', true],
      ["rejects a restyle in a spread object", button('{...{ className: "bg-red-500" }}'), true],
      ["rejects a quoted className key in a spread object", button('{...{ "className": "px-6" }}'), true],
      ["rejects a restyle on a destructured import", 'const { Button } = await import("@/shared/components/ui/button");\nexport const Example = () => <Button className="bg-red-500">Save</Button>;\n', true],
      ["rejects a restyle through a namespace import", 'export const Action = () => <ui.Button className="bg-red-500">Save</ui.Button>;\n', true],
      ["permits margin and responsive width", button('className="mt-8 sm:w-auto"'), false],
      ["permits container-query width and group", button('className="group @xl:w-auto sm:min-w-[17rem]"'), false],
      ["permits self and grid placement", button('className="self-start justify-self-end col-span-2 order-last"'), false],
      ["permits flex and snap item placement", button('className="shrink-0 flex-1 basis-1/2 snap-start"'), false],
      ["permits position, inset and z-index", button('className="fixed -top-24 left-4 z-[100] focus:top-4"'), false],
      ["permits responsive visibility", button('className="hidden md:inline-flex xl:hidden"'), false],
      ["permits important layout classes", button('className="!mt-2 md:mb-4!"'), false],
      ["permits an expression string", button('className={"mt-4"}'), false],
      ["permits an expression-free template", button("className={`mt-4 sm:w-auto`}"), false],
      ["permits conditional cn layout", button('className={cn("mt-4", open && "hidden", wide ? "sm:w-auto" : undefined)}'), false],
      ["permits a NavItem layout class", 'export const Tab = () => <NavItem active className="shrink-0 snap-start" href="/account">Account</NavItem>;\n', false],
      ["permits restyled children", 'export const Action = () => <Button><span className="text-xs">Save</span></Button>;\n', false],
      ["permits other components", 'export const Dot = () => <UnstyledButton className="size-3 rounded-full bg-white" />;\n', false],
      ["permits Buttons outside Workspace", button('className="bg-white"'), false, "apps/boardgame-bar/src/components/action.tsx"],
      ["permits the React Email Button", 'import { Button, Section } from "react-email";\nexport const Cta = () => <Section><Button className="rounded-full bg-aquamarine px-7" href="/">Book</Button></Section>;\n', false],
      ["rejects a restyle beside other React Email imports", 'import { Link } from "react-email";\nimport { Button } from "@/shared/components/ui/button";\nexport const Action = () => <Button className="bg-white">Save</Button>;\n', true],
      ["rejects a restyle beside a commented-out React Email import", 'import { Button } from "@/shared/components/ui/button";\n// import { Button } from "react-email";\nexport const Action = () => <Button className="bg-white">Save</Button>;\n', true],
      ["rejects a restyle when Button is imported from React Email and the shared module", 'import { Button } from "react-email";\nimport { Button } from "@/shared/components/ui/button";\nexport const Action = () => <Button className="bg-white">Save</Button>;\n', true],
      ["rejects a restyle beside a renamed React Email Button", 'import { Button as EmailButton } from "react-email";\nimport { Button } from "@/shared/components/ui/button";\nexport const Action = () => <Button className="bg-white">Save</Button>;\n', true],
      ["rejects a restyle that shadows the React Email Button", 'import { Button } from "react-email";\nimport * as ui from "@/shared/components/ui";\nexport function Action() {\n  const { Button } = ui;\n  return <Button className="bg-white">Save</Button>;\n}\n', true],
      ["rejects a restyle through a parameter that shadows the React Email Button", 'import { Button } from "react-email";\nexport const Action = ({ Button }: Slots) => <Button className="bg-white">Save</Button>;\n', true],
      ["permits layout classes in a spread object", button('{...{ className: "mt-4", type: "submit" }}'), false],
    ],
  },
  {
    name: "no-button-restyling", diagnostic: "so the parent-layout check can read it",
    module: checkoutActions,
    cases: [
      ["rejects a class variable", button("className={classes}"), true],
      ["rejects a forwarded className", button('className={cn("mt-4", className)}'), true],
      ["rejects an interpolated template", button("className={`mt-${size}`}"), true],
      ["rejects a fallback operand", button('className={open || "mt-4"}'), true],
      ["rejects another class helper", button("className={layoutClasses()}"), true],
      ["permits literal and conditional cn classes", button('className={cn("mt-4", open && "hidden")}'), false],
      ["permits a suppressed forwarded className", 'export const Action = ({ className }: { className?: string }) => (\n  // biome-ignore lint/plugin: forwards the caller\'s parent-layout classes.\n  <Button className={className}>Save</Button>\n);\n', false],
    ],
  },
  {
    name: "no-button-restyling", diagnostic: "Spread props can carry a Button className",
    module: checkoutActions,
    cases: [
      ["rejects spread props", button("{...props}"), true],
      ["rejects spread form field props", button("{...field}"), true],
      ["rejects a computed spread key", button('{...{ ["className"]: "bg-red-500" }}'), true],
      ["rejects a shorthand className in a spread object", button("{...{ className }}"), true],
      ["rejects a nested spread", button("{...{ ...rest }}"), true],
      ["rejects spread props on a NavItem", 'export const Tab = () => <NavItem {...link} active>Account</NavItem>;\n', true],
      ["permits a spread object without className", button('{...{ onClick, type: "submit", "aria-label": "Save" }}'), false],
      ["permits spread props on other components", 'export const Dot = () => <UnstyledButton {...props} />;\n', false],
      ["permits suppressed forwarded props", 'export const Action = (props: ButtonProps) => (\n  <Button\n    // biome-ignore lint/plugin: forwards the caller\'s Button props.\n    {...props}\n  />\n);\n', false],
    ],
  },
  {
    name: "no-button-restyling", diagnostic: "Keep the Button family under its own name",
    module: checkoutActions,
    cases: [
      ["rejects a renamed import", 'import { Button as ActionButton } from "@/shared/components/ui/button";\nexport const Action = () => <ActionButton className="bg-red-500">Save</ActionButton>;\n', true],
      ["rejects a renamed NavItem import", 'import { NavItem as Tab } from "@/shared/components/ui/nav-item";\nexport const Link = () => <Tab active href="/account">Account</Tab>;\n', true],
      ["rejects a renamed re-export", 'export { Button as ActionButton } from "@/shared/components/ui/button";\n', true, "apps/deskohub-workspace/shared/components/ui/index.ts"],
      ["rejects a renamed local export", 'import { ChoiceCard } from "@/shared/components/ui/choice-card";\nexport { ChoiceCard as Option };\n', true],
      ["rejects a destructured alias", 'import * as ui from "@/shared/components/ui/button";\nconst { Button: Action } = ui;\nexport const Example = () => <Action className="bg-red-500">Save</Action>;\n', true],
      ["rejects a destructured prop", 'export const Example = ({ NavItem: Tab }: Slots) => <Tab active href="/account">Account</Tab>;\n', true],
      ["rejects a const alias", 'import { Button } from "@/shared/components/ui/button";\nconst Action = Button;\nexport const Example = () => <Action className="bg-red-500">Save</Action>;\n', true],
      ["rejects a wrapped component", 'import { Button } from "@/shared/components/ui/button";\nconst Action = memo(Button);\nexport const Example = () => <Action className="bg-red-500">Save</Action>;\n', true],
      ["rejects createElement", 'import { Button } from "@/shared/components/ui/button";\nexport const Example = () => createElement(Button, { className: "bg-red-500" });\n', true],
      ["rejects an object shorthand", 'import { SegmentedControl } from "@/shared/components/ui/segmented-control";\nexport const slots = { SegmentedControl };\n', true],
      ["rejects a namespace member alias", 'import * as ui from "@/shared/components/ui/choice-card";\nconst Option = ui.ChoiceCard;\nexport const Example = () => <Option className="border-white" />;\n', true],
      ["permits a plain import", 'import { Button } from "@/shared/components/ui/button";\nexport const Action = () => <Button className="mt-4">Save</Button>;\n', false],
      ["permits a renamed React Email Button", 'import { Button as EmailButton } from "react-email";\nexport const Cta = () => <EmailButton className="rounded-full px-7" href="/">Book</EmailButton>;\n', false],
      ["permits renaming other components", 'import { UnstyledButton as Dot } from "@/shared/components/ui/unstyled-button";\nexport const Bullet = () => <Dot />;\n', false],
      ["permits renaming the props type", 'import type { ButtonProps as ActionProps } from "@/shared/components/ui/button";\nexport type Props = ActionProps;\n', false],
      ["permits a namespace import used as JSX tags", 'import * as ui from "@/shared/components/ui/button";\nexport const Example = () => <ui.Button className="mt-4">Save</ui.Button>;\n', false],
      ["permits a destructured import under its own name", 'const { Button } = await import("@/shared/components/ui/button");\nexport const Example = () => <Button className="mt-4">Save</Button>;\n', false],
      ["permits a plain export", 'import { DisclosureButton } from "@/shared/components/ui/disclosure-button";\nexport { DisclosureButton };\n', false],
      ["permits type references", 'import type { Button } from "@/shared/components/ui/button";\nexport type Props = ComponentProps<typeof Button>;\n', false],
    ],
  },
  {
    name: "no-direct-effect-runs", diagnostic: "Use the matching Workspace Effect runner or boundary",
    module: `${account}/refresh-identity.ts`,
    cases: [
      ["rejects a raw run in a feature module", 'export const refresh = () => Effect.runPromise(Effect.void);\n', true],
      ["rejects a raw run in a client module", '"use client";\nexport const refresh = () => Effect.runFork(Effect.void);\n', true],
      ["rejects a raw run in the browser runner module", 'export const run = () => Effect.runPromiseExit(Effect.void);\n', true, browserRunner],
      ["permits the browser runner", 'export const refresh = () => Effect.void.pipe(runWorkspaceBrowserEffect("account.refresh"));\n', false],
      ["permits the server runner", 'export const refresh = () => Effect.void.pipe(runWorkspaceEffect("account.refresh"));\n', false],
      ["permits test modules", 'export const refresh = () => Effect.runPromise(Effect.void);\n', false, `${account}/refresh-identity.test.ts`],
    ],
  },
  {
    name: "no-direct-next-effect-imports", diagnostic: "Use the app-owned Workspace Effect runner or action boundary",
    module: `${account}/refresh-identity.ts`,
    cases: [
      ["rejects a feature import", 'import { NextEffect } from "@deskohub/next-effect";\n', true],
      ["rejects another browser module", 'import { NextEffect } from "@deskohub/next-effect";\n', true, "apps/deskohub-workspace/shared/browser/workspace-browser-logs.ts"],
      ["permits the browser runner", 'import { NextEffect } from "@deskohub/next-effect";\n', false, browserRunner],
      ["permits the server runner", 'import { NextEffect } from "@deskohub/next-effect";\n', false, "apps/deskohub-workspace/shared/backend/workspace-effect.ts"],
      ["permits the standalone runner", 'import { NextEffect } from "@deskohub/next-effect";\n', false, "apps/deskohub-workspace/shared/backend/standalone-workspace-effect.ts"],
      ["permits the action boundary", 'import { EffectAction } from "@deskohub/next-effect/effect-action";\n', false, "apps/deskohub-workspace/shared/backend/workspace-action.ts"],
    ],
  },
];

const lintCases = rules.flatMap(({ name, diagnostic, module, cases }) =>
  cases.map(([behavior, source, flagged, override]) => ({
    title: `${name} ${behavior}`,
    diagnostic,
    flagged,
    module: override ?? module,
    source,
  }))
);

const writeCase = (directory: string, module: string, source: string) => {
  const path = join(fixtureRoot, directory, module);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  return path;
};

const casePaths = lintCases.map(({ module, source }, index) =>
  writeCase(`case-${index}`, module, source)
);
const singleDiagnosticPath = writeCase(
  "case-single-diagnostic",
  "apps/deskohub-workspace/features/reservation/load-reservation.ts",
  traced(gen, threeTransforms)
);

// One Biome run lints the whole corpus; each case reads its own file's messages.
const messagesByPath = new Map<string, string[]>();

beforeAll(async () => {
  const result = await runCommand(
    [
      "bunx",
      "biome",
      "lint",
      fixtureRoot,
      "--config-path",
      config,
      "--reporter=json",
      "--max-diagnostics=none",
    ],
    { cwd: repositoryRoot }
  );
  const report = JSON.parse(result.stdout) as {
    readonly diagnostics: readonly {
      readonly message: string;
      readonly location: { readonly path: string };
    }[];
  };
  for (const { message, location } of report.diagnostics) {
    const path = resolve(repositoryRoot, location.path);
    messagesByPath.set(path, [...(messagesByPath.get(path) ?? []), message]);
  }
});

const messagesOf = (path: string) => messagesByPath.get(path) ?? [];

lintCases.forEach(({ title, diagnostic, flagged }, index) => {
  test(title, () => {
    const reported = messagesOf(casePaths[index]!).some((message) =>
      message.includes(diagnostic)
    );
    expect(reported).toBe(flagged);
  });
});

test("prefer-effect-fn emits exactly one diagnostic for a named Effect.fn arrow with three trailing transforms", () => {
  expect(
    messagesOf(singleDiagnosticPath).filter((message) =>
      message.includes("Define Effect generator functions with Effect.fn")
    )
  ).toHaveLength(1);
});

afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));
