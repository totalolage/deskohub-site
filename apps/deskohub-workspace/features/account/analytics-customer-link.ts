"use client";

import type { DotyposCustomerId } from "@deskohub/dotypos/types";
import { Data, Effect, Schema } from "effect";
import { runWorkspaceBrowserEffect } from "@/shared/browser/workspace-browser-effect";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import {
  type AccountCustomerLinkResponse,
  accountCustomerLinkPath,
  accountCustomerLinkResponseSchema,
} from "./account-customer-link";
import type { CustomerAccountId } from "./customer-account";

type KnownCustomerLink = {
  readonly accountId: CustomerAccountId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

class AccountCustomerLinkLoadError extends Data.TaggedError(
  "AccountCustomerLinkLoadError"
)<{ readonly cause?: unknown; readonly status?: number }> {}

const loadFailureCode = "account.analytics-customer-link.load-failed";

const listeners = new Set<() => void>();

// A claimed link never changes for the account, so a known link is kept for
// the page's lifetime. A missing link is asked for again on the next request.
let knownLink: KnownCustomerLink | undefined;
let loadingAccountId: CustomerAccountId | undefined;
let requestedAccountId: CustomerAccountId | undefined;
let reloadAfterLoad = false;

const loadAccountCustomerLink = Effect.tryPromise({
  try: (signal) =>
    fetch(accountCustomerLinkPath, {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    }),
  catch: (cause) => new AccountCustomerLinkLoadError({ cause }),
}).pipe(
  Effect.filterOrFail(
    (response) => response.ok,
    (response) => new AccountCustomerLinkLoadError({ status: response.status })
  ),
  Effect.flatMap((response) =>
    Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => new AccountCustomerLinkLoadError({ cause }),
    })
  ),
  Effect.flatMap(Schema.decodeUnknownEffect(accountCustomerLinkResponseSchema))
);

const rememberLink = (
  accountId: CustomerAccountId,
  link: AccountCustomerLinkResponse
) => {
  // The session can change while the request is in flight.
  if (link.accountId !== accountId || link.dotyposCustomerId === null) return;

  knownLink = { accountId, dotyposCustomerId: link.dotyposCustomerId };
  for (const listener of [...listeners]) listener();
};

/** The account's Dotypos customer ID once it has loaded, never contact data. */
export function getAnalyticsDotyposCustomerId(
  accountId: CustomerAccountId
): DotyposCustomerId | undefined {
  return knownLink?.accountId === accountId
    ? knownLink.dotyposCustomerId
    : undefined;
}

/**
 * Loads the account's Dotypos customer ID unless it is already known or
 * loading. Callers ask only after analytics consent, for the settled account.
 */
export function requestAnalyticsDotyposCustomerId(
  accountId: CustomerAccountId
): void {
  requestedAccountId = accountId;
  if (knownLink?.accountId === accountId || loadingAccountId === accountId) {
    return;
  }

  loadingAccountId = accountId;
  void loadAccountCustomerLink.pipe(
    Effect.tap((link) => Effect.sync(() => rememberLink(accountId, link))),
    Effect.tapError((cause) =>
      reportWorkspaceBrowserFailure(loadFailureCode, cause)
    ),
    Effect.ignore,
    Effect.ensuring(
      Effect.sync(() => {
        if (loadingAccountId !== accountId) return;
        loadingAccountId = undefined;
        if (!reloadAfterLoad) return;
        reloadAfterLoad = false;
        requestAnalyticsDotyposCustomerId(accountId);
      })
    ),
    runWorkspaceBrowserEffect("account.analytics-customer-link.load")
  );
}

/**
 * Asks again for the account analytics last requested, after a change such as
 * profile completion may have created its Dotypos customer. Without an
 * earlier consented request this does nothing.
 */
export function refreshAnalyticsDotyposCustomerId(): void {
  if (requestedAccountId === undefined) return;
  // A load already in flight may have read the account before the change.
  if (loadingAccountId === requestedAccountId) {
    reloadAfterLoad = true;
    return;
  }
  requestAnalyticsDotyposCustomerId(requestedAccountId);
}

export function subscribeAnalyticsDotyposCustomerId(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
