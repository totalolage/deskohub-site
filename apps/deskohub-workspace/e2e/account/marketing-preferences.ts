import "../../shared/polyfills/temporal";

import { createHash, randomBytes } from "node:crypto";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { Effect, Predicate } from "effect";
import { Children, isValidElement, type ReactNode } from "react";
import { customerMarketingConsents } from "@/db/schema/customer-marketing-consents";
import { customerMarketingManagementTokens } from "@/db/schema/customer-marketing-management-tokens";
import { marketingPreferencesFormCopy } from "@/features/legal/components/marketing-preferences-form.copy";
import { getLegalDocument } from "@/features/legal/content";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { dismissLegalCookieConsent } from "../legal-cookie-consent";
import { pollUntil } from "../polling";
import { addRedaction, assert } from "../runtime";
import { workspaceE2EPollIntervalMs, workspaceE2ETimeouts } from "../timeouts";
import {
  type AccountReviewTarget,
  captureAccountReview,
} from "./review-screenshots";

const accountLegalPath = "/en-US/account/legal";
const marketingPreferencesAccessPath = "/en-US/marketing-preferences/access";
const accountAuthCookieSuffix = "session_token";
const marketingLinkLifetimeDays = 30;
const marketingBrowserFailureMessage =
  "Marketing preferences browser verification failed";
const marketingFixtureConvergenceMessage =
  "Marketing preferences fixture cleanup did not converge";

type MarketingPreferenceStatus = "active" | "withdrawn";
type MarketingPreferenceSource = "account" | "link";
type MarketingConsentRow = typeof customerMarketingConsents.$inferSelect;
type MarketingManagementTokenProjection = {
  readonly purpose: "link" | "session";
  readonly revokedAt: Temporal.Instant | null;
  readonly tokenHash: string;
};

/**
 * The caller must exclusively own this synthetic customer's account and
 * consent rows while the fixture runs. Existing management-token rows are
 * allowed; cleanup restores the original token-hash set and removes only the
 * delta created by this fixture.
 * The supplied page is already authenticated for this same synthetic customer
 * and may begin at any URL; the flow navigates it to the clean legal route.
 */
export type WorkspaceE2EMarketingPreferencesInput = {
  readonly baseUrl: string;
  readonly browser: Browser;
  readonly bypassSecret: string | undefined;
  readonly customerId: DotyposCustomerId;
  readonly page: Page;
};

export type WorkspaceE2EMarketingPreferencesSeedRow =
  typeof customerMarketingManagementTokens.$inferInsert;

/**
 * Builds the one link-token row used by the E2E fixture without handling raw
 * credentials. The caller must pass an exclusively owned synthetic customer;
 * the enclosing fixture may preserve existing token rows and clean up only
 * its token delta.
 */
export const makeWorkspaceE2EMarketingPreferencesSeedRow = (input: {
  readonly customerId: DotyposCustomerId;
  readonly now: Temporal.Instant;
  readonly tokenHash: string;
}): WorkspaceE2EMarketingPreferencesSeedRow => ({
  dotyposCustomerId: input.customerId,
  expiresAt: input.now.add({ hours: marketingLinkLifetimeDays * 24 }),
  purpose: "link",
  revokedAt: null,
  tokenHash: input.tokenHash,
});

type WorkspaceE2EMarketingPreferencesFixture = {
  readonly customerId: DotyposCustomerId;
  readonly documentHash: string;
  readonly linkTokenHash: string;
  readonly originalConsent: MarketingConsentRow | null;
  readonly originalTokenHashes: readonly string[];
  readonly rawLinkToken: string;
};

type WorkspaceE2EMarketingBrowserOperationResource = {
  readonly controller: AbortController;
  pending: PromiseLike<unknown> | undefined;
};

const settleMarketingBrowserOperation = (
  pending: PromiseLike<unknown> | undefined
): Effect.Effect<void> =>
  pending === undefined
    ? Effect.void
    : Effect.promise(() =>
        Promise.resolve(pending).then(
          () => undefined,
          () => undefined
        )
      );

/** Keeps each pending browser operation alive until its native promise settles. */
export const runWorkspaceE2EMarketingBrowserOperation = <A>(
  operation: string,
  execute: (signal: AbortSignal) => Promise<A>
): Effect.Effect<A, WorkspaceE2EError> =>
  Effect.acquireUseRelease(
    Effect.sync(
      (): WorkspaceE2EMarketingBrowserOperationResource => ({
        controller: new AbortController(),
        pending: undefined,
      })
    ),
    (resource) =>
      Effect.tryPromise({
        catch: () =>
          workspaceE2EError(marketingBrowserFailureMessage, {
            operation,
          }),
        try: (signal) => {
          const relayAbort = () => resource.controller.abort();
          signal.addEventListener("abort", relayAbort, { once: true });
          if (signal.aborted) {
            resource.controller.abort();
            signal.removeEventListener("abort", relayAbort);
            signal.throwIfAborted();
          }

          try {
            const pending = execute(resource.controller.signal);
            resource.pending = pending;
            void pending.then(
              () => signal.removeEventListener("abort", relayAbort),
              () => signal.removeEventListener("abort", relayAbort)
            );
            return pending;
          } catch (cause) {
            signal.removeEventListener("abort", relayAbort);
            throw cause;
          }
        },
      }),
    (resource) =>
      Effect.uninterruptible(
        Effect.sync(() => resource.controller.abort()).pipe(
          Effect.andThen(settleMarketingBrowserOperation(resource.pending))
        )
      )
  );

