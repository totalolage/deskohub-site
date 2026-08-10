import { Plus } from "lucide-react";
import Link from "next/link";
import type {
  AdministrationCustomerActivity,
  AdministrationCustomerConsent,
  AdministrationCustomerTransaction,
  AdministrationMoney,
} from "@/features/administration/administration.service";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  formatAdministrationDateTime,
  formatAdministrationMoney,
  ReservationTable,
} from "@/features/administration/components";
import { groupCustomerReservations } from "@/features/administration/customer-activity";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { AdminPageShell, EmptyState } from "./components";
import {
  AddCodeCustomerForm,
  AdminMutationButton,
  CustomerCodeAction,
  CustomerDiscountGroupForm,
  CustomerSearch,
} from "./customer-admin-client";
import type {
  AdminCustomerProfile,
  AdminDiscountCode,
  AdminDiscountCodeClaim,
  AdminDiscountCodeDetail,
} from "./discount-administration.service";

type Notice = {
  readonly message: string;
  readonly status: "error" | "success";
};

const getCustomerCodeAvailability = (
  code: AdminCustomerProfile["codes"][number]
) => {
  if (!code.eligible) return "Available to all";
  if (code.audienceSize === 1) return "Only this customer";
  return `${code.audienceSize} selected customers`;
};

export function CustomersAdministrationPage({
  notice,
}: {
  readonly notice?: Notice;
}) {
  return (
    <AdminPageShell
      activeSection="customers"
      count={0}
      notice={notice}
      title="Customers"
    >
      <CustomerSearch />
    </AdminPageShell>
  );
}

export function CodeAdministrationDetailPage({
  detail,
  notice,
}: {
  readonly detail: AdminDiscountCodeDetail;
  readonly notice?: Notice;
}) {
  const { code } = detail;
  return (
    <AdminPageShell
      activeSection="codes"
      count={detail.customers.length}
      notice={notice}
      title={code.code}
    >
      <Button asChild className="mb-4" size="sm" variant="ghost">
        <Link href="/admin/codes">← Back to codes</Link>
      </Button>

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
        <ClaimHistory claims={detail.claims} showCode={false} />
      </section>
    </AdminPageShell>
  );
}

