import { afterAll, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readWorkspaceE2ECaseJournals,
  writeWorkspaceE2ECaseJournal,
} from "../playwright-checkout/run-plan";
import type { CheckoutData, CheckoutFlowState } from "../types";
import {
  makeWorkspaceE2EAccountJournalRecorder,
  readWorkspaceE2EAccountJournal,
} from "./journal";

// A referral-lane case owns both a checkout case journal and an account
// identity journal under the same ID.
const caseId = "referral-share-link-checkout";
const artifactRoot = resolve(import.meta.dir, "../../e2e-artifacts/checkout");

afterAll(async () => {
  await Promise.all(
    [
      resolve(artifactRoot, "cleanup-journals", `${caseId}.json`),
      resolve(artifactRoot, "account-journals", `${caseId}.json`),
    ].map((path) => unlink(path).catch(() => undefined))
  );
});

test("keeps a case's checkout and account journals apart", async () => {
  const recorder = makeWorkspaceE2EAccountJournalRecorder(caseId);
  await recorder.record({ authUserIds: ["synthetic-auth-user"] });
  await writeWorkspaceE2ECaseJournal(caseId, [
    {
      data: { date: "2099-09-01" } as CheckoutData,
      orderId: "order-1",
    } as CheckoutFlowState,
  ]);
  await recorder.record({ dotyposCustomerIds: ["synthetic-customer"] });

  const accountJournal = await readWorkspaceE2EAccountJournal(caseId);
  const [checkoutState] = await readWorkspaceE2ECaseJournals([caseId]);

  expect(accountJournal?.authUserIds).toEqual(["synthetic-auth-user"]);
  expect(accountJournal?.dotyposCustomerIds).toEqual(["synthetic-customer"]);
  expect(checkoutState?.orderId).toBe("order-1");
});
