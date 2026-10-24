import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  AdministrationAuthentication,
  AdministrationLegacyUsername,
  type CampaignOperationError,
  type CampaignOperationName,
  type CampaignOperations as CampaignOperationRegistry,
  CliMutationRequestId,
  CliSessionId,
  CurrentAdministrationCaller,
  campaignOperationEndpoints,
  campaignOperations,
  dhwVersionHeader,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
  type OperationInput,
  type Operations,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto, NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { cliSessions } from "@/db/schema";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import type { CampaignId } from "@/features/email-campaigns/campaign-identifiers";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { insertTestAdministrator } from "@/shared/testing/workspace-test-accounts.test-utils";
import { richCampaignBodies } from "../body/campaign-body-document.test-utils";

/**
 * Every run empties the campaign tables, so the suite runs on a database of
 * its own.
 */
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "campaign_operations_contract"
);
afterAll(() => testDatabase?.close());

// Every Live layer reads the disposable database, and the admin UI's
// session gate yields the seeded administrator; the port re-checks the
// grant itself.
let currentAdministrator: AdministratorAccountActor | undefined;
let administrator: AdministratorAccountActor;
if (testDatabase) {
  mock.module("@/db/database-provider.server", () => ({
    workspaceDatabaseLayer: testDatabase.layer,
  }));
}
mock.module(
  "@/features/administrators/server/administrator-authorization.server",
  () => ({
    requireAdministratorAuthorization: Effect.suspend(() =>
      currentAdministrator
        ? Effect.succeed(currentAdministrator)
        : Effect.die("no administrator seeded")
    ),
  })
);
mock.module("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));
mock.module("next/server", () => ({
  after: () => undefined,
  connection: async () => undefined,
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

type Registry = CampaignOperationRegistry;
type AnyOperationInput = OperationInput<Registry[CampaignOperationName]>;
type CliErrorBody = { readonly _tag?: string; readonly code?: string };

/** What every adapter must agree on: the output, or category and code. */
type Outcome =
  | { readonly _tag: "Success"; readonly output: unknown }
  | {
      readonly _tag: "Failure";
      readonly category: CampaignOperationError["_tag"];
      readonly code: string;
    };

/** The rows every case starts from, on an emptied campaign domain. */
type Seeded = {
  readonly audienceId: string;
  readonly unusedAudienceId: string;
  readonly archivedAudienceId: string;
  readonly draftId: string;
  readonly deletableDraftId: string;
  readonly draftWithoutAudienceId: string;
  readonly automatedDraftId: string;
  /** A completed dry run of the automated draft's current working copy. */
  readonly readyPreviewId: string;
  /** A completed dry run of an older working copy. */
  readonly stalePreviewId: string;
};

type AdapterContractCase<Name extends CampaignOperationName> = {
  readonly title: string;
  /** Revokes the seeded administrator's grant for this case. */
  readonly revokeAdministrator?: true;
  readonly input: (seeded: Seeded) => OperationInput<Registry[Name]>;
  readonly expect:
    | { readonly _tag: "Success"; readonly output?: unknown }
    | Omit<Extract<Outcome, { readonly _tag: "Failure" }>, never>;
};

/** At least one case per operation; a missing one fails the typecheck. */
type AdapterContractCases<Ops extends Operations> = {
  readonly [Name in keyof Ops & CampaignOperationName]: readonly [
    AdapterContractCase<Name>,
    ...AdapterContractCase<Name>[],
  ];
};

/** A body whose button and link the composer hasn't finished yet. */
const unfinishedBody = "Více na [webu]().\n\n[[button: ]()]";

const success = { _tag: "Success" } as const;
const failure = (
  category: CampaignOperationError["_tag"],
  code: string
): Outcome => ({ _tag: "Failure", category, code });
const requestId = () => CliMutationRequestId.make(crypto.randomUUID());
const missingId = "01990000-0000-7000-8000-00000000dead";
const savedAudienceFilter = { _tag: "Group", operator: "and", filters: [] };
/** "Twice an hour, send": the schedule fires more than hourly (D33). */
const twiceHourlyFlow = {
  trigger: { _tag: "Schedule", calendar: { minutes: [0, 30] } },
  steps: [{ _tag: "Send", id: "send" }],
} as const;
const czechContent = {
  "cs-CZ": { subject: "Novinky", preheader: "", bodyMarkdown: "# Ahoj" },
};
/** Both locales with bodies as the editor holds them. */
const editorContent = {
  "cs-CZ": {
    subject: "Novinky",
    preheader: "",
    bodyDocument: richCampaignBodies["cs-CZ"],
  },
  "en-US": {
    subject: "News",
    preheader: "",
    bodyDocument: richCampaignBodies["en-US"],
  },
};

const cases: AdapterContractCases<Registry> = {
  listCampaignAudiences: [
    { title: "lists every audience", input: () => ({}), expect: success },
  ],
  getCampaignAudience: [
    {
      title: "returns an audience",
      input: ({ audienceId }) => ({ audienceId }),
      expect: success,
    },
    {
      title: "reports a missing audience",
      input: () => ({ audienceId: missingId }),
      expect: failure("OperationNotFound", "audience-not-found"),
    },
  ],
  createCampaignAudience: [
    {
      title: "creates an audience",
      input: () => ({
        requestId: requestId(),
        audience: { title: "Everyone else", filter: savedAudienceFilter },
      }),
      expect: success,
    },
    {
      title: "refuses a title over 120 characters",
      input: () => ({
        requestId: requestId(),
        audience: { title: "x".repeat(121), filter: savedAudienceFilter },
      }),
      expect: failure("OperationInputInvalid", "input-invalid"),
    },
  ],
  updateCampaignAudience: [
    {
      title: "renames an audience",
      input: ({ audienceId }) => ({ audienceId, title: "Renamed audience" }),
      expect: success,
    },
  ],
  archiveCampaignAudience: [
    {
      title: "archives an audience",
      input: ({ unusedAudienceId }) => ({ audienceId: unusedAudienceId }),
      expect: success,
    },
  ],
  unarchiveCampaignAudience: [
    {
      title: "unarchives an audience",
      input: ({ archivedAudienceId }) => ({ audienceId: archivedAudienceId }),
      expect: success,
    },
  ],
  deleteCampaignAudience: [
    {
      title: "deletes an unused audience",
      input: ({ unusedAudienceId }) => ({ audienceId: unusedAudienceId }),
      expect: success,
    },
    {
      title: "keeps an audience a draft uses",
      input: ({ audienceId }) => ({ audienceId }),
      expect: failure("OperationConflict", "audience-in-use"),
    },
  ],
  listCampaignTemplates: [
    { title: "lists the templates", input: () => ({}), expect: success },
  ],
  getCampaignSettings: [
    {
      title: "returns campaign settings",
      input: () => ({}),
      expect: success,
    },
  ],
  previewCampaignTemplate: [
    {
      title: "renders unsaved operational texts",
      input: () => ({
        templateKey: "workspace",
        preview: {
          _tag: "Content",
          purpose: "operational",
          locale: "cs-CZ",
          content: czechContent["cs-CZ"],
        },
      }),
      expect: success,
    },
    {
      title: "renders texts with an unfinished button and link",
      input: () => ({
        templateKey: "workspace",
        preview: {
          _tag: "UnfinishedContent",
          purpose: "operational",
          locale: "cs-CZ",
          content: { ...czechContent["cs-CZ"], bodyMarkdown: unfinishedBody },
        },
      }),
      expect: success,
    },
    {
      title: "refuses unsaved texts with an unfinished button and link",
      input: () => ({
        templateKey: "workspace",
        preview: {
          _tag: "Content",
          purpose: "operational",
          locale: "cs-CZ",
          content: { ...czechContent["cs-CZ"], bodyMarkdown: unfinishedBody },
        },
      }),
      expect: failure("OperationInputInvalid", "content-markdown-invalid"),
    },
    {
      title: "refuses a saved campaign's missing locale",
      input: ({ draftId }) => ({
        templateKey: "workspace",
        preview: { _tag: "Campaign", campaignId: draftId, locale: "en-US" },
      }),
      expect: failure("OperationInputInvalid", "content-locale-missing"),
    },
  ],
  listCampaigns: [
    { title: "lists every campaign", input: () => ({}), expect: success },
    {
      title: "refuses a revoked administrator",
      revokeAdministrator: true,
      input: () => ({}),
      expect: failure("OperationUnauthorized", "administrator-required"),
    },
  ],
  getCampaign: [
    {
      title: "returns a campaign",
      input: ({ draftId }) => ({ campaignId: draftId }),
      expect: success,
    },
    {
      title: "reports a missing campaign",
      input: () => ({ campaignId: missingId }),
      expect: failure("OperationNotFound", "campaign-not-found"),
    },
  ],
  getCampaignEditorContent: [
    {
      title: "returns a campaign with document bodies",
      input: ({ draftId }) => ({ campaignId: draftId }),
      expect: success,
    },
    {
      title: "reports a missing campaign",
      input: () => ({ campaignId: missingId }),
      expect: failure("OperationNotFound", "campaign-not-found"),
    },
  ],
  createCampaign: [
    {
      title: "creates a one-off draft",
      input: ({ audienceId }) => ({
        requestId: requestId(),
        campaign: {
          title: "November news",
          purpose: "operational",
          templateKey: "workspace",
          audienceId,
          content: czechContent,
        },
      }),
      expect: success,
    },
    {
      title: "creates a draft from document bodies",
      input: ({ audienceId }) => ({
        requestId: requestId(),
        campaign: {
          title: "November news",
          purpose: "operational",
          templateKey: "workspace",
          audienceId,
          content: editorContent,
        },
      }),
      expect: success,
    },
  ],
  updateCampaign: [
    {
      title: "rewrites bodies as documents",
      input: ({ draftId }) => ({ campaignId: draftId, content: editorContent }),
      expect: success,
    },
    {
      title: "refuses a body given in both forms",
      input: ({ draftId }) => ({
        campaignId: draftId,
        content: {
          "cs-CZ": { ...editorContent["cs-CZ"], bodyMarkdown: "# Ahoj" },
        },
      }),
      expect: failure("OperationInputInvalid", "input-invalid"),
    },
    {
      title: "renames a draft",
      input: ({ draftId }) => ({ campaignId: draftId, title: "Renamed news" }),
      expect: success,
    },
    {
      title: "refuses an unknown input key",
      input: ({ draftId }) =>
        ({ campaignId: draftId, title: "Renamed", unexpected: true }) as never,
      expect: failure("OperationInputInvalid", "input-invalid"),
    },
  ],
  duplicateCampaign: [
    {
      title: "copies a draft",
      input: ({ draftId }) => ({ campaignId: draftId, requestId: requestId() }),
      expect: success,
    },
  ],
  deleteCampaign: [
    {
      title: "deletes a draft",
      input: ({ deletableDraftId }) => ({ campaignId: deletableDraftId }),
      expect: success,
    },
  ],
  previewCampaignRecipients: [
    {
      title: "needs an audience",
      input: ({ draftWithoutAudienceId }) => ({
        campaignId: draftWithoutAudienceId,
      }),
      expect: failure("OperationConflict", "campaign-audience-missing"),
    },
  ],
  testSendCampaign: [
    {
      title: "refuses an automated campaign",
      input: ({ automatedDraftId }) => ({
        campaignId: automatedDraftId,
        recipients: [],
      }),
      expect: failure("OperationConflict", "campaign-delivery-mismatch"),
    },
  ],
  sendCampaign: [
    {
      title: "refuses an automated campaign",
      input: ({ automatedDraftId }) => ({
        campaignId: automatedDraftId,
        confirmationCode: "ABCD-EFGH",
      }),
      expect: failure("OperationConflict", "campaign-delivery-mismatch"),
    },
  ],
  retryCampaign: [
    {
      title: "retries only a failed campaign",
      input: ({ draftId }) => ({
        campaignId: draftId,
        includeUnconfirmed: false,
      }),
      expect: failure("OperationConflict", "campaign-not-retryable"),
    },
  ],
  getCampaignSendStatus: [
    {
      title: "has no send before sending",
      input: ({ draftId }) => ({ campaignId: draftId }),
      expect: success,
    },
  ],
  getAutomation: [
    {
      title: "reports the schedule's frequency",
      input: ({ automatedDraftId }) => ({ campaignId: automatedDraftId }),
      expect: {
        _tag: "Success",
        output: {
          trigger: {
            frequency: { maxFiresPerHour: 2, firesMoreThanHourly: true },
          },
        },
      },
    },
    {
      title: "refuses a one-off campaign",
      input: ({ draftId }) => ({ campaignId: draftId }),
      expect: failure("OperationConflict", "campaign-delivery-mismatch"),
    },
  ],
  updateAutomationFlow: [
    {
      title: "stores a schedule firing twice an hour",
      input: ({ automatedDraftId }) => ({
        campaignId: automatedDraftId,
        flow: twiceHourlyFlow,
      }),
      expect: {
        _tag: "Success",
        output: {
          trigger: {
            frequency: { maxFiresPerHour: 2, firesMoreThanHourly: true },
          },
        },
      },
    },
    {
      title: "refuses an unknown input key",
      input: ({ automatedDraftId }) =>
        ({
          campaignId: automatedDraftId,
          flow: twiceHourlyFlow,
          unexpected: true,
        }) as never,
      expect: failure("OperationInputInvalid", "input-invalid"),
    },
    {
      title: "refuses a calendar that never happens",
      input: ({ automatedDraftId }) => ({
        campaignId: automatedDraftId,
        flow: {
          ...twiceHourlyFlow,
          trigger: {
            _tag: "Schedule",
            calendar: { daysOfMonth: [31], months: [2] },
          },
        },
      }),
      expect: failure("OperationInputInvalid", "calendar-never-occurs"),
    },
    {
      title: "refuses a schedule off the engine's ticks",
      input: ({ automatedDraftId }) => ({
        campaignId: automatedDraftId,
        flow: {
          ...twiceHourlyFlow,
          trigger: { _tag: "Schedule", calendar: { minutes: [0, 7] } },
        },
      }),
      expect: failure("OperationInputInvalid", "schedule-minutes-not-allowed"),
    },
  ],
  dryRunAutomation: [
    {
      title: "returns the completed dry run of the current draft",
      input: ({ automatedDraftId }) => ({ campaignId: automatedDraftId }),
      expect: { _tag: "Success", output: { status: "completed" } },
    },
    {
      title: "refuses a one-off campaign",
      input: ({ draftId }) => ({ campaignId: draftId }),
      expect: failure("OperationConflict", "campaign-delivery-mismatch"),
    },
  ],
  getAutomationDryRun: [
    {
      title: "returns a completed dry run with the schedule's frequency",
      input: ({ readyPreviewId }) => ({ previewId: readyPreviewId, limit: 50 }),
      expect: {
        _tag: "Success",
        output: {
          status: "completed",
          frequency: { maxFiresPerHour: 2, firesMoreThanHourly: true },
        },
      },
    },
    {
      title: "reports a missing dry run",
      input: () => ({ previewId: missingId }),
      expect: failure("OperationNotFound", "automation-preview-not-found"),
    },
  ],
  activateAutomation: [
    {
      title: "activates with a completed dry run of the current draft",
      input: ({ automatedDraftId, readyPreviewId }) => ({
        campaignId: automatedDraftId,
        previewId: readyPreviewId,
      }),
      expect: { _tag: "Success", output: { versionNumber: 1, active: true } },
    },
    {
      title: "refuses activation without a completed dry run",
      input: ({ automatedDraftId }) => ({
        campaignId: automatedDraftId,
        previewId: missingId,
      }),
      expect: failure("OperationConflict", "automation-preview-required"),
    },
    {
      title: "refuses a dry run of an older draft",
      input: ({ automatedDraftId, stalePreviewId }) => ({
        campaignId: automatedDraftId,
        previewId: stalePreviewId,
      }),
      expect: failure("OperationConflict", "automation-draft-changed"),
    },
  ],
  pauseAutomation: [
    {
      title: "refuses to pause a draft",
      input: ({ automatedDraftId }) => ({ campaignId: automatedDraftId }),
      expect: failure("OperationConflict", "automation-status-conflict"),
    },
  ],
  resumeAutomation: [
    {
      title: "refuses to resume a draft",
      input: ({ automatedDraftId }) => ({ campaignId: automatedDraftId }),
      expect: failure("OperationConflict", "automation-status-conflict"),
    },
  ],
  archiveAutomation: [
    {
      title: "archives a draft",
      input: ({ automatedDraftId }) => ({ campaignId: automatedDraftId }),
      expect: { _tag: "Success", output: { status: "archived" } },
    },
  ],
  listAutomationVersions: [
    {
      title: "has no versions before activation",
      input: ({ automatedDraftId }) => ({ campaignId: automatedDraftId }),
      expect: { _tag: "Success", output: [] },
    },
  ],
  getAutomationVersion: [
    {
      title: "reports a missing version",
      input: ({ automatedDraftId }) => ({
        campaignId: automatedDraftId,
        versionNumber: 1,
      }),
      expect: failure("OperationNotFound", "automation-version-not-found"),
    },
  ],
  getAutomationRunStats: [
    {
      title: "counts no runs before activation",
      input: ({ automatedDraftId }) => ({ campaignId: automatedDraftId }),
      expect: {
        _tag: "Success",
        output: { byState: { active: 0, sending: 0, ended: 0 } },
      },
    },
  ],
  listAutomationRuns: [
    {
      title: "lists no runs before activation",
      input: ({ automatedDraftId }) => ({
        campaignId: automatedDraftId,
        state: "active",
        limit: 10,
      }),
      expect: { _tag: "Success", output: { runs: [], nextCursor: null } },
    },
  ],
  getAutomationRun: [
    {
      title: "reports a missing run",
      input: () => ({ runId: missingId }),
      expect: failure("OperationNotFound", "automation-run-not-found"),
    },
  ],
  previewCalendarExpression: [
    {
      title: "describes a schedule firing twice an hour",
      input: () => ({
        expression: { minutes: [0, 30], hours: [10], months: [1] },
        usage: "trigger",
        locale: "en-US",
      }),
      expect: {
        _tag: "Success",
        output: {
          frequency: { maxFiresPerHour: 2, firesMoreThanHourly: true },
        },
      },
    },
  ],
  getAutomationEngineHealth: [
    {
      title: "refuses a revoked administrator",
      revokeAdministrator: true,
      input: () => ({}),
      expect: failure("OperationUnauthorized", "administrator-required"),
    },
  ],
};

const volatileKeys = [
  "id",
  "createdAt",
  "updatedAt",
  "archivedAt",
  "activatedAt",
  "acceptingSince",
  "asOf",
  "completedAt",
  "nextFireAt",
];

/** Generated ids and instants differ per run; everything else must match. */
const normalise = <A>(value: A): A =>
  JSON.parse(
    JSON.stringify(value, (key, entry) =>
      volatileKeys.includes(key) && entry !== null ? `<${key}>` : entry
    )
  );

const sessionId = CliSessionId.make(crypto.randomUUID());
const packagedDhwVersion: string = (
  await Bun.file(
    new URL("../../../../dhw/package.json", import.meta.url)
  ).json()
).version;
/**
 * The release that ships every operation: the packaged `dhw`, or the next
 * release when an operation already requires it before Release Please
 * bumps the package.
 */
const currentDhwVersion = Object.values(campaignOperations).reduce(
  (newest, { minimumDhwVersion }) =>
    minimumDhwVersion !== undefined &&
    Bun.semver.order(minimumDhwVersion, newest) > 0
      ? minimumDhwVersion
      : newest,
  packagedDhwVersion
);

/**
 * `/api/v1/cli` with the real campaign handlers over the disposable
 * database. The session is stubbed so the port's own grant check decides.
 */
const handleCliRequest = await (async () => {
  if (!testDatabase) return undefined;
  const { AdminCliCampaignsApiHandlers } = await import(
    "@/features/admin-cli/email-campaigns-api.server"
  );
  const { AdminCliAutomationsApiHandlers } = await import(
    "@/features/admin-cli/email-automations-api.server"
  );
  const { CliClientCompatibilityLive } = await import(
    "@/features/admin-cli/cli-client-version"
  );
  const { CliMutationIdempotency } = await import(
    "@/features/admin-cli/cli-mutation-idempotency.service"
  );
  const { UnrecordedAdministrationActions, UnusedCliSessionAuthentication } =
    await import("@/features/admin-cli/cli-api.test-utils");
  const { CampaignOperations } = await import("./campaign-operations.service");
  const { unhandledHttpApiGroups } = await import(
    "@/shared/testing/http-api-test-groups.test-utils"
  );
  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(WorkspaceAdminApi).pipe(
      Layer.provide(AdminCliCampaignsApiHandlers),
      Layer.provide(AdminCliAutomationsApiHandlers),
      Layer.provide(
        unhandledHttpApiGroups(WorkspaceAdminApi, ["campaigns", "automations"])
      ),
      Layer.provide(
        Layer.mergeAll(
          UnusedCliSessionAuthentication,
          Layer.succeed(AdministrationAuthentication, {
            bearer: (httpEffect) =>
              Effect.provideService(httpEffect, CurrentAdministrationCaller, {
                actor: administrator,
                channel: { _tag: "CliSession", sessionId },
              }),
          }),
          CliClientCompatibilityLive,
          UnrecordedAdministrationActions,
          CampaignOperations.Live,
          CliMutationIdempotency.Default.pipe(Layer.provide(testDatabase.layer))
        )
      ),
      Layer.provide(NodeHttpServer.layerHttpServices)
    ),
    { disableLogger: true }
  ).handler;
})();

describe.skipIf(!testDatabase)("campaign operation adapters", () => {
  if (!testDatabase) return;
  const { pool } = testDatabase;

  beforeAll(async () => {
    administrator = await insertTestAdministrator(testDatabase, "contract");
    await Effect.runPromise(
      makeCliAuthenticationSecret().pipe(
        Effect.flatMap(digestCliAuthenticationSecret),
        Effect.flatMap((tokenHash) =>
          testDatabase.db.insert(cliSessions).values({
            id: sessionId,
            approvedBy: AdministrationLegacyUsername.make("operator"),
            tokenHash,
            clientName: "contract client",
            cliVersion: currentDhwVersion,
            buildTarget: "development",
          })
        ),
        Effect.provide(NodeCrypto.layer)
      )
    );
  });

  afterAll(async () => {
    await pool.query("delete from cli_sessions where id = $1", [sessionId]);
    await pool.query(`delete from auth."user" where id = $1`, [
      administrator.accountId,
    ]);
    await emptyCampaignDomain();
  });

  const emptyCampaignDomain = () =>
    pool.query(
      "truncate email_campaigns, email_campaign_audiences, cli_mutation_requests cascade"
    );

  const seedIds = (): Seeded => ({
    audienceId: crypto.randomUUID(),
    unusedAudienceId: crypto.randomUUID(),
    archivedAudienceId: crypto.randomUUID(),
    draftId: crypto.randomUUID(),
    deletableDraftId: crypto.randomUUID(),
    draftWithoutAudienceId: crypto.randomUUID(),
    automatedDraftId: crypto.randomUUID(),
    readyPreviewId: crypto.randomUUID(),
    stalePreviewId: crypto.randomUUID(),
  });

  /** Empties the campaign domain and seeds the same rows for every run. */
  const seed = async (seeded: Seeded) => {
    await emptyCampaignDomain();
    await pool.query(
      `insert into email_campaign_audiences (id, title, filter, archived_at, created_at) values
         ($1, 'Everyone', $4, null, now() - interval '3 minutes'),
         ($2, 'Nobody yet', $4, null, now() - interval '2 minutes'),
         ($3, 'Former regulars', $4, now(), now() - interval '1 minute')`,
      [
        seeded.audienceId,
        seeded.unusedAudienceId,
        seeded.archivedAudienceId,
        savedAudienceFilter,
      ]
    );
    await pool.query(
      `insert into email_campaigns (id, title, purpose, template_key, content, audience_id, delivery, status, created_at) values
         ($1, 'October news', 'operational', 'workspace', '{}', $5, 'once', 'draft', now() - interval '4 minutes'),
         ($2, 'Scrapped news', 'operational', 'workspace', '{}', $5, 'once', 'draft', now() - interval '3 minutes'),
         ($3, 'Untargeted news', 'operational', 'workspace', '{}', null, 'once', 'draft', now() - interval '2 minutes'),
         ($4, 'Review request', 'marketing', 'workspace', $6, $5, 'automated', 'draft', now() - interval '1 minute')`,
      [
        seeded.draftId,
        seeded.deletableDraftId,
        seeded.draftWithoutAudienceId,
        seeded.automatedDraftId,
        seeded.audienceId,
        czechContent,
      ]
    );
    await pool.query(
      "insert into email_campaign_automations (campaign_id) values ($1)",
      [seeded.automatedDraftId]
    );
    const draftHash = await saveAutomationFlow(
      seeded.automatedDraftId,
      twiceHourlyFlow
    );
    await pool.query(
      `insert into email_campaign_automation_previews
         (id, campaign_id, draft_hash, kind, status, as_of, units_total, units_done, completed_at) values
         ($1, $3, $4, 'schedule', 'completed', now(), 1, 1, now()),
         ($2, $3, 'an older draft', 'schedule', 'completed', now(), 1, 1, now())`,
      [
        seeded.readyPreviewId,
        seeded.stalePreviewId,
        seeded.automatedDraftId,
        draftHash,
      ]
    );
  };

  /** Saves the working copy as an administrator would; returns its hash. */
  const saveAutomationFlow = async (
    campaignId: string,
    flow: typeof twiceHourlyFlow
  ) => {
    const { AutomationLifecycle } = await import(
      "../automation/backend/automation-lifecycle.service"
    );
    const { automationFlowFixture } = await import(
      "../automation/backend/automation-lifecycle.test-utils"
    );
    const { loadAutomationWorkingCopy } = await import(
      "../automation/backend/automation-working-copy"
    );
    const id = campaignId as CampaignId;
    return AutomationLifecycle.pipe(
      Effect.flatMap((lifecycle) =>
        lifecycle.updateFlow({
          campaignId: id,
          flow: automationFlowFixture(flow),
        })
      ),
      Effect.andThen(
        testDatabase.db.transaction((tx) => loadAutomationWorkingCopy(tx, id))
      ),
      Effect.map((copy) => Option.getOrThrow(copy.draftHash)),
      Effect.provide(AutomationLifecycle.Live),
      Effect.runPromise
    );
  };

  /** The campaign domain's rows, without generated ids and instants. */
  const databaseState = async () => {
    const campaigns = await pool.query(
      `select c.title, c.purpose, c.template_key, c.delivery, c.status, c.content,
              a.title as audience, ca.flow, ca.campaign_id is not null as automated,
              (select count(*)::int from email_campaign_automation_versions v
                where v.campaign_id = c.id) as versions
         from email_campaigns c
         left join email_campaign_audiences a on a.id = c.audience_id
         left join email_campaign_automations ca on ca.campaign_id = c.id
        order by c.title, c.created_at`
    );
    const audiences = await pool.query(
      `select title, filter, archived_at is not null as archived
         from email_campaign_audiences order by title`
    );
    return { campaigns: campaigns.rows, audiences: audiences.rows };
  };

  const withAdministrator = <A>(
    revoke: boolean,
    run: () => Promise<A>
  ): Promise<A> =>
    (revoke
      ? pool.query("delete from account_role_grants where account_id = $1", [
          administrator.accountId,
        ])
      : Promise.resolve()
    )
      .then(run)
      .finally(() =>
        pool.query(
          `insert into account_role_grants (account_id, role)
           values ($1, 'administrator') on conflict do nothing`,
          [administrator.accountId]
        )
      );

  const outcomeOf = (
    result: Effect.Effect<unknown, CampaignOperationError>
  ): Effect.Effect<Outcome> =>
    result.pipe(
      Effect.match({
        onFailure: ({ _tag, code }) => failure(_tag, code),
        onSuccess: (output): Outcome => ({ _tag: "Success", output }),
      })
    );

  const harnesses = {
    invoke: async (name: CampaignOperationName, input: AnyOperationInput) => {
      const { CampaignOperations } = await import(
        "./campaign-operations.service"
      );
      const { OperationRequestLedger } = await import(
        "./operation-request-ledger.service"
      );
      const { CurrentAdministrator } = await import(
        "@/features/administrators/backend/current-administrator"
      );
      return CampaignOperations.pipe(
        Effect.flatMap((operations) =>
          outcomeOf(operations.invoke(name, input as never))
        ),
        Effect.provideService(CurrentAdministrator, administrator),
        Effect.provide(OperationRequestLedger.unscoped),
        Effect.provide(CampaignOperations.Live),
        Effect.runPromise
      );
    },
    "admin UI": async (
      name: CampaignOperationName,
      input: AnyOperationInput
    ) => {
      const { runCampaignOperation } = await import(
        "../admin/campaign-operations.actions"
      );
      currentAdministrator = administrator;
      const result = await runCampaignOperation({
        operation: name,
        input: input as never,
      });
      const data = result?.data;
      if (!data) return { _tag: "Unexpected", result } as never;
      return data._tag === "Success"
        ? ({ _tag: "Success", output: data.output } satisfies Outcome)
        : failure(data.category, data.code);
    },
    "/api/v1/cli": async (
      name: CampaignOperationName,
      input: AnyOperationInput
    ) => {
      const response = await (
        handleCliRequest as NonNullable<typeof handleCliRequest>
      )(cliRequest(name, input));
      const text = await response.text();
      // HttpApi answers its own strict payload decoding with an empty 400.
      if (text === "") {
        return response.status === 400
          ? failure("OperationInputInvalid", "input-invalid")
          : failure("OperationUnavailable", `<empty ${response.status}>`);
      }
      const body: CliErrorBody = JSON.parse(text);
      return response.ok
        ? ({ _tag: "Success", output: body } satisfies Outcome)
        : cliFailure(response.status, body);
    },
  };

  /** The endpoint's request: path params from the input, the rest as body. */
  const cliRequest = (
    name: CampaignOperationName,
    input: AnyOperationInput
  ) => {
    const endpoint = campaignOperationEndpoints[name];
    const fields = new Map(Object.entries(input));
    const path = endpoint.path.replace(/:(\w+)/g, (_, param: string) => {
      const value = String(fields.get(param));
      fields.delete(param);
      return encodeURIComponent(value);
    });
    const body =
      name === "previewCampaignTemplate"
        ? fields.get("preview")
        : Object.fromEntries(fields);
    // A GET carries the rest of its input as query parameters.
    const query =
      endpoint.method === "GET" && fields.size > 0
        ? `?${new URLSearchParams([...fields].map(([key, value]) => [key, String(value)]))}`
        : "";
    return new Request(`https://workspace.deskohub.test${path}${query}`, {
      method: endpoint.method,
      headers: {
        authorization: "Bearer contract",
        "content-type": "application/json",
        [dhwVersionHeader]: currentDhwVersion,
      },
      body:
        endpoint.method === "GET" || endpoint.method === "DELETE"
          ? undefined
          : JSON.stringify(body),
    });
  };

  /**
   * The CLI error's status names the category and its `code` the cause. A
   * 400 without a CLI error body is HttpApi's own strict payload decoding,
   * the same input check the port runs.
   */
  const cliFailure = (
    status: number,
    { _tag, code }: CliErrorBody
  ): Outcome => {
    const category = (
      {
        400: "OperationInputInvalid",
        401: "OperationUnauthorized",
        404: "OperationNotFound",
        409:
          _tag === "CliMutationInProgress"
            ? "OperationInProgress"
            : "OperationConflict",
        503: "OperationUnavailable",
      } as const
    )[status as 400 | 401 | 404 | 409 | 503];
    return failure(category, code ?? uncodedFailure(status, _tag));
  };

  /** A 401 is the bearer check; any other failure must carry a code. */
  const uncodedFailure = (status: number, tag: string | undefined) => {
    if (status === 401) return "administrator-required";
    if (status === 400 && tag !== "CliInputInvalid") return "input-invalid";
    return `<${status} ${tag} without a code>`;
  };

  for (const [name, operationCases] of Object.entries(cases) as Array<
    [CampaignOperationName, ReadonlyArray<AdapterContractCase<never>>]
  >) {
    for (const contractCase of operationCases) {
      test(`${name}: ${contractCase.title}`, async () => {
        const runs = [];
        const seeded = seedIds();
        for (const [adapter, run] of Object.entries(harnesses)) {
          await seed(seeded);
          const outcome = await withAdministrator(
            contractCase.revokeAdministrator === true,
            () => run(name, contractCase.input(seeded))
          );
          runs.push({
            adapter,
            outcome: normalise(outcome),
            state: normalise(await databaseState()),
          });
        }

        const [reference, ...others] = runs;
        expect(reference?.outcome).toMatchObject(contractCase.expect);
        for (const other of others) {
          expect({ adapter: other.adapter, outcome: other.outcome }).toEqual({
            adapter: other.adapter,
            outcome: reference?.outcome,
          });
          expect({ adapter: other.adapter, state: other.state }).toEqual({
            adapter: other.adapter,
            state: reference?.state,
          });
        }
      });
    }
  }
});
