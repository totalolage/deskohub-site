import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  AdministrationLegacyUsername,
  type CampaignOperationError,
  type CampaignOperationName,
  type CampaignOperations as CampaignOperationRegistry,
  CliBearerAuthentication,
  CliMutationRequestId,
  CliSessionId,
  CurrentCliSession,
  campaignOperationEndpoints,
  dhwVersionHeader,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
  type OperationInput,
  type Operations,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto, NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { cliSessions } from "@/db/schema";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { insertTestAdministrator } from "@/shared/testing/workspace-test-accounts.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

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
};

type AdapterContractCase<Name extends CampaignOperationName> = {
  readonly title: string;
  /** Revokes the seeded administrator's grant for this case. */
  readonly revokeAdministrator?: true;
  readonly input: (seeded: Seeded) => OperationInput<Registry[Name]>;
  readonly expect:
    | { readonly _tag: "Success" }
    | Omit<Extract<Outcome, { readonly _tag: "Failure" }>, never>;
};

/** At least one case per operation; a missing one fails the typecheck. */
type AdapterContractCases<Ops extends Operations> = {
  readonly [Name in keyof Ops & CampaignOperationName]: readonly [
    AdapterContractCase<Name>,
    ...AdapterContractCase<Name>[],
  ];
};

const success = { _tag: "Success" } as const;
const failure = (
  category: CampaignOperationError["_tag"],
  code: string
): Outcome => ({ _tag: "Failure", category, code });
const requestId = () => CliMutationRequestId.make(crypto.randomUUID());
const missingId = "01990000-0000-7000-8000-00000000dead";
const savedAudienceFilter = { _tag: "Group", operator: "and", filters: [] };
const czechContent = {
  "cs-CZ": { subject: "Novinky", preheader: "", bodyMarkdown: "# Ahoj" },
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
      title: "refuses an unknown input key",
      input: ({ draftId }) =>
        ({ campaignId: draftId, unexpected: true }) as never,
      expect: failure("OperationInputInvalid", "input-invalid"),
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
  ],
  updateCampaign: [
    {
      title: "renames a draft",
      input: ({ draftId }) => ({ campaignId: draftId, title: "Renamed news" }),
      expect: success,
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
      expect: failure("OperationConflict", "audience-missing"),
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
};

const volatileKeys = ["id", "createdAt", "updatedAt", "archivedAt"];

/** Generated ids and instants differ per run; everything else must match. */
const normalise = <A>(value: A): A =>
  JSON.parse(
    JSON.stringify(value, (key, entry) =>
      volatileKeys.includes(key) && entry !== null ? `<${key}>` : entry
    )
  );

const sessionId = CliSessionId.make(crypto.randomUUID());
const currentDhwVersion: string = (
  await Bun.file(
    new URL("../../../../dhw/package.json", import.meta.url)
  ).json()
).version;

/**
 * `/api/v1/cli` with the real campaign handlers over the disposable
 * database. The session is stubbed so the port's own grant check decides.
 */
const handleCliRequest = await (async () => {
  if (!testDatabase) return undefined;
  const { AdminCliCampaignsApiHandlers } = await import(
    "@/features/admin-cli/email-campaigns-api.server"
  );
  const { CliClientCompatibilityLive } = await import(
    "@/features/admin-cli/cli-client-version"
  );
  const { CliMutationIdempotency } = await import(
    "@/features/admin-cli/cli-mutation-idempotency.service"
  );
  const { CliAuthentication } = await import(
    "@/features/admin-cli/cli-authentication.service"
  );
  const { CampaignOperations } = await import("./campaign-operations.service");
  const { unhandledHttpApiGroups } = await import(
    "@/shared/testing/http-api-test-groups.test-utils"
  );
  const session = {
    id: sessionId,
    approvedBy: null,
    clientName: "contract client",
    cliVersion: currentDhwVersion,
    buildTarget: "development" as const,
    createdAt: "2026-10-19T08:00:00.000Z",
    lastUsedAt: "2026-10-19T08:00:00.000Z",
    expiresAt: null,
  };
  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(WorkspaceAdminApi).pipe(
      Layer.provide(AdminCliCampaignsApiHandlers),
      Layer.provide(unhandledHttpApiGroups(WorkspaceAdminApi, ["campaigns"])),
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(CliBearerAuthentication, {
            bearer: (httpEffect) =>
              Effect.provideService(httpEffect, CurrentCliSession, session),
          }),
          CliClientCompatibilityLive,
          CampaignOperations.Live,
          CliMutationIdempotency.Default.pipe(
            Layer.provide(testDatabase.layer)
          ),
          Layer.mock(CliAuthentication, {
            sessionAdministrator: () => Effect.succeed(administrator),
          })
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

  /** Empties the campaign domain and seeds the same rows for every run. */
  const seed = async (): Promise<Seeded> => {
    await emptyCampaignDomain();
    const seeded: Seeded = {
      audienceId: crypto.randomUUID(),
      unusedAudienceId: crypto.randomUUID(),
      archivedAudienceId: crypto.randomUUID(),
      draftId: crypto.randomUUID(),
      deletableDraftId: crypto.randomUUID(),
      draftWithoutAudienceId: crypto.randomUUID(),
      automatedDraftId: crypto.randomUUID(),
    };
    await pool.query(
      `insert into email_campaign_audiences (id, title, filter, archived_at) values
         ($1, 'Everyone', $4, null), ($2, 'Nobody yet', $4, null),
         ($3, 'Former regulars', $4, now())`,
      [
        seeded.audienceId,
        seeded.unusedAudienceId,
        seeded.archivedAudienceId,
        savedAudienceFilter,
      ]
    );
    await pool.query(
      `insert into email_campaigns (id, title, purpose, template_key, content, audience_id, delivery, status) values
         ($1, 'October news', 'operational', 'workspace', '{}', $5, 'once', 'draft'),
         ($2, 'Scrapped news', 'operational', 'workspace', '{}', $5, 'once', 'draft'),
         ($3, 'Untargeted news', 'operational', 'workspace', '{}', null, 'once', 'draft'),
         ($4, 'Review request', 'marketing', 'workspace', '{}', $5, 'automated', 'draft')`,
      [
        seeded.draftId,
        seeded.deletableDraftId,
        seeded.draftWithoutAudienceId,
        seeded.automatedDraftId,
        seeded.audienceId,
      ]
    );
    await pool.query(
      "insert into email_campaign_automations (campaign_id) values ($1)",
      [seeded.automatedDraftId]
    );
    return seeded;
  };

  /** The campaign domain's rows, without generated ids and instants. */
  const databaseState = async () => {
    const campaigns = await pool.query(
      `select c.title, c.purpose, c.template_key, c.delivery, c.status, c.content,
              a.title as audience, ca.flow, ca.campaign_id is not null as automated
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
      const body: CliErrorBody = await response.json();
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
    return new Request(`https://workspace.deskohub.test/api/v1/cli${path}`, {
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
        for (const [adapter, run] of Object.entries(harnesses)) {
          const seeded = await seed();
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
