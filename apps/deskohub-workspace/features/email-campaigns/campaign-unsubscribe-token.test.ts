import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Option } from "effect";
import type { CampaignSendId } from "./campaign-identifiers";
import {
  openCampaignUnsubscribeToken,
  signCampaignUnsubscribeToken,
} from "./campaign-unsubscribe-token";

const currentKey = Buffer.alloc(32, 1);
const previousKey = Buffer.alloc(32, 2);
const recipient = {
  sendId: "send-1" as CampaignSendId,
  dotyposCustomerId: DotyposCustomerIdSchema.make("42"),
};

// The tokens this module signs for the recipient under each key today.
// Unsubscribe links in sent emails must keep opening, so the format can't
// change.
const goldenToken =
  "WyJzZW5kLTEiLCI0MiJd.766UFxUziQ368Ko3FdnJpEt3Ws48QDR2IULn2-C1aS4";
const goldenPreviousKeyToken =
  "WyJzZW5kLTEiLCI0MiJd.qjIg7vrg5HqB3qM8x6rCwGTzH2PCVy5C6uvrM5mTX_c";

describe("campaign unsubscribe token", () => {
  test("keeps the signed token format", () => {
    expect(signCampaignUnsubscribeToken(currentKey, recipient)).toBe(
      goldenToken
    );
    expect(signCampaignUnsubscribeToken(previousKey, recipient)).toBe(
      goldenPreviousKeyToken
    );
    for (const token of [goldenToken, goldenPreviousKeyToken]) {
      expect(
        openCampaignUnsubscribeToken([currentKey, previousKey], token)
      ).toEqual(Option.some(recipient));
    }
  });

  test("opens to the signed recipient", () => {
    const token = signCampaignUnsubscribeToken(currentKey, recipient);

    expect(openCampaignUnsubscribeToken([currentKey], token)).toEqual(
      Option.some(recipient)
    );
  });

  test("is the same for the same recipient, so a replayed batch matches", () => {
    expect(signCampaignUnsubscribeToken(currentKey, recipient)).toBe(
      signCampaignUnsubscribeToken(currentKey, recipient)
    );
  });

  test("still opens after the signing secret rotates", () => {
    const token = signCampaignUnsubscribeToken(previousKey, recipient);

    expect(
      openCampaignUnsubscribeToken([currentKey, previousKey], token)
    ).toEqual(Option.some(recipient));
  });

  test("rejects a forged, altered, or malformed token", () => {
    const token = signCampaignUnsubscribeToken(currentKey, recipient);
    const [, signature] = token.split(".");
    const otherRecipient = signCampaignUnsubscribeToken(currentKey, {
      ...recipient,
      dotyposCustomerId: DotyposCustomerIdSchema.make("43"),
    });
    const [otherPayload] = otherRecipient.split(".");

    for (const candidate of [
      signCampaignUnsubscribeToken(previousKey, recipient),
      `${otherPayload}.${signature}`,
      `${token}.extra`,
      "",
      "not-a-token",
    ]) {
      expect(openCampaignUnsubscribeToken([currentKey], candidate)).toEqual(
        Option.none()
      );
    }
  });
});
