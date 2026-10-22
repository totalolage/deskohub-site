import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { EmailServiceTag } from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationCampaignAudienceId,
  AdministrationCampaignId,
  AdministrationCampaignSendId,
  AdministrationDotyposCustomerId,
  AdministrationLegacyUsername,
  CliInputInvalid,
  CliMutationRejected,
  CliMutationRequestId,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionId,
  CliSessionUnauthorized,
  digestCliAuthenticationSecret,
  makeCliAuthenticationSecret,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeCrypto, NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignAudienceRow,
  type CampaignRow,
  cliSessions,
} from "@/db/schema";
import { CampaignService } from "@/features/email-campaigns/backend/campaign.service";
import { CampaignAudienceService } from "@/features/email-campaigns/backend/campaign-audience.service";
import { CampaignConfirmationCodeService } from "@/features/email-campaigns/backend/campaign-confirmation-code.service";
import {
  CampaignEmailConfig,
  resolveCampaignEmailConfig,
} from "@/features/email-campaigns/backend/campaign-email.config";
import { CampaignOperations } from "@/features/email-campaigns/backend/campaign-operations.service";
import { automationServiceStubs } from "@/features/email-campaigns/backend/campaign-operations.test-utils";
import { CampaignRecipientService } from "@/features/email-campaigns/backend/campaign-recipient.service";
import { CampaignSendService } from "@/features/email-campaigns/backend/campaign-send.service";
import { CampaignSendQueueService } from "@/features/email-campaigns/backend/campaign-send-queue.service";
import { CampaignSendStatusService } from "@/features/email-campaigns/backend/campaign-send-status.service";
import { parseCampaignBodyMarkdown } from "@/features/email-campaigns/body/campaign-body-markdown";
import type { CampaignLocalizedContent } from "@/features/email-campaigns/body/campaign-content";
import {
  CampaignAudienceInUse,
  CampaignAudienceNotFound,
  CampaignConfirmationRejected,
  CampaignFallbackContentMissing,
  CampaignLocaleContentMissing,
  CampaignNotFound,
  CampaignRecipientResolutionError,
  CampaignTestRecipientInvalid,
} from "@/features/email-campaigns/errors";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  authorizedCliRequest,
  ClaimEveryCliMutation,
  cliClientVersion,
  GrantedAdministrator,
  UnauthorizedCliRequest,
  UnrecordedAdministrationActions,
} from "./cli-api.test-utils";
import { CliClientCompatibilityLive } from "./cli-client-version";
import { CliMutationIdempotency } from "./cli-mutation-idempotency.service";
import { AdminCliCampaignsApiHandlers } from "./email-campaigns-api.server";

const campaignId = AdministrationCampaignId.make(
  "01990000-0000-7000-8000-000000000001"
);
const audienceId = AdministrationCampaignAudienceId.make(
  "01990000-0000-7000-8000-000000000002"
);
const customerId = AdministrationDotyposCustomerId.make("1001");
const otherCustomerId = AdministrationDotyposCustomerId.make("1002");
const createdAt = Temporal.Instant.from("2026-10-14T08:00:00Z");
const testDhwVersion = "1.20.0";
const AuthorizedCliRequest = authorizedCliRequest();
const TestDhwVersionHeader = cliClientVersion(testDhwVersion);

const parseBody = (markdown: string) =>
  Effect.runPromise(parseCampaignBodyMarkdown(markdown));

