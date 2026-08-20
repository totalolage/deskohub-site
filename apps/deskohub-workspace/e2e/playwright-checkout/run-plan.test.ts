import { afterAll, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { CheckoutData, CheckoutFlowState } from "../types";
import {
  readWorkspaceE2ECaseJournals,
  writeWorkspaceE2ECaseJournal,
} from "./run-plan";

const caseId = "locale-switch";
const journalPath = resolve(
  import.meta.dir,
  "../../e2e-artifacts/checkout/cleanup-journals/locale-switch.json"
);

afterAll(async () => {
  await unlink(journalPath).catch(() => undefined);
});

test("persists exact cleanup completion for teardown reconciliation", async () => {
  const journalStartedAt = new Date("2026-08-12T10:00:00.000Z");
  const state = {
    cleanupComplete: true,
    completedDotyposReservationId: "dotypos-reservation-1",
    data: { date: "2026-08-20" } as CheckoutData,
    orderId: "order-1",
    startedAt: new Date("2026-08-12T10:00:01.000Z"),
  } as CheckoutFlowState;

  await writeWorkspaceE2ECaseJournal(caseId, [state], journalStartedAt);
  const [restored] = await readWorkspaceE2ECaseJournals([caseId]);

  expect(restored?.cleanupComplete).toBe(true);
  expect(restored?.completedDotyposReservationId).toBe("dotypos-reservation-1");
  expect(restored?.orderId).toBe("order-1");
  expect(restored?.startedAt).toEqual(state.startedAt);
});
