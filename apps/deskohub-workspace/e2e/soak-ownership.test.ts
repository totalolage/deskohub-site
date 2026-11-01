import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import { makeTestE2EEnvironment } from "./e2e-env.test-fixture";
import { workspaceE2ECaseIds } from "./playwright-checkout/case-catalog";
import { workspaceE2ECheckoutJournalOwners } from "./playwright-checkout/journal-owners";
import { makeE2ERunContext } from "./services/telemetry";
import { readRunOwnership } from "./soak-ownership";

test("the actual ownership reader requires complete case, owner, run and pre-create coverage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "owned-journal-reader-"));
  const environment = makeTestE2EEnvironment({
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "1",
    TARGET_SHA: "a".repeat(40),
  });
  const context = makeE2ERunContext(environment);
  const caseId = "checkout-cowork-basic";
  const intent = {
    id: "orphan-pre-create",
    caseId,
    runId: context.runId,
    owner: { email: testEmailAddress("delivered+owned-reader") },
    startDate: "2027-01-01T08:00:00Z",
    endDate: "2027-01-01T10:00:00Z",
  };
  const write = (path: string, value: object) =>
    writeFile(join(directory, path), JSON.stringify(value), { mode: 0o600 });
  const journal = {
    caseId,
    checkoutStates: [{ data: { email: intent.owner.email } }],
    reservationIntents: [intent],
  };
  const rejected = async () => {
    let failed = false;
    try {
      await readRunOwnership(environment, directory);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  };
  try {
    await mkdir(join(directory, "cleanup-journals"));
    await mkdir(join(directory, "account-journals"));
    await write("run-plan.json", {
      version: 2,
      preparation: {},
      runContext: context,
    });
    for (const id of workspaceE2ECaseIds)
      await write(`cleanup-journals/${id}.json`, {
        ...journal,
        caseId: id,
        reservationIntents: id === caseId ? [intent] : [],
      });
    const accountJournal = {
      laneId: "account-lane",
      dotyposCustomerIds: [],
      authUserIds: [],
      reservationIntents: [],
    };
    for (const { ownerId } of workspaceE2ECheckoutJournalOwners)
      await write(`account-journals/${ownerId}.json`, {
        ...accountJournal,
        laneId: ownerId,
      });
    expect((await readRunOwnership(environment, directory)).intents).toEqual([
      intent,
    ]);
    await rm(join(directory, "account-journals/account-lane.json"));
    await rejected();
    await write("account-journals/account-lane.json", accountJournal);
    const booker = workspaceE2ECheckoutJournalOwners.find(
      (owner) => owner.caseId === caseId
    )!;
    for (const ownerId of [booker.ownerId, "referral-share-link-checkout"]) {
      await rm(join(directory, `account-journals/${ownerId}.json`));
      await rejected();
      await write(`account-journals/${ownerId}.json`, {
        ...accountJournal,
        laneId: ownerId,
      });
    }
    // These cases are not admitted by this ordinary run without office slots.
    for (const owner of workspaceE2ECheckoutJournalOwners) {
      if (
        (owner.caseId ?? owner.ownerId) === "automation-reservation-booked" ||
        (owner.caseId ?? owner.ownerId).startsWith("checkout-office-")
      )
        await rm(join(directory, `account-journals/${owner.ownerId}.json`));
    }
    expect((await readRunOwnership(environment, directory)).intents).toEqual([
      intent,
    ]);
    await write("account-journals/unknown-owner.json", {});
    await rejected();
    await rm(join(directory, "account-journals/unknown-owner.json"));
    await rm(join(directory, `cleanup-journals/${caseId}.json`));
    await rejected();
    await write(`cleanup-journals/${caseId}.json`, {
      ...journal,
      reservationIntents: undefined,
    });
    await rejected();
    await write(`cleanup-journals/${caseId}.json`, {
      ...journal,
      reservationIntents: [{ ...intent, runId: "other-run" }],
    });
    await rejected();
    await write(`cleanup-journals/${caseId}.json`, {
      ...journal,
      reservationIntents: [{ ...intent, caseId: "unregistered" }],
    });
    await rejected();
    await write(`cleanup-journals/${caseId}.json`, {
      ...journal,
      reservationIntents: [intent, intent],
    });
    await rejected();
    await write(`cleanup-journals/${caseId}.json`, journal);
    expect(
      (await readRunOwnership(environment, directory)).intents
    ).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
