import { type BrowserContext, expect, type Page } from "@playwright/test";
import { Effect } from "effect";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { signInWorkspaceE2ESyntheticBrowserContext } from "../account/seeded-session";
import { readAgentEvalRunResources } from "../agent-evals/records";
import { tryWorkspaceE2EPromise } from "../errors";
import { requireBaseUrl } from "../instant-navigation/navigation-test-helpers";
import { waitForReactSubmitHandler } from "../react-handlers";
import { workspaceE2ETimeouts } from "../timeouts";
import { type AuditedLocale, openSettledPage } from "./accessibility-audit";
import { makeSeededAccountRuntime } from "./audit-target";
import { reservationForm } from "./page-states";
import {
  makeSeededAccountRunId,
  reconcileSeededAccount,
  seedLinkedAccount,
} from "./seeded-account";

/**
 * Days out the Pay audit books its Open Space day. Other lanes share the
 * Dotypos sandbox: checkout cases book 14 to 90 days out, the account lane
 * 120, and agent evals 125 to 170 (e2e/agent-evals/parameters.ts), so this
 * window stays clear of them and inside the six-month booking horizon.
 */
const payAuditDateWindow = { fromOffsetDays: 175, toOffsetDays: 180 } as const;

const payAuditRecipientLabel = "pay";

const offsetDate = (offsetDays: number) =>
  getCurrentWorkspaceDate().add({ days: offsetDays }).toString();

/** The first Open Space day in the window the deployment offers. */
async function pickPayAuditDate(page: Page) {
  const from = offsetDate(payAuditDateWindow.fromOffsetDays);
  const to = offsetDate(payAuditDateWindow.toOffsetDays);
  const response = await page.request.get(
    `/api/workspace/availability?${new URLSearchParams({ entryTier: "open-space", from, to })}`,
    { timeout: workspaceE2ETimeouts.browserAction }
  );
  expect(response.ok()).toBe(true);
  const { unavailableDates } = (await response.json()) as {
    readonly unavailableDates: readonly string[];
  };
  for (
    let offset = payAuditDateWindow.fromOffsetDays;
    offset <= payAuditDateWindow.toOffsetDays;
    offset += 1
  ) {
    const date = offsetDate(offset);
    if (!unavailableDates.includes(date)) return date;
  }
  throw new Error("No Open Space day is available in the Pay audit window");
}

/**
 * Opens the real Pay page while `use` runs. A synthetic account linked to a
 * synthetic Dotypos profile books one Open Space day through the cowork form
 * and stops at Pay, before any payment exists. Every identity is journaled
 * before it is created, and the finalizer cancels the held reservation,
 * expires the profile, and deletes the account, whatever `use` did.
 */
export async function withPayPage(
  {
    baseURL,
    context,
    locale,
    page,
  }: {
    readonly baseURL: string | undefined;
    readonly context: BrowserContext;
    readonly locale: AuditedLocale;
    readonly page: Page;
  },
  use: () => Promise<void>
) {
  const origin = new URL(requireBaseUrl(baseURL)).origin;
  const runtime = makeSeededAccountRuntime(origin);
  const runId = makeSeededAccountRunId();
  let seeded: Awaited<ReturnType<typeof seedLinkedAccount>> | undefined;

  try {
    seeded = await seedLinkedAccount(runtime, runId, payAuditRecipientLabel);
    await runtime.runPromise(
      signInWorkspaceE2ESyntheticBrowserContext({
        accountId: seeded.accountId,
        context,
        origin,
        secret: runtime.secret,
      })
    );

    const date = await pickPayAuditDate(page);
    await openSettledPage(
      page,
      `/${locale}/reservation/cowork?${new URLSearchParams({ date, entryTier: "open-space" })}`
    );
    await waitForReactSubmitHandler(
      page,
      reservationForm(page),
      workspaceE2ETimeouts.browserAction
    );
    await expect(page.locator("#reservation-submit")).toBeEnabled({
      timeout: workspaceE2ETimeouts.uiTransition,
    });
    await page.locator("#reservation-submit").click();
    await page.waitForURL((url) => url.pathname === `/${locale}/checkout/pay`, {
      timeout: workspaceE2ETimeouts.checkoutStart,
    });
    await expect(page.locator("#checkout-pay-legal-consent")).toBeVisible();
    await use();
  } finally {
    if (seeded !== undefined) {
      const { accountId, recorder } = seeded;
      // Journal the hold the checkout created before reconciling.
      await runtime.runPromise(
        Effect.gen(function* () {
          const resources = yield* readAgentEvalRunResources(
            runtime.datasourceConfig,
            accountId,
            recorder.journal.startedAt
          );
          yield* tryWorkspaceE2EPromise("journal Pay audit reservations", () =>
            recorder.record({
              dotyposCustomerIds: resources.dotyposCustomerIds,
              dotyposReservationIds: resources.dotyposReservationIds,
            })
          );
        })
      );
    }
    await reconcileSeededAccount(runtime, runId, payAuditRecipientLabel);
  }
}
