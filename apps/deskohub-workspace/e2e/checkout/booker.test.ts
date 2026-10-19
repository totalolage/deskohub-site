import { expect, test } from "bun:test";
import type { Browser } from "@playwright/test";
import { Effect } from "effect";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { makeTestE2EEnvironment } from "../e2e-env.test-fixture";
import { WorkspaceE2EError } from "../errors";
import {
  isWorkspaceE2EReferralCaseId,
  workspaceE2ECaseIds,
} from "../playwright-checkout/case-catalog";
import { workspaceE2ERunIdSchema } from "../run-identifiers";
import type { Runner } from "../runtime";
import type { WorkspaceE2ECase } from "../types";
import {
  bindWorkspaceE2ECheckoutBooker,
  workspaceE2ECheckoutBookerCaseIds,
  workspaceE2ECheckoutBookerJournalOwners,
  workspaceE2ECheckoutBookerLabel,
} from "./booker";
import { makeCoworkCheckoutData } from "./data";

const runId = workspaceE2ERunIdSchema.make("38258478033-1");
const signingSecrets = "2:synthetic-current-session-signing-secret-0123456789";
const environment = (secrets: string | undefined) =>
  ({
    ...makeTestE2EEnvironment({ WORKSPACE_E2E_BETTER_AUTH_SECRETS: secrets }),
    WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL:
      "postgresql://provider-permit:synthetic-password@ep-coordinator.eu.neon.tech/neondb",
  }) as WorkspaceE2EEnvironment;
const run: Runner = async () => ({ exitCode: 0, stderr: "", stdout: "" });
// The booker binder never touches the worker browser.
const browser = {} as Browser;

const plannedCase = (id: string): WorkspaceE2ECase => ({
  checkoutStates: [
    {
      data: makeCoworkCheckoutData(
        "https://deskohub-workspace-abc123xyz-deskohub.vercel.app",
        "2099-09-01",
        id
      ),
    },
  ],
  execute: () => Effect.void,
  id,
  timeoutMs: 1_000,
});

const bind = (id: string, secrets: string | undefined) =>
  bindWorkspaceE2ECheckoutBooker({
    browser,
    environment: environment(secrets),
    run,
    runId,
    testCase: plannedCase(id),
  });

test("signs in every submitting case that does not own its identities", () => {
  expect(workspaceE2ECheckoutBookerCaseIds).toContain("checkout-cowork-basic");
  expect(workspaceE2ECheckoutBookerCaseIds).toContain(
    "payment-meeting-room-cancelled"
  );
  for (const id of [
    "contact-form",
    "locale-switch",
    "reservation-url-state-cowork",
    "checkout-referral-someone-else",
    "checkout-signed-out-verification",
  ]) {
    expect(workspaceE2ECheckoutBookerCaseIds).not.toContain(id);
  }
  for (const id of workspaceE2ECheckoutBookerCaseIds) {
    expect(isWorkspaceE2EReferralCaseId(id)).toBe(false);
    expect(workspaceE2ECaseIds).toContain(id);
  }
});

test("gives every booker its own journal owner and short opaque recipient", () => {
  const ownerIds = workspaceE2ECheckoutBookerJournalOwners.map(
    ({ ownerId }) => ownerId
  );
  expect(new Set(ownerIds).size).toBe(workspaceE2ECheckoutBookerCaseIds.length);
  for (const ownerId of ownerIds) {
    expect(ownerId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
  const labels = workspaceE2ECheckoutBookerJournalOwners.flatMap(
    ({ recipientLabels }) => recipientLabels
  );
  expect(new Set(labels).size).toBe(labels.length);
  for (const label of labels) {
    const recipient = makeWorkspaceE2EAccountRecipientForRunId(runId, label);
    expect(recipient.split("@")[0]?.length ?? 0).toBeLessThanOrEqual(64);
  }
  expect(workspaceE2ECheckoutBookerLabel("checkout-cowork-basic")).toBe(
    workspaceE2ECheckoutBookerLabel("checkout-cowork-basic")
  );
});

test("leaves signed-out cases and cases with their own identities as planned", async () => {
  for (const id of ["contact-form", "checkout-referral-someone-else"]) {
    const planned = plannedCase(id);
    const bound = await bindWorkspaceE2ECheckoutBooker({
      browser,
      environment: environment(signingSecrets),
      run,
      runId,
      testCase: planned,
    });
    expect(bound).toBe(planned);
  }
});

test("books the plain checkout as the booker's account", async () => {
  const bound = await bind("checkout-cowork-basic", signingSecrets);
  const [state] = bound.checkoutStates;
  const booker = makeWorkspaceE2EAccountRecipientForRunId(
    runId,
    workspaceE2ECheckoutBookerLabel("checkout-cowork-basic")
  );

  expect(state?.data.email).toBe(booker);
  const url = new URL(state?.data.checkoutUrl ?? "");
  expect(url.searchParams.get("customer")).toBe("account");
  expect(url.searchParams.get("email")).toBe(booker);
});

test("keeps the planned contact of a case that books for someone else", async () => {
  const planned = plannedCase("checkout-zero-total");
  const bound = await bindWorkspaceE2ECheckoutBooker({
    browser,
    environment: environment(signingSecrets),
    run,
    runId,
    testCase: planned,
  });

  expect(bound.checkoutStates).toBe(planned.checkoutStates);
  expect(bound.execute).not.toBe(planned.execute);
});

test("fails closed before a booker case runs without the preview signing secret", async () => {
  await expect(bind("checkout-zero-total", undefined)).rejects.toBeInstanceOf(
    WorkspaceE2EError
  );
});