const runMarketingBrowserOperation = runWorkspaceE2EMarketingBrowserOperation;

const reactHandlerIsInstalled = ({
  handler,
  selector,
}: {
  readonly handler: string;
  readonly selector: string;
}): boolean => {
  const element = document.querySelector(selector);
  if (element === null) return false;

  const reactPropsKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$")
  );
  if (reactPropsKey === undefined) return false;

  const reactProps = Object.getOwnPropertyDescriptor(
    element,
    reactPropsKey
  )?.value;
  return (
    typeof reactProps === "object" &&
    reactProps !== null &&
    typeof (reactProps as Record<string, unknown>)[handler] === "function"
  );
};

const waitForReactHandler = async (
  page: Page,
  selector: string,
  handler: "onClick" | "onSubmit"
): Promise<void> => {
  await page.waitForFunction(
    reactHandlerIsInstalled,
    { handler, selector },
    { timeout: workspaceE2ETimeouts.uiTransition }
  );
};

/** Navigates without allowing a Playwright error to retain a credential-bearing URL as its cause. */
export const navigateWorkspaceE2EMarketingPreferences = async (
  page: Page,
  url: string
): Promise<void> => {
  try {
    await page.goto(url, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });
  } catch {
    throw new Error(marketingBrowserFailureMessage);
  }
};

const hashOpaqueToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

const reactNodeToCanonicalText = (node: ReactNode): string => {
  if (node === null || node === undefined || Predicate.isBoolean(node)) {
    return "";
  }

  if (Predicate.isString(node) || Predicate.isNumber(node)) {
    return String(node);
  }

  if (Array.isArray(node)) {
    return Children.toArray(node).map(reactNodeToCanonicalText).join("");
  }

  if (isValidElement<{ readonly children?: ReactNode }>(node)) {
    return reactNodeToCanonicalText(node.props.children);
  }

  return "";
};

const marketingCommunicationsDocumentHash = Effect.try({
  catch: () =>
    workspaceE2EError("Read marketing communications document hash failed", {
      operation: "read marketing communications document hash",
    }),
  try: () => {
    const document = getLegalDocument("en-US", "marketing-communications");
    const canonicalDocument = JSON.stringify({
      title: document.title,
      lead: document.lead,
      updatedAt: document.updatedAt,
      sections: document.sections.map((section) => ({
        heading: section.heading,
        body: section.body.map(reactNodeToCanonicalText),
      })),
    });
    return createHash("sha256").update(canonicalDocument).digest("hex");
  },
});

const rawMarketingLinkToken = Effect.try({
  catch: () =>
    workspaceE2EError("Generate marketing management token failed", {
      operation: "generate marketing management token",
    }),
  try: () => randomBytes(32).toString("base64url"),
});

const seedWorkspaceE2EMarketingPreferences = Effect.fn(
  "seedWorkspaceE2EMarketingPreferences"
)(function* (input: { readonly customerId: DotyposCustomerId }) {
  const documentHash = yield* marketingCommunicationsDocumentHash;
  const rawLinkToken = yield* rawMarketingLinkToken;
  yield* Effect.sync(() => addRedaction(rawLinkToken));

  const linkTokenHash = hashOpaqueToken(rawLinkToken);
  const now = Temporal.Now.instant();
  const activeConsent: typeof customerMarketingConsents.$inferInsert = {
    dotyposCustomerId: input.customerId,
    documentHash,
    grantedAt: now,
    locale: "en-US",
    withdrawnAt: null,
  };
  const linkRow = makeWorkspaceE2EMarketingPreferencesSeedRow({
    customerId: input.customerId,
    now,
    tokenHash: linkTokenHash,
  });
  const { db } = yield* E2EDatabase;

  return yield* runDatabaseOperation(
    "seed marketing preferences fixture",
    db.transaction((tx) =>
      Effect.gen(function* () {
        const originalConsents = yield* tx
          .select()
          .from(customerMarketingConsents)
          .where(
            eq(customerMarketingConsents.dotyposCustomerId, input.customerId)
          );
        const originalTokens = yield* tx
          .select({ tokenHash: customerMarketingManagementTokens.tokenHash })
          .from(customerMarketingManagementTokens)
          .where(
            eq(
              customerMarketingManagementTokens.dotyposCustomerId,
              input.customerId
            )
          );

        if (originalTokens.some((row) => row.tokenHash === linkTokenHash)) {
          return yield* workspaceE2EError(
            "Generated marketing management token collided with an existing row",
            {
              diagnosticCode: "postgres_account_fixture_assertion_failed",
              operation: "seed marketing preferences fixture",
            }
          );
        }

        const originalConsent = originalConsents[0] ?? null;
        const needsActiveConsent =
          originalConsent === null ||
          originalConsent.withdrawnAt !== null ||
          originalConsent.documentHash !== documentHash ||
          originalConsent.locale !== "en-US";
        if (needsActiveConsent) {
          yield* tx
            .insert(customerMarketingConsents)
            .values(activeConsent)
            .onConflictDoUpdate({
              target: customerMarketingConsents.dotyposCustomerId,
              set: {
                documentHash: activeConsent.documentHash,
                grantedAt: activeConsent.grantedAt,
                locale: activeConsent.locale,
                withdrawnAt: activeConsent.withdrawnAt,
              },
            });
        }

        yield* tx.insert(customerMarketingManagementTokens).values(linkRow);

        const seededLink = yield* tx
          .select({ tokenHash: customerMarketingManagementTokens.tokenHash })
          .from(customerMarketingManagementTokens)
          .where(
            and(
              eq(
                customerMarketingManagementTokens.dotyposCustomerId,
                input.customerId
              ),
              eq(customerMarketingManagementTokens.tokenHash, linkTokenHash)
            )
          );
        if (seededLink.length !== 1) {
          return yield* workspaceE2EError(
            "Marketing management link fixture was not persisted",
            {
              diagnosticCode: "postgres_account_fixture_assertion_failed",
              operation: "verify marketing preferences fixture seed",
            }
          );
        }

        return {
          originalConsent,
          originalTokenHashes: originalTokens.map((row) => row.tokenHash),
        };
      })
    )
  ).pipe(
    Effect.map(({ originalConsent, originalTokenHashes }) => ({
      customerId: input.customerId,
      documentHash,
      linkTokenHash,
      originalConsent,
      originalTokenHashes,
      rawLinkToken,
    }))
  );
});

