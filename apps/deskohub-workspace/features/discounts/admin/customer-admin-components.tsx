import Link from "next/link";
import type { AdministrationReservationPage } from "@/features/administration/administration.service";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  Pagination,
  ReservationTable,
} from "@/features/administration/components";
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
  notice,
  profile,
  reservations,
}: {
  readonly notice?: Notice;
  readonly profile: AdminCustomerProfile;
  readonly reservations: AdministrationReservationPage;
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
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        description="Customer details, associated reservations, and discount access."
        eyebrow="Customer"
        title={profile.customer.displayName}
      />
      <AdministrationNoticeBanner notice={notice} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-7">
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xl">Reservations</h2>
                <p className="mt-1 text-sm text-navy-blue/65">
                  Reservations associated with this customer.
                </p>
              </div>
              <span className="text-sm text-navy-blue/65">
                {reservations.total} total
              </span>
            </div>
            <ReservationTable
              emptyMessage="This customer has no reservations."
              reservations={reservations.items}
            />
            <Pagination
              basePath={`/admin/customers/${profile.customer.id}`}
              page={reservations.page}
              pageCount={reservations.pageCount}
              pageParam="reservationsPage"
            />
          </section>

          <section>
            <h2 className="mb-3 text-xl">Discount codes</h2>
            {profile.codes.length === 0 ? (
              <EmptyState message="No discount codes exist." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-navy-blue/10 bg-white">
                <Table
                  aria-label="Customer code eligibility"
                  className="min-w-[720px]"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>Audience</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {profile.codes.map((code) => {
                      let eligibilityLabel = "Not eligible";
                      if (code.eligible) eligibilityLabel = "Allowlisted";
                      else if (code.audienceSize === 0)
                        eligibilityLabel = "Eligible";

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
                            {code.audienceSize === 0
                              ? "Unrestricted"
                              : `${code.audienceSize} customers`}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={code.eligible ? "default" : "subtle"}
                            >
                              {eligibilityLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <CustomerCodeAction
                              code={code}
                              customerId={profile.customer.id}
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

function CustomerCodeAction({
  code,
  customerId,
}: {
  readonly code: AdminCustomerProfile["codes"][number];
  readonly customerId: AdminCustomerProfile["customer"]["id"];
}) {
  if (code.eligible && code.audienceSize === 1) {
    return (
      <AdminMutationButton
        confirmation={`Make ${code.code} unrestricted? Every Dotypos customer will be eligible.`}
        mutation={{ kind: "make-code-unrestricted", codeId: code.id }}
      >
        Make unrestricted
      </AdminMutationButton>
    );
  }
  if (code.eligible) {
    return (
      <AdminMutationButton
        confirmation={`Remove this customer from ${code.code}?`}
        mutation={{
          kind: "remove-code-customer",
          codeId: code.id,
          customerId,
        }}
      >
        Remove
      </AdminMutationButton>
    );
  }

  return (
    <AdminMutationButton
      confirmation={
        code.audienceSize === 0
          ? `Restrict ${code.code} to this customer?`
          : undefined
      }
      mutation={{
        kind: "add-code-customer",
        codeId: code.id,
        customerId,
      }}
    >
      Add
    </AdminMutationButton>
  );
}

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
