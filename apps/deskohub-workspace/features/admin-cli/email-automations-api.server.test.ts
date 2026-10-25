import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationCampaignId,
  AutomationDetail,
  AutomationEngineHealth,
  AutomationPreviewId,
  AutomationRunId,
  AutomationRunStats,
  AutomationRunSummary,
  automationsMinimumDhwVersion,
  CliClientCompatibility,
  CliInputInvalid,
  CliMutationRejected,
  CliResourceNotFound,
  CliSessionUnauthorized,
  openEngineWarningsDhwVersion,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { HttpApiMiddleware, HttpApiTest } from "effect/unstable/httpapi";
import {
  AutomationDraftChanged,
  AutomationRunNotFound,
  AutomationVersionNotFound,
} from "@/features/email-campaigns/automation/errors";
import { CampaignService } from "@/features/email-campaigns/backend/campaign.service";
import { CampaignAudienceService } from "@/features/email-campaigns/backend/campaign-audience.service";
import { CampaignOperations } from "@/features/email-campaigns/backend/campaign-operations.service";
import {
  type AutomationServiceStubs,
  automationServiceStubs,
} from "@/features/email-campaigns/backend/campaign-operations.test-utils";
import { CampaignRecipientService } from "@/features/email-campaigns/backend/campaign-recipient.service";
import { CampaignSendService } from "@/features/email-campaigns/backend/campaign-send.service";
import { CampaignSendStatusService } from "@/features/email-campaigns/backend/campaign-send-status.service";
import type { CampaignId } from "@/features/email-campaigns/campaign-identifiers";
import { CampaignDeliveryMismatch } from "@/features/email-campaigns/errors";
import {
  authorizedCliRequest,
  ClaimEveryCliMutation,
  cliClientVersion,
  cliSessionAdministrator,
  GrantedAdministrator,
  UnauthorizedCliRequest,
  UnrecordedAdministrationActions,
} from "./cli-api.test-utils";
import { CliClientCompatibilityLive } from "./cli-client-version";
import { AdminCliAutomationsApiHandlers } from "./email-automations-api.server";

const campaignId = AdministrationCampaignId.make(
  "01990000-0000-7000-8000-000000000001"
);
const previewId = AutomationPreviewId.make(
  "01990000-0000-7000-8000-000000000002"
);
const twiceHourlyFlow = {
  trigger: { _tag: "Schedule", calendar: { minutes: [0, 30] } },
  steps: [{ _tag: "Send", id: "send" }],
} as const;

const automationDetail = Schema.decodeUnknownSync(AutomationDetail)({
  campaignId,
  status: "draft",
  flow: twiceHourlyFlow,
  trigger: {
    kind: "schedule",
    frequency: { maxFiresPerHour: 2, firesMoreThanHourly: true },
  },
  activeVersion: null,
  versionCount: 0,
  pendingChanges: true,
  activation: { _tag: "PreviewRequired" },
  updatedAt: "2026-10-19T08:00:00Z",
});

// As the assistant's API: every request admitted, none carrying a version.
const AssistantCompatibility = Layer.succeed(
  CliClientCompatibility,
  (httpEffect) => httpEffect
);
const AssistantClientRequests = HttpApiMiddleware.layerClient(
  CliClientCompatibility,
  ({ request, next }) => next(request)
);

const automationsClient = HttpApiTest.groups(WorkspaceAdminApi, [
  "automations",
]).pipe(Effect.map((client) => client.automations));
type AutomationsClient = Effect.Success<typeof automationsClient>;

