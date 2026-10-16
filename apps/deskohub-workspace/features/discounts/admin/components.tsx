import { ArrowUpRight } from "lucide-react";
import {
  AdministrationAlert,
  EmptyState,
} from "@/features/administration/components";
import {
  formatAdministrationDateTime,
  formatAdministrationPlainDate,
} from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  CalendarSalesAdminTable,
  type CalendarSaleTableItem,
  DiscountCodesAdminTable,
  type DiscountTableItem,
  VouchersAdminTable,
} from "./admin-tables";
import { formatCalendarSaleTitle } from "./calendar-sale-title";
import {
  DiscountCodeCreationDialog,
  SaleDiscountCreationDialog,
  VoucherCreationDialog,
} from "./creation-dialogs";
import type {
  AdminCalendarSale,
  DiscountAdminCodesPage,
  DiscountAdminDashboard,
  DiscountAdminSalesPage,
  DiscountAdminVouchersPage,
} from "./discount-administration.service";

export function CodesAdministrationActions({
  dashboard,
}: {
  readonly dashboard: DiscountAdminCodesPage;
}) {
  return (
    <DiscountCodeCreationDialog discounts={toDiscountTableItems(dashboard)} />
  );
}

export function CodesAdministrationCollection({
  dashboard,
  locale,
}: {
  readonly dashboard: DiscountAdminCodesPage;
  readonly locale: Locale;
}) {
  const discounts = toDiscountTableItems(dashboard);
  const codes = toDiscountCodeTableItems(dashboard);

  return (
    <section aria-labelledby="discount-codes-heading">
      <h2 className="sr-only" id="discount-codes-heading">
        {m.discountsCodesTitle({}, { locale })}
      </h2>
      {codes.length === 0 ? (
        <EmptyState message={m.discountsCodesEmpty({}, { locale })} />
      ) : (
        <DiscountCodesAdminTable codes={codes} discounts={discounts} />
      )}
    </section>
  );
}

export function VouchersAdministrationActions() {
  return <VoucherCreationDialog />;
}

export function VouchersAdministrationCollection({
  dashboard,
  locale,
}: {
  readonly dashboard: DiscountAdminVouchersPage;
  readonly locale: Locale;
}) {
  return (
    <section aria-labelledby="vouchers-heading">
      <h2 className="sr-only" id="vouchers-heading">
        {m.discountsVouchersTitle({}, { locale })}
      </h2>
      {dashboard.vouchers.length === 0 ? (
        <EmptyState message={m.discountsVouchersEmpty({}, { locale })} />
      ) : (
        <VouchersAdminTable
          vouchers={dashboard.vouchers.map((voucher) => ({
            ...voucher,
            validFrom: voucher.validFrom?.toString() ?? null,
            validUntil: voucher.validUntil?.toString() ?? null,
          }))}
        />
      )}
    </section>
  );
}

export function SalesAdministrationActions() {
  return <SaleDiscountCreationDialog />;
}

export function SalesAdministrationCollection({
  dashboard,
  locale,
}: {
  readonly dashboard: DiscountAdminSalesPage;
  readonly locale: Locale;
}) {
  return (
    <CalendarSection
      calendar={dashboard.calendar}
      discounts={toDiscountTableItems(dashboard)}
      locale={locale}
    />
  );
}

function CalendarSection({
  calendar,
  discounts,
  locale,
}: {
  readonly calendar: DiscountAdminDashboard["calendar"];
  readonly discounts: readonly DiscountTableItem[];
  readonly locale: Locale;
}) {
  let calendarContent = (
    <CalendarSalesAdminTable
      discounts={discounts}
      events={calendar.events.map((event) =>
        toCalendarSaleTableItem(event, locale)
      )}
    />
  );
  if (calendar.unavailable) {
    calendarContent = (
      <AdministrationAlert status="warning">
        {m.discountsCalendarUnavailable({}, { locale })}
      </AdministrationAlert>
    );
  } else if (calendar.events.length === 0) {
    calendarContent = (
      <EmptyState message={m.discountsCalendarSalesEmpty({}, { locale })} />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="calendar-sales-heading">
        <h2 className="sr-only" id="calendar-sales-heading">
          {m.discountsCalendarSalesTitle({}, { locale })}
        </h2>
        {calendarContent}
      </section>

      <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-5 xl:sticky xl:top-24">
        <h2 className="text-base font-semibold">
          {m.discountsCalendarLinkSaleTitle({}, { locale })}
        </h2>
        <ol className="mt-3 space-y-2 text-sm leading-5 text-navy-blue/78">
          <li>{m.discountsCalendarLinkSaleStepOpen({}, { locale })}</li>
          <li>{m.discountsCalendarLinkSaleStepAllDay({}, { locale })}</li>
          <li>{m.discountsCalendarLinkSaleStepDescription({}, { locale })}</li>
          <li>{m.discountsCalendarLinkSaleStepRefresh({}, { locale })}</li>
        </ol>
        <Button
          asChild
          className="mt-4"
          fullWidth
          size="sm"
          variant="secondary"
        >
          <a href={calendar.calendarUrl} rel="noreferrer" target="_blank">
            {m.discountsCalendarOpen({}, { locale })}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        </Button>
      </aside>
    </div>
  );
}

const plainDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T/;

// Calendar sale dates are formatted here on the server: an event with a time
// would otherwise format differently in the client tree and fail hydration.
const formatCalendarSaleDate = (value: string, locale: Locale) => {
  if (plainDatePattern.test(value)) {
    return formatAdministrationPlainDate(value, locale);
  }
  if (dateTimePattern.test(value)) {
    return formatAdministrationDateTime(value, locale);
  }
  return m.discountsCalendarUnknownDate({}, { locale });
};

const toCalendarSaleTableItem = (
  event: AdminCalendarSale,
  locale: Locale
): CalendarSaleTableItem => ({
  ...event,
  title: formatCalendarSaleTitle(event.title, locale),
  dates: `${formatCalendarSaleDate(event.start, locale)} → ${formatCalendarSaleDate(event.end, locale)}`,
});

const toDiscountTableItems = ({
  discounts,
}: Pick<DiscountAdminDashboard, "discounts">): readonly DiscountTableItem[] =>
  discounts.map(({ codeCount, id, labels, adjustment, products }) => ({
    adjustment,
    codeCount,
    id,
    labels,
    products,
  }));

const toDiscountCodeTableItems = ({
  codes,
}: Pick<DiscountAdminCodesPage, "codes">) =>
  codes.map((code) => ({
    code: code.code,
    discountId: code.discountId,
    enabled: code.enabled,
    id: code.id,
    maxUses: code.maxUses,
    maxUsesPerCustomer: code.maxUsesPerCustomer,
    audienceSize: code.audienceSize,
    reservedUses: code.reservedUses,
    redeemedUses: code.redeemedUses,
    remainingUses: code.remainingUses,
    validFrom: code.validFrom?.toString() ?? null,
    validUntil: code.validUntil?.toString() ?? null,
  }));
