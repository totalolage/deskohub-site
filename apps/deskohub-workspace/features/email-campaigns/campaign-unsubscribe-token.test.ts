import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Option } from "effect";
import type { SignedClaimsKeyRing } from "@/shared/backend/signed-claims";
import type { CampaignSendId } from "./campaign-identifiers";
import {
  type CampaignUnsubscribeRecipient,
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

const sign = (
  keys: SignedClaimsKeyRing,
  signed: CampaignUnsubscribeRecipient = recipient
) => Effect.runSync(signCampaignUnsubscribeToken(keys, signed));
const open = (keys: SignedClaimsKeyRing, token: string) =>
  Effect.runSync(openCampaignUnsubscribeToken(keys, token));

/** A token whose payload is `json`, signed over the bare payload. */
const signedPayload = (json: Buffer | string, key = currentKey) => {
  const payload = Buffer.from(json).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
};

describe("campaign unsubscribe token", () => {
  test("keeps the signed token format", () => {
    expect(sign([currentKey])).toBe(goldenToken);
    expect(sign([previousKey])).toBe(goldenPreviousKeyToken);
    for (const token of [goldenToken, goldenPreviousKeyToken]) {
      expect(open([currentKey, previousKey], token)).toEqual(
        Option.some(recipient)
      );
    }
  });

  test("signs the bare payload, with no purpose prefix", () => {
    expect(sign([currentKey])).toBe(
      signedPayload(JSON.stringify([recipient.sendId, "42"]))
    );
  });

  test("opens to the signed recipient", () => {
    expect(open([currentKey], sign([currentKey]))).toEqual(
      Option.some(recipient)
    );
  });

  test("is the same for the same recipient, so a replayed batch matches", () => {
    expect(sign([currentKey])).toBe(sign([currentKey]));
  });

  test("signs with the first key of the ring", () => {
    expect(sign([currentKey, previousKey])).toBe(goldenToken);
    expect(sign([previousKey, currentKey])).toBe(goldenPreviousKeyToken);
  });

  test("still opens after the signing secret rotates", () => {
    const token = sign([previousKey]);

    expect(open([currentKey, previousKey], token)).toEqual(
      Option.some(recipient)
    );
    expect(open([currentKey], token)).toEqual(Option.none());
  });

  test("rejects a forged, altered, or malformed token", () => {
    const [payload = "", signature = ""] = goldenToken.split(".");
    const [otherPayload] = sign([currentKey], {
      ...recipient,
      dotyposCustomerId: DotyposCustomerIdSchema.make("43"),
    }).split(".");

    for (const candidate of [
      sign([previousKey]),
      `${otherPayload}.${signature}`,
      `${goldenToken}.extra`,
      `${payload}.${signature.slice(0, -1)}`,
      `${payload}.${signature}=`,
      `${payload}=.${signature}`,
      `.${signature}`,
      `${payload}.`,
      "",
      "not-a-token",
    ]) {
      expect(open([currentKey], candidate)).toEqual(Option.none());
    }
  });

  test("rejects signed claims that aren't a recipient", () => {
    for (const json of [
      JSON.stringify(["send-1", "42", "extra"]),
      JSON.stringify(["send-1"]),
      JSON.stringify(["", "42"]),
      JSON.stringify({ sendId: "send-1", dotyposCustomerId: "42" }),
      "not json",
      Buffer.from([0x5b, 0x22, 0xff, 0x22, 0x5d]),
    ]) {
      expect(open([currentKey], signedPayload(json))).toEqual(Option.none());
    }
  });
});