const callAutomationsApi = <A, E>(
  call: (client: AutomationsClient) => Effect.Effect<A, E>,
  stubs: AutomationServiceStubs = {},
  options: {
    /** `null` calls as an AI assistant: no version, and no version check. */
    readonly dhwVersion?: string | null;
    readonly bearer?: typeof UnauthorizedCliRequest;
  } = {}
) => {
  const dhwVersion =
    options.dhwVersion === undefined
      ? automationsMinimumDhwVersion
      : options.dhwVersion;
  return automationsClient.pipe(
    Effect.flatMap(call),
    Effect.provide(AdminCliAutomationsApiHandlers),
    Effect.provide(options.bearer ?? authorizedCliRequest()),
    Effect.provide(
      CampaignOperations.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(CampaignAudienceService, {}),
            Layer.mock(CampaignService, {}),
            Layer.mock(CampaignRecipientService, {}),
            Layer.mock(CampaignSendService, {}),
            Layer.mock(CampaignSendStatusService, {}),
            automationServiceStubs(stubs),
            GrantedAdministrator
          )
        )
      )
    ),
    Effect.provide(ClaimEveryCliMutation),
    Effect.provide(
      dhwVersion === null ? AssistantCompatibility : CliClientCompatibilityLive
    ),
    Effect.provide(UnrecordedAdministrationActions),
    Effect.provide(
      dhwVersion === null
        ? AssistantClientRequests
        : cliClientVersion(dhwVersion)
    ),
    Effect.provide(NodeHttpServer.layerHttpServices),
    Effect.scoped,
    Effect.runPromise
  );
};

