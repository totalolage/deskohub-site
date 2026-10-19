import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  AdministrationCampaignId,
  AutomationDetail,
  AutomationPreviewId,
  AutomationRunId,
  automationsMinimumDhwVersion,
  CliInputInvalid,
  CliMutationRejected,
  CliResourceNotFound,
  CliSessionUnauthorized,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
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
  CliSessionAdministrator,
  cliClientVersion,
  cliSessionAdministrator,
  GrantedAdministrator,
  UnauthorizedCliRequest,
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

const automationsClient = HttpApiTest.groups(WorkspaceAdminApi, [
  "automations",
]).pipe(Effect.map((client) => client.automations));
type AutomationsClient = Effect.Success<typeof automationsClient>;

const callAutomationsApi = <A, E>(
  call: (client: AutomationsClient) => Effect.Effect<A, E>,
  stubs: AutomationServiceStubs = {},
  options: {
    readonly dhwVersion?: string;
    readonly bearer?: Layer.Layer<never>;
  } = {}
) => {
  const dhwVersion = options.dhwVersion ?? automationsMinimumDhwVersion;
  return automationsClient.pipe(
    Effect.flatMap(call),
    Effect.provide(AdminCliAutomationsApiHandlers),
    Effect.provide(options.bearer ?? authorizedCliRequest(dhwVersion)),
    Effect.provide(CliSessionAdministrator),
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
    Effect.provide(CliClientCompatibilityLive),
    Effect.provide(cliClientVersion(dhwVersion)),
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

  test("refuses a dhw older than the automation commands", async () => {
    const error = await callAutomationsApi(
      (client) =>
        client.getAutomation({ params: { campaignId } }).pipe(Effect.flip),
      { lifecycle: { get: () => Effect.die("not expected") } },
      { dhwVersion: "1.20.0" }
    );

    expect(error).toBeInstanceOf(CliInputInvalid);
    expect(error.message).toContain("dhw update");
  });

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

  test("passes the run filters from the query", async () => {
    const queries: unknown[] = [];
    await callAutomationsApi(
      (client) =>
        client.listAutomationRuns({
          params: { campaignId },
          query: {
            state: "ended",
            outcome: "sent",
            versionNumber: 2,
            limit: 20,
          },
        }),
      {
        runLog: {
          listRuns: (input) => {
            queries.push(input);
            return Effect.succeed({ runs: [], nextCursor: null });
          },
        },
      }
    );

    expect(queries).toEqual([
      {
        campaignId,
        state: "ended",
        outcome: "sent",
        versionNumber: 2,
        limit: 20,
      },
    ]);
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