export function CustomerAdministrationDetailPage({
  activity,
  notice,
  profile,
}: {
  readonly activity: AdministrationCustomerActivity;
  readonly notice?: Notice;
  readonly profile: AdminCustomerProfile;
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
        Number(right.eligible) - Number(left.eligible) ||
        left.code.localeCompare(right.code)
    );
  const targetedCodeCount = profile.codes.filter(
    (code) => code.eligible && code.audienceSize > 0
  ).length;
  const universalCodeCount = profile.codes.filter(
    (code) => code.audienceSize === 0
  ).length;
  const reservationGroups = groupCustomerReservations(activity.reservations);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        description={
          [profile.customer.email, profile.customer.phone]
            .filter(Boolean)
            .join(" · ") || "No contact details"
        }
        title={profile.customer.displayName}
      />
      <AdministrationNoticeBanner notice={notice} />

      <div className="mb-7 grid gap-5 lg:grid-cols-2">
        <CustomerStats
          activity={activity}
          availableCodes={`${targetedCodeCount} (+ ${universalCodeCount})`}
        />
        <CustomerConsents consents={activity.consents} />
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
                  Create discount code
                </Link>
              </Button>
            </div>
            {visibleCodes.length === 0 ? (
              <EmptyState message="No discount codes are available to this customer." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-navy-blue/10 bg-white">
                <Table
                  aria-label="Customer code eligibility"
                  className="min-w-[620px]"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>Availability</TableHead>
                      <TableHead>
                        <span className="sr-only">Manage eligibility</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleCodes.map((code) => {
                      return (
                        <TableRow key={code.id}>
                          <TableCell>
                            <Link
                              className="font-mono font-semibold underline underline-offset-4"
                              href={`/admin/codes/${code.id}`}
                            >
                              {code.code}
                            </Link>
                          </TableCell>
                          <TableCell>{code.discountLabel}</TableCell>
                          <TableCell>
                            {getCustomerCodeAvailability(code)}
                          </TableCell>
                          <TableCell className="text-right">
                            <CustomerCodeAction
                              audienceSize={code.audienceSize}
                              code={code.code}
                              codeId={code.id}
                              customerId={profile.customer.id}
                              customerName={profile.customer.displayName}
                              eligible={code.eligible}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xl">Discount code history</h2>
            <ClaimHistory claims={profile.claims} showCode />
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
            <h2 className="font-semibold">Contact</h2>
            <dl className="mt-4 grid gap-4 text-sm">
              <CustomerFact
                label="Email"
                value={profile.customer.email ?? "—"}
              />
              <CustomerFact
                label="Phone"
                value={profile.customer.phone ?? "—"}
              />
              <CustomerFact label="Current group" value={currentGroupLabel} />
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
              <CustomerFact
                label="Customer ID"
                value={profile.customer.id}
                mono
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
  consents,
}: {
  readonly consents: readonly AdministrationCustomerConsent[];
}) {
  const byKey = new Map(
    consents.map((consent) => [consent.documentKey, consent])
  );
  return (
    <section>
      <h2 className="mb-3 text-xl">Consents</h2>
      <dl className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
        <CustomerConsent
          consent={byKey.get("privacyPolicy")}
          label="Privacy policy"
        />
        <CustomerConsent
          consent={byKey.get("marketingCommunications")}
          label="Marketing communications"
        />
      </dl>
    </section>
  );
}

function CustomerConsent({
  consent,
  label,
}: {
  readonly consent?: AdministrationCustomerConsent;
  readonly label: string;
}) {
  return (
    <div className="grid gap-1 border-b border-navy-blue/8 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <dt className="font-medium">{label}</dt>
      <dd className="text-sm text-navy-blue/65 sm:text-right">
        {consent ? (
          <>
            <span
              className={
                consent.accepted
                  ? "font-semibold text-aquamarine-ink"
                  : "font-semibold text-red-600"
              }
            >
              {consent.accepted ? "Accepted" : "Declined"}
            </span>{" "}
            · {formatAdministrationDateTime(consent.acceptedAt)}
            <span className="mt-0.5 block text-xs">
              {consent.documentPath.split("/").at(-1)} · {consent.locale}
            </span>
          </>
        ) : (
          "Not recorded"
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
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-blue/10 bg-white">
      <Table
        aria-label="Customer transaction history"
        className="min-w-[760px]"
      >
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reservation</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Payment ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map(({ attempt, reservation }) => (
            <TableRow key={attempt.id}>
              <TableCell className="whitespace-nowrap text-navy-blue/68">
                {formatAdministrationDateTime(attempt.updatedAt)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={attempt.state === "paid" ? "default" : "subtle"}
                >
                  {attempt.stateLabel}
                </Badge>
              </TableCell>
              <TableCell>
                <Link
                  className="font-semibold underline decoration-navy-blue/20 underline-offset-4"
                  href={`/admin/reservations/${reservation.id}`}
                >
                  {reservation.typeLabel}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap font-semibold">
                {formatAdministrationMoney(attempt.amount)}
              </TableCell>
              <TableCell>
                {attempt.providerOrderId ? (
                  <a
                    className="font-mono text-xs font-semibold text-burned-orange-ink underline underline-offset-4"
                    href={`https://xpaydashboard.nexigroup.com/nexi/ordermanagement/order/${encodeURIComponent(attempt.providerOrderId)}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {attempt.providerOrderId} ↗
                  </a>
                ) : (
                  <span className="font-mono text-xs">{attempt.id}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
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
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-navy-blue/10 bg-navy-blue/10 sm:grid-cols-5">
      <SummaryFact label="Discount" value={discountLabel} />
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
        label="Remaining"
        value={code.remainingUses ?? "Unlimited"}
      />
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

function CustomerFact({
  label,
  mono = false,
  value,
}: {
  readonly label: string;
  readonly mono?: boolean;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-blue/65">
        {label}
      </dt>
      <dd className={mono ? "mt-1 break-all font-mono text-xs" : "mt-1"}>
        {value}
      </dd>
    </div>
  );
}

function ClaimHistory({
  claims,
  showCode,
}: {
  readonly claims: readonly AdminDiscountCodeClaim[];
  readonly showCode: boolean;
}) {
  if (claims.length === 0) {
    return <EmptyState message="No code claims yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-navy-blue/10 bg-white">
      <Table aria-label="Discount code claim history" className="min-w-[820px]">
        <TableHeader>
          <TableRow>
            {showCode ? (
              <TableHead>Code</TableHead>
            ) : (
              <TableHead>Customer</TableHead>
            )}
            <TableHead>State</TableHead>
            <TableHead>Reserved</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead>Reservation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {claims.map((claim) => (
            <TableRow key={claim.id}>
              {showCode ? (
                <TableCell>
                  <Link
                    className="font-semibold underline underline-offset-4"
                    href={`/admin/codes/${claim.codeId}`}
                  >
                    View code
                  </Link>
                </TableCell>
              ) : (
                <TableCell>
                  <Link
                    className="font-semibold underline underline-offset-4"
                    href={`/admin/customers/${claim.dotyposCustomerId}`}
                  >
                    View customer
                  </Link>
                </TableCell>
              )}
              <TableCell>
                <Badge
                  variant={claim.state === "released" ? "subtle" : "default"}
                >
                  {claim.state[0]?.toUpperCase()}
                  {claim.state.slice(1)}
                </Badge>
                {claim.releaseReason && (
                  <p className="mt-1 max-w-48 text-xs text-navy-blue/65">
                    {claim.releaseReason}
                  </p>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatInstant(claim.reservedAt)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatInstant(claim.redeemedAt ?? claim.releasedAt)}
              </TableCell>
              <TableCell>
                <Link
                  className="font-semibold underline underline-offset-4"
                  href={`/admin/reservations/${claim.workspaceReservationId}`}
                >
                  Open reservation
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const formatInstant = (instant: Temporal.Instant | null) =>
  instant
    ? instant.toZonedDateTimeISO("Europe/Prague").toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
