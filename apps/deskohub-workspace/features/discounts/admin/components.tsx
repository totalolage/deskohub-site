import { ArrowUpRight, Plus } from "lucide-react";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { Button } from "@/shared/components/ui/button";
import {
  CalendarSalesAdminTable,
  CreateDiscountForm,
  DiscountCodesAdminTable,
  DiscountsAdminTable,
  type DiscountTableItem,
} from "./admin-tables";
import {
  DiscountCodeCreationDialog,
  SaleDiscountCreationDialog,
} from "./creation-dialogs";
import type { DiscountAdminDashboard } from "./discount-administration.service";

type DiscountAdministrationProps = {
  readonly dashboard: DiscountAdminDashboard;
  readonly notice?: {
    readonly message: string;
    readonly status: "error" | "success";
  };
};

export function DiscountsAdministrationPage({
  dashboard,
  notice,
}: DiscountAdministrationProps) {
  const discounts = toDiscountTableItems(dashboard);

  return (
    <AdminPageShell
      activeSection="discounts"
      count={discounts.length}
      notice={notice}
      title="Discounts"
    >
      <section>
        <details className="group rounded-xl border border-navy-blue/10 bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 font-semibold marker:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-burned-orange-ink text-white">
              <Plus aria-hidden className="size-4" />
            </span>
            Create a discount
          </summary>
          <div className="px-5 pb-6">
            <CreateDiscountForm />
          </div>
        </details>

        <div className="mt-4">
          {discounts.length === 0 ? (
            <EmptyState message="No discounts yet. Create the first definition above." />
          ) : (
            <DiscountsAdminTable discounts={discounts} />
          )}
        </div>
      </section>
    </AdminPageShell>
  );
}

export function CodesAdministrationPage({
  dashboard,
  notice,
}: DiscountAdministrationProps) {
  const discounts = toDiscountTableItems(dashboard);
  const codes = dashboard.codes.map((code) => ({
    code: code.code,
    discountId: code.discountId,
    enabled: code.enabled,
    id: code.id,
    maxUses: code.maxUses,
    audienceSize: code.audienceSize,
    reservedUses: code.reservedUses,
    redeemedUses: code.redeemedUses,
    remainingUses: code.remainingUses,
    validFrom: code.validFrom?.toString() ?? null,
    validUntil: code.validUntil?.toString() ?? null,
  }));

  return (
    <AdminPageShell
      activeSection="codes"
      count={codes.length}
      notice={notice}
      showHeader={false}
      title="Codes"
    >
      <h1 className="sr-only">Codes</h1>
      <div>
        <section aria-labelledby="discount-codes-heading">
          <h2 className="sr-only" id="discount-codes-heading">
            Codes
          </h2>
          <div className="flex justify-end">
            <DiscountCodeCreationDialog discounts={discounts} />
          </div>

          <div className="mt-4">
            {codes.length === 0 ? (
              <EmptyState message="No discount codes yet." />
            ) : (
              <DiscountCodesAdminTable codes={codes} discounts={discounts} />
            )}
          </div>
        </section>
      </div>
    </AdminPageShell>
  );
}

export function SalesAdministrationPage({
  dashboard,
  notice,
}: DiscountAdministrationProps) {
  const discounts = toDiscountTableItems(dashboard);
  return (
    <AdminPageShell
      activeSection="sales"
      count={dashboard.calendar.events.length}
      notice={notice}
      showHeader={false}
      title="Sales"
    >
      <h1 className="sr-only">Sales</h1>
      <div className="space-y-4">
        <div className="flex justify-end">
          <SaleDiscountCreationDialog />
        </div>
        <CalendarSection calendar={dashboard.calendar} discounts={discounts} />
      </div>
    </AdminPageShell>
  );
}

export function AdminPageShell({
  children,
  count,
  notice,
  showHeader = true,
  title,
}: {
  readonly activeSection: "codes" | "customers" | "discounts" | "sales";
  readonly children: React.ReactNode;
  readonly count: number;
  readonly notice: DiscountAdministrationProps["notice"];
  readonly showHeader?: boolean;
  readonly title: string;
}) {
  return (
    <AdministrationPage>
      {showHeader && <AdministrationPageHeader count={count} title={title} />}
      <AdministrationNoticeBanner notice={notice} />
      {children}
    </AdministrationPage>
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
      <EmptyState message="Google Calendar is temporarily unavailable. Database editing still works." />
    );
  } else if (calendar.events.length === 0) {
    calendarContent = <EmptyState message="No Calendar sale events found." />;
  }

  return (
    <section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>{calendarContent}</div>

        <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-4 lg:sticky lg:top-4">
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
    </section>
  );
}

export function EmptyState({ message }: { readonly message: string }) {
  return (
    <div className="rounded-xl border border-navy-blue/10 bg-white px-5 py-10 text-center text-sm text-navy-blue/62">
      {message}
    </div>
  );
}

const toDiscountTableItems = ({
  discounts,
}: DiscountAdminDashboard): readonly DiscountTableItem[] =>
  discounts.map(({ codeCount, id, labels, adjustment, products }) => ({
    adjustment,
    codeCount,
    id,
    labels,
    products,
  }));