describe("automation admin API", () => {
  test("rejects a request without a valid CLI session before any service runs", async () => {
    const error = await callAutomationsApi(
      (client) =>
        client.getAutomation({ params: { campaignId } }).pipe(Effect.flip),
      { lifecycle: { get: () => Effect.die("not expected") } },
      { bearer: UnauthorizedCliRequest }
    );

    expect(error).toBeInstanceOf(CliSessionUnauthorized);
  });

  // dhw 1.22.0 and 1.23.0 shipped before the automation commands did.
  test.each(["1.21.0", "1.22.0", "1.23.0", "1.24.0-rc.1"])(
    "refuses dhw %s, which lacks the automation commands",
    async (dhwVersion) => {
      const error = await callAutomationsApi(
        (client) =>
          client.getAutomation({ params: { campaignId } }).pipe(Effect.flip),
        { lifecycle: { get: () => Effect.die("not expected") } },
        { dhwVersion }
      );

      expect(error).toBeInstanceOf(CliInputInvalid);
      expect(error.message).toContain("dhw update");
    }
  );

  test.each(["1.24.0", "1.24.0+pr.762.abc1234", "1.25.0"])(
    "accepts dhw %s, the first release with the automation commands or later",
    async (dhwVersion) => {
      const detail = await callAutomationsApi(
        (client) => client.getAutomation({ params: { campaignId } }),
        { lifecycle: { get: () => Effect.succeed(automationDetail) } },
        { dhwVersion }
      );

      expect(detail.trigger?.frequency).toBeDefined();
    }
  );

  test("returns the working copy with the schedule's frequency", async () => {
    const requested: CampaignId[] = [];
    const detail = await callAutomationsApi(
      (client) => client.getAutomation({ params: { campaignId } }),
      {
        lifecycle: {
          get: (id) => {
            requested.push(id);
            return Effect.succeed(automationDetail);
          },
        },
      }
    );

    expect(requested).toEqual([campaignId]);
    expect(detail.trigger?.frequency).toEqual({
      maxFiresPerHour: 2,
      firesMoreThanHourly: true,
    });
  });

  test("saves the flow from the body under the path's campaign", async () => {
    const updates: unknown[] = [];
    await callAutomationsApi(
      (client) =>
        client.updateAutomationFlow({
          params: { campaignId },
          payload: { flow: twiceHourlyFlow },
        }),
      {
        lifecycle: {
          updateFlow: (input) => {
            updates.push(input);
            return Effect.succeed(automationDetail);
          },
        },
      }
    );

    expect(updates).toEqual([{ campaignId, flow: twiceHourlyFlow }]);
  });

  test("activates as the session's administrator and explains a changed draft", async () => {
    const activations: unknown[] = [];
    const error = await callAutomationsApi(
      (client) =>
        client
          .activateAutomation({
            params: { campaignId },
            payload: { previewId },
          })
          .pipe(Effect.flip),
      {
        lifecycle: {
          activate: (input) => {
            activations.push(input);
            return Effect.fail(
              new AutomationDraftChanged({
                campaignId: input.campaignId,
                previewId: input.previewId,
              })
            );
          },
        },
      }
    );

    expect(activations).toEqual([
      {
        campaignId,
        previewId,
        activatedBy: cliSessionAdministrator.accountId,
      },
    ]);
    expect(error).toBeInstanceOf(CliMutationRejected);
    expect(error).toMatchObject({ code: "automation-draft-changed" });
  });

  test("refuses a one-off campaign as a conflict", async () => {
    const error = await callAutomationsApi(
      (client) =>
        client.pauseAutomation({ params: { campaignId } }).pipe(Effect.flip),
      {
        lifecycle: {
          pause: (id) =>
            Effect.fail(
              new CampaignDeliveryMismatch({ campaignId: id, delivery: "once" })
            ),
        },
      }
    );

    expect(error).toBeInstanceOf(CliMutationRejected);
    expect(error).toMatchObject({ code: "campaign-delivery-mismatch" });
  });

  test("passes the run filters from the query and returns each run's contact", async () => {
    const queries: unknown[] = [];
    const run = Schema.decodeUnknownSync(AutomationRunSummary)({
      runId: "01990000-0000-7000-8000-000000000003",
      campaignId,
      versionNumber: 2,
      customerId: "customer-1",
      customerName: "Ana Test",
      customerEmail: testEmailAddress("ana"),
      customerProfileStatus: "found",
      triggerKind: "account-created",
      triggerAt: "2026-10-19T08:00:00Z",
      state: "ended",
      stepId: "send",
      outcome: "skipped",
      outcomeReason: "missing-email",
      startedAt: "2026-10-19T08:00:00Z",
      endedAt: "2026-10-19T08:01:00Z",
    });
    const page = await callAutomationsApi(
      (client) =>
        client.listAutomationRuns({
          params: { campaignId },
          query: {
            state: "ended",
            outcome: "skipped",
            skipReason: "missing-email",
            versionNumber: 2,
            limit: 20,
          },
        }),
      {
        runLog: {
          listRuns: (input) => {
            queries.push(input);
            return Effect.succeed({ runs: [run], nextCursor: null });
          },
        },
      }
    );

    expect(queries).toEqual([
      {
        campaignId,
        state: "ended",
        outcome: "skipped",
        skipReason: "missing-email",
        versionNumber: 2,
        limit: 20,
      },
    ]);
    expect(page.runs).toEqual([run]);
  });

  test("returns the run counts by skip reason", async () => {
    const stats = Schema.decodeUnknownSync(AutomationRunStats)({
      campaignId,
      versionNumber: 2,
      bySkipReason: {
        "missing-from-dotypos": 0,
        "deleted-customer": 0,
        "missing-email": 2,
        "invalid-email": 0,
        "consent-withdrawn": 1,
        "outside-test-domain": 0,
      },
    });
    const requested: unknown[] = [];

    expect(
      await callAutomationsApi(
        (client) =>
          client.getAutomationRunStats({
            params: { campaignId },
            query: { versionNumber: 2 },
          }),
        {
          runLog: {
            getRunStats: (input) => {
              requested.push(input);
              return Effect.succeed(stats);
            },
          },
        }
      )
    ).toEqual(stats);
    expect(requested).toEqual([{ campaignId, versionNumber: 2 }]);
  });

  test("reads one version by the number in its path", async () => {
    const requested: unknown[] = [];
    const error = await callAutomationsApi(
      (client) =>
        client
          .getAutomationVersion({ params: { campaignId, versionNumber: 3 } })
          .pipe(Effect.flip),
      {
        lifecycle: {
          getVersion: (input) => {
            requested.push(input);
            return Effect.fail(new AutomationVersionNotFound(input));
          },
        },
      }
    );

    expect(requested).toEqual([{ campaignId, versionNumber: 3 }]);
    expect(error).toBeInstanceOf(CliResourceNotFound);
    expect(error).toMatchObject({ code: "automation-version-not-found" });
  });

  test("reports a missing run as not found", async () => {
    const runId = AutomationRunId.make("01990000-0000-7000-8000-000000000003");
    const error = await callAutomationsApi(
      (client) =>
        client.getAutomationRun({ params: { runId } }).pipe(Effect.flip),
      {
        runLog: {
          getRun: () => Effect.fail(new AutomationRunNotFound({ runId })),
        },
      }
    );

    expect(error).toBeInstanceOf(CliResourceNotFound);
    expect(error).toMatchObject({ code: "automation-run-not-found" });
  });

  const stalledEngine = {
    engineHealth: {
      get: Effect.succeed(
        Schema.decodeUnknownSync(AutomationEngineHealth)({
          lastPlannedAt: "2026-10-19T08:00:00Z",
          sweepLagSeconds: 3600,
          reconcileLagSeconds: 8160,
          deadlineMisses: 0,
          warnings: [
            "sweep-lagging",
            "reconcile-stalled",
            "synthetic-later-warning",
          ],
        })
      ),
    },
  };
  const everyWarning = [
    "sweep-lagging",
    "reconcile-stalled",
    "synthetic-later-warning",
  ];
  // `AutomationEngineHealth` as dhw 1.24.0 to 1.27.0 decode it: a closed list
  // of warnings, which rejects the whole report on a code it doesn't know.
  const ReleasedAutomationEngineHealth = Schema.Struct({
    warnings: Schema.Array(
      Schema.Literals([
        "planner-stale",
        "sweep-lagging",
        "event-backlog",
        "unit-backlog",
        "schedule-lagging",
        "falling-behind",
      ])
    ),
  });

  test.each(["1.24.0", "1.27.0", "1.28.0-rc.1"])(
    "serves dhw %s engine health without the warnings it can't decode",
    async (dhwVersion) => {
      const health = await callAutomationsApi(
        (client) => client.getAutomationEngineHealth(),
        stalledEngine,
        { dhwVersion }
      );

      expect(health.reconcileLagSeconds).toBe(8160);
      expect(health.warnings).toEqual(["sweep-lagging"]);
      expect(
        Schema.decodeUnknownSync(ReleasedAutomationEngineHealth)(
          Schema.encodeSync(AutomationEngineHealth)(health)
        ).warnings
      ).toEqual(["sweep-lagging"]);
    }
  );

  test.each([openEngineWarningsDhwVersion, "1.28.0+pr.827.ead84a5", "1.29.0"])(
    "serves dhw %s every engine warning",
    async (dhwVersion) => {
      const health = await callAutomationsApi(
        (client) => client.getAutomationEngineHealth(),
        stalledEngine,
        { dhwVersion }
      );

      expect(health.warnings).toEqual(everyWarning);
    }
  );

  test("serves an AI assistant, which sends no version, every engine warning", async () => {
    const health = await callAutomationsApi(
      (client) => client.getAutomationEngineHealth(),
      stalledEngine,
      { dhwVersion: null }
    );

    expect(health.warnings).toEqual(everyWarning);
  });

  test("describes a calendar expression", async () => {
    const preview = await callAutomationsApi((client) =>
      client.previewCalendarExpression({
        payload: {
          expression: { minutes: [0, 30], hours: [10] },
          usage: "trigger",
          locale: "en-US",
        },
      })
    );

    expect(preview.frequency).toEqual({
      maxFiresPerHour: 2,
      firesMoreThanHourly: true,
    });
    expect(preview.nextStarts).toHaveLength(5);
  });
});
