import { ArrowUpRight } from "lucide-react";
import {
  AdministrationAlert,
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationTableToolbar,
  EmptyState,
} from "@/features/administration/components";
import { Button } from "@/shared/components/ui/button";
import {
  CalendarSalesAdminTable,
  DiscountCodesAdminTable,
  type DiscountTableItem,
} from "./admin-tables";
import {
  DiscountCodeCreationDialog,
  SaleDiscountCreationDialog,
} from "./creation-dialogs";
import type {
  DiscountAdminCodesPage,
  DiscountAdminDashboard,
  DiscountAdminSalesPage,
} from "./discount-administration.service";

type DiscountAdministrationProps<Dashboard> = {
  readonly dashboard: Dashboard;
  readonly notice?: {
    readonly message: string;
    readonly status: "error" | "success";
  };
};

export function CodesAdministrationPage({
  dashboard,
  notice,
}: DiscountAdministrationProps<DiscountAdminCodesPage>) {
  return (
    <AdministrationPage>
      <h1 className="sr-only">Codes</h1>
      <AdministrationNoticeBanner notice={notice} />
      <AdministrationTableToolbar
        actions={<CodesAdministrationActions dashboard={dashboard} />}
        count={dashboard.codes.length}
        itemLabel="discount code"
      />
      <CodesAdministrationCollection dashboard={dashboard} />
    </AdministrationPage>
  );
}

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
}: {
  readonly dashboard: DiscountAdminCodesPage;
}) {
  const discounts = toDiscountTableItems(dashboard);
  const codes = toDiscountCodeTableItems(dashboard);

  return (
    <section aria-labelledby="discount-codes-heading">
      <h2 className="sr-only" id="discount-codes-heading">
        Codes
      </h2>
      {codes.length === 0 ? (
        <EmptyState message="No discount codes yet." />
      ) : (
        <DiscountCodesAdminTable codes={codes} discounts={discounts} />
      )}
    </section>
  );
}

export function SalesAdministrationPage({
  dashboard,
  notice,
}: DiscountAdministrationProps<DiscountAdminSalesPage>) {
  return (
    <AdministrationPage>
      <h1 className="sr-only">Sales</h1>
      <AdministrationNoticeBanner notice={notice} />
      <AdministrationTableToolbar
        actions={<SalesAdministrationActions />}
        count={dashboard.calendar.events.length}
        itemLabel="sale"
      />
      <SalesAdministrationCollection dashboard={dashboard} />
    </AdministrationPage>
  );
}

export function SalesAdministrationActions() {
  return <SaleDiscountCreationDialog />;
}

export function SalesAdministrationCollection({
  dashboard,
}: {
  readonly dashboard: DiscountAdminSalesPage;
}) {
  return (
    <CalendarSection
      calendar={dashboard.calendar}
      discounts={toDiscountTableItems(dashboard)}
    />
  );
}

function CalendarSection({
  calendar,
  discounts,
}: {
  readonly calendar: DiscountAdminDashboard["calendar"];
  readonly discounts: readonly DiscountTableItem[];
}) {
  let calendarContent = (
    <CalendarSalesAdminTable discounts={discounts} events={calendar.events} />
  );
  if (calendar.unavailable) {
    calendarContent = (
      <AdministrationAlert status="warning">
        Google Calendar is temporarily unavailable. Database editing still
        works.
      </AdministrationAlert>
    );
  } else if (calendar.events.length === 0) {
    calendarContent = <EmptyState message="No Calendar sale events found." />;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="calendar-sales-heading">
        <h2 className="sr-only" id="calendar-sales-heading">
          Calendar sales
        </h2>
        {calendarContent}
      </section>

      <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-5 xl:sticky xl:top-24">
        <h2 className="text-base font-semibold">Link a sale</h2>
        <ol className="mt-3 space-y-2 text-sm leading-5 text-navy-blue/78">
          <li>1. Open the Calendar event.</li>
          <li>2. Set it as all-day.</li>
          <li>3. Put only the discount UUID in the event description.</li>
          <li>4. Save, then refresh this page.</li>
        </ol>
        <Button asChild className="mt-4 w-full" size="sm" variant="secondary">
          <a href={calendar.calendarUrl} rel="noreferrer" target="_blank">
            Open calendar
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        </Button>
      </aside>
    </div>
  );
}

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
