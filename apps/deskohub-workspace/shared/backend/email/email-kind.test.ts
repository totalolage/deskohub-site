import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { testEmailAddress } from "@deskohub/test-email";
import { campaignEmailKind } from "@/features/email-campaigns/campaign-email-kind";
import { campaignSendIdSchema } from "@/features/email-campaigns/campaign-identifiers";
import { emailDeliveryReportTags, emailKindTags } from "./email-kind";

const campaignDelivery = emailKindTags(campaignEmailKind, {
  campaignSendId: campaignSendIdSchema.make("send-synthetic"),
  dotyposCustomerId: DotyposCustomerIdSchema.make("customer-synthetic"),
  deploymentEnvironment: "preview",
});

describe("emailDeliveryReportTags", () => {
  test("keeps tags its kind decodes back to the metadata it was sent with", () => {
    const tags = emailDeliveryReportTags([campaignEmailKind], {
      category: campaignEmailKind.category,
      metadata: campaignDelivery.metadata,
    });

    expect(tags).toEqual({
      category: campaignEmailKind.category,
      deploymentEnvironment: "preview",
      campaignSendId: "send-synthetic",
      dotyposCustomerId: "customer-synthetic",
    });
    expect(decodeStandardSchema(campaignEmailKind.metadata, tags)).toEqual({
      campaignSendId: "send-synthetic",
      dotyposCustomerId: "customer-synthetic",
    });
  });

  test("leaves out metadata the kind doesn't declare", () => {
    const tags = emailDeliveryReportTags([campaignEmailKind], {
      category: campaignEmailKind.category,
      metadata: {
        ...campaignDelivery.metadata,
        contactName: "Ada Example",
        contactEmail: testEmailAddress("ada"),
      },
    });

    expect(Object.keys(tags).sort()).toEqual([
      "campaignSendId",
      "category",
      "deploymentEnvironment",
      "dotyposCustomerId",
    ]);
  });

  test.each([
    ["of no listed kind", "synthetic-unlisted-kind", { campaignSendId: "" }],
    [
      "whose metadata its kind rejects",
      campaignEmailKind.category,
      { campaignSendId: "send-synthetic" },
    ],
  ])(
    "keeps only the category and deployment of an email %s",
    (_, category, metadata) => {
      expect(
        emailDeliveryReportTags([campaignEmailKind], {
          category,
          metadata: {
            ...metadata,
            deploymentEnvironment: "preview",
            contactName: "Ada Example",
          },
        })
      ).toEqual({ category, deploymentEnvironment: "preview" });
    }
  );
});
