import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import {
  AdministrationCampaignSendId,
  type AdministrationCampaignSendStatusType,
  OperationNotFound,
} from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import {
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../../campaign-identifiers";
import { stubCampaignPageQueries } from "../campaign-operation-query.test-utils";

const port = stubCampaignPageQueries();

const { loadSentCampaign } = await import("./sent-campaign.server");

const audienceId = campaignAudienceIdSchema.make("audience-sent");

const send: AdministrationCampaignSendStatusType = {
  sendId: AdministrationCampaignSendId.make("send-1"),
  createdAt: "2026-10-03T08:00:00Z",
  completedAt: null,
  audienceId,
  audienceFilter: {
    _tag: "Condition",
    attribute: "locale",
    operator: "anyOf",
    value: ["cs-CZ"],
  },
  counts: {
    pending: 0,
    sent: 0,
    delivered: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
    unconfirmed: 0,
    skipped: 0,
  },
  recipients: [],
};

beforeEach(() => {
  port.invoked.length = 0;
  port.responses = {
    getCampaignSendStatus: Effect.succeed({ send }),
    getCampaignAudience: Effect.succeed({ title: "Czech speakers" }),
  };
});

describe("loadSentCampaign", () => {
  test("reads the send and its audience's current title", async () => {
    const campaignId = campaignIdSchema.make("campaign-sent");
    expect(await loadSentCampaign(campaignId)).toEqual({
      send,
      audienceTitle: "Czech speakers",
    });
    expect(port.invoked).toEqual([
      { name: "getCampaignSendStatus", input: { campaignId } },
      { name: "getCampaignAudience", input: { audienceId } },
    ]);
  });

  test("has no audience title once the audience is deleted", async () => {
    port.responses.getCampaignAudience = Effect.fail(
      new OperationNotFound({
        code: "audience-not-found",
        message: "The audience doesn't exist.",
      })
    );
    expect(
      await loadSentCampaign(campaignIdSchema.make("campaign-deleted-audience"))
    ).toEqual({ send, audienceTitle: null });
  });

  test("reads no audience before the campaign is sent", async () => {
    port.responses.getCampaignSendStatus = Effect.succeed({ send: null });
    expect(
      await loadSentCampaign(campaignIdSchema.make("campaign-unsent"))
    ).toEqual({ send: null, audienceTitle: null });
    expect(port.invoked.map(({ name }) => name)).toEqual([
      "getCampaignSendStatus",
    ]);
  });
});
