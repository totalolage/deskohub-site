import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  campaignDeliveryBatchIdempotencyKey,
  campaignDeliveryPayloadHash,
} from "./campaign-delivery-batches";
import type { CampaignSendId } from "./campaign-identifiers";

const sendId = "send-1" as CampaignSendId;

describe("campaign delivery batches", () => {
  test("hashes equal payloads alike and any change differently", () => {
    const message = {
      from: { email: testEmailAddress("campaigns") },
      to: { email: testEmailAddress("ada") },
      subject: "Novinky",
      html: "<p>Ahoj</p>",
    };
    const hash = campaignDeliveryPayloadHash([message]);

    expect(campaignDeliveryPayloadHash([{ ...message }])).toBe(hash);
    expect(
      new Set([
        hash,
        campaignDeliveryPayloadHash([
          { ...message, to: { email: testEmailAddress("grace") } },
        ]),
        campaignDeliveryPayloadHash([{ ...message, html: "<p>Hi</p>" }]),
        campaignDeliveryPayloadHash([message, message]),
      ]).size
    ).toBe(4);
  });

  test("keys a batch by send, attempt, and index", () => {
    const key = campaignDeliveryBatchIdempotencyKey({
      sendId,
      deliveryAttempt: 1,
      batchIndex: 0,
    });

    expect(
      campaignDeliveryBatchIdempotencyKey({
        sendId,
        deliveryAttempt: 1,
        batchIndex: 0,
      })
    ).toBe(key);
    expect(
      new Set([
        key,
        campaignDeliveryBatchIdempotencyKey({
          sendId,
          deliveryAttempt: 1,
          batchIndex: 1,
        }),
        campaignDeliveryBatchIdempotencyKey({
          sendId,
          deliveryAttempt: 2,
          batchIndex: 0,
        }),
        campaignDeliveryBatchIdempotencyKey({
          sendId: "send-2" as CampaignSendId,
          deliveryAttempt: 1,
          batchIndex: 0,
        }),
      ]).size
    ).toBe(4);
    expect(key.length).toBeLessThanOrEqual(256);
  });
});
