import { describe, expect, test } from "bun:test";
import { addRedaction } from "../runtime";
import { judgeAgentEvalFacts } from "./judges";
import { redactAgentEvalOutput } from "./redaction";

// Synthetic sentinels only; none of them is a real identifier or secret.
const bypass = "sentinel-bypass-0123456789";
const accountId = "agent-eval-0b6f4c1e-0000-4000-8000-000000000001";
const reservationId = "4815162342001";
const customerId = "9000000000017";
const orderId = "ord_sentinel42";
const previewUrl = "https://deskohub-workspace-git-sentinel.vercel.app/cs-CZ";
const statusUrl = `https://deskohub-workspace-git-sentinel.vercel.app/cs-CZ/reservation/status?access=${"t".repeat(40)}`;

addRedaction(bypass);

describe("redactAgentEvalOutput", () => {
  test.each([
    ["the bypass secret", `x-vercel-protection-bypass: ${bypass}`, bypass],
    ["a preview URL", `Opened ${previewUrl} first.`, "vercel.app"],
    ["a status URL with its access token", `Done: ${statusUrl}`, "access="],
    [
      "a same-origin status path",
      "Navigated to /cs-CZ/reservation/status?access=abc123",
      "abc123",
    ],
    ["the run's account id", `account ${accountId}`, accountId],
    ["a Dotypos reservation id", `Reservation ${reservationId}`, reservationId],
    ["the profile id", `customer=${customerId}`, customerId],
    ["a payment order id", `order ${orderId} created`, orderId],
    [
      "an unknown provider id",
      "Rezervace 7777777777777 je potvrzena",
      "7777777777777",
    ],
    [
      "a contact's email",
      "Booked for jana.novakova@example.test",
      "jana.novakova",
    ],
    ["a token-like run", `token ${"A1b2".repeat(10)}`, "A1b2A1b2"],
  ])("strips %s", (_label, text, sentinel) => {
    const redacted = redactAgentEvalOutput(text, [
      accountId,
      reservationId,
      customerId,
      orderId,
    ]);
    expect(redacted).not.toContain(sentinel);
  });

  test("keeps the facts a judge reads", () => {
    const answer =
      "A Reserved Desk costs CZK 410 per day. The space is open 24/7, at Turnovská 430/10, 180 00 Praha 8.";
    const redacted = redactAgentEvalOutput(answer, [reservationId]);
    expect(redacted).toBe(answer);
    expect(judgeAgentEvalFacts(redacted).success).toBe(true);
  });
});