const readMarketingConsent = Effect.fn("readMarketingConsent")(function* (
  customerId: DotyposCustomerId
) {
  const { db } = yield* E2EDatabase;
  const rows = yield* runDatabaseOperation(
    "read marketing preference consent",
    db
      .select()
      .from(customerMarketingConsents)
      .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
  );
  return rows[0] ?? null;
});

const readMarketingManagementTokens = Effect.fn(
  "readMarketingManagementTokens"
)(function* (customerId: DotyposCustomerId) {
  const { db } = yield* E2EDatabase;
  return yield* runDatabaseOperation(
    "read marketing management tokens",
    db
      .select({
        purpose: customerMarketingManagementTokens.purpose,
        revokedAt: customerMarketingManagementTokens.revokedAt,
        tokenHash: customerMarketingManagementTokens.tokenHash,
      })
      .from(customerMarketingManagementTokens)
      .where(
        eq(customerMarketingManagementTokens.dotyposCustomerId, customerId)
      )
  );
});

const consentHasState = (
  consent: MarketingConsentRow | null,
  expectedStatus: MarketingPreferenceStatus,
  documentHash: string
): consent is MarketingConsentRow =>
  consent !== null &&
  consent.documentHash === documentHash &&
  consent.locale === "en-US" &&
  (expectedStatus === "active"
    ? consent.withdrawnAt === null
    : consent.withdrawnAt !== null);

const managedPreferenceSelector = (
  status: MarketingPreferenceStatus,
  source: MarketingPreferenceSource
) =>
  `[data-marketing-preferences=${JSON.stringify(status)}][data-marketing-preferences-source=${JSON.stringify(source)}]`;

const pendingPreferenceSelector = '[data-marketing-preferences="pending-link"]';
const invalidPreferenceSelector = '[data-marketing-preferences="invalid-link"]';
const unavailablePreferenceSelector =
  '[data-marketing-preferences="unavailable"]';
const marketingPreferencesCopy = marketingPreferencesFormCopy["en-US"];
const marketingManagementCookieNames = [
  "__Host-workspace-marketing-pending",
  "__Host-workspace-marketing",
] as const;
const invalidMarketingManagementActionMessage =
  "This marketing management link is invalid or has expired.";

