import { Plus } from "lucide-react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import type {
  AdministrationCustomerActivity,
  AdministrationCustomerMarketingConsent,
  AdministrationCustomerReservationActivity,
  AdministrationCustomerTransaction,
  AdministrationMoney,
} from "@/features/administration/administration.service";
import {
  AdministrationFact,
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  AdministrationStatusBadge,
  CustomerReservationActivity,
  EmptyState,
  formatAdministrationDateTime,
  formatAdministrationMoney,
  ReservationTable,
} from "@/features/administration/components";
import { groupCustomerReservations } from "@/features/administration/customer-activity";
import { Button } from "@/shared/components/ui/button";
import { VoucherEditor } from "./admin-tables";
import {
  AddCodeCustomerForm,
  AddVoucherCustomerForm,
  AdminMutationButton,
  CustomerDiscountGroupForm,
} from "./customer-admin-client";
import {
  ClaimHistoryTable,
  CustomerCodeEligibilityTable,
  CustomerTransactionHistoryTable,
  CustomerVoucherEligibilityTable,
} from "./customer-admin-tables";
import type {
  AdminCustomerProfile,
  AdminDiscountCode,
  AdminDiscountCodeClaim,
  AdminDiscountCodeDetail,
  AdminVoucher,
  AdminVoucherClaim,
  AdminVoucherDetail,
} from "./discount-administration.service";

type Notice = {
  readonly message: string;
  readonly status: "error" | "success";
};

