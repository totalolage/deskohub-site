import { expect, test } from "bun:test";
import type { Browser } from "@playwright/test";
import { Effect } from "effect";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { makeTestE2EEnvironment } from "../e2e-env.test-fixture";
import { WorkspaceE2EError } from "../errors";
import { workspaceE2EReferralCaseIds } from "../playwright-checkout/case-catalog";
import { workspaceE2ERunIdSchema } from "../run-identifiers";
import type { Runner } from "../runtime";
import type { WorkspaceE2ECase } from "../types";
import { bindWorkspaceE2EReferralCase } from "./cases";
import {
  workspaceE2EReferralJournalOwners,
  workspaceE2EReferralRecipientLabels,
} from "./journal-owners";
import { workspaceE2EReferralCheckoutCaseIds } from "./plan";

const runId = workspaceE2ERunIdSchema.make("38258478033-1");
const signingSecrets = "2:synthetic-current-session-signing-secret-0123456789";
const environment = (secrets: string | undefined) =>
  ({
    ...makeTestE2EEnvironment({ WORKSPACE_E2E_BETTER_AUTH_SECRETS: secrets }),
    WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL:
      "postgresql://provider-permit:synthetic-password@ep-coordinator.eu.neon.tech/neondb",
  }) as WorkspaceE2EEnvironment;
const run: Runner = async () => ({ exitCode: 0, stderr: "", stdout: "" });
const browser = { contexts: () => [] } as unknown as Browser;

const plannedCase = (id: string): WorkspaceE2ECase => ({
  checkoutStates: (
    workspaceE2EReferralCheckoutCaseIds as readonly string[]
  ).includes(id)
    ? [
        {
          data: makeCoworkCheckoutData(
            "https://deskohub-workspace-abc123xyz-deskohub.vercel.app",
            "2099-09-01",
            id
          ),
        },
      ]
    : [],
  execute: () => Effect.void,
  id,
  timeoutMs: 1_000,
});

test("binds every referral-lane case and books checkouts for the case's own run-scoped customer", () => {
  for (const id of workspaceE2EReferralCaseIds) {
    const planned = plannedCase(id);
    const bound = bindWorkspaceE2EReferralCase({
      browser,
      environment: environment(signingSecrets),
      run,
      runId,
      testCase: planned,
    });

    expect(bound.id).toBe(id);
    expect(bound.checkoutStates).toHaveLength(planned.checkoutStates.length);
    for (const { data } of bound.checkoutStates) {
      const owned = workspaceE2EReferralRecipientLabels[id].map((label) =>
        makeWorkspaceE2EAccountRecipientForRunId(runId, label)
      );
      expect(owned).toContain(data.email);
      expect(new URL(data.checkoutUrl).searchParams.get("email")).toBe(
        data.email
      );
    }
  }
});

test("fails closed before a referral case runs without the preview signing secret", () => {
  expect(() =>
    bindWorkspaceE2EReferralCase({
      browser,
      environment: environment(undefined),
      run,
      runId,
      testCase: plannedCase("referral-auto-linked-sign-in"),
    })
  ).toThrow(WorkspaceE2EError);
});

test("gives every referral case its own journal owner and short opaque recipients", () => {
  expect(
    workspaceE2EReferralJournalOwners.map(({ ownerId }) => ownerId)
  ).toEqual([...workspaceE2EReferralCaseIds]);
  const labels = workspaceE2EReferralJournalOwners.flatMap(
    ({ recipientLabels }) => recipientLabels
  );
  expect(new Set(labels).size).toBe(labels.length);
  for (const label of labels) {
    const recipient = makeWorkspaceE2EAccountRecipientForRunId(runId, label);
    expect(recipient.split("@")[0]?.length ?? 0).toBeLessThanOrEqual(64);
  }
});
