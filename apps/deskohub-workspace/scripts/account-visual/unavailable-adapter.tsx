import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import type { CustomerInvoiceListState } from "@/features/account/contracts";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { AccountVisualRoute } from "./account-route";
import { accountVisualFixture as defaultFixture } from "./default-adapter";
import type { AccountVisualAdapterProps } from "./types";

const unavailableFixture = {
  ...defaultFixture,
  invoices: Promise.resolve<CustomerInvoiceListState>({ kind: "unavailable" }),
} satisfies CustomerAccountPageState;

export const accountVisualFixture = unavailableFixture;

export const accountVisualAdapterMetadata = {
  owner: "account-visual invoice-unavailable adapter",
  fixture: "synthetic linked account with unavailable invoices",
} as const;

export function UnavailableAccountAdapter({
  locale,
}: AccountVisualAdapterProps) {
  return (
    <AccountLayoutShell accountsEnabled locale={locale} signedIn>
      <AccountVisualRoute locale={locale} state={unavailableFixture} />
    </AccountLayoutShell>
  );
}

export default UnavailableAccountAdapter;
