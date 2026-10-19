import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type AdministrationCampaignAudienceType,
  type AdministrationCampaignDetailType,
  AdministrationDotyposCustomerId,
  OperationConflict,
  OperationNotFound,
  OperationUnavailable,
} from "@deskohub/workspace-admin-api";
import { Effect, Predicate } from "effect";
import {
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../../campaign-identifiers";
import { stubCampaignPageQueries } from "../campaign-operation-query.test-utils";

const campaignId = campaignIdSchema.make("campaign-preview");
const audienceId = campaignAudienceIdSchema.make("audience-preview");

const draft: AdministrationCampaignDetailType = {
  id: campaignId,
  title: "Autumn news",
  purpose: "marketing",
  templateKey: "workspace",
  delivery: "once",
  status: "draft",
  audienceId,
  locales: ["cs-CZ"],
  createdAt: "2026-10-01T08:00:00Z",
  updatedAt: "2026-10-02T08:00:00Z",
  content: {},
};

const audience: AdministrationCampaignAudienceType = {
  id: audienceId,
  title: "Czech speakers",
  filter: {
    _tag: "Condition",
    attribute: "locale",
    operator: "anyOf",
    value: ["cs-CZ"],
  },
  archivedAt: null,
  createdAt: "2026-10-01T08:00:00Z",
  updatedAt: "2026-10-01T08:00:00Z",
};

const resolution = {
  recipients: [
    {
      customerId: AdministrationDotyposCustomerId.make("101"),
      locale: "cs-CZ",
      email: testEmailAddress("recipient-preview-101"),
    },
  ],
  exclusions: [],
  duplicates: [],
} as const;

const port = stubCampaignPageQueries();

mock.module(
  "@/features/email-campaigns/admin/audiences/audience-value-lookups.server",
  () => ({ loadAudienceValueLookups: async () => ({}) })
);

mock.module("next/root-params", () => ({ locale: async () => "en-US" }));

const { loadRecipientPreview } = await import("./recipient-preview.server");

// The real `redirect` and `notFound` throw errors whose digest names the
// outcome; other test files share the module, so it isn't mocked here.
const previewOutcome = async () => {
  try {
    return {
      kind: "ok" as const,
      value: await loadRecipientPreview(campaignId),
    };
  } catch (signal) {
    const digest = Predicate.hasProperty(signal, "digest")
      ? signal.digest
      : undefined;
    if (!Predicate.isString(digest)) throw signal;
    const redirect = /^NEXT_REDIRECT;\w+;(.*);\d+;$/.exec(digest);
    if (redirect) return { kind: "redirect" as const, location: redirect[1] };
    if (digest === "NEXT_HTTP_ERROR_FALLBACK;404") {
      return { kind: "not-found" as const };
    }
    throw signal;
  }
};

const notFound = (code: string) =>
  Effect.fail(new OperationNotFound({ code, message: code }));

const invokedNames = () => port.invoked.map(({ name }) => name);

beforeEach(() => {
  port.invoked.length = 0;
  port.responses = {
    getCampaign: Effect.succeed(draft),
    getCampaignAudience: Effect.succeed(audience),
    previewCampaignRecipients: Effect.succeed(resolution),
  };
});

describe("loadRecipientPreview", () => {
  test("resolves a Draft's audience through the port", async () => {
    expect(await previewOutcome()).toEqual({
      kind: "ok",
      value: {
        kind: "resolved",
        campaign: draft,
        audienceTitle: "Czech speakers",
        audienceSummary: expect.any(String),
        resolution,
      },
    });
    expect(invokedNames()).toEqual([
      "getCampaign",
      "getCampaignAudience",
      "previewCampaignRecipients",
    ]);
  });

  test("shows the unavailable state when recipients can't be resolved", async () => {
    port.responses.previewCampaignRecipients = Effect.fail(
      new OperationUnavailable({
        code: "recipient-resolution-unavailable",
        message: "Dotypos is unreachable.",
      })
    );
    const outcome = await previewOutcome();
    expect(outcome).toMatchObject({
      kind: "ok",
      value: { kind: "unavailable", audienceTitle: "Czech speakers" },
    });
  });

  test("fails on any other unavailable dependency", async () => {
    port.responses.previewCampaignRecipients = Effect.fail(
      new OperationUnavailable({
        code: "service-unavailable",
        message: "The database is unreachable.",
      })
    );
    await expect(previewOutcome()).rejects.toBeDefined();
  });

  test("shows the no-audience state without resolving recipients", async () => {
    port.responses.getCampaign = Effect.succeed({ ...draft, audienceId: null });
    expect(await previewOutcome()).toEqual({
      kind: "ok",
      value: {
        kind: "no-audience",
        campaign: { ...draft, audienceId: null },
      },
    });
    expect(invokedNames()).toEqual(["getCampaign"]);
  });

  test("treats a deleted audience as no audience", async () => {
    port.responses.getCampaignAudience = notFound("audience-not-found");
    expect(await previewOutcome()).toMatchObject({
      kind: "ok",
      value: { kind: "no-audience" },
    });
  });

  test("treats an audience that went away during resolution as no audience", async () => {
    port.responses.previewCampaignRecipients = Effect.fail(
      new OperationConflict({
        code: "campaign-audience-missing",
        message: "The campaign has no audience. Set one first.",
      })
    );
    expect(await previewOutcome()).toMatchObject({
      kind: "ok",
      value: { kind: "no-audience" },
    });
  });

  test("renders the not-found page for a missing campaign", async () => {
    port.responses.getCampaign = notFound("campaign-not-found");
    expect(await previewOutcome()).toEqual({ kind: "not-found" });
  });

  test("renders the not-found page for an automated campaign", async () => {
    port.responses.getCampaign = Effect.succeed({
      ...draft,
      delivery: "automated",
    });
    expect(await previewOutcome()).toEqual({ kind: "not-found" });
  });

  test("redirects a campaign that left Draft to its campaign page", async () => {
    port.responses.getCampaign = Effect.succeed({ ...draft, status: "sent" });
    expect(await previewOutcome()).toEqual({
      kind: "redirect",
      location: `/en-US/admin/email-campaigns/${campaignId}`,
    });
    expect(invokedNames()).toEqual(["getCampaign"]);
  });
});
