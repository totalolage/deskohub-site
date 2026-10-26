import { Plus } from "lucide-react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import type {
  AdministrationCustomerActivity,
  AdministrationCustomerMarketingConsent,
  AdministrationCustomerReservationActivity,
  AdministrationCustomerTransaction,
} from "@/features/administration/administration.service";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationFact,
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  CustomerReservationActivity,
  EmptyState,
  formatAdministrationDateTime,
  ReservationTable,
} from "@/features/administration/components";
import { groupCustomerReservations } from "@/features/administration/customer-activity";
import { m } from "@/features/administration/i18n";
import { getAdministrationReservationProductTitle } from "@/features/administration/reservation-product";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { Locale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { formatMoney, type Money } from "@/shared/money/money";
import { formatCount } from "@/shared/utils/number";
import { VoucherEditor } from "./admin-tables";
import {
  AddCodeCustomerForm,
  AddVoucherCustomerForm,
  AdminMutationButton,
  CustomerDiscountGroupForm,
} from "./customer-admin-client";
import {
  ClaimHistoryTable,
  CustomerPromotionCodeTable,
  CustomerTransactionHistoryTable,
} from "./customer-admin-tables";
import { formatDiscountAdminCustomerName } from "./customer-display-name";
import type {
  AdminCustomerProfile,
  AdminDiscountCode,
  AdminDiscountCodeClaim,
  AdminDiscountCodeDetail,
  AdminVoucher,
  AdminVoucherClaim,
  AdminVoucherDetail,
} from "./discount-administration.service";
import { formatDiscountUsageLimit } from "./usage-limit";

type Notice = {
  readonly message: string;
  readonly status: "error" | "success";
};

export function CodeAdministrationDetailPage({
  detail,
  locale,
  notice,
}: {
  readonly detail: AdminDiscountCodeDetail;
  readonly locale: Locale;
  readonly notice?: Notice;
}) {
  const { code } = detail;
  return (
    <AdministrationPage>
      <AdministrationPageHeader title={code.code} />
      <AdministrationNoticeBanner notice={notice} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link href={administrationHref("/[locale]/admin/codes")}>
            {m.discountsBackToCodes({}, { locale })}
          </Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href={administrationHref("/[locale]/admin/codes")}>
            {m.discountsEditOrDeleteCode({}, { locale })}
          </Link>
        </Button>
      </div>

      <CodeSummary
        code={code}
        discountLabel={detail.discountLabels[locale]}
        locale={locale}
      />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-blue/10 px-5 py-4">
            <div>
              <h2 className="font-semibold">
                {m.discountsColumnAudience({}, { locale })}
              </h2>
              <p className="mt-1 text-sm text-navy-blue/65">
                {detail.customers.length === 0
                  ? m.discountsCodeAudienceUnrestricted({}, { locale })
                  : m.discountsCodeAudienceCount(
                      { count: detail.customers.length },
                      { locale }
                    )}
              </p>
            </div>
            {detail.customers.length > 0 && (
              <AdminMutationButton
                confirmation={m.discountsCodeMakeUnrestrictedConfirmation(
                  {},
                  { locale }
                )}
                mutation={{
                  kind: "make-code-unrestricted",
                  codeId: code.id,
                }}
              >
                {m.discountsMakeUnrestricted({}, { locale })}
              </AdminMutationButton>
            )}
          </div>
          {detail.customers.length === 0 ? (
            <EmptyState message={m.discountsAudienceEmpty({}, { locale })} />
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
                      href={administrationHref(
                        "/[locale]/admin/customers/[customerId]",
                        { customerId }
                      )}
                    >
                      {customer
                        ? formatDiscountAdminCustomerName(customer, locale)
                        : m.discountsCustomerDetailsUnavailable({}, { locale })}
                    </Link>
                    <p className="mt-1 text-sm text-navy-blue/65">
                      {customer
                        ? [customer.email, customer.phone]
                            .filter(Boolean)
                            .join(" · ") ||
                          m.discountsCustomerNoContactDetails({}, { locale })
                        : customerId}
                    </p>
                  </div>
                  {detail.customers.length > 1 ? (
                    <AdminMutationButton
                      confirmation={m.discountsCodeRemoveCustomerConfirmation(
                        {
                          customerName: customer
                            ? formatDiscountAdminCustomerName(customer, locale)
                            : customerId,
                        },
                        { locale }
                      )}
                      mutation={{
                        kind: "remove-code-customer",
                        codeId: code.id,
                        customerId,
                      }}
                    >
                      {m.discountsRemove({}, { locale })}
                    </AdminMutationButton>
                  ) : (
                    <span className="text-xs text-navy-blue/65">
                      {m.discountsUseMakeUnrestricted({}, { locale })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-5">
          <h2 className="font-semibold">
            {m.discountsAddCustomer({}, { locale })}
          </h2>
          <p className="mb-4 mt-1 text-sm leading-5 text-navy-blue/65">
            {m.discountsCodeAddCustomerDescription({}, { locale })}
          </p>
          <AddCodeCustomerForm codeId={code.id} />
          <Link
            className="mt-4 inline-block text-sm font-semibold underline underline-offset-4"
            href={administrationHref("/[locale]/admin/customers")}
          >
            {m.discountsFindDotyposCustomer({}, { locale })}
          </Link>
        </aside>
      </div>

      <section className="mt-5">
        <h2 className="mb-3 font-semibold">
          {m.discountsClaimHistoryTitle({}, { locale })}
        </h2>
        <ClaimHistory
          ariaLabel={m.discountsCodeClaimHistoryLabel({}, { locale })}
          claims={detail.claims}
          emptyMessage={m.discountsCodeClaimsEmpty({}, { locale })}
          locale={locale}
          subject="customer"
        />
      </section>
    </AdministrationPage>
  );
}

export function VoucherAdministrationDetailPage({
  detail,
  locale,
  notice,
}: {
  readonly detail: AdminVoucherDetail;
  readonly locale: Locale;
  readonly notice?: Notice;
}) {
  const { voucher } = detail;
  return (
    <AdministrationPage>
      <AdministrationPageHeader title={voucher.code} />
      <AdministrationNoticeBanner notice={notice} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="ghost">
          <Link href={administrationHref("/[locale]/admin/vouchers")}>
            {m.discountsBackToVouchers({}, { locale })}
          </Link>
        </Button>
      </div>

      <VoucherSummary locale={locale} voucher={voucher} />

      <section className="mt-5 rounded-xl border border-navy-blue/10 bg-white p-5">
        <h2 className="mb-4 font-semibold">
          {m.discountsConfigurationTitle({}, { locale })}
        </h2>
        <VoucherEditor
          deletable
          deleteRedirect={administrationHref("/[locale]/admin/vouchers")}
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
              <h2 className="font-semibold">
                {m.discountsColumnAudience({}, { locale })}
              </h2>
              <p className="mt-1 text-sm text-navy-blue/65">
                {detail.customers.length === 0
                  ? m.discountsVoucherAudienceUnrestricted({}, { locale })
                  : m.discountsVoucherAudienceCount(
                      { count: detail.customers.length },
                      { locale }
                    )}
              </p>
            </div>
            {detail.customers.length > 0 && (
              <AdminMutationButton
                confirmation={m.discountsVoucherMakeUnrestrictedConfirmation(
                  {},
                  { locale }
                )}
                mutation={{
                  kind: "make-voucher-unrestricted",
                  voucherId: voucher.id,
                }}
              >
                {m.discountsMakeUnrestricted({}, { locale })}
              </AdminMutationButton>
            )}
          </div>
          {detail.customers.length === 0 ? (
            <EmptyState message={m.discountsAudienceEmpty({}, { locale })} />
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
                      href={administrationHref(
                        "/[locale]/admin/customers/[customerId]",
                        { customerId }
                      )}
                    >
                      {customer
                        ? formatDiscountAdminCustomerName(customer, locale)
                        : m.discountsCustomerDetailsUnavailable({}, { locale })}
                    </Link>
                    <p className="mt-1 text-sm text-navy-blue/65">
                      {customer
                        ? [customer.email, customer.phone]
                            .filter(Boolean)
                            .join(" · ") ||
                          m.discountsCustomerNoContactDetails({}, { locale })
                        : customerId}
                    </p>
                  </div>
                  {detail.customers.length > 1 ? (
                    <AdminMutationButton
                      confirmation={m.discountsVoucherRemoveCustomerConfirmation(
                        {
                          customerName: customer
                            ? formatDiscountAdminCustomerName(customer, locale)
                            : customerId,
                        },
                        { locale }
                      )}
                      mutation={{
                        kind: "remove-voucher-customer",
                        voucherId: voucher.id,
                        customerId,
                      }}
                    >
                      {m.discountsRemove({}, { locale })}
                    </AdminMutationButton>
                  ) : (
                    <span className="text-xs text-navy-blue/65">
                      {m.discountsUseMakeUnrestricted({}, { locale })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-5">
          <h2 className="font-semibold">
            {m.discountsAddCustomer({}, { locale })}
          </h2>
          <p className="mb-4 mt-1 text-sm leading-5 text-navy-blue/65">
            {m.discountsVoucherAddCustomerDescription({}, { locale })}
          </p>
          <AddVoucherCustomerForm voucherId={voucher.id} />
        </aside>
      </div>

      <section className="mt-5">
        <h2 className="mb-3 font-semibold">
          {m.discountsClaimHistoryTitle({}, { locale })}
        </h2>
        <ClaimHistory
          ariaLabel={m.discountsVoucherClaimHistoryLabel({}, { locale })}
          claims={detail.claims}
          emptyMessage={m.discountsVoucherClaimsEmpty({}, { locale })}
          locale={locale}
          subject="customer"
        />
      </section>
    </AdministrationPage>
  );
}

export function CustomerAdministrationDetailPage({
  activity,
  locale,
  notice,
  profile,
  reservationActivity,
}: {
  readonly activity: AdministrationCustomerActivity;
  readonly locale: Locale;
  readonly notice?: Notice;
  readonly profile: AdminCustomerProfile;
  readonly reservationActivity: AdministrationCustomerReservationActivity;
}) {
  const customerName = formatDiscountAdminCustomerName(
    profile.customer,
    locale
  );
  const currentGroup = profile.discountGroups.find(
    ({ id }) => id === profile.customer.discountGroupId
  );
  let currentGroupLabel: string = m.discountsCustomerGroupNone({}, { locale });
  if (currentGroup) {
    currentGroupLabel = `${currentGroup.name} (${formatDiscountAdjustment(
      { kind: "percentage", basisPoints: currentGroup.basisPoints },
      locale
    )})`;
  } else if (profile.customer.discountGroupId) {
    currentGroupLabel = m.discountsCustomerGroupUnavailable(
      { groupId: profile.customer.discountGroupId },
      { locale }
    );
  }
  const visiblePromotionCodes = [
    ...profile.codes.map(
      ({
        audienceSize,
        code,
        discountAdjustment,
        discountLabels,
        eligible,
        enabled,
        id,
      }) => ({
        kind: "discount-code" as const,
        audienceSize,
        code,
        discountAdjustment,
        discountLabel: discountLabels[locale],
        eligible,
        enabled,
        id,
      })
    ),
    ...profile.vouchers.map(
      ({
        audienceSize,
        code,
        eligible,
        enabled,
        id,
        issuedCredit,
        remainingCredit,
      }) => ({
        kind: "voucher" as const,
        audienceSize,
        code,
        eligible,
        enabled,
        id,
        issuedCredit,
        remainingCredit,
      })
    ),
  ]
    .filter((item) => item.eligible || item.audienceSize === 0)
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
  const reservationGroups = groupCustomerReservations(activity.reservations);
  return (
    <AdministrationPage>
      <AdministrationPageHeader title={customerName} />
      <AdministrationNoticeBanner notice={notice} />

      <CustomerReservationActivity
        activity={reservationActivity}
        locale={locale}
      />

      <div className="mb-7 grid gap-5 lg:grid-cols-2">
        <CustomerStats
          activity={activity}
          availableCodes={`${formatCount(targetedCodeCount, locale)} (+ ${formatCount(universalCodeCount, locale)})`}
          locale={locale}
        />
        <CustomerConsents consent={activity.marketingConsent} locale={locale} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-7">
          <section>
            <h2 className="mb-3 text-xl">
              {m.discountsCustomerReservationsTitle({}, { locale })}
            </h2>
            {activity.reservationHistoryTruncated && (
              <p className="mb-3 text-sm text-navy-blue/65">
                {m.discountsCustomerReservationsTruncated({}, { locale })}{" "}
                <Link
                  className="font-semibold underline underline-offset-4"
                  href={`${administrationHref(
                    "/[locale]/admin/reservations"
                  )}?customerId=${encodeURIComponent(profile.customer.id)}`}
                >
                  {m.discountsCustomerViewAllReservations({}, { locale })}
                </Link>
              </p>
            )}
            <div className="space-y-4">
              <details className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
                <summary className="cursor-pointer px-5 py-4 font-semibold">
                  {m.discountsCustomerPastReservations(
                    {
                      count: formatCount(reservationGroups.past.length, locale),
                    },
                    { locale }
                  )}
                </summary>
                <div className="border-t border-navy-blue/10 p-3">
                  <ReservationTable
                    emptyMessage={m.discountsCustomerPastReservationsEmpty(
                      {},
                      { locale }
                    )}
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
                  {m.discountsCustomerCurrentReservations({}, { locale })}
                </h3>
                <ReservationTable
                  emptyMessage={
                    activity.reservationHistoryTruncated
                      ? m.discountsCustomerCurrentReservationsTruncatedEmpty(
                          {},
                          { locale }
                        )
                      : m.discountsCustomerCurrentReservationsEmpty(
                          {},
                          { locale }
                        )
                  }
                  reservations={reservationGroups.currentAndFuture}
                  showCustomer={false}
                />
              </section>

              {reservationGroups.unavailable.length > 0 && (
                <details className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
                  <summary className="cursor-pointer px-5 py-4 font-semibold">
                    {m.discountsCustomerUnavailableDateReservations(
                      {
                        count: formatCount(
                          reservationGroups.unavailable.length,
                          locale
                        ),
                      },
                      { locale }
                    )}
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
            <h2 className="mb-3 text-xl">
              {m.discountsCustomerTransactionsTitle({}, { locale })}
            </h2>
            {activity.transactionHistoryTruncated && (
              <p className="mb-3 text-sm text-navy-blue/65">
                {m.discountsCustomerTransactionsTruncated({}, { locale })}
              </p>
            )}
            <CustomerTransactionHistory
              locale={locale}
              transactions={activity.transactions}
            />
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-xl">
                {m.discountsCustomerCodesTitle({}, { locale })}
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link
                    href={administrationHref(
                      "/[locale]/admin/customers/[customerId]/create-code",
                      { customerId: profile.customer.id }
                    )}
                  >
                    <Plus aria-hidden className="size-4" />
                    {m.discountsCodeCreateSubmit({}, { locale })}
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link
                    href={administrationHref(
                      "/[locale]/admin/customers/[customerId]/create-voucher",
                      { customerId: profile.customer.id }
                    )}
                  >
                    <Plus aria-hidden className="size-4" />
                    {m.discountsVoucherCreateSubmit({}, { locale })}
                  </Link>
                </Button>
              </div>
            </div>
            {visiblePromotionCodes.length === 0 ? (
              <EmptyState
                message={m.discountsCustomerCodesEmpty({}, { locale })}
              />
            ) : (
              <CustomerPromotionCodeTable
                customerId={profile.customer.id}
                customerName={customerName}
                items={visiblePromotionCodes}
              />
            )}
          </section>

          <section>
            <h2 className="mb-3 text-xl">
              {m.discountsClaimHistoryTitle({}, { locale })}
            </h2>
            <ClaimHistory
              ariaLabel={m.discountsCustomerClaimHistoryLabel({}, { locale })}
              claims={[...profile.claims, ...profile.voucherClaims].toSorted(
                (left, right) =>
                  Temporal.Instant.compare(right.reservedAt, left.reservedAt)
              )}
              emptyMessage={m.discountsCustomerClaimsEmpty({}, { locale })}
              locale={locale}
              promotionCodes={
                new Map([
                  ...profile.codes.map(
                    ({ code, id }) => [`discount-code:${id}`, code] as const
                  ),
                  ...profile.vouchers.map(
                    ({ code, id }) => [`voucher:${id}`, code] as const
                  ),
                ])
              }
              subject="promotion-code"
            />
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
            <h2 className="font-semibold">
              {m.discountsCustomerContactTitle({}, { locale })}
            </h2>
            <dl className="mt-4 grid gap-4 text-sm">
              <AdministrationFact
                label={m.discountsCustomerEmailLabel({}, { locale })}
                value={profile.customer.email ?? "—"}
              />
              <AdministrationFact
                label={m.discountsCustomerPhoneLabel({}, { locale })}
                value={profile.customer.phone ?? "—"}
              />
              <AdministrationFact
                label={m.discountsCustomerCurrentGroupLabel({}, { locale })}
                value={currentGroupLabel}
              />
            </dl>
          </section>

          <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
            <h2 className="mb-4 font-semibold">
              {m.discountsCustomerDiscountGroupTitle({}, { locale })}
            </h2>
            <CustomerDiscountGroupForm
              currentGroupId={profile.customer.discountGroupId}
              customerId={profile.customer.id}
              discountGroups={profile.discountGroups}
            />
          </section>

          <details className="rounded-xl border border-navy-blue/10 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              {m.discountsCustomerReferenceTitle({}, { locale })}
            </summary>
            <div className="border-t border-navy-blue/10 px-5 py-4">
              <AdministrationFact
                label={m.discountsCustomerIdLabel({}, { locale })}
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
  locale,
}: {
  readonly activity: AdministrationCustomerActivity;
  readonly availableCodes: string;
  readonly locale: Locale;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl">
        {m.discountsCustomerStatsTitle({}, { locale })}
      </h2>
      <dl className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
        <CustomerStat
          label={m.discountsCustomerStatReservations({}, { locale })}
          value={formatCount(activity.stats.reservationCount, locale)}
        />
        <CustomerStat
          label={m.discountsCustomerStatRevenue({}, { locale })}
          value={formatMoneyTotals(activity.stats.revenue, locale)}
        />
        <CustomerStat
          label={m.discountsCustomerStatFavoriteProduct({}, { locale })}
          value={
            activity.stats.favoriteReservationProduct
              ? getAdministrationReservationProductTitle(
                  activity.stats.favoriteReservationProduct,
                  locale
                )
              : "—"
          }
        />
        <CustomerStat
          label={m.discountsCustomerStatDiscountSavings({}, { locale })}
          value={formatMoneyTotals(activity.stats.discountSavings, locale)}
        />
        <CustomerStat
          label={m.discountsCustomerStatAvailableCodes({}, { locale })}
          value={availableCodes}
        />
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
  locale,
}: {
  readonly consent: AdministrationCustomerMarketingConsent | null;
  readonly locale: Locale;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl">
        {m.discountsCustomerConsentsTitle({}, { locale })}
      </h2>
      <dl className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
        <CustomerConsent consent={consent} locale={locale} />
      </dl>
    </section>
  );
}

function CustomerConsent({
  consent,
  locale,
}: {
  readonly consent: AdministrationCustomerMarketingConsent | null;
  readonly locale: Locale;
}) {
  const withdrawnAt = consent?.withdrawnAt;
  return (
    <div className="grid gap-1 border-b border-navy-blue/8 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <dt className="font-medium">
        {m.discountsCustomerConsentMarketing({}, { locale })}
      </dt>
      <dd className="text-sm text-navy-blue/65 sm:text-right">
        {consent ? (
          <>
            <StatusBadge tone={withdrawnAt ? "attention" : "positive"}>
              {withdrawnAt
                ? m.discountsCustomerConsentWithdrawn({}, { locale })
                : m.discountsCustomerConsentGranted({}, { locale })}
            </StatusBadge>{" "}
            ·{" "}
            {formatAdministrationDateTime(
              withdrawnAt ?? consent.grantedAt,
              locale
            )}
            <span className="mt-0.5 block break-all text-xs">
              {withdrawnAt && (
                <>
                  {m.discountsCustomerConsentGrantedAt(
                    {
                      date: formatAdministrationDateTime(
                        consent.grantedAt,
                        locale
                      ),
                    },
                    { locale }
                  )}{" "}
                  ·{" "}
                </>
              )}
              {consent.locale} · {consent.documentHash}
            </span>
          </>
        ) : (
          m.discountsCustomerConsentNotGranted({}, { locale })
        )}
      </dd>
    </div>
  );
}

function CustomerTransactionHistory({
  locale,
  transactions,
}: {
  readonly locale: Locale;
  readonly transactions: readonly AdministrationCustomerTransaction[];
}) {
  if (transactions.length === 0) {
    return (
      <EmptyState
        message={m.discountsCustomerTransactionsEmpty({}, { locale })}
      />
    );
  }
  return (
    <CustomerTransactionHistoryTable
      transactions={transactions.map((transaction) => ({
        ...transaction,
        updatedAtLabel: formatAdministrationDateTime(
          transaction.attempt.updatedAt,
          locale
        ),
      }))}
    />
  );
}

const formatMoneyTotals = (totals: readonly Money[], locale: Locale) =>
  totals.length > 0
    ? totals.map((total) => formatMoney(total, locale)).join(" + ")
    : "—";

const getSummaryStatus = (enabled: boolean, locale: Locale) =>
  enabled
    ? m.discountsStatusEnabled({}, { locale })
    : m.discountsStatusDisabled({}, { locale });

const getSummaryAudience = (audienceSize: number, locale: Locale) =>
  audienceSize === 0
    ? m.discountsAudienceUnrestricted({}, { locale })
    : m.discountsAudienceCustomerCount({ count: audienceSize }, { locale });

function CodeSummary({
  code,
  discountLabel,
  locale,
}: {
  readonly code: AdminDiscountCode;
  readonly discountLabel: string;
  readonly locale: Locale;
}) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-navy-blue/10 bg-navy-blue/10 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryFact
        label={m.discountsColumnBenefit({}, { locale })}
        value={discountLabel}
      />
      <SummaryFact
        label={m.discountsColumnStatus({}, { locale })}
        value={getSummaryStatus(code.enabled, locale)}
      />
      <SummaryFact
        label={m.discountsValidFromLabel({}, { locale })}
        value={formatOptionalInstant(code.validFrom, locale)}
      />
      <SummaryFact
        label={m.discountsValidUntilLabel({}, { locale })}
        value={formatOptionalInstant(code.validUntil, locale)}
      />
      <SummaryFact
        label={m.discountsColumnAudience({}, { locale })}
        value={getSummaryAudience(code.audienceSize, locale)}
      />
      <SummaryFact
        label={m.discountsColumnReserved({}, { locale })}
        value={formatCount(code.reservedUses, locale)}
      />
      <SummaryFact
        label={m.discountsColumnRedeemed({}, { locale })}
        value={formatCount(code.redeemedUses, locale)}
      />
      <SummaryFact
        label={m.discountsColumnRemainingGlobally({}, { locale })}
        value={formatDiscountUsageLimit(code.remainingUses, locale)}
      />
      <SummaryFact
        label={m.discountsColumnUsesPerCustomer({}, { locale })}
        value={formatDiscountUsageLimit(code.maxUsesPerCustomer, locale)}
      />
    </dl>
  );
}

function VoucherSummary({
  locale,
  voucher,
}: {
  readonly locale: Locale;
  readonly voucher: AdminVoucher;
}) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-navy-blue/10 bg-navy-blue/10 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryFact
        label={m.discountsColumnIssued({}, { locale })}
        value={formatMoney(voucher.issuedCredit, locale)}
      />
      <SummaryFact
        label={m.discountsColumnRemaining({}, { locale })}
        value={formatMoney(voucher.remainingCredit, locale)}
      />
      <SummaryFact
        label={m.discountsColumnStatus({}, { locale })}
        value={getSummaryStatus(voucher.enabled, locale)}
      />
      <SummaryFact
        label={m.discountsColumnAudience({}, { locale })}
        value={getSummaryAudience(voucher.audienceSize, locale)}
      />
      <SummaryFact
        label={m.discountsValidFromLabel({}, { locale })}
        value={formatOptionalInstant(voucher.validFrom, locale)}
      />
      <SummaryFact
        label={m.discountsValidUntilLabel({}, { locale })}
        value={formatOptionalInstant(voucher.validUntil, locale)}
      />
      <SummaryFact
        label={m.discountsColumnReserved({}, { locale })}
        value={formatCount(voucher.reservedUses, locale)}
      />
      <SummaryFact
        label={m.discountsColumnRedeemed({}, { locale })}
        value={formatCount(voucher.redeemedUses, locale)}
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

function ClaimHistory({
  ariaLabel,
  claims,
  emptyMessage,
  locale,
  promotionCodes,
  subject,
}: {
  readonly ariaLabel: string;
  readonly claims: readonly (AdminDiscountCodeClaim | AdminVoucherClaim)[];
  readonly emptyMessage: string;
  readonly locale: Locale;
  /** Code values keyed by `discount-code:<id>` or `voucher:<id>`. */
  readonly promotionCodes?: ReadonlyMap<string, string>;
  readonly subject: "customer" | "promotion-code";
}) {
  if (claims.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <ClaimHistoryTable
      ariaLabel={ariaLabel}
      claims={claims.map((claim) => {
        const promotion =
          "codeId" in claim
            ? { kind: "discount-code" as const, id: claim.codeId }
            : { kind: "voucher" as const, id: claim.voucherId };
        const completedAt = claim.redeemedAt ?? claim.releasedAt;
        return {
          id: claim.id,
          kind: promotion.kind,
          appliedAmount: claim.appliedAmount,
          promotion: {
            id: promotion.id,
            code:
              promotionCodes?.get(`${promotion.kind}:${promotion.id}`) ?? null,
          },
          dotyposCustomerId: claim.dotyposCustomerId,
          redeemedAt: claim.redeemedAt?.toString() ?? null,
          releasedAt: claim.releasedAt?.toString() ?? null,
          releaseReason: claim.releaseReason,
          reservedAt: claim.reservedAt.toString(),
          reservedAtLabel: formatAdministrationDateTime(
            claim.reservedAt.toString(),
            locale
          ),
          completedAtLabel: completedAt
            ? formatAdministrationDateTime(completedAt.toString(), locale)
            : null,
          state: claim.state,
          workspaceReservationId: claim.workspaceReservationId,
        };
      })}
      subject={subject}
    />
  );
}

const formatOptionalInstant = (
  instant: Temporal.Instant | null,
  locale: Locale
) => (instant ? formatAdministrationDateTime(instant.toString(), locale) : "—");
