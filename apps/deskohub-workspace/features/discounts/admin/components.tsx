import { ArrowUpRight, Plus } from "lucide-react";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
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
import {
  CreateDiscountCodeForm,
  CreateDiscountForm,
  DiscountCodesAdminTable,
  DiscountsAdminTable,
  type DiscountTableItem,
} from "./admin-tables";
import type {
  AdminCalendarSale,
  DiscountAdminDashboard,
} from "./discount-administration.service";

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
      title="Codes"
    >
      <div className="space-y-9">
        <DiscountDefinitionsSection discounts={discounts} />
        <section aria-labelledby="discount-codes-heading">
          <div className="mb-3">
            <h2 className="text-xl" id="discount-codes-heading">
              Codes
            </h2>
            <p className="mt-1 text-sm text-navy-blue/65">
              Create customer-facing codes from the definitions above.
            </p>
          </div>
          {discounts.length === 0 ? (
            <div className="rounded-xl border border-navy-blue/10 bg-white px-5 py-6 text-sm text-navy-blue/65">
              Create a discount before adding a code.
            </div>
          ) : (
            <details className="group rounded-xl border border-navy-blue/10 bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 font-semibold marker:hidden">
                <span className="grid size-8 place-items-center rounded-lg bg-burned-orange-ink text-white">
                  <Plus aria-hidden className="size-4" />
                </span>
                Create a discount code
              </summary>
              <div className="px-5 pb-6">
                <CreateDiscountCodeForm discounts={discounts} />
              </div>
            </details>
          )}

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
      title="Sales"
    >
      <div className="space-y-9">
        <CalendarSection calendar={dashboard.calendar} />
        <DiscountDefinitionsSection discounts={discounts} />
      </div>
    </AdminPageShell>
  );
}

function DiscountDefinitionsSection({
  discounts,
}: {
  readonly discounts: readonly DiscountTableItem[];
}) {
  return (
    <section aria-labelledby="discount-definitions-heading">
      <div className="mb-3">
        <h2 className="text-xl" id="discount-definitions-heading">
          Discount definitions
        </h2>
        <p className="mt-1 text-sm text-navy-blue/65">
          Shared pricing rules used by codes and Calendar sales.
        </p>
      </div>
      <details className="group rounded-xl border border-navy-blue/10 bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 font-semibold marker:hidden">
          <span className="grid size-8 place-items-center rounded-lg bg-burned-orange-ink text-white">
            <Plus aria-hidden className="size-4" />
          </span>
          Create a discount definition
        </summary>
        <div className="px-5 pb-6">
          <CreateDiscountForm />
        </div>
      </details>
      <div className="mt-4">
        {discounts.length === 0 ? (
          <EmptyState message="No discount definitions yet." />
        ) : (
          <DiscountsAdminTable discounts={discounts} />
        )}
      </div>
    </section>
  );
}

export function AdminPageShell({
  children,
  count,
  notice,
  title,
}: {
  readonly activeSection: "codes" | "customers" | "discounts" | "sales";
  readonly children: React.ReactNode;
  readonly count: number;
  readonly notice: DiscountAdministrationProps["notice"];
  readonly title: string;
}) {
  return (
    <AdministrationPage>
      <AdministrationPageHeader count={count} title={title} />
      <AdministrationNoticeBanner notice={notice} />
      {children}
    </AdministrationPage>
  );
}

function CalendarSection({
  calendar,
}: {
  readonly calendar: DiscountAdminDashboard["calendar"];
}) {
  let calendarContent = (
    <Table aria-label="Calendar sales" className="min-w-[760px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Event</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Calendar status</TableHead>
          <TableHead>Association</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {calendar.events.map((event) => (
          <CalendarSaleRow event={event} key={event.eventReference} />
        ))}
      </TableBody>
    </Table>
  );
  if (calendar.unavailable) {
    calendarContent = (
      <EmptyState message="Google Calendar is temporarily unavailable. Database editing still works." />
    );
  } else if (calendar.events.length === 0) {
    calendarContent = (
      <EmptyState message="No Calendar events found in this window." />
    );
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-navy-blue/65">
          {calendar.from} — {calendar.to}
        </p>
        <Button asChild size="sm" variant="secondary">
          <a href={calendar.calendarUrl} rel="noreferrer" target="_blank">
            Open calendar
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
          {calendarContent}
        </div>

        <aside className="h-fit rounded-xl border border-navy-blue/10 bg-white p-4 lg:sticky lg:top-4">
          <h2 className="text-base font-semibold">Link a sale</h2>
          <ol className="mt-3 space-y-2 text-sm leading-5 text-navy-blue/78">
            <li>1. Open the Calendar event.</li>
            <li>2. Set it as all-day.</li>
            <li>3. Put only the discount UUID in the event description.</li>
            <li>4. Save, then refresh this page.</li>
          </ol>
        </aside>
      </div>
    </section>
  );
}

function CalendarSaleRow({ event }: { readonly event: AdminCalendarSale }) {
  return (
    <TableRow>
      <TableCell>
        <p className="font-semibold">{event.title}</p>
        <code className="mt-1 block max-w-64 truncate text-xs text-navy-blue/65">
          {event.description || "Empty description"}
        </code>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-navy-blue/70">
        {event.start} → {event.end}
      </TableCell>
      <TableCell>
        <Badge variant="subtle">{event.status}</Badge>
      </TableCell>
      <TableCell>
        <AssociationBadge association={event.association} />
        {event.association.kind === "associated" && (
          <p className="mt-1 max-w-48 truncate text-xs text-navy-blue/70">
            {event.association.discountLabel}
          </p>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button asChild size="sm" variant="secondary">
          <a href={event.eventUrl} rel="noreferrer" target="_blank">
            Open event
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function AssociationBadge({
  association,
}: {
  readonly association: AdminCalendarSale["association"];
}) {
  if (association.kind === "associated") {
    return (
      <Badge className="border-burned-orange-ink bg-burned-orange-ink text-white">
        Associated
      </Badge>
    );
  }
  if (association.kind === "missing-discount") {
    return <Badge variant="emphasis">Discount not found</Badge>;
  }
  if (association.kind === "invalid-description") {
    return <Badge variant="emphasis">Invalid description</Badge>;
  }
  return <Badge variant="subtle">No discount ID</Badge>;
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
