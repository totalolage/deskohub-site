import { AccountSignInRedirect } from "@/features/account/components/account-sign-in-redirect";
import { InvoiceHistoryPanel } from "@/features/account/components/billing/invoice-history";
import { ReservationHistory } from "@/features/account/components/reservation-history";
import { SessionRefresh } from "@/features/account/components/session-refresh";
import {
  AccountUnavailableCard,
  SignedInAccount,
  type SignedInAccountState,
} from "@/features/account/components/signed-in-account";
import type {
  CustomerInvoiceHistory,
  CustomerReservationHistory,
} from "@/features/account/contracts";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import type { Locale } from "@/features/i18n";

export function AccountPage({
  loadInvoiceHistory,
  locale,
  state,
}: {
  /**
   * Starts loading the account's invoice history. Only a linked or review
   * account's page calls it, and the history streams into the Billing
   * section without holding up the page.
   */
  readonly loadInvoiceHistory: () => Promise<CustomerInvoiceHistory>;
  readonly locale: Locale;
  readonly state: CustomerAccountPageState;
}) {
  if (state.kind === "unauthenticated") {
    return <AccountSignInRedirect locale={locale} />;
  }
  if (state.kind === "unavailable") {
    return <AccountUnavailableCard locale={locale} />;
  }

  return (
    <>
      <SessionRefresh />
      <SignedInAccount
        invoices={
          (state.kind === "linked" || state.kind === "review-account") && (
            <InvoiceHistoryPanel
              history={loadInvoiceHistory()}
              locale={locale}
            />
          )
        }
        locale={locale}
        state={withRenderedReservations(state, locale)}
      />
    </>
  );
}

/**
 * Renders the state's reservation history on the server, where its `Intl`
 * dates are formatted, and leaves the history itself out of the client view.
 */
function withRenderedReservations(
  state: Exclude<
    CustomerAccountPageState,
    { readonly kind: "unauthenticated" | "unavailable" }
  >,
  locale: Locale
): SignedInAccountState {
  const render = (history: CustomerReservationHistory) => ({
    count:
      history.kind === "available" ? history.groups.current.length : undefined,
    history: <ReservationHistory history={history} locale={locale} />,
  });
  switch (state.kind) {
    case "linked":
    case "review-account": {
      const { history, ...rest } = state;
      return { ...rest, reservations: render(history) };
    }
    case "completion-required":
    case "support-required": {
      const { history, ...rest } = state;
      return history === undefined
        ? rest
        : { ...rest, reservations: render(history) };
    }
    case "authenticated-unavailable":
    case "deletion-pending":
      return state;
  }
}