const campaignRow = (overrides: Partial<CampaignRow> = {}): CampaignRow => ({
  id: campaignId,
  title: "October news",
  purpose: "operational",
  templateKey: "workspace",
  content: {},
  audienceId,
  delivery: "once",
  status: "draft",
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const audienceRow = (
  overrides: Partial<CampaignAudienceRow> = {}
): CampaignAudienceRow => ({
  id: audienceId,
  title: "Czech customers",
  filter: {
    attribute: "locale",
    _tag: "Condition",
    operator: "anyOf",
    value: ["cs-CZ"],
  },
  archivedAt: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

type CampaignServiceOverrides = {
  readonly audiences?: Partial<CampaignAudienceService["Service"]>;
  readonly campaigns?: Partial<CampaignService["Service"]>;
  readonly recipients?: Partial<CampaignRecipientService["Service"]>;
  readonly sending?: Partial<CampaignSendService["Service"]>;
  readonly sendStatus?: Partial<CampaignSendStatusService["Service"]>;
  /** Replaces the `sending` stub with a fully built send service. */
  readonly sendingLayer?: Layer.Layer<CampaignSendService>;
};

const campaignServices = (overrides: CampaignServiceOverrides) =>
  Layer.mergeAll(
    Layer.succeed(CampaignAudienceService, {
      ...({} as CampaignAudienceService["Service"]),
      ...overrides.audiences,
    }),
    Layer.succeed(CampaignService, {
      ...({} as CampaignService["Service"]),
      ...overrides.campaigns,
    }),
    Layer.succeed(CampaignRecipientService, {
      ...({} as CampaignRecipientService["Service"]),
      ...overrides.recipients,
    }),
    overrides.sendingLayer ??
      Layer.succeed(CampaignSendService, {
        ...({} as CampaignSendService["Service"]),
        ...overrides.sending,
      }),
    Layer.succeed(CampaignSendStatusService, {
      ...({} as CampaignSendStatusService["Service"]),
      ...overrides.sendStatus,
    }),
    automationServiceStubs()
  );

const mutationRequestId = (n: number) =>
  CliMutationRequestId.make(
    `01990000-0000-7000-8000-${n.toString().padStart(12, "0")}`
  );

const campaignsClient = HttpApiTest.groups(WorkspaceAdminApi, [
  "campaigns",
]).pipe(Effect.map((client) => client.campaigns));
type CampaignsClient = Effect.Success<typeof campaignsClient>;

const callCampaignsApi = <A, E>(
  call: (client: CampaignsClient) => Effect.Effect<A, E>,
  overrides: CampaignServiceOverrides = {},
  bearer = AuthorizedCliRequest
) =>
  campaignsClient.pipe(
    Effect.flatMap(call),
    Effect.provide(AdminCliCampaignsApiHandlers),
    Effect.provide(bearer),
    Effect.provide(
      CampaignOperations.Default.pipe(
        Layer.provide(
          Layer.mergeAll(campaignServices(overrides), GrantedAdministrator)
        )
      )
    ),
    Effect.provide(ClaimEveryCliMutation),
    Effect.provide(CliClientCompatibilityLive),
    Effect.provide(UnrecordedAdministrationActions),
    Effect.provide(TestDhwVersionHeader),
    Effect.provide(NodeHttpServer.layerHttpServices),
    Effect.scoped,
    Effect.runPromise
  );

describe("campaign admin API", () => {
  test("reports the deployment's admin inbox as the test-send inbox", async () => {
    const config = await Effect.runPromise(
      CampaignEmailConfig.pipe(Effect.provide(CampaignEmailConfig.Default))
    );

    const settings = await callCampaignsApi((client) =>
      client.getCampaignSettings({})
    );

    expect(settings).toEqual({ testSendInbox: config.adminInbox });
  });

  test("rejects a request without a valid CLI session before any service runs", async () => {
    const calls: string[] = [];
    const error = await callCampaignsApi(
      (client) =>
        client
          .sendCampaign({
            params: { campaignId },
            payload: { confirmationCode: "ABC123" },
          })
          .pipe(Effect.flip),
      {
        sending: {
          send: () => {
            calls.push("send");
            return Effect.die("not expected");
          },
        },
      },
      UnauthorizedCliRequest
    );

    expect(error).toBeInstanceOf(CliSessionUnauthorized);
    expect(calls).toEqual([]);
  });

  test("creates a campaign from per-locale Markdown and exports it back", async () => {
    const created: CampaignLocalizedContent[] = [];
    const detail = await callCampaignsApi(
      (client) =>
        client.createCampaign({
          payload: {
            requestId: mutationRequestId(1),
            campaign: {
              title: "October news",
              purpose: "operational",
              templateKey: "workspace",
              audienceId,
              content: {
                "cs-CZ": {
                  subject: "Novinky",
                  preheader: "Co je nového",
                  bodyMarkdown:
                    "# Novinky\n\nOtevíráme **novou** zasedačku.\n\n[[button: Rezervovat](https://workspace.deskohub.cz/cs-CZ/meeting-room)]",
                  operationalReason: "Máte u nás rezervaci.",
                },
              },
            },
          },
        }),
      {
        campaigns: {
          create: (input) => {
            created.push(input.content);
            return Effect.succeed(
              campaignRow({
                title: input.title,
                audienceId: input.audienceId,
                content: input.content,
              })
            );
          },
        },
      }
    );

    expect(created).toHaveLength(1);
    expect(created[0]?.["cs-CZ"]?.body.formatVersion).toBe(1);
    expect(created[0]?.["en-US"]).toBeUndefined();
    expect(detail.title).toBe("October news");
    expect(detail.locales).toEqual(["cs-CZ"]);
    expect(detail.content["cs-CZ"]).toMatchObject({
      subject: "Novinky",
      preheader: "Co je nového",
      operationalReason: "Máte u nás rezervaci.",
    });
    expect(detail.content["cs-CZ"]?.bodyMarkdown).toContain("# Novinky");
    expect(detail.content["cs-CZ"]?.bodyMarkdown).toContain("**novou**");
    expect(detail.content["cs-CZ"]?.bodyMarkdown).toContain(
      "[[button: Rezervovat](https://workspace.deskohub.cz/cs-CZ/meeting-room)]"
    );
  });

  test("reports invalid Markdown with its locale and saves nothing", async () => {
    const calls: string[] = [];
    const error = await callCampaignsApi(
      (client) =>
        client
          .createCampaign({
            payload: {
              requestId: mutationRequestId(2),
              campaign: {
                title: "October news",
                purpose: "marketing",
                templateKey: "workspace",
                audienceId: null,
                content: {
                  "en-US": {
                    subject: "News",
                    preheader: "",
                    bodyMarkdown: "[[button: Go](http://deskohub.cz)]",
                  },
                },
              },
            },
          })
          .pipe(Effect.flip),
      {
        campaigns: {
          create: () => {
            calls.push("create");
            return Effect.die("not expected");
          },
        },
      }
    );

    expect(error).toBeInstanceOf(CliInputInvalid);
    expect(error.message).toStartWith(
      "The en-US body isn't valid campaign Markdown:"
    );
    expect(calls).toEqual([]);
  });

  test("passes a campaign edit to the campaign service whole", async () => {
    const patches: unknown[] = [];
    const payload = {
      title: "Renamed",
      content: {
        "cs-CZ": { subject: "Nový předmět", operationalReason: null },
        "en-US": null,
      },
    };
    await callCampaignsApi(
      (client) => client.updateCampaign({ params: { campaignId }, payload }),
      {
        campaigns: {
          patch: (input) => {
            patches.push(input);
            return Effect.succeed(campaignRow({ title: "Renamed" }));
          },
        },
      }
    );

    expect(patches).toEqual([{ campaignId, ...payload }]);
  });

  test("requires a subject and a body for a locale the campaign lacks", async () => {
    const error = await callCampaignsApi(
      (client) =>
        client
          .updateCampaign({
            params: { campaignId },
            payload: { content: { "en-US": { subject: "Subject" } } },
          })
          .pipe(Effect.flip),
      {
        campaigns: {
          patch: () =>
            Effect.fail(
              new CampaignLocaleContentMissing({ campaignId, locale: "en-US" })
            ),
        },
      }
    );

    expect(error).toBeInstanceOf(CliInputInvalid);
    expect(error).toMatchObject({
      code: "content-locale-missing",
      message:
        "The campaign has no en-US content yet, so it needs a subject and a body.",
    });
  });

  test("passes the confirmation code to the send and explains a rejected code", async () => {
    const sends: unknown[] = [];
    const sendWith = (reason: CampaignConfirmationRejected["reason"] | null) =>
      callCampaignsApi(
        (client) =>
          client
            .sendCampaign({
              params: { campaignId },
              payload: { confirmationCode: "ABC123" },
            })
            .pipe(Effect.result),
        {
          sending: {
            send: (input) => {
              sends.push(input);
              return reason === null
                ? Effect.succeed({
                    sendId: AdministrationCampaignSendId.make("send-1"),
                    recipientCount: 3,
                  })
                : Effect.fail(
                    new CampaignConfirmationRejected({ campaignId, reason })
                  );
            },
          },
        }
      );

    const sent = await sendWith(null);
    const expired = await sendWith("expired");

    expect(sends).toEqual([
      { campaignId, confirmationCode: "ABC123" },
      { campaignId, confirmationCode: "ABC123" },
    ]);
    expect(sent).toMatchObject({
      _tag: "Success",
      success: { sendId: "send-1", recipientCount: 3 },
    });
    expect(expired).toMatchObject({ _tag: "Failure" });
    const failure = expired._tag === "Failure" ? expired.failure : null;
    expect(failure).toBeInstanceOf(CliMutationRejected);
    expect(failure?.message).toBe(
      "The confirmation code expired. Run a new test send."
    );
  });

  test("previews the recipients of the campaign's audience", async () => {
    const resolutions: unknown[] = [];
    const preview = await callCampaignsApi(
      (client) => client.previewCampaignRecipients({ params: { campaignId } }),
      {
        campaigns: {
          get: () => Effect.succeed(campaignRow({ purpose: "marketing" })),
        },
        audiences: { get: () => Effect.succeed(audienceRow()) },
        recipients: {
          resolve: (input) => {
            resolutions.push(input);
            return Effect.succeed({
              recipients: [
                {
                  dotyposCustomerId: customerId,
                  locale: "cs-CZ",
                  email: testEmailAddress("campaign-recipient"),
                },
              ],
              exclusions: [
                { dotyposCustomerId: otherCustomerId, reason: "missing-email" },
              ],
              duplicates: [],
            });
          },
        },
      }
    );

    expect(resolutions).toEqual([
      { purpose: "marketing", filter: audienceRow().filter },
    ]);
    expect(preview).toEqual({
      recipients: [
        {
          customerId,
          locale: "cs-CZ",
          email: testEmailAddress("campaign-recipient"),
        },
      ],
      exclusions: [{ customerId: otherCustomerId, reason: "missing-email" }],
      duplicates: [],
    });
  });

  test("refuses a recipient preview without an audience and retries a failed resolution", async () => {
    const withoutAudience = await callCampaignsApi(
      (client) =>
        client
          .previewCampaignRecipients({ params: { campaignId } })
          .pipe(Effect.flip),
      {
        campaigns: {
          get: () => Effect.succeed(campaignRow({ audienceId: null })),
        },
      }
    );
    const unavailable = await callCampaignsApi(
      (client) =>
        client
          .previewCampaignRecipients({ params: { campaignId } })
          .pipe(Effect.flip),
      {
        campaigns: { get: () => Effect.succeed(campaignRow()) },
        audiences: { get: () => Effect.succeed(audienceRow()) },
        recipients: {
          resolve: () =>
            Effect.fail(
              CampaignRecipientResolutionError.dotypos(new Error("timeout"))
            ),
        },
      }
    );

    expect(withoutAudience).toBeInstanceOf(CliMutationRejected);
    expect(unavailable).toBeInstanceOf(CliServiceUnavailable);
    expect(unavailable.message).toContain("Dotypos API");
  });

  test("test-sends to extra recipients and rejects an invalid address", async () => {
    const testSends: unknown[] = [];
    const extraRecipient = testEmailAddress("campaign-test");
    const result = await callCampaignsApi(
      (client) =>
        client.testSendCampaign({
          params: { campaignId },
          payload: { recipients: [extraRecipient] },
        }),
      {
        sending: {
          testSend: (input) => {
            testSends.push(input);
            return Effect.succeed({
              recipients: [testEmailAddress("admin-inbox"), extraRecipient],
              locales: ["cs-CZ"],
              codeExpiresAt: Temporal.Instant.from("2026-10-15T08:00:00Z"),
            });
          },
        },
      }
    );
    const invalid = await callCampaignsApi(
      (client) =>
        client
          .testSendCampaign({
            params: { campaignId },
            payload: { recipients: ["not-an-address"] },
          })
          .pipe(Effect.flip),
      {
        sending: {
          testSend: () =>
            Effect.fail(
              new CampaignTestRecipientInvalid({ email: "not-an-address" })
            ),
        },
      }
    );

    expect(testSends).toEqual([
      { campaignId, extraRecipients: [extraRecipient] },
    ]);
    expect(result).toEqual({
      recipients: [testEmailAddress("admin-inbox"), extraRecipient],
      locales: ["cs-CZ"],
      codeExpiresAt: "2026-10-15T08:00:00Z",
    });
    expect(invalid).toBeInstanceOf(CliInputInvalid);
  });

  test("reports the send status, or none before the send", async () => {
    const notSent = await callCampaignsApi(
      (client) => client.getCampaignSendStatus({ params: { campaignId } }),
      { sendStatus: { get: () => Effect.succeed(Option.none()) } }
    );
    const sent = await callCampaignsApi(
      (client) => client.getCampaignSendStatus({ params: { campaignId } }),
      {
        sendStatus: {
          get: () =>
            Effect.succeed(
              Option.some({
                sendId: AdministrationCampaignSendId.make("send-1"),
                createdAt,
                completedAt: null,
                audienceId,
                audienceFilter: audienceRow().filter,
                counts: {
                  pending: 0,
                  sent: 0,
                  delivered: 1,
                  bounced: 0,
                  complained: 0,
                  failed: 0,
                  unconfirmed: 1,
                  skipped: 1,
                },
                recipients: [
                  {
                    dotyposCustomerId: customerId,
                    locale: "cs-CZ",
                    status: "delivered",
                    skipReason: null,
                    statusUpdatedAt: createdAt,
                  },
                  {
                    dotyposCustomerId: otherCustomerId,
                    locale: "en-US",
                    status: "skipped",
                    skipReason: "consent-withdrawn",
                    statusUpdatedAt: createdAt,
                  },
                ],
              })
            ),
        },
      }
    );

    expect(notSent).toEqual({ send: null });
    expect(sent.send).toMatchObject({
      sendId: "send-1",
      createdAt: "2026-10-14T08:00:00Z",
      completedAt: null,
      counts: { delivered: 1, unconfirmed: 1, skipped: 1 },
      recipients: [
        {
          customerId,
          locale: "cs-CZ",
          status: "delivered",
          skipReason: null,
          statusUpdatedAt: "2026-10-14T08:00:00Z",
        },
        {
          customerId: otherCustomerId,
          locale: "en-US",
          status: "skipped",
          skipReason: "consent-withdrawn",
          statusUpdatedAt: "2026-10-14T08:00:00Z",
        },
      ],
    });
  });

  test("explains that English-only content can't reach Czech fallback recipients", async () => {
    const result = await callCampaignsApi(
      (client) =>
        client
          .sendCampaign({
            params: { campaignId },
            payload: { confirmationCode: "ABC123" },
          })
          .pipe(Effect.flip),
      {
        sending: {
          send: () =>
            Effect.fail(new CampaignFallbackContentMissing({ campaignId })),
        },
      }
    );

    expect(result).toBeInstanceOf(CliMutationRejected);
    expect(result.message).toContain("add Czech (cs-CZ) content");
  });

  test("keeps other endpoints and the send status working when production campaign email isn't configured", async () => {
    const UnconfiguredCampaignSending = CampaignSendService.perOperation(
      CampaignSendService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.effect(
              CampaignEmailConfig,
              resolveCampaignEmailConfig({
                deploymentEnvironment: "production",
                EMAIL_CAMPAIGN_FROM: undefined,
                EMAIL_CAMPAIGN_REPLY_TO: undefined,
                EMAIL_CAMPAIGN_ADMIN_INBOX: undefined,
              })
            ),
            Layer.mock(WorkspaceDatabase, {}),
            Layer.mock(CampaignService, {}),
            Layer.mock(CampaignAudienceService, {}),
            Layer.mock(CampaignRecipientService, {}),
            Layer.mock(CampaignConfirmationCodeService, {}),
            Layer.mock(CampaignSendQueueService, {}),
            Layer.mock(EmailServiceTag, {})
          )
        )
      )
    );
    const call = <A, E>(
      request: (client: CampaignsClient) => Effect.Effect<A, E>
    ) =>
      callCampaignsApi((client) => request(client).pipe(Effect.result), {
        sendingLayer: UnconfiguredCampaignSending,
        campaigns: { list: Effect.succeed([campaignRow()]) },
        sendStatus: { get: () => Effect.succeed(Option.none()) },
      });

    const listed = await call((client) => client.listCampaigns());
    const status = await call((client) =>
      client.getCampaignSendStatus({ params: { campaignId } })
    );
    const sendingFailures = await Promise.all([
      call((client) =>
        client.testSendCampaign({
          params: { campaignId },
          payload: { recipients: [] },
        })
      ),
      call((client) =>
        client.sendCampaign({
          params: { campaignId },
          payload: { confirmationCode: "ABC123" },
        })
      ),
      call((client) =>
        client.retryCampaign({
          params: { campaignId },
          payload: { includeUnconfirmed: false },
        })
      ),
    ]);

    expect(listed).toMatchObject({ _tag: "Success" });
    expect(status).toMatchObject({ _tag: "Success", success: { send: null } });
    for (const result of sendingFailures) {
      expect(result._tag).toBe("Failure");
      const failure = result._tag === "Failure" ? result.failure : null;
      expect(failure).toBeInstanceOf(CliServiceUnavailable);
      expect(failure?.message).toContain(
        "Campaign email isn't configured for this deployment"
      );
      expect(failure?.message).toContain("EMAIL_CAMPAIGN_ADMIN_INBOX");
    }
  });

  test("keeps an audience that drafts use and names those drafts", async () => {
    const error = await callCampaignsApi(
      (client) =>
        client
          .deleteCampaignAudience({ params: { audienceId } })
          .pipe(Effect.flip),
      {
        audiences: {
          delete: () =>
            Effect.fail(
              new CampaignAudienceInUse({
                audienceId,
                draftCampaignIds: [campaignId],
              })
            ),
        },
      }
    );

    expect(error).toBeInstanceOf(CliMutationRejected);
    expect(error.message).toContain(campaignId);
  });

  test("validates an audience filter with the domain schema before saving it", async () => {
    const created: unknown[] = [];
    const filter = {
      _tag: "Group",
      operator: "and",
      filters: [
        {
          attribute: "reservationCount",
          _tag: "Condition",
          params: {
            dateBasis: "visit",
            period: { _tag: "Onward", date: "2026-01-01" },
          },
          operator: "gt",
          value: 0,
        },
        {
          attribute: "hasAccount",
          _tag: "Condition",
          operator: "is",
          value: true,
        },
      ],
    } as const;
    const audience = await callCampaignsApi(
      (client) =>
        client.createCampaignAudience({
          payload: {
            requestId: mutationRequestId(3),
            audience: { title: "Members", filter },
          },
        }),
      {
        audiences: {
          create: (input) => {
            created.push(input);
            return Effect.succeed(audienceRow(input));
          },
        },
      }
    );

    expect(created).toEqual([{ title: "Members", filter }]);
    expect(audience).toMatchObject({
      id: audienceId,
      title: "Members",
      filter,
      archivedAt: null,
      createdAt: "2026-10-14T08:00:00Z",
    });
  });

  test("renders a template preview from Markdown or from a saved campaign", async () => {
    const czechBody = await parseBody("Text kampaně");
    const preview = await callCampaignsApi((client) =>
      client.previewCampaignTemplate({
        params: { templateKey: "workspace" },
        payload: {
          _tag: "Content",
          purpose: "operational",
          locale: "en-US",
          content: {
            subject: "Preview subject",
            preheader: "",
            bodyMarkdown: "Hello **there**",
            operationalReason: "You booked a desk with us.",
          },
        },
      })
    );
    const missingLocale = await callCampaignsApi(
      (client) =>
        client
          .previewCampaignTemplate({
            params: { templateKey: "workspace" },
            payload: { _tag: "Campaign", campaignId, locale: "en-US" },
          })
          .pipe(Effect.flip),
      {
        campaigns: {
          get: () =>
            Effect.succeed(
              campaignRow({
                content: {
                  "cs-CZ": {
                    subject: "Předmět",
                    preheader: "",
                    body: czechBody,
                  },
                },
              })
            ),
        },
      }
    );
    const missingCampaign = await callCampaignsApi(
      (client) =>
        client
          .previewCampaignTemplate({
            params: { templateKey: "workspace" },
            payload: { _tag: "Campaign", campaignId, locale: "cs-CZ" },
          })
          .pipe(Effect.flip),
      {
        campaigns: {
          get: () => Effect.fail(new CampaignNotFound({ campaignId })),
        },
      }
    );

    expect(preview.subject).toBe("Preview subject");
    expect(preview.html).toContain("<strong>there</strong>");
    expect(preview.html).toContain("You booked a desk with us.");
    expect(preview.text).toContain("Hello");
    expect(missingLocale).toBeInstanceOf(CliInputInvalid);
    expect(missingCampaign).toBeInstanceOf(CliResourceNotFound);
  });

  test("retries unconfirmed recipients only when asked", async () => {
    const retried: unknown[] = [];
    const retry = (includeUnconfirmed: boolean) =>
      callCampaignsApi(
        (client) =>
          client.retryCampaign({
            params: { campaignId },
            payload: { includeUnconfirmed },
          }),
        {
          sending: {
            retryUndelivered: (input) => {
              retried.push(input);
              return Effect.succeed({
                sendId: AdministrationCampaignSendId.make("send-1"),
                retriedCount: 2,
              });
            },
          },
        }
      );

    expect((await retry(false)).retriedCount).toBe(2);
    await retry(true);

    expect(retried).toEqual([
      { campaignId, includeUnconfirmed: false },
      { campaignId, includeUnconfirmed: true },
    ]);
  });

  test("unarchives an audience, or reports it missing", async () => {
    const unarchived = await callCampaignsApi(
      (client) => client.unarchiveCampaignAudience({ params: { audienceId } }),
      { audiences: { unarchive: () => Effect.succeed(audienceRow()) } }
    );
    const missing = await callCampaignsApi(
      (client) =>
        client
          .unarchiveCampaignAudience({ params: { audienceId } })
          .pipe(Effect.flip),
      {
        audiences: {
          unarchive: () =>
            Effect.fail(new CampaignAudienceNotFound({ audienceId })),
        },
      }
    );

    expect(unarchived).toMatchObject({ id: audienceId, archivedAt: null });
    expect(missing).toBeInstanceOf(CliResourceNotFound);
  });
});

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "campaign creations on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const sessionId = CliSessionId.make(crypto.randomUUID());
    const titlePrefix = `Ledger ${crypto.randomUUID()}`;

    afterAll(async () => {
      // Deleting the session deletes its mutation requests.
      await testDatabase.pool.query("delete from cli_sessions where id = $1", [
        sessionId,
      ]);
      await testDatabase.pool.query(
        "delete from email_campaigns where title like $1",
        [`${titlePrefix}%`]
      );
      await testDatabase.pool.query(
        "delete from email_campaign_audiences where title like $1",
        [`${titlePrefix}%`]
      );
    });

    const seedSession = Effect.gen(function* () {
      const tokenHash = yield* makeCliAuthenticationSecret().pipe(
        Effect.flatMap(digestCliAuthenticationSecret)
      );
      yield* testDatabase.db.insert(cliSessions).values({
        id: sessionId,
        approvedBy: AdministrationLegacyUsername.make("operator"),
        tokenHash,
        clientName: "ledger test client",
        cliVersion: testDhwVersion,
        buildTarget: "development",
        createdAt: createdAt,
        lastUsedAt: createdAt,
      });
    });
    beforeAll(() =>
      Effect.runPromise(seedSession.pipe(Effect.provide(NodeCrypto.layer)))
    );

    const SeededSessionRequest = authorizedCliRequest(sessionId);

    const callWithLedger = <A, E>(
      call: (client: CampaignsClient) => Effect.Effect<A, E>
    ) =>
      campaignsClient.pipe(
        Effect.flatMap(call),
        Effect.provide(AdminCliCampaignsApiHandlers),
        Effect.provide(SeededSessionRequest),
        Effect.provide(CampaignOperations.Default),
        Effect.provide(
          Layer.mergeAll(
            GrantedAdministrator,
            automationServiceStubs(),
            CampaignService.Default,
            CampaignAudienceService.Default,
            CliMutationIdempotency.Default,
            Layer.succeed(
              CampaignRecipientService,
              {} as CampaignRecipientService["Service"]
            ),
            // The one-off guards refuse before sending touches its other
            // capabilities, so they are unimplemented mocks.
            CampaignSendService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  CampaignService.Default,
                  Layer.mock(CampaignAudienceService, {}),
                  Layer.mock(CampaignRecipientService, {}),
                  Layer.mock(CampaignConfirmationCodeService, {}),
                  Layer.mock(CampaignEmailConfig, {}),
                  Layer.mock(EmailServiceTag, {}),
                  Layer.mock(CampaignSendQueueService, {})
                )
              )
            ),
            Layer.succeed(
              CampaignSendStatusService,
              {} as CampaignSendStatusService["Service"]
            )
          ).pipe(Layer.provide(testDatabase.layer))
        ),
        Effect.provide(CliClientCompatibilityLive),
        Effect.provide(UnrecordedAdministrationActions),
        Effect.provide(TestDhwVersionHeader),
        Effect.provide(NodeHttpServer.layerHttpServices),
        Effect.scoped,
        Effect.runPromise
      );

    const countRows = async (table: string, title: string) => {
      const result = (await testDatabase.pool.query(
        `select count(*)::int as count from ${table} where title like $1`,
        [`%${title}%`]
      )) as { rows: Array<{ count: number }> };
      return result.rows[0]?.count;
    };

    const campaignInput = (title: string, bodyMarkdown = "# Ahoj") => ({
      title,
      purpose: "operational" as const,
      templateKey: "workspace" as const,
      audienceId: null,
      content: {
        "cs-CZ": { subject: "Novinky", preheader: "", bodyMarkdown },
      },
    });

    test("replays a retried campaign creation without another draft", async () => {
      const title = `${titlePrefix} create`;
      const requestId = CliMutationRequestId.make(crypto.randomUUID());
      const create = () =>
        callWithLedger((client) =>
          client.createCampaign({
            payload: { requestId, campaign: campaignInput(title) },
          })
        );

      const first = await create();
      const retried = await create();

      expect(retried).toEqual(first);
      expect(await countRows("email_campaigns", title)).toBe(1);

      const reused = await callWithLedger((client) =>
        client
          .createCampaign({
            payload: {
              requestId,
              campaign: campaignInput(`${title} changed`),
            },
          })
          .pipe(Effect.flip)
      );
      expect(reused).toBeInstanceOf(CliMutationRejected);
      expect(await countRows("email_campaigns", title)).toBe(1);
    });

    test("frees the request ID of a creation it rejected", async () => {
      const title = `${titlePrefix} corrected`;
      const requestId = CliMutationRequestId.make(crypto.randomUUID());

      const rejected = await callWithLedger((client) =>
        client
          .createCampaign({
            payload: {
              requestId,
              campaign: campaignInput(title, "[[button: Go](http://x.cz)]"),
            },
          })
          .pipe(Effect.flip)
      );
      const corrected = await callWithLedger((client) =>
        client.createCampaign({
          payload: { requestId, campaign: campaignInput(title) },
        })
      );

      expect(rejected).toBeInstanceOf(CliInputInvalid);
      expect(corrected.title).toBe(title);
      expect(await countRows("email_campaigns", title)).toBe(1);
    });

    test("replays a retried duplication without another draft", async () => {
      const title = `${titlePrefix} duplicate`;
      const source = await callWithLedger((client) =>
        client.createCampaign({
          payload: {
            requestId: CliMutationRequestId.make(crypto.randomUUID()),
            campaign: campaignInput(title),
          },
        })
      );
      const requestId = CliMutationRequestId.make(crypto.randomUUID());
      const duplicate = () =>
        callWithLedger((client) =>
          client.duplicateCampaign({
            params: { campaignId: source.id },
            payload: { requestId },
          })
        );

      const first = await duplicate();
      const retried = await duplicate();

      expect(first.id).not.toBe(source.id);
      expect(retried).toEqual(first);
      expect(await countRows("email_campaigns", title)).toBe(2);

      await callWithLedger((client) =>
        client.duplicateCampaign({
          params: { campaignId: source.id },
          payload: {
            requestId: CliMutationRequestId.make(crypto.randomUUID()),
          },
        })
      );
      expect(await countRows("email_campaigns", title)).toBe(3);
    });

    test("refuses one-off sending operations on an automated campaign with a conflict", async () => {
      // Nothing writes automated campaigns yet, so the test inserts them by SQL.
      const title = `${titlePrefix} automated`;
      for (const status of ["draft", "active", "paused", "archived"] as const) {
        const { rows } = await testDatabase.pool.query<{
          id: AdministrationCampaignId;
        }>(
          `insert into email_campaigns (title, purpose, template_key, delivery, status)
           values ($1, 'marketing', 'workspace', 'automated', $2)
           returning id`,
          [title, status]
        );
        const params = { campaignId: rows[0]!.id };
        // Edits, deletion and duplication follow the automation lifecycle
        // (campaign.service.postgres.test.ts); only sending is one-off.
        const operations = [
          (client: CampaignsClient) =>
            client.testSendCampaign({ params, payload: { recipients: [] } }),
          (client: CampaignsClient) =>
            client.sendCampaign({
              params,
              payload: { confirmationCode: "ABCD-EFGH" },
            }),
          (client: CampaignsClient) =>
            client.retryCampaign({
              params,
              payload: { includeUnconfirmed: false },
            }),
        ];
        for (const operation of operations) {
          const failure = await callWithLedger((client) =>
            operation(client).pipe(Effect.flip)
          );
          expect(failure).toBeInstanceOf(CliMutationRejected);
          expect(failure).toMatchObject({ code: "campaign-delivery-mismatch" });
          expect(failure.message).toContain("sends automatically");
        }
      }

      const { rows } = await testDatabase.pool.query(
        "select title, status from email_campaigns where title like $1 order by status",
        [`${title}%`]
      );
      expect(rows).toEqual(
        ["active", "archived", "draft", "paused"].map((status) => ({
          title,
          status,
        }))
      );
    });

    test("replays a retried audience creation without another audience", async () => {
      const title = `${titlePrefix} audience`;
      const requestId = CliMutationRequestId.make(crypto.randomUUID());
      const create = () =>
        callWithLedger((client) =>
          client.createCampaignAudience({
            payload: {
              requestId,
              audience: {
                title,
                filter: {
                  attribute: "locale",
                  _tag: "Condition",
                  operator: "anyOf",
                  value: ["cs-CZ"],
                },
              },
            },
          })
        );

      const first = await create();
      const retried = await create();

      expect(retried).toEqual(first);
      expect(await countRows("email_campaign_audiences", title)).toBe(1);
    });

    test("rejects an automation-only audience filter as invalid input", async () => {
      const title = `${titlePrefix} trigger window`;
      const rejected = await callWithLedger((client) =>
        client
          .createCampaignAudience({
            payload: {
              requestId: CliMutationRequestId.make(crypto.randomUUID()),
              audience: {
                title,
                filter: {
                  attribute: "reservationCount",
                  _tag: "Condition",
                  params: {
                    dateBasis: "visit",
                    period: {
                      _tag: "TriggerWindow",
                      side: "before",
                      count: 7,
                      unit: "day",
                    },
                  },
                  operator: "gt",
                  value: 0,
                },
              },
            },
          })
          .pipe(Effect.flip)
      );

      expect(rejected).toBeInstanceOf(CliInputInvalid);
      expect(rejected.message).toBe(
        "The audience filter uses TriggerWindow periods, which only automation conditions can use."
      );
      expect(await countRows("email_campaign_audiences", title)).toBe(0);
    });

    test("creates an audience with first visit and a specific campaign filter", async () => {
      const sourceTitle = `${titlePrefix} specific source`;
      const source = await callWithLedger((client) =>
        client.createCampaign({
          payload: {
            requestId: CliMutationRequestId.make(crypto.randomUUID()),
            campaign: campaignInput(sourceTitle),
          },
        })
      );
      const title = `${titlePrefix} specific audience`;
      const filter = {
        _tag: "Group" as const,
        operator: "and" as const,
        filters: [
          {
            attribute: "firstVisit" as const,
            _tag: "Condition" as const,
            operator: "none" as const,
          },
          {
            attribute: "campaignEmailCount" as const,
            _tag: "Condition" as const,
            params: {
              purpose: "any" as const,
              period: { _tag: "AnyTime" as const },
              campaign: { _tag: "Specific" as const, campaignId: source.id },
            },
            operator: "eq" as const,
            value: 0,
          },
        ],
      };
      const audience = await callWithLedger((client) =>
        client.createCampaignAudience({
          payload: {
            requestId: CliMutationRequestId.make(crypto.randomUUID()),
            audience: { title, filter },
          },
        })
      );

      expect(audience.filter).toEqual(filter);
      expect(await countRows("email_campaign_audiences", title)).toBe(1);
    });

    test("rejects an audience filter that names an unknown campaign", async () => {
      const unknownCampaignId = AdministrationCampaignId.make(
        crypto.randomUUID()
      );
      const title = `${titlePrefix} unknown campaign`;
      const rejected = await callWithLedger((client) =>
        client
          .createCampaignAudience({
            payload: {
              requestId: CliMutationRequestId.make(crypto.randomUUID()),
              audience: {
                title,
                filter: {
                  attribute: "campaignEmailCount",
                  _tag: "Condition",
                  params: {
                    purpose: "any",
                    period: { _tag: "AnyTime" },
                    campaign: {
                      _tag: "Specific",
                      campaignId: unknownCampaignId,
                    },
                  },
                  operator: "eq",
                  value: 0,
                },
              },
            },
          })
          .pipe(Effect.flip)
      );

      expect(rejected).toBeInstanceOf(CliInputInvalid);
      expect(rejected.message).toBe(
        `The audience filter counts emails of campaigns that don't exist (${unknownCampaignId}).`
      );
      expect(await countRows("email_campaign_audiences", title)).toBe(0);
    });
  }
);