const requireManagedPreference = async (
  page: Page,
  status: MarketingPreferenceStatus,
  source: MarketingPreferenceSource
): Promise<Locator> => {
  const section = page.locator(managedPreferenceSelector(status, source));
  await expect(section).toHaveCount(1, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(section).toBeVisible({
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  const statusCopy =
    status === "active"
      ? marketingPreferencesCopy.statusActive
      : marketingPreferencesCopy.statusWithdrawn;
  const contextCopy =
    source === "link"
      ? marketingPreferencesCopy.linkContext
      : marketingPreferencesCopy.accountContext;
  const otherContextCopy =
    source === "link"
      ? marketingPreferencesCopy.accountContext
      : marketingPreferencesCopy.linkContext;
  const confirmationCopy =
    status === "active"
      ? marketingPreferencesCopy.withdrawConfirmation
      : marketingPreferencesCopy.grantConfirmation;
  const actionCopy =
    status === "active"
      ? marketingPreferencesCopy.withdrawAction
      : marketingPreferencesCopy.grantAction;
  await expect(section.getByText(statusCopy, { exact: true })).toHaveCount(1, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(section.getByText(contextCopy, { exact: true })).toHaveCount(1, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(
    section.getByText(otherContextCopy, { exact: true })
  ).toHaveCount(0);
  await expect(
    section.getByRole("checkbox", {
      exact: true,
      name: confirmationCopy,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.getByRole("button", {
      exact: true,
      name: actionCopy,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.getByRole("button", {
      exact: true,
      name: marketingPreferencesCopy.clearAction,
    })
  ).toHaveCount(source === "link" ? 1 : 0, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  return section;
};

const requirePendingPreference = async (page: Page): Promise<Locator> => {
  const section = page.locator(pendingPreferenceSelector);
  await expect(section).toHaveCount(1, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(section).toBeVisible({
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(
    section.getByText(marketingPreferencesCopy.pendingDescription, {
      exact: true,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.getByRole("button", {
      exact: true,
      name: marketingPreferencesCopy.continueAction,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.getByRole("button", {
      exact: true,
      name: marketingPreferencesCopy.clearAction,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.locator("[data-marketing-preferences-source]")
  ).toHaveCount(0);
  await expect(section.locator("form")).toHaveCount(0);
  return section;
};

const requireInvalidLinkPreference = async (page: Page): Promise<Locator> => {
  const section = page.locator(invalidPreferenceSelector);
  await expect(section).toHaveCount(1, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(section).toBeVisible({
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(
    section.getByText(marketingPreferencesCopy.invalidLinkDescription, {
      exact: true,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.getByText(marketingPreferencesCopy.invalidLinkNextStep, {
      exact: true,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.locator("[data-marketing-preferences-source]")
  ).toHaveCount(0);
  await expect(section.getByRole("checkbox", { exact: true })).toHaveCount(0);
  await expect(section.locator("form")).toHaveCount(0);
  await expect(
    section.getByRole("button", {
      exact: true,
      name: marketingPreferencesCopy.continueAction,
    })
  ).toHaveCount(0);
  const clearButton = section.getByRole("button", {
    exact: true,
    name: marketingPreferencesCopy.clearAction,
  });
  await expect(clearButton).toHaveCount(1, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(clearButton).toBeVisible({
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  return section;
};

const requireUnavailablePreference = async (page: Page): Promise<Locator> => {
  const section = page.locator(unavailablePreferenceSelector);
  await expect(section).toHaveCount(1, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(section).toBeVisible({
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(
    section.getByText(marketingPreferencesCopy.unavailableDescription, {
      exact: true,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.getByText(marketingPreferencesCopy.unavailableNextStep, {
      exact: true,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.getByText(marketingPreferencesCopy.unavailableSignInNextStep, {
      exact: true,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.locator("[data-marketing-preferences-source]")
  ).toHaveCount(0);
  await expect(section.getByRole("checkbox", { exact: true })).toHaveCount(0);
  await expect(section.locator("form")).toHaveCount(0);
  await expect(
    section.getByRole("button", {
      exact: true,
      name: marketingPreferencesCopy.continueAction,
    })
  ).toHaveCount(0);
  await expect(
    section.getByRole("link", {
      exact: true,
      name: marketingPreferencesCopy.signInAction,
    })
  ).toHaveCount(1, { timeout: workspaceE2ETimeouts.uiTransition });
  await expect(
    section.getByRole("button", {
      exact: true,
      name: marketingPreferencesCopy.clearAction,
    })
  ).toHaveCount(0);
  return section;
};

const requireRejectedReplayPreference = async (page: Page): Promise<void> => {
  const section = await requirePendingPreference(page);
  await expect(
    page.locator(
      '[data-marketing-preferences-source="account"], [data-marketing-preferences-source="link"]'
    )
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(1, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
  await expect(page.getByRole("alert")).toContainText(
    invalidMarketingManagementActionMessage,
    {
      timeout: workspaceE2ETimeouts.uiTransition,
    }
  );
  await expect(section.locator("form")).toHaveCount(0);
  await expect(section.getByRole("checkbox")).toHaveCount(0);
  await expect(section.locator('button[type="submit"]')).toHaveCount(0);
};

const sessionTokenHashes = (
  tokens: readonly MarketingManagementTokenProjection[]
): readonly string[] =>
  tokens
    .filter((token) => token.purpose === "session")
    .map((token) => token.tokenHash)
    .sort();

const assertNoNewSessionToken = (
  before: readonly string[],
  after: readonly string[]
): void => {
  assert(
    before.length === after.length &&
      before.every((tokenHash, index) => tokenHash === after[index]),
    "Replaying the consumed marketing link created a session token row"
  );
};

const submitManagedPreference = async ({
  desiredStatus,
  page,
  signal,
  source,
  status,
}: {
  readonly desiredStatus: MarketingPreferenceStatus;
  readonly page: Page;
  readonly signal: AbortSignal;
  readonly source: MarketingPreferenceSource;
  readonly status: MarketingPreferenceStatus;
}): Promise<void> => {
  const section = await requireManagedPreference(page, status, source);
  const selector = managedPreferenceSelector(status, source);
  const form = section.locator("form");
  const confirmationCopy =
    status === "active"
      ? marketingPreferencesCopy.withdrawConfirmation
      : marketingPreferencesCopy.grantConfirmation;
  const actionCopy =
    status === "active"
      ? marketingPreferencesCopy.withdrawAction
      : marketingPreferencesCopy.grantAction;
  const checkbox = form.getByRole("checkbox", {
    exact: true,
    name: confirmationCopy,
  });
  const submit = form.getByRole("button", {
    exact: true,
    name: actionCopy,
  });

  await expect(form).toHaveCount(1);
  await expect(checkbox).toHaveCount(1);
  await expect(submit).toHaveCount(1);
  await waitForReactHandler(page, `${selector} form`, "onSubmit");
  await waitForReactHandler(
    page,
    `${selector} form [role="checkbox"]`,
    "onClick"
  );
  signal.throwIfAborted();

  const initialChecked = await checkbox.getAttribute("aria-checked");
  if (initialChecked !== "false") {
    throw new Error(
      "Marketing preference confirmation did not start unchecked"
    );
  }

  signal.throwIfAborted();
  await checkbox.click({ timeout: workspaceE2ETimeouts.browserAction });
  await expect(checkbox).toHaveAttribute("aria-checked", "true", {
    timeout: workspaceE2ETimeouts.browserAction,
  });
  await expect(submit).toBeEnabled({
    timeout: workspaceE2ETimeouts.browserAction,
  });
  signal.throwIfAborted();
  await submit.click({ timeout: workspaceE2ETimeouts.browserAction });
  await requireManagedPreference(page, desiredStatus, source);
};

const waitForCanonicalLegalRoute = async (
  page: Page,
  legalUrl: string
): Promise<void> => {
  await page.waitForURL(legalUrl, {
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
  assert(
    page.url() === legalUrl,
    "Marketing preferences navigation did not settle on the canonical legal route"
  );
};

const captureMarketingReview = (
  page: Page,
  baseUrl: string,
  target: MarketingReviewTarget
): Promise<void> => captureAccountReview(page, baseUrl, target);

type MarketingReviewTarget = Extract<
  AccountReviewTarget,
  | "account-marketing-active-mobile"
  | "account-marketing-withdrawn-desktop"
  | "marketing-link-active-desktop"
  | "marketing-link-active-mobile"
  | "marketing-link-invalid-desktop"
  | "marketing-link-invalid-mobile"
  | "marketing-link-pending-desktop"
  | "marketing-link-pending-mobile"
  | "marketing-link-withdrawn-desktop"
  | "marketing-link-withdrawn-mobile"
>;

const assertNoAccountAuthCookie = async (
  context: BrowserContext
): Promise<void> => {
  const cookies = await context.cookies();
  assert(
    !cookies.some((cookie) => cookie.name.endsWith(accountAuthCookieSuffix)),
    "Anonymous marketing preferences context contains an account auth cookie"
  );
};

const assertNoMarketingManagementCookies = async (
  context: BrowserContext
): Promise<void> => {
  const cookies = await context.cookies();
  assert(
    marketingManagementCookieNames.every(
      (name) => !cookies.some((cookie) => cookie.name === name)
    ),
    "Marketing preferences context retains a management cookie after clear"
  );
};

const primePreviewAccess = async (
  context: BrowserContext,
  baseUrl: string,
  bypassSecret: string | undefined
): Promise<void> => {
  if (!bypassSecret) return;

  const response = await context.request.get(
    new URL("/favicon.svg", baseUrl).toString(),
    {
      headers: {
        "x-vercel-protection-bypass": bypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      },
      maxRedirects: 3,
    }
  );
  try {
    assert(response.ok(), "Preview access could not be primed");
  } finally {
    await response.dispose();
  }
};

const withAnonymousMarketingContext = <A>(
  input: WorkspaceE2EMarketingPreferencesInput,
  use: (
    context: BrowserContext,
    page: Page
  ) => Effect.Effect<A, WorkspaceE2EError, E2EDatabase>
): Effect.Effect<A, WorkspaceE2EError, E2EDatabase> =>
  Effect.acquireUseRelease(
    runMarketingBrowserOperation(
      "create isolated marketing preferences browser context",
      () => input.browser.newContext({ baseURL: input.baseUrl })
    ),
    (context) =>
      Effect.gen(function* () {
        const page = yield* runMarketingBrowserOperation(
          "create isolated marketing preferences browser page",
          () => context.newPage()
        );
        return yield* use(context, page);
      }),
    (context) =>
      runMarketingBrowserOperation(
        "close isolated marketing preferences browser context",
        () => context.close()
      ).pipe(Effect.asVoid)
  );

const makeMarketingPreferenceUrls = Effect.fn("makeMarketingPreferenceUrls")(
  function* (input: {
    readonly baseUrl: string;
    readonly rawLinkToken: string;
  }) {
    return yield* Effect.try({
      catch: () =>
        workspaceE2EError("Build marketing preferences URLs failed", {
          operation: "build marketing preferences URLs",
        }),
      try: () => {
        const accountLegalUrl = new URL(
          accountLegalPath,
          input.baseUrl
        ).toString();
        const accessUrl = new URL(
          marketingPreferencesAccessPath,
          input.baseUrl
        );
        accessUrl.searchParams.set("token", input.rawLinkToken);
        const invalidAccessUrl = new URL(
          marketingPreferencesAccessPath,
          input.baseUrl
        );
        invalidAccessUrl.searchParams.set("token", "invalid");
        return {
          accessUrl: accessUrl.toString(),
          accountLegalUrl,
          invalidAccessUrl: invalidAccessUrl.toString(),
        };
      },
    });
  }
);

const waitForConsumedMarketingLink = (
  fixture: WorkspaceE2EMarketingPreferencesFixture
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  pollUntil(
    readMarketingManagementTokens(fixture.customerId).pipe(
      Effect.map((tokens) => {
        const link = tokens.find(
          (token) => token.tokenHash === fixture.linkTokenHash
        );
        return link?.purpose === "link" && link.revokedAt !== null
          ? link
          : undefined;
      })
    ),
    {
      intervalMs: workspaceE2EPollIntervalMs.datasource,
      label: "consumed marketing management link",
      timeoutMs: workspaceE2ETimeouts.datasource,
    }
  ).pipe(Effect.asVoid);

const waitForPersistedConsentStatus = (
  fixture: WorkspaceE2EMarketingPreferencesFixture,
  expectedStatus: MarketingPreferenceStatus
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  pollUntil(
    readMarketingConsent(fixture.customerId).pipe(
      Effect.map((consent) =>
        consentHasState(consent, expectedStatus, fixture.documentHash)
          ? consent
          : undefined
      )
    ),
    {
      intervalMs: workspaceE2EPollIntervalMs.datasource,
      label: `marketing preference ${expectedStatus} persisted`,
      timeoutMs: workspaceE2ETimeouts.datasource,
    }
  ).pipe(Effect.asVoid);

const assertExactTokenHashes = (
  actual: readonly string[],
  expected: readonly string[]
): boolean =>
  actual.length === expected.length &&
  actual.every((tokenHash) => expected.includes(tokenHash));

const sameInstant = (
  left: Temporal.Instant | null,
  right: Temporal.Instant | null
): boolean =>
  left === null
    ? right === null
    : right !== null && left.epochNanoseconds === right.epochNanoseconds;

const sameConsent = (
  actual: MarketingConsentRow | null,
  expected: MarketingConsentRow | null
): boolean =>
  actual !== null &&
  expected !== null &&
  actual.dotyposCustomerId === expected.dotyposCustomerId &&
  actual.documentHash === expected.documentHash &&
  actual.locale === expected.locale &&
  sameInstant(actual.grantedAt, expected.grantedAt) &&
  sameInstant(actual.withdrawnAt, expected.withdrawnAt);

const cleanupWorkspaceE2EMarketingPreferences = Effect.fn(
  "cleanupWorkspaceE2EMarketingPreferences"
)(function* (fixture: WorkspaceE2EMarketingPreferencesFixture) {
  const { db } = yield* E2EDatabase;
  const originalTokenHashes = new Set(fixture.originalTokenHashes);

  yield* runDatabaseOperation(
    "restore marketing preferences fixture",
    db.transaction((tx) =>
      Effect.gen(function* () {
        const currentTokens = yield* tx
          .select({ tokenHash: customerMarketingManagementTokens.tokenHash })
          .from(customerMarketingManagementTokens)
          .where(
            eq(
              customerMarketingManagementTokens.dotyposCustomerId,
              fixture.customerId
            )
          );
        for (const token of currentTokens) {
          if (originalTokenHashes.has(token.tokenHash)) continue;
          yield* tx
            .delete(customerMarketingManagementTokens)
            .where(
              and(
                eq(
                  customerMarketingManagementTokens.dotyposCustomerId,
                  fixture.customerId
                ),
                eq(customerMarketingManagementTokens.tokenHash, token.tokenHash)
              )
            );
        }

        if (fixture.originalConsent === null) {
          yield* tx
            .delete(customerMarketingConsents)
            .where(
              eq(
                customerMarketingConsents.dotyposCustomerId,
                fixture.customerId
              )
            );
        } else {
          yield* tx
            .insert(customerMarketingConsents)
            .values(fixture.originalConsent)
            .onConflictDoUpdate({
              target: customerMarketingConsents.dotyposCustomerId,
              set: {
                documentHash: fixture.originalConsent.documentHash,
                grantedAt: fixture.originalConsent.grantedAt,
                locale: fixture.originalConsent.locale,
                withdrawnAt: fixture.originalConsent.withdrawnAt,
              },
            });
        }
      })
    )
  );

  const remainingTokens = yield* readMarketingManagementTokens(
    fixture.customerId
  );
  const restoredConsent = yield* readMarketingConsent(fixture.customerId);
  if (
    !assertExactTokenHashes(
      remainingTokens.map((token) => token.tokenHash),
      fixture.originalTokenHashes
    ) ||
    (fixture.originalConsent === null
      ? restoredConsent !== null
      : !sameConsent(restoredConsent, fixture.originalConsent))
  ) {
    return yield* workspaceE2EError(marketingFixtureConvergenceMessage, {
      diagnosticCode: "postgres_account_fixture_convergence_failed",
      operation: "verify marketing preferences fixture cleanup",
    });
  }
});

const runAuthenticatedMarketingPreferencesFlow = (
  input: WorkspaceE2EMarketingPreferencesInput,
  fixture: WorkspaceE2EMarketingPreferencesFixture,
  accountLegalUrl: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* runMarketingBrowserOperation(
      "navigate authenticated marketing preferences page",
      () =>
        navigateAuthenticatedWorkspaceE2EMarketingPreferences(
          input.page,
          accountLegalUrl
        )
    );
    yield* runMarketingBrowserOperation(
      "assert account marketing preference",
      () =>
        requireManagedPreference(input.page, "active", "account").then(
          () => undefined
        )
    );

    yield* runMarketingBrowserOperation(
      "withdraw account marketing preference",
      (signal) =>
        submitManagedPreference({
          desiredStatus: "withdrawn",
          page: input.page,
          signal,
          source: "account",
          status: "active",
        })
    );
    yield* waitForPersistedConsentStatus(fixture, "withdrawn");

    yield* runMarketingBrowserOperation(
      "reload withdrawn account marketing preference",
      async () => {
        await input.page.reload({
          timeout: workspaceE2ETimeouts.browserNavigation,
          waitUntil: "load",
        });
        assertExactPageUrl(input.page, accountLegalUrl);
        await requireManagedPreference(input.page, "withdrawn", "account");
      }
    );
    yield* runMarketingBrowserOperation(
      "capture withdrawn account marketing preference",
      () =>
        captureMarketingReview(
          input.page,
          input.baseUrl,
          "account-marketing-withdrawn-desktop"
        )
    );

    yield* runMarketingBrowserOperation(
      "opt in account marketing preference",
      (signal) =>
        submitManagedPreference({
          desiredStatus: "active",
          page: input.page,
          signal,
          source: "account",
          status: "withdrawn",
        })
    );
    yield* waitForPersistedConsentStatus(fixture, "active");

    yield* runMarketingBrowserOperation(
      "reload active account marketing preference",
      async () => {
        await input.page.reload({
          timeout: workspaceE2ETimeouts.browserNavigation,
          waitUntil: "load",
        });
        assertExactPageUrl(input.page, accountLegalUrl);
        await requireManagedPreference(input.page, "active", "account");
      }
    );
    yield* runMarketingBrowserOperation(
      "capture active account marketing preference",
      () =>
        captureMarketingReview(
          input.page,
          input.baseUrl,
          "account-marketing-active-mobile"
        )
    );
  });

const runAnonymousMarketingPreferencesFlow = (
  input: WorkspaceE2EMarketingPreferencesInput,
  fixture: WorkspaceE2EMarketingPreferencesFixture,
  accessUrl: string,
  accountLegalUrl: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  withAnonymousMarketingContext(input, (context, page) =>
    Effect.gen(function* () {
      yield* runMarketingBrowserOperation(
        "prime anonymous marketing preferences context",
        () => primePreviewAccess(context, input.baseUrl, input.bypassSecret)
      );
      yield* runMarketingBrowserOperation(
        "assert anonymous marketing preferences context",
        () => assertNoAccountAuthCookie(context)
      );
      yield* runMarketingBrowserOperation(
        "open marketing management link",
        () => navigateWorkspaceE2EMarketingPreferences(page, accessUrl)
      );
      yield* runMarketingBrowserOperation(
        "assert marketing management link redirect",
        () => waitForCanonicalLegalRoute(page, accountLegalUrl)
      );
      yield* runMarketingBrowserOperation(
        "dismiss marketing preferences legal cookie consent",
        () => dismissLegalCookieConsent(page, "en-US")
      );
      yield* runMarketingBrowserOperation(
        "assert pending marketing management link",
        () => requirePendingPreference(page).then(() => undefined)
      );
      yield* runMarketingBrowserOperation(
        "capture pending marketing management link desktop",
        () =>
          captureMarketingReview(
            page,
            input.baseUrl,
            "marketing-link-pending-desktop"
          )
      );
      yield* runMarketingBrowserOperation(
        "capture pending marketing management link mobile",
        () =>
          captureMarketingReview(
            page,
            input.baseUrl,
            "marketing-link-pending-mobile"
          )
      );

      yield* runMarketingBrowserOperation(
        "confirm marketing management link",
        async (signal) => {
          const pending = await requirePendingPreference(page);
          const continueButton = pending.getByRole("button", {
            exact: true,
            name: marketingPreferencesCopy.continueAction,
          });
          await expect(continueButton).toHaveCount(1);
          await waitForReactHandler(
            page,
            `${pendingPreferenceSelector} button`,
            "onClick"
          );
          signal.throwIfAborted();
          await continueButton.click({
            timeout: workspaceE2ETimeouts.browserAction,
          });
          await requireManagedPreference(page, "active", "link");
        }
      );
      yield* waitForPersistedConsentStatus(fixture, "active");
      yield* waitForConsumedMarketingLink(fixture);
      yield* runMarketingBrowserOperation(
        "capture active marketing management link desktop",
        () =>
          captureMarketingReview(
            page,
            input.baseUrl,
            "marketing-link-active-desktop"
          )
      );
      yield* runMarketingBrowserOperation(
        "capture active marketing management link mobile",
        () =>
          captureMarketingReview(
            page,
            input.baseUrl,
            "marketing-link-active-mobile"
          )
      );

      yield* runMarketingBrowserOperation(
        "withdraw marketing management link preference",
        (signal) =>
          submitManagedPreference({
            desiredStatus: "withdrawn",
            page,
            signal,
            source: "link",
            status: "active",
          })
      );
      yield* waitForPersistedConsentStatus(fixture, "withdrawn");
      yield* runMarketingBrowserOperation(
        "reload withdrawn marketing management link preference",
        async () => {
          await page.reload({
            timeout: workspaceE2ETimeouts.browserNavigation,
            waitUntil: "load",
          });
          assertExactPageUrl(page, accountLegalUrl);
          await requireManagedPreference(page, "withdrawn", "link");
        }
      );
      yield* runMarketingBrowserOperation(
        "capture withdrawn marketing management link desktop",
        () =>
          captureMarketingReview(
            page,
            input.baseUrl,
            "marketing-link-withdrawn-desktop"
          )
      );
      yield* runMarketingBrowserOperation(
        "capture withdrawn marketing management link mobile",
        () =>
          captureMarketingReview(
            page,
            input.baseUrl,
            "marketing-link-withdrawn-mobile"
          )
      );

      yield* runMarketingBrowserOperation(
        "opt in marketing management link preference",
        (signal) =>
          submitManagedPreference({
            desiredStatus: "active",
            page,
            signal,
            source: "link",
            status: "withdrawn",
          })
      );
      yield* waitForPersistedConsentStatus(fixture, "active");
      yield* runMarketingBrowserOperation(
        "assert anonymous marketing preferences context after management",
        () => assertNoAccountAuthCookie(context)
      );
    })
  );

const runReplayedMarketingPreferencesFlow = (
  input: WorkspaceE2EMarketingPreferencesInput,
  fixture: WorkspaceE2EMarketingPreferencesFixture,
  accessUrl: string,
  invalidAccessUrl: string,
  accountLegalUrl: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const sessionTokenHashesBeforeReplay = yield* readMarketingManagementTokens(
      fixture.customerId
    ).pipe(Effect.map(sessionTokenHashes));

    yield* withAnonymousMarketingContext(input, (context, page) =>
      Effect.gen(function* () {
        yield* runMarketingBrowserOperation(
          "prime replay marketing preferences context",
          () => primePreviewAccess(context, input.baseUrl, input.bypassSecret)
        );
        yield* runMarketingBrowserOperation(
          "assert replay marketing preferences context",
          () => assertNoAccountAuthCookie(context)
        );
        yield* runMarketingBrowserOperation(
          "replay marketing management link",
          () => navigateWorkspaceE2EMarketingPreferences(page, accessUrl)
        );
        yield* runMarketingBrowserOperation(
          "assert replay marketing management link redirect",
          () => waitForCanonicalLegalRoute(page, accountLegalUrl)
        );
        yield* runMarketingBrowserOperation(
          "dismiss replay marketing preferences legal cookie consent",
          () => dismissLegalCookieConsent(page, "en-US")
        );
        yield* runMarketingBrowserOperation(
          "assert replay pending marketing management link",
          () => requirePendingPreference(page).then(() => undefined)
        );
        yield* runMarketingBrowserOperation(
          "continue replayed marketing management link",
          async (signal) => {
            const pending = await requirePendingPreference(page);
            const continueButton = pending.getByRole("button", {
              exact: true,
              name: marketingPreferencesCopy.continueAction,
            });
            await expect(continueButton).toHaveCount(1);
            await waitForReactHandler(
              page,
              `${pendingPreferenceSelector} button`,
              "onClick"
            );
            signal.throwIfAborted();
            await continueButton.click({
              timeout: workspaceE2ETimeouts.browserAction,
            });
            await requireRejectedReplayPreference(page);
            assertExactPageUrl(page, accountLegalUrl);
          }
        );
        yield* runMarketingBrowserOperation(
          "assert replay marketing preferences context after rejection",
          () => assertNoAccountAuthCookie(context)
        );
        yield* runMarketingBrowserOperation(
          "open malformed marketing management link",
          () => navigateWorkspaceE2EMarketingPreferences(page, invalidAccessUrl)
        );
        yield* runMarketingBrowserOperation(
          "assert malformed marketing management link redirect",
          () => waitForCanonicalLegalRoute(page, accountLegalUrl)
        );
        yield* runMarketingBrowserOperation(
          "assert invalid marketing management link state",
          () => requireInvalidLinkPreference(page).then(() => undefined)
        );
        yield* runMarketingBrowserOperation(
          "capture invalid marketing management link desktop",
          () =>
            captureMarketingReview(
              page,
              input.baseUrl,
              "marketing-link-invalid-desktop"
            )
        );
        yield* runMarketingBrowserOperation(
          "capture invalid marketing management link mobile",
          () =>
            captureMarketingReview(
              page,
              input.baseUrl,
              "marketing-link-invalid-mobile"
            )
        );
        yield* runMarketingBrowserOperation(
          "clear malformed marketing management link",
          async (signal) => {
            const invalid = await requireInvalidLinkPreference(page);
            const clearButton = invalid.getByRole("button", {
              exact: true,
              name: marketingPreferencesCopy.clearAction,
            });
            await waitForReactHandler(
              page,
              `${invalidPreferenceSelector} button`,
              "onClick"
            );
            signal.throwIfAborted();
            await clearButton.click({
              timeout: workspaceE2ETimeouts.browserAction,
            });
            await requireUnavailablePreference(page);
            assertExactPageUrl(page, accountLegalUrl);
          }
        );
        yield* runMarketingBrowserOperation(
          "assert anonymous marketing preferences context after clear",
          () =>
            Promise.all([
              assertNoAccountAuthCookie(context),
              assertNoMarketingManagementCookies(context),
            ]).then(() => undefined)
        );
      })
    );

    const sessionTokenHashesAfterReplay = yield* readMarketingManagementTokens(
      fixture.customerId
    ).pipe(Effect.map(sessionTokenHashes));
    assertNoNewSessionToken(
      sessionTokenHashesBeforeReplay,
      sessionTokenHashesAfterReplay
    );
  });

const assertExactPageUrl = (page: Page, expectedUrl: string): void => {
  assert(
    page.url() === expectedUrl,
    "Marketing preferences page URL was not the expected clean legal URL"
  );
};

export const navigateAuthenticatedWorkspaceE2EMarketingPreferences = async (
  page: Page,
  accountLegalUrl: string
): Promise<void> => {
  await navigateWorkspaceE2EMarketingPreferences(page, accountLegalUrl);
  assertExactPageUrl(page, accountLegalUrl);
};

const verifyWorkspaceE2EMarketingPreferences = Effect.fn(
  "verifyWorkspaceE2EMarketingPreferences"
)(function* (input: WorkspaceE2EMarketingPreferencesInput) {
  yield* Effect.acquireUseRelease(
    seedWorkspaceE2EMarketingPreferences({
      customerId: input.customerId,
    }),
    (fixture) =>
      Effect.gen(function* () {
        const urls = yield* makeMarketingPreferenceUrls({
          baseUrl: input.baseUrl,
          rawLinkToken: fixture.rawLinkToken,
        });

        yield* runAuthenticatedMarketingPreferencesFlow(
          input,
          fixture,
          urls.accountLegalUrl
        );
        yield* runAnonymousMarketingPreferencesFlow(
          input,
          fixture,
          urls.accessUrl,
          urls.accountLegalUrl
        );
        yield* runReplayedMarketingPreferencesFlow(
          input,
          fixture,
          urls.accessUrl,
          urls.invalidAccessUrl,
          urls.accountLegalUrl
        );
      }),
    cleanupWorkspaceE2EMarketingPreferences
  );
});

export { verifyWorkspaceE2EMarketingPreferences };
