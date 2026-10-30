import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Option } from "effect";
import {
  campaignDeliveryMessage,
  campaignEmailKind,
  campaignTestMessage,
} from "./campaign-email-message";
import type { CampaignSendId } from "./campaign-identifiers";

const sender = {
  from: { email: testEmailAddress("campaigns"), name: "Deskohub Workspace" },
  replyTo: { email: testEmailAddress("hello") },
};
const email = { subject: "News", html: "<p>Hi</p>", text: "Hi" };
const recipient = {
  sendId: "send-1" as CampaignSendId,
  dotyposCustomerId: DotyposCustomerIdSchema.make("42"),
};
const unsubscribeUrl =
  "https://workspace.example/api/email-campaigns/unsubscribe?token=t";

describe("campaign delivery message", () => {
  test("carries one-click unsubscribe headers for a marketing email", () => {
    const message = campaignDeliveryMessage({
      sender,
      to: testEmailAddress("ada"),
      email,
      unsubscribeUrl: Option.some(unsubscribeUrl),
      recipient,
      deploymentEnvironment: "production",
    });

    expect(message.headers).toEqual({
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  test("carries no unsubscribe headers for an operational email", () => {
    const message = campaignDeliveryMessage({
      sender,
      to: testEmailAddress("ada"),
      email,
      unsubscribeUrl: Option.none(),
      recipient,
      deploymentEnvironment: "production",
    });

    expect(message.headers).toBeUndefined();
  });

  test("tags the frozen recipient for the delivery-status webhook", () => {
    const message = campaignDeliveryMessage({
      sender,
      to: testEmailAddress("ada"),
      email,
      unsubscribeUrl: Option.none(),
      recipient,
      deploymentEnvironment: "preview",
    });

    expect(message).toMatchObject({
      from: sender.from,
      replyTo: sender.replyTo,
      subject: "News",
      tags: [campaignEmailKind.category],
      metadata: {
        campaignSendId: "send-1",
        dotyposCustomerId: "42",
        deploymentEnvironment: "preview",
      },
    });
  });
});

describe("campaign test message", () => {
  test("marks the subject and carries no delivery tags or headers", () => {
    const message = campaignTestMessage({
      sender,
      to: testEmailAddress("admin"),
      email,
      deploymentEnvironment: "preview",
    });

    expect(message.subject).toBe("[TEST] News");
    expect(message.headers).toBeUndefined();
    expect(message.metadata).toBeUndefined();
    expect(message.tags).not.toContain(campaignEmailKind.category);
    expect(message.sensitiveContent).toBe(false);
  });

  test("keeps the confirmation code out of production provider logs", () => {
    const message = campaignTestMessage({
      sender,
      to: testEmailAddress("admin"),
      email,
      deploymentEnvironment: "production",
    });

    expect(message.sensitiveContent).toBe(true);
  });
});
