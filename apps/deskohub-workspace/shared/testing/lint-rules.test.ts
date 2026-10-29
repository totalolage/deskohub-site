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
const automationBackend =
  "apps/deskohub-workspace/features/email-campaigns/automation/backend";
const automationEngineModule = `${automationBackend}/automation-deliver-unit.ts`;
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
    name: "automation-state-writers", diagnostic: "Automation states have one writer each",
    module: automationEngineModule,
    cases: [
      ["rejects ending a run with the update builder", 'await tx.update(emailCampaignAutomationRuns).set({ status: "ended", outcome: "sent" }).where(eq(emailCampaignAutomationRuns.id, runId));\n', true],
      ["rejects inserting an ended run", 'await tx.insert(emailCampaignAutomationRuns).values([{ ...run, status: "ended" }]);\n', true],
      ["rejects appending run endings outside the transitions", "await appendAutomationRunEndings(tx, entries);\n", true],
      ["rejects SQL that ends a run", "await client.query(\"update email_campaign_automation_runs set outcome = 'sent', status = 'ended' where id = $1\", [runId]);\n", true],
      ["rejects SQL that inserts an ended run", "await client.query(\"insert into email_campaign_automation_runs (id, status) values ($1, 'ended')\", [runId]);\n", true],
      ["rejects a template that ends a run through the table interpolation", `await tx.execute(sql\`update \${emailCampaignAutomationRuns} set \${emailCampaignAutomationRuns.status} = 'ended' where id = \${runId}\`);\n`, true],
      ["rejects pausing a campaign with the update builder", 'await tx.update(emailCampaigns).set({ status: "paused" }).where(eq(emailCampaigns.id, campaignId));\n', true],
      ["rejects inserting an active campaign", 'await tx.insert(emailCampaigns).values({ title, delivery: "automated", status: "active" });\n', true],
      ["rejects SQL that archives a campaign", "await client.query(\"update email_campaigns set status = 'archived' where id = $1\", [campaignId]);\n", true],
      ["permits the run transitions", 'await tx.update(emailCampaignAutomationRuns).set({ status: "ended", outcome: "sent" }).where(eq(emailCampaignAutomationRuns.id, runId));\n', false, `${automationBackend}/automation-run-transitions.ts`],
      ["permits the run transitions appending endings", "await appendAutomationRunEndings(tx, entries);\n", false, `${automationBackend}/automation-run-transitions.ts`],
      ["permits the lifecycle service", 'await tx.update(emailCampaigns).set({ status: "paused" }).where(eq(emailCampaigns.id, campaignId));\n', false, `${automationBackend}/automation-lifecycle.service.ts`],
      ["permits moving a run between open states", 'await tx.update(emailCampaignAutomationRuns).set({ status: "sending", phase: null, dueAt: null });\n', false],
      ["permits one-off campaign statuses", 'await tx.update(emailCampaigns).set({ status: "sent" });\n', false],
      ["permits other tables in an ended status", 'await tx.update(emailCampaignSends).set({ status: "ended" });\n', false],
      ["permits SQL that filters on ended runs", "await client.query(\"update email_campaign_automation_runs set updated_at = now() where status = 'ended'\");\n", false],
      ["permits SQL that filters on campaign status", "await client.query(\"update email_campaigns set updated_at = now() where status = 'active'\");\n", false],
      ["permits a status the rule can't see, which the CHECK and transition tests guard", "await tx.update(emailCampaignAutomationRuns).set({ status });\n", false],
      ["permits Postgres tests seeding ended runs", 'await tx.insert(emailCampaignAutomationRuns).values({ ...run, status: "ended" });\n', false, `${automationBackend}/automation-run-settlement.service.postgres.test.ts`],
      ["permits test utils seeding campaign statuses", 'await db.insert(emailCampaigns).values({ title, status: "active" });\n', false, "apps/deskohub-workspace/features/email-campaigns/backend/email-campaigns.test-utils.ts"],
      ["permits modules outside Workspace", 'await tx.update(emailCampaigns).set({ status: "paused" });\n', false, "apps/dhw/src/campaigns.ts"],
    ],
  },
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
    name: "no-administration-agent-tools-imports", diagnostic: "Only the MCP route imports the administration agent tools",
    module: "apps/deskohub-workspace/features/agent-tools/customer-agent-tools.ts",
    cases: [
      ["rejects the customer registry importing the module", 'import { AdministrationAgentAccess } from "@/features/administration-agent-tools";\nexport const access = AdministrationAgentAccess;\n', true],
      ["rejects a deep import from another route", 'import { makeAdministrationAgentTools } from "@/features/administration-agent-tools/administration-agent-tools";\nexport const tools = makeAdministrationAgentTools;\n', true, "apps/deskohub-workspace/app/llms.txt/route.ts"],
      ["rejects a dynamic import", 'export const load = () => import("@/features/administration-agent-tools");\n', true],
      ["permits the MCP route", 'import { AdministrationAgentAccess } from "@/features/administration-agent-tools";\nexport const access = AdministrationAgentAccess;\n', false, "apps/deskohub-workspace/app/api/mcp/route.ts"],
      ["permits the module's own files", 'import { makeAdministrationAgentTools } from "./administration-agent-tools";\nexport const tools = makeAdministrationAgentTools;\n', false, "apps/deskohub-workspace/features/administration-agent-tools/administration-agent-access.ts"],
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
    name: "no-eager-posthog-browser-sdk", diagnostic: "Load the PostHog browser SDK only through the consent-gated dynamic import",
    module: "apps/deskohub-workspace/features/checkout/components/discount-rejection-analytics.tsx",
    cases: [
      ["rejects a static SDK import", 'import posthog from "posthog-js";\nexport const capture = posthog.capture;\n', true],
      ["rejects a named SDK import", 'import { posthog } from "posthog-js";\nexport const client = posthog;\n', true],
      ["rejects an inline type specifier, which keeps the import", 'import { type PostHog } from "posthog-js";\nexport type Client = PostHog;\n', true],
      ["rejects the React bindings", 'import { usePostHog } from "@posthog/react";\nexport const useClient = usePostHog;\n', true],
      ["rejects the SDK in the shared PostHog package", 'import posthog from "posthog-js";\nexport const client = posthog;\n', true, "packages/posthog/src/feature-flags/react.ts"],
      ["permits a type-only import", 'import type { PostHog } from "posthog-js";\nexport type Client = PostHog;\n', false],
      ["permits the consent-gated dynamic import", 'export const load = () => import("posthog-js");\n', false],
      ["permits test fixtures", 'import posthog from "posthog-js";\nexport const client = posthog;\n', false, "apps/deskohub-workspace/shared/testing/posthog-identity-browser-fixture.tsx"],
      ["permits tests", 'import posthog from "posthog-js";\nexport const client = posthog;\n', false, "apps/deskohub-workspace/features/cookie-consent/components/posthog-analytics.test.tsx"],
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
      [
        "rejects an interpolated template",
        button("className={`mt-$" + "{size}`}"),
        true,
      ],
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
  {
    name: "no-borrowed-provider-outcomes", diagnostic: "Only the provider package constructs its outcomes",
    module: `${accountBackend}/example.ts`,
    cases: [
      ["rejects constructing a provider outcome", 'export const missing = new DotyposRejected({ operation: "getCustomer", reason: "not-found" });\n', true],
      ["rejects yielding a constructed provider outcome", 'export const load = Effect.gen(function* () { return yield* new DotyposUnavailable({ operation: "getCustomer", reason: "server" }); });\n', true],
      ["permits test modules", 'export const missing = new DotyposRejected({ operation: "getCustomer", reason: "not-found" });\n', false, `${accountBackend}/example.test.ts`],
      ["permits test utility modules", 'export const missing = new DotyposRejected({ operation: "getCustomer", reason: "not-found" });\n', false, `${accountBackend}/example.test-utils.ts`],
      ["permits a non-outcome name", "export const value = new DotyposCustomerSomething();\n", false],
      ["permits matching an outcome", 'export const recover = (effect) => effect.pipe(Effect.catchTag("DotyposRejected", () => Effect.void));\n', false],
    ],
  },
  {
    name: "no-provider-status-branching", diagnostic: "Don't read a provider outcome's httpStatus",
    module: `${accountBackend}/example.ts`,
    cases: [
      ["rejects branching on the status", "export const limited = (failure) => failure.httpStatus === 429;\n", true],
      ["rejects an optional status read", "export const status = (failure) => failure?.httpStatus;\n", true],
      ["rejects a computed status read", 'export const status = (failure) => failure["httpStatus"];\n', true],
      ["permits the failure log fields", 'export const log = (failure) => Effect.logError("Read failed", dotyposFailureLogFields(failure));\n', false],
      ["permits test modules", "export const limited = (failure) => failure.httpStatus === 429;\n", false, `${accountBackend}/example.test.ts`],
      ["permits test utility modules", "export const limited = (failure) => failure.httpStatus === 429;\n", false, `${accountBackend}/example.test-utils.ts`],
    ],
  },
  {
    name: "no-generic-provider-error-tags", diagnostic: "Name provider errors with the port prefix",
    module: "packages/example/src/errors.ts",
    cases: [
      [
        "rejects a generic Data tag",
        `export class ${["ExternalAPI", "Error"].join("")} extends Data.TaggedError("${["ExternalAPI", "Error"].join("")}")<{}> {}\n`,
        true,
      ],
      [
        "rejects a multi-line generic schema tag",
        `export class ${["Network", "Error"].join("")} extends Schema.TaggedErrorClass<${["Network", "Error"].join("")}>()(\n  "${["Network", "Error"].join("")}",\n  {}\n) {}\n`,
        true,
      ],
      ["permits a prefixed outcome tag", 'export class DotyposRejected extends Schema.TaggedErrorClass<DotyposRejected>()("DotyposRejected", {}) {}\n', false],
      [
        "permits the generic tag while Nexi is excluded",
        `export class ${["ExternalAPI", "Error"].join("")} extends Data.TaggedError("${["ExternalAPI", "Error"].join("")}")<{}> {}\n`,
        false,
        "packages/nexi/src/errors.ts",
      ],
    ],
  },
  {
    name: "workspace-transaction-entry", diagnostic: "Open Workspace transactions only with `transaction` from `yield* WorkspaceDatabase`",
    module: "apps/deskohub-workspace/features/reservation/backend/probe.repository.ts",
    cases: [
      ["rejects the client's transaction", "db.transaction(Effect.fn(function* (tx) { return tx; }));\n", true],
      ["rejects the service's transaction called as a member", "database.transaction(effect);\n", true],
      ["rejects a nested transaction on a transaction client", "tx.transaction(() => effect);\n", true],
      ["rejects a renamed client", "const client = db;\nclient.transaction(() => effect);\n", true],
      ["rejects Effect SQL withTransaction", "sql.withTransaction(Effect.void);\n", true],
      ["rejects reading transaction off the service", "const open = database.transaction;\nopen(effect);\n", true],
      ["permits an indexed access type of the client's transaction", 'type Transaction = Parameters<WorkspaceDatabaseClient["transaction"]>[0];\n', false],
      ["permits a type query of the client's transaction", "type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];\n", false],
      ["rejects computed access to transaction", 'const open = database["transaction"];\nopen(effect);\n', true],
      ["rejects computed access to withTransaction", "sql['withTransaction'](Effect.void);\n", true],
      ["rejects destructuring transaction from a client", "const { transaction } = db;\ntransaction(() => effect);\n", true],
      ["rejects a renamed destructure from a bound service", "const { transaction: open } = database;\n", true],
      ["rejects raw transactions in shared modules", "db.transaction(() => effect);\n", true, "apps/deskohub-workspace/shared/backend/probe.ts"],
      ["rejects providing the marker", "writer.pipe(Effect.provideService(WorkspaceTransaction, { db }));\n", true],
      ["rejects providing the marker uncurried", "Effect.provideService(writer, WorkspaceTransaction, { db });\n", true],
      ["rejects building the marker", "WorkspaceTransaction.of({ db });\n", true],
      ["rejects a marker context", "Context.make(WorkspaceTransaction, { db });\n", true],
      ["rejects a marker layer in tests", "Layer.succeed(WorkspaceTransaction, { db });\n", true, "apps/deskohub-workspace/features/reservation/backend/probe.test.ts"],
      ["rejects hand-building the service in tests", "Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.of({ db }));\n", true, "apps/deskohub-workspace/features/reservation/backend/probe.test.ts"],
      ["permits the destructured wrapper", "Effect.gen(function* () { const { db, transaction } = yield* WorkspaceDatabase; return yield* transaction(write(db)); });\n", false],
      ["permits reading the marker", "Effect.gen(function* () { const { db } = yield* WorkspaceTransaction; return db; });\n", false],
      ["permits the advisory-lock permit around the wrapper", "advisoryLock.withTransactionPermit(transaction(effect));\n", false],
      ["permits transaction-history names", "const { transactions } = ledger;\n", false],
      ["rejects a literal service layer in tests", "Layer.succeed(WorkspaceDatabase, { db: {} } as never);\n", true, "apps/deskohub-workspace/features/reservation/backend/probe.test.ts"],
      ["permits a partial service mock", "Layer.mock(WorkspaceDatabase, { db: proxy });\n", false, "apps/deskohub-workspace/features/reservation/backend/probe.test.ts"],
      ["permits make in tests", "Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db));\n", false, "apps/deskohub-workspace/features/reservation/backend/probe.test.ts"],
      ["rejects raw transactions in Postgres tests", "db.transaction(() => effect);\n", true, "apps/deskohub-workspace/features/reservation/backend/probe.postgres.test.ts"],
      ["rejects raw transactions in test utilities", "db.transaction((tx) => tx);\n", true, "apps/deskohub-workspace/shared/testing/probe.test-utils.ts"],
      ["rejects Effect SQL withTransaction in tests", "sql.withTransaction(Effect.void);\n", true, "apps/deskohub-workspace/features/reservation/backend/probe.test.ts"],
      ["rejects destructuring transaction from a built service in tests", "const { transaction } = WorkspaceDatabase.make(db);\n", true, "apps/deskohub-workspace/features/reservation/backend/probe.postgres.test.ts"],
      ["permits the destructured wrapper parameter in tests", "Effect.flatMap(WorkspaceDatabase, ({ db, transaction }) => transaction(write(db)));\n", false, "apps/deskohub-workspace/features/reservation/backend/probe.postgres.test.ts"],
      ["permits raw transactions in database-layer tests", "db.transaction(() => effect);\nsql.withTransaction(Effect.void);\n", false, "apps/deskohub-workspace/db/probe.postgres.test.ts"],
      ["permits E2E clients", "db.transaction((tx) => tx);\n", false, "apps/deskohub-workspace/e2e/probe.ts"],
      ["permits the wrapper's home", "db.transaction(() => effect);\nWorkspaceDatabase.of({ db, transaction });\n", false, "apps/deskohub-workspace/db/database.service.ts"],
      ["rejects a raw transaction in the last file the ratchet listed", "db.transaction((tx) => tx);\n", true, "apps/deskohub-workspace/features/email-campaigns/backend/campaign-delivery.service.ts"],
      ["rejects a raw transaction in the automation engine", "db.transaction((tx) => tx);\n", true, "apps/deskohub-workspace/features/email-campaigns/automation/backend/automation-unit-slots.ts"],
    ],
  },
  {
    name: "workspace-transaction-concurrency", diagnostic: "Keep transactional work on one fiber",
    module: "apps/deskohub-workspace/features/reservation/backend/probe.repository.ts",
    cases: [
      ["rejects unbounded inside a transaction", 'transaction(Effect.all([a, b], { concurrency: "unbounded" }));\n', true],
      ["rejects a numeric limit inside a transaction", "transaction(Effect.forEach(xs, f, { concurrency: 4 }));\n", true],
      ["rejects a computed limit inside a transaction", "transaction(Effect.all([a, b], { concurrency: 1 + 1 }));\n", true],
      ["rejects a called limit inside a transaction", "transaction(Effect.all([a, b], { concurrency: getLimit() }));\n", true],
      ["rejects a limit of one inside a transaction", "transaction(Effect.forEach(xs, f, { concurrency: 1 }));\n", true],
      ["rejects inherit inside a transaction", 'transaction(Effect.all([a, b], { concurrency: "inherit" }));\n', true],
      ["rejects a computed concurrency key", 'transaction(Effect.all([a, b], { ["concurrency"]: 4 }));\n', true],
      ["rejects an options object written elsewhere in the file", "const options = {};\noptions.concurrency = 2;\ntransaction(Effect.all([a, b], options));\n", true],
      ["rejects a computed options write", 'const options = {};\noptions["concurrent"] = true;\ntransaction(Effect.zip(a, b, options));\n', true],
      ["rejects a shorthand limit", "const concurrency = 4;\ntransaction(Effect.all([a, b], { concurrency }));\n", true],
      ["rejects an options object built elsewhere in the file", "const parallel = { concurrency: 4 };\nEffect.gen(function* () { const { transaction } = yield* WorkspaceDatabase; return yield* transaction(Effect.all([a, b], parallel)); });\n", true],
      ["rejects overriding the limit", "transaction(Effect.all([a, b]).pipe(Effect.withConcurrency(8)));\n", true],
      ["rejects a concurrent zip", "transaction(Effect.zip(a, b, { concurrent: true }));\n", true],
      ["rejects a sequential concurrent option", "transaction(Effect.zip(a, b, { concurrent: false }));\n", true],
      ["rejects a fork", "transaction(Effect.gen(function* () { yield* Effect.forkChild(a); }));\n", true],
      ["rejects a stream merge", "transaction(Stream.runDrain(Stream.merge(a, b)));\n", true],
      ["rejects a renamed wrapper", "Effect.gen(function* () { const { transaction: open } = yield* WorkspaceDatabase; return yield* open(Effect.all([a, b], { concurrency: 4 })); });\n", true],
      ["rejects a destructured wrapper parameter", "Effect.flatMap(WorkspaceDatabase, ({ transaction }) => transaction(Effect.forEach(xs, f, { concurrency: 2 })));\n", true],
      ["rejects a re-aliased wrapper", "Effect.gen(function* () { const { transaction } = yield* WorkspaceDatabase; const run = transaction; return yield* run(Effect.all([a, b], { concurrency: 4 })); });\n", true],
      ["leaves a raw transaction to the entry rule", "db.transaction((tx) => Effect.all([a, b], { concurrency: limit }));\n", false],
      ["rejects a numeric limit in a declaring writer", "const w = Effect.fn(function* () { const { db } = yield* WorkspaceTransaction; yield* Effect.forEach(xs, f, { concurrency: 4 }); });\n", true],
      ["rejects a limit in a declaring writer's nested generator", "const w = Effect.fn(function* () { const { db } = yield* WorkspaceTransaction; yield* Effect.gen(function* () { yield* Effect.all([a, b], { concurrency: 4 }); }); return db; });\n", true],
      ["rejects a race in a declaring writer", "const w = Effect.fn(function* () { yield* WorkspaceTransaction; return yield* Effect.raceFirst(a, b); });\n", true],
      ["rejects inherit in a declaring writer", "const w = Effect.fn(function* () { yield* WorkspaceTransaction; return yield* Effect.all([a, b], { concurrency: 'inherit' }); });\n", true],
      ["rejects a limit in a writer that names the marker only in its type", "const w = (): Effect.Effect<void, never, WorkspaceTransaction> => Effect.all([a, b], { concurrency: 2 });\n", true],
      ["rejects concurrency in a sibling method of a declaring service", "Layer.effect(Svc, Effect.gen(function* () { return { write: Effect.fn(function* () { const { db } = yield* WorkspaceTransaction; return db; }), fetch: Effect.fn(function* () { return yield* Effect.all([a, b], { concurrency: 4 }); }) }; }));\n", true],
      ["permits plain sequential Effect.all inside a transaction", "transaction(Effect.all([a, b]));\n", false],
      ["permits concurrency in a file that runs no transaction", 'Effect.all([a, b], { concurrency: "inherit" });\n', false],
      ["permits concurrency in a file that only reads the client", "Effect.gen(function* () { const { db } = yield* WorkspaceDatabase; return yield* Effect.forEach(ids, (id) => load(db, id), { concurrency: 4 }); });\n", false],
      ["permits transaction-history names", "const { transactions } = ledger;\nEffect.all([a, b], { concurrency: 4 });\n", false],
      ["permits layer merges in a transactional file", "transaction(effect);\nLayer.mergeAll(a, b);\n", false],
      ["permits concurrency outside a raw transaction", 'const load = Effect.all([a, b], { concurrency: "inherit" });\ndb.transaction((tx) => write(tx));\n', false],
      ["permits the wrapper's home", "db.transaction(() => effect.pipe(Effect.withConcurrency(1)));\n", false, "apps/deskohub-workspace/db/database.service.ts"],
      ["permits tests", "transaction(Effect.forEach(xs, f, { concurrency: 4 }));\n", false, "apps/deskohub-workspace/features/reservation/backend/probe.postgres.test.ts"],
    ],
  },
  {
    name: "workspace-lock-statements", diagnostic: "Take advisory locks and bounded lock waits through the Workspace lock registry",
    module: "apps/deskohub-workspace/features/reservation/backend/probe.repository.ts",
    cases: [
      ["rejects advisory lock SQL", "db.execute(sql`select pg_advisory_xact_lock(hashtext('x'), hashtext('y'))`);\n", true],
      ["rejects lock_timeout SQL", "db.execute(sql`set local lock_timeout = '5s'`);\n", true],
      ["rejects try-lock text", 'const query = "select pg_try_advisory_lock(1)";\n', true],
      ["rejects advisory unlock text", 'const query = "select pg_advisory_unlock_all()";\n', true],
      ["rejects the statement builder", 'db.execute(postgresAdvisoryTransactionLockStatement(["a", "b"]));\n', true],
      ["rejects the session lock helpers", "withPostgresAdvisoryLock(pool, key, effect);\n", true],
      ["permits the registry", "sql`select pg_advisory_xact_lock(1::bigint)`;\n", false, "apps/deskohub-workspace/db/workspace-locks.ts"],
      ["permits the ledger", "sql`select set_config('lock_timeout', '5s', true)`;\n", false, "apps/deskohub-workspace/db/workspace-lock-ledger.ts"],
      ["permits the session-lock module", 'const query = "select pg_advisory_lock(hashtext($1), hashtext($2))";\n', false, "apps/deskohub-workspace/db/postgres-advisory-lock.ts"],
      ["permits a comment naming lock_timeout", "/** Gave up waiting (`lock_timeout`). */\nexport const advisory = 1;\n", false],
      ["permits unrelated advisory words", 'const label = "advisory availability";\n', false],
      ["permits tests", "sql`select pg_try_advisory_xact_lock(1)`;\n", false, "apps/deskohub-workspace/features/reservation/backend/probe.postgres.test.ts"],
    ],
  },
  {
    name: "workspace-transaction-executors", diagnostic: "Don't pass a transaction executor",
    module: "apps/deskohub-workspace/features/reservation/backend/probe.repository.ts",
    cases: [
      ["rejects a tx parameter", "export const f = (tx: Client) => tx;\n", true],
      ["rejects an untyped tx callback parameter", "run((tx) => tx.select());\n", true],
      ["rejects a bare tx arrow parameter", "run(tx => tx.select());\n", true],
      ["rejects a destructured tx", "export const f = ({ tx }: Input) => tx;\n", true],
      ["rejects an optional executor default", "export const f = (code: string, executor: Client = db) => executor;\n", true],
      ["rejects an executor input field", "type Input = { readonly executor: WorkspaceDatabaseClient };\n", true],
      ["rejects a quoted executor input field", 'type Input = { readonly "executor": WorkspaceDatabaseClient };\n', true],
      ["rejects an executor argument", "run({ executor: db });\n", true],
      ["rejects a transaction parameter typed as a client", "export const f = (transaction: WorkspaceDatabaseClient) => transaction;\n", true],
      ["rejects a transaction parameter typed as a narrowed client", 'export const f = (transaction: Pick<WorkspaceDatabaseClient, "select">) => transaction;\n', true],
      ["rejects a transaction parameter typed as the marker's client", 'export const f = (transaction: WorkspaceTransaction["db"]) => transaction;\n', true],
      ["rejects a derived alias", 'type T = Parameters<Parameters<WorkspaceDatabaseClient["transaction"]>[0]>[0];\n', true],
      ["rejects an InTransaction name", "export const spendInTransaction = () => Effect.void;\n", true],
      ["rejects a Tx name", "export const spendTx = () => Effect.void;\n", true],
      ["rejects a Tx method name", "export const ledger = { spendTx() { return Effect.void; } };\n", true],
      ["permits a writer that reads the marker", "export const record = (event: Event) =>\n  Effect.flatMap(WorkspaceTransaction, ({ db }) => db.insert(events).values(event));\n", false],
      ["permits a joining db parameter", "export const read = (db: WorkspaceDatabaseClient) => db.select().from(t);\n", false],
      ["permits the wrapper", "export const f = (transaction: <A>(effect: A) => A) => transaction;\n", false],
      ["permits a wrapper whose effect requires the marker", "export const f = (\n  transaction: (effect: Effect.Effect<void, never, WorkspaceTransaction>) => Effect.Effect<void>\n) => transaction;\n", false],
      ["permits a transaction-history prop", "export const Rows = ({ transactions }: Props) => transactions;\n", false],
      ["permits names ending in lowercase tx", "export const ctx = 1;\n", false],
      ["permits tests", "export const f = (tx: Client) => tx;\n", false, "apps/deskohub-workspace/features/reservation/backend/probe.postgres.test.ts"],
      ["permits E2E", "export const f = (tx: Client) => tx;\n", false, "apps/deskohub-workspace/e2e/integrations/probe.ts"],
    ],
  },
  {
    name: "workspace-database-clients", diagnostic: "Build Workspace database clients only in db/",
    module: "apps/deskohub-workspace/features/reservation/backend/probe.repository.ts",
    cases: [
      ["rejects a feature pool", "new Pool({});\n", true],
      ["rejects a feature drizzle client", "drizzle({ client: pool });\n", true],
      ["rejects an Effect SQL client", "PgClient.layer({ url });\n", true],
      ["rejects the Workspace client factory", "makeDatabaseClient(pool);\n", true],
      ["permits db/", "new Pool({});\n", false, "apps/deskohub-workspace/db/database-client.ts"],
      ["permits E2E", "makeDatabasePool({ connectionString });\n", false, "apps/deskohub-workspace/e2e/integrations/probe.ts"],
      ["permits tests", "new Pool({});\n", false, "apps/deskohub-workspace/features/x/probe.postgres.test.ts"],
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