export function CodeAdministrationDetailPage({
  detail,
  notice,
}: {
  readonly detail: AdminDiscountCodeDetail;
  readonly notice?: Notice;
}) {
  const { code } = detail;
  return (
    <AdministrationPage>
      <AdministrationPageHeader title={code.code} />
      <AdministrationNoticeBanner notice={notice} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link href="/admin/codes">← Back to codes</Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href="/admin/codes">Edit or delete code</Link>
        </Button>
      </div>

      <CodeSummary code={code} discountLabel={detail.discountLabel} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-blue/10 px-5 py-4">
            <div>
              <h2 className="font-semibold">Audience</h2>
              <p className="mt-1 text-sm text-navy-blue/65">
                {detail.customers.length === 0
                  ? "Any Dotypos customer can use this code."
                  : `${detail.customers.length} customers can use this code.`}
              </p>
            </div>
            {detail.customers.length > 0 && (
              <AdminMutationButton
                confirmation="Make this code unrestricted? Every Dotypos customer will be eligible."
                mutation={{
                  kind: "make-code-unrestricted",
                  codeId: code.id,
                }}
              >
                Make unrestricted
              </AdminMutationButton>
            )}
          </div>
          {detail.customers.length === 0 ? (
            <EmptyState message="Unrestricted audience" />
          ) : (
            <ul className="divide-y divide-navy-blue/10">
              {detail.customers.map(({ customer, customerId }) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                  key={customerId}
                >
                  <div>
                    <Link
                      className="font-semibold underline decoration-navy-blue/25 underline-offset-4"
                      href={`/admin/customers/${customerId}`}
                    >
                      {customer?.displayName ?? "Details unavailable"}
                    </Link>
                    <p className="mt-1 text-sm text-navy-blue/65">
                      {customer
                        ? [customer.email, customer.phone]
                            .filter(Boolean)
                            .join(" · ") || "No contact details"
                        : customerId}
                    </p>
                  </div>
                  {detail.customers.length > 1 ? (
                    <AdminMutationButton
                      confirmation={`Remove ${customer?.displayName ?? customerId} from this code audience?`}
                      mutation={{
                        kind: "remove-code-customer",
                        codeId: code.id,
                        customerId,
                      }}
                    >
                      Remove
                    </AdminMutationButton>
                  ) : (
                    <span className="text-xs text-navy-blue/65">
                      Use Make unrestricted
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-5">
          <h2 className="font-semibold">Add customer</h2>
          <p className="mb-4 mt-1 text-sm leading-5 text-navy-blue/65">
            Adding the first customer changes an unrestricted code into a
            restricted code.
          </p>
          <AddCodeCustomerForm codeId={code.id} />
          <Link
            className="mt-4 inline-block text-sm font-semibold underline underline-offset-4"
            href="/admin/customers"
          >
            Find a Dotypos customer
          </Link>
        </aside>
      </div>

      <section className="mt-5">
        <h2 className="mb-3 font-semibold">Claim history</h2>
        <ClaimHistory claims={detail.claims} resource="code-customer" />
      </section>
    </AdministrationPage>
  );
}

export function VoucherAdministrationDetailPage({
  detail,
  notice,
}: {
  readonly detail: AdminVoucherDetail;
  readonly notice?: Notice;
}) {
  const { voucher } = detail;
  return (
    <AdministrationPage>
      <AdministrationPageHeader title={voucher.code} />
      <AdministrationNoticeBanner notice={notice} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link href="/admin/vouchers">← Back to vouchers</Link>
        </Button>
      </div>

      <VoucherSummary voucher={voucher} />

      <section className="mt-5 rounded-xl border border-navy-blue/10 bg-white p-5">
        <h2 className="mb-4 font-semibold">Configuration</h2>
        <VoucherEditor
          deletable
          deleteRedirect="/admin/vouchers"
          voucher={{
            ...voucher,
            validFrom: voucher.validFrom?.toString() ?? null,
            validUntil: voucher.validUntil?.toString() ?? null,
          }}
        />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-blue/10 px-5 py-4">
            <div>
              <h2 className="font-semibold">Audience</h2>
              <p className="mt-1 text-sm text-navy-blue/65">
                {detail.customers.length === 0
                  ? "Any Dotypos customer can use this voucher."
                  : `${detail.customers.length} customers can use this voucher.`}
              </p>
            </div>
            {detail.customers.length > 0 && (
              <AdminMutationButton
                confirmation="Make this voucher unrestricted? Every Dotypos customer will be eligible."
                mutation={{
                  kind: "make-voucher-unrestricted",
                  voucherId: voucher.id,
                }}
              >
                Make unrestricted
              </AdminMutationButton>
            )}
          </div>
          {detail.customers.length === 0 ? (
            <EmptyState message="Unrestricted audience" />
          ) : (
            <ul className="divide-y divide-navy-blue/10">
              {detail.customers.map(({ customer, customerId }) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                  key={customerId}
                >
                  <div>
                    <Link
                      className="font-semibold underline decoration-navy-blue/25 underline-offset-4"
                      href={`/admin/customers/${customerId}`}
                    >
                      {customer?.displayName ?? "Details unavailable"}
                    </Link>
                    <p className="mt-1 text-sm text-navy-blue/65">
                      {customer
                        ? [customer.email, customer.phone]
                            .filter(Boolean)
                            .join(" · ") || "No contact details"
                        : customerId}
                    </p>
                  </div>
                  {detail.customers.length > 1 ? (
                    <AdminMutationButton
                      confirmation={`Remove ${customer?.displayName ?? customerId} from this voucher audience?`}
                      mutation={{
                        kind: "remove-voucher-customer",
                        voucherId: voucher.id,
                        customerId,
                      }}
                    >
                      Remove
                    </AdminMutationButton>
                  ) : (
                    <span className="text-xs text-navy-blue/65">
                      Use Make unrestricted
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-5">
          <h2 className="font-semibold">Add customer</h2>
          <p className="mb-4 mt-1 text-sm leading-5 text-navy-blue/65">
            Adding the first customer changes an unrestricted voucher into a
            restricted voucher.
          </p>
          <AddVoucherCustomerForm voucherId={voucher.id} />
        </aside>
      </div>

      <section className="mt-5">
        <h2 className="mb-3 font-semibold">Claim history</h2>
        <ClaimHistory claims={detail.claims} resource="voucher-customer" />
      </section>
    </AdministrationPage>
  );
}

export function CustomerAdministrationDetailPage({
  activity,
  notice,
  profile,
  reservationActivity,
}: {
  readonly activity: AdministrationCustomerActivity;
  readonly notice?: Notice;
  readonly profile: AdminCustomerProfile;
  readonly reservationActivity: AdministrationCustomerReservationActivity;
}) {
  const currentGroup = profile.discountGroups.find(
    ({ id }) => id === profile.customer.discountGroupId
  );
  let currentGroupLabel = "None";
  if (currentGroup) {
    currentGroupLabel = `${currentGroup.name} (${currentGroup.basisPoints / 100}%)`;
  } else if (profile.customer.discountGroupId) {
    currentGroupLabel = `Unavailable (${profile.customer.discountGroupId})`;
  }
  const visibleCodes = profile.codes
    .filter((code) => code.eligible || code.audienceSize === 0)
    .toSorted(
      (left, right) =>
        Number(right.enabled) - Number(left.enabled) ||
        Number(right.eligible) - Number(left.eligible) ||
        left.code.localeCompare(right.code)
    );
  const targetedCodeCount = profile.codes.filter(
    (code) => code.enabled && code.eligible && code.audienceSize > 0
  ).length;
  const universalCodeCount = profile.codes.filter(
    (code) => code.enabled && code.audienceSize === 0
  ).length;
  const visibleVouchers = profile.vouchers
    .filter((voucher) => voucher.eligible || voucher.audienceSize === 0)
    .toSorted((left, right) => left.code.localeCompare(right.code));
  const reservationGroups = groupCustomerReservations(activity.reservations);
  return (
    <AdministrationPage>
      <AdministrationPageHeader title={profile.customer.displayName} />
      <AdministrationNoticeBanner notice={notice} />

      <CustomerReservationActivity activity={reservationActivity} />

      <div className="mb-7 grid gap-5 lg:grid-cols-2">
        <CustomerStats
          activity={activity}
          availableCodes={`${targetedCodeCount} (+ ${universalCodeCount})`}
        />
        <CustomerConsents consent={activity.marketingConsent} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-7">
          <section>
            <h2 className="mb-3 text-xl">Reservations</h2>
            {activity.reservationHistoryTruncated && (
              <p className="mb-3 text-sm text-navy-blue/65">
                Showing the 24 most recently updated reservations.{" "}
                <Link
                  className="font-semibold underline underline-offset-4"
                  href={`/admin/reservations?customerId=${encodeURIComponent(profile.customer.id)}`}
                >
                  View all reservations
                </Link>
              </p>
            )}
            <div className="space-y-4">
              <details className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
                <summary className="cursor-pointer px-5 py-4 font-semibold">
                  Past reservations ({reservationGroups.past.length})
                </summary>
                <div className="border-t border-navy-blue/10 p-3">
                  <ReservationTable
                    emptyMessage="This customer has no past reservations."
                    reservations={reservationGroups.past}
                    showCustomer={false}
                  />
                </div>
              </details>

              <section aria-labelledby="current-reservations-heading">
                <h3
                  className="mb-3 font-semibold"
                  id="current-reservations-heading"
                >
                  Current and future reservations
                </h3>
                <ReservationTable
                  emptyMessage={
                    activity.reservationHistoryTruncated
                      ? "No current or future reservations are present in this recent activity view."
                      : "This customer has no current or future reservations."
                  }
                  reservations={reservationGroups.currentAndFuture}
                  showCustomer={false}
                />
              </section>

              {reservationGroups.unavailable.length > 0 && (
                <details className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
                  <summary className="cursor-pointer px-5 py-4 font-semibold">
                    Reservations with unavailable dates (
                    {reservationGroups.unavailable.length})
                  </summary>
                  <div className="border-t border-navy-blue/10 p-3">
                    <ReservationTable
                      reservations={reservationGroups.unavailable}
                      showCustomer={false}
                    />
                  </div>
                </details>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xl">Transactions</h2>
            {activity.transactionHistoryTruncated && (
              <p className="mb-3 text-sm text-navy-blue/65">
                Showing the 50 latest transactions.
              </p>
            )}
            <CustomerTransactionHistory transactions={activity.transactions} />
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-xl">Discount codes</h2>
              <Button asChild size="sm">
                <Link
                  href={`/admin/customers/${profile.customer.id}/create-code`}
                >
                  <Plus aria-hidden className="size-4" />
                  Create code
                </Link>
              </Button>
            </div>
            {visibleCodes.length === 0 ? (
              <EmptyState message="No discount codes are available to this customer." />
            ) : (
              <CustomerCodeEligibilityTable
                codes={visibleCodes.map(
                  ({
                    audienceSize,
                    code,
                    discountAdjustment,
                    discountLabel,
                    eligible,
                    enabled,
                    id,
                  }) => ({
                    audienceSize,
                    code,
                    discountAdjustment,
                    discountLabel,
                    eligible,
                    enabled,
                    id,
                  })
                )}
                customerId={profile.customer.id}
                customerName={profile.customer.displayName}
              />
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xl">Discount code history</h2>
            <ClaimHistory claims={profile.claims} resource="code" />
          </section>

          <section>
            <h2 className="mb-3 text-xl">Vouchers</h2>
            {visibleVouchers.length === 0 ? (
              <EmptyState message="No vouchers are available to this customer." />
            ) : (
              <CustomerVoucherEligibilityTable
                vouchers={visibleVouchers.map(
                  ({
                    audienceSize,
                    code,
                    eligible,
                    id,
                    issuedCredit,
                    remainingCredit,
                  }) => ({
                    audienceSize,
                    code,
                    eligible,
                    id,
                    issuedCredit,
                    remainingCredit,
                  })
                )}
              />
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xl">Voucher history</h2>
            <ClaimHistory claims={profile.voucherClaims} resource="voucher" />
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
            <h2 className="font-semibold">Contact</h2>
            <dl className="mt-4 grid gap-4 text-sm">
              <AdministrationFact
                label="Email"
                value={profile.customer.email ?? "—"}
              />
              <AdministrationFact
                label="Phone"
                value={profile.customer.phone ?? "—"}
              />
              <AdministrationFact
                label="Current group"
                value={currentGroupLabel}
              />
            </dl>
          </section>

          <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
            <h2 className="mb-4 font-semibold">Discount group</h2>
            <CustomerDiscountGroupForm
              currentGroupId={profile.customer.discountGroupId}
              customerId={profile.customer.id}
              discountGroups={profile.discountGroups}
            />
          </section>

          <details className="rounded-xl border border-navy-blue/10 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              Reference
            </summary>
            <div className="border-t border-navy-blue/10 px-5 py-4">
              <AdministrationFact
                label="Customer ID"
                value={profile.customer.id}
                valueClassName="break-all font-mono text-xs"
              />
            </div>
          </details>
        </aside>
      </div>
    </AdministrationPage>
  );
}

function CustomerStats({
  activity,
  availableCodes,
}: {
  readonly activity: AdministrationCustomerActivity;
  readonly availableCodes: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl">Stats</h2>
      <dl className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
        <CustomerStat
          label="Reservations"
          value={activity.stats.reservationCount}
        />
        <CustomerStat
          label="Total revenue"
          value={formatMoneyTotals(activity.stats.revenue)}
        />
        <CustomerStat
          label="Favourite product"
          value={activity.stats.favoriteProduct ?? "—"}
        />
        <CustomerStat
          label="Discount savings"
          value={formatMoneyTotals(activity.stats.discountSavings)}
        />
        <CustomerStat label="Available codes" value={availableCodes} />
      </dl>
    </section>
  );
}

function CustomerStat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-navy-blue/8 px-4 py-2.5 last:border-b-0 odd:bg-navy-blue/[0.025]">
      <dt className="text-sm text-navy-blue/72">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}

function CustomerConsents({
  consent,
}: {
  readonly consent: AdministrationCustomerMarketingConsent | null;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl">Consents</h2>
      <dl className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
        <CustomerConsent consent={consent} />
      </dl>
    </section>
  );
}

function CustomerConsent({
  consent,
}: {
  readonly consent: AdministrationCustomerMarketingConsent | null;
}) {
  const withdrawnAt = consent?.withdrawnAt;
  return (
    <div className="grid gap-1 border-b border-navy-blue/8 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <dt className="font-medium">Marketing communications</dt>
      <dd className="text-sm text-navy-blue/65 sm:text-right">
        {consent ? (
          <>
            <AdministrationStatusBadge
              tone={withdrawnAt ? "attention" : "positive"}
            >
              {withdrawnAt ? "Withdrawn" : "Granted"}
            </AdministrationStatusBadge>{" "}
            · {formatAdministrationDateTime(withdrawnAt ?? consent.grantedAt)}
            <span className="mt-0.5 block break-all text-xs">
              {withdrawnAt && (
                <>
                  Granted {formatAdministrationDateTime(consent.grantedAt)} ·{" "}
                </>
              )}
              {consent.locale} · {consent.documentHash}
            </span>
          </>
        ) : (
          "Not granted"
        )}
      </dd>
    </div>
  );
}

function CustomerTransactionHistory({
  transactions,
}: {
  readonly transactions: readonly AdministrationCustomerTransaction[];
}) {
  if (transactions.length === 0) {
    return <EmptyState message="This customer has no payments." />;
  }
  return <CustomerTransactionHistoryTable transactions={transactions} />;
}

const formatMoneyTotals = (totals: readonly AdministrationMoney[]) =>
  totals.length > 0 ? totals.map(formatAdministrationMoney).join(" + ") : "—";

function CodeSummary({
  code,
  discountLabel,
}: {
  readonly code: AdminDiscountCode;
  readonly discountLabel: string;
}) {
  const benefit = discountLabel;
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-navy-blue/10 bg-navy-blue/10 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryFact label="Benefit" value={benefit} />
      <SummaryFact
        label="Status"
        value={code.enabled ? "Enabled" : "Disabled"}
      />
      <SummaryFact label="Valid from" value={formatInstant(code.validFrom)} />
      <SummaryFact label="Valid until" value={formatInstant(code.validUntil)} />
      <SummaryFact
        label="Audience"
        value={
          code.audienceSize === 0
            ? "Unrestricted"
            : `${code.audienceSize} customers`
        }
      />
      <SummaryFact label="Reserved" value={code.reservedUses} />
      <SummaryFact label="Redeemed" value={code.redeemedUses} />
      <SummaryFact
        label="Remaining globally"
        value={code.remainingUses ?? "Unlimited"}
      />
      <SummaryFact
        label="Uses per customer"
        value={code.maxUsesPerCustomer ?? "Unlimited"}
      />
    </dl>
  );
}

function VoucherSummary({ voucher }: { readonly voucher: AdminVoucher }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-navy-blue/10 bg-navy-blue/10 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryFact
        label="Issued"
        value={formatAdministrationMoney(voucher.issuedCredit)}
      />
      <SummaryFact
        label="Remaining"
        value={formatAdministrationMoney(voucher.remainingCredit)}
      />
      <SummaryFact
        label="Status"
        value={voucher.enabled ? "Enabled" : "Disabled"}
      />
      <SummaryFact
        label="Audience"
        value={
          voucher.audienceSize === 0
            ? "Unrestricted"
            : `${voucher.audienceSize} customers`
        }
      />
      <SummaryFact
        label="Valid from"
        value={formatInstant(voucher.validFrom)}
      />
      <SummaryFact
        label="Valid until"
        value={formatInstant(voucher.validUntil)}
      />
      <SummaryFact label="Reserved" value={voucher.reservedUses} />
      <SummaryFact label="Redeemed" value={voucher.redeemedUses} />
    </dl>
  );
}

function SummaryFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-blue/65">
        {label}
      </dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function ClaimHistory({
  claims,
  resource,
}: {
  readonly claims: readonly (AdminDiscountCodeClaim | AdminVoucherClaim)[];
  readonly resource: "code" | "code-customer" | "voucher" | "voucher-customer";
}) {
  const isVoucher = resource.startsWith("voucher");
  const subjectLabel = isVoucher ? "Voucher" : "Discount code";
  if (claims.length === 0) {
    return (
      <EmptyState message={`No ${subjectLabel.toLowerCase()} claims yet.`} />
    );
  }

  return (
    <ClaimHistoryTable
      claims={claims.map((claim) => ({
        id: claim.id,
        appliedAmount: claim.appliedAmount,
        ...("codeId" in claim
          ? { codeId: claim.codeId }
          : { voucherId: claim.voucherId }),
        dotyposCustomerId: claim.dotyposCustomerId,
        redeemedAt: claim.redeemedAt?.toString() ?? null,
        releasedAt: claim.releasedAt?.toString() ?? null,
        releaseReason: claim.releaseReason,
        reservedAt: claim.reservedAt.toString(),
        state: claim.state,
        workspaceReservationId: claim.workspaceReservationId,
      }))}
      resource={resource}
    />
  );
}

const formatInstant = (instant: Temporal.Instant | null) =>
  instant
    ? instant.toZonedDateTimeISO("Europe/Prague").toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
