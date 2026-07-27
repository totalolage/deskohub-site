import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  KeyRound,
  Plus,
  Save,
} from "lucide-react";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  createDiscountAdminForm,
  createDiscountCodeAdminForm,
  deleteDiscountAdminForm,
  deleteDiscountCodeAdminForm,
  updateDiscountAdminForm,
  updateDiscountCodeAdminForm,
} from "./actions";
import { DeleteForm } from "./delete-form";
import type {
  AdminCalendarSale,
  AdminDiscount,
  AdminDiscountCode,
  DiscountAdminDashboard,
} from "./discount-administration.service";

type DiscountAdministrationProps = {
  readonly dashboard: DiscountAdminDashboard;
  readonly notice?: {
    readonly message: string;
    readonly status: "error" | "success";
  };
};

export function DiscountAdministrationPage({
  dashboard,
  notice,
}: DiscountAdministrationProps) {
  return (
    <main className="min-h-screen bg-[#f4f5f8] text-navy-blue">
      <header className="border-b border-navy-blue/10 bg-navy-blue px-5 py-10 text-white sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="mb-3 text-sm font-semibold text-aquamarine-green">
              Workspace operations
            </p>
            <h1 className="text-balance text-4xl leading-none sm:text-5xl">
              Discount administration
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/72">
              Maintain database discounts and codes, then connect scheduled
              sales through the read-only Google Calendar.
            </p>
          </div>
          <nav
            aria-label="Administration sections"
            className="flex flex-wrap gap-2"
          >
            <AdminSectionLink href="#discounts">Discounts</AdminSectionLink>
            <AdminSectionLink href="#codes">Codes</AdminSectionLink>
            <AdminSectionLink href="#calendar">Calendar</AdminSectionLink>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-16 px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
        {notice && (
          <div
            className={
              notice.status === "success"
                ? "flex items-start gap-3 rounded-2xl bg-aquamarine-green/15 px-5 py-4 text-aquamarine-ink"
                : "flex items-start gap-3 rounded-2xl bg-burned-orange/10 px-5 py-4 text-burned-orange-ink"
            }
            role={notice.status === "error" ? "alert" : "status"}
          >
            {notice.status === "success" ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
            ) : (
              <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
            )}
            <p className="text-sm font-semibold leading-6">{notice.message}</p>
          </div>
        )}

        <DiscountsSection discounts={dashboard.discounts} />
        <CodesSection codes={dashboard.codes} discounts={dashboard.discounts} />
        <CalendarSection calendar={dashboard.calendar} />
      </div>
    </main>
  );
}

function DiscountsSection({
  discounts,
}: {
  readonly discounts: readonly AdminDiscount[];
}) {
  return (
    <section className="scroll-mt-8" id="discounts">
      <SectionHeading
        count={discounts.length}
        description="Each definition owns both customer-facing translations, its adjustment, and every eligible product."
        icon={CircleDollarSign}
        title="Discounts"
      />

      <details className="group mt-7 rounded-2xl bg-white shadow-[0_16px_36px_-28px_rgba(0,2,79,0.5)]">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 font-semibold marker:hidden">
          <span className="grid size-9 place-items-center rounded-full bg-burned-orange-ink text-white">
            <Plus aria-hidden className="size-4" />
          </span>
          Create a discount
          <span className="ml-auto text-sm font-normal text-navy-blue/70 group-open:hidden">
            Open form
          </span>
        </summary>
        <form action={createDiscountAdminForm} className="px-5 pb-6">
          <DiscountFields />
          <Button
            className="mt-6 bg-burned-orange-ink hover:bg-burned-orange-ink/90"
            type="submit"
          >
            <Plus aria-hidden className="size-4" />
            Create discount
          </Button>
        </form>
      </details>

      <div className="mt-5 divide-y divide-navy-blue/10 overflow-hidden rounded-2xl bg-white shadow-[0_16px_36px_-28px_rgba(0,2,79,0.5)]">
        {discounts.length === 0 ? (
          <EmptyState message="No discounts yet. Create the first definition above." />
        ) : (
          discounts.map((discount) => (
            <DiscountEditor discount={discount} key={discount.id} />
          ))
        )}
      </div>
    </section>
  );
}

function DiscountEditor({ discount }: { readonly discount: AdminDiscount }) {
  const updateAction = updateDiscountAdminForm.bind(null, discount.id);
  const deleteAction = deleteDiscountAdminForm.bind(null, discount.id);

  return (
    <details className="group">
      <summary className="grid cursor-pointer list-none gap-3 px-5 py-5 marker:hidden sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">
            {discount.labels["en-US"]}
          </p>
          <p className="mt-1 truncate text-sm text-navy-blue/62">
            {discount.labels["cs-CZ"]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="subtle">{formatAdjustment(discount)}</Badge>
          <Badge variant="subtle">
            {discount.products.length}{" "}
            {discount.products.length === 1 ? "product" : "products"}
          </Badge>
          <Badge variant="subtle">
            {discount.codeCount} {discount.codeCount === 1 ? "code" : "codes"}
          </Badge>
          <span className="text-sm font-semibold text-burned-orange-ink group-open:hidden">
            Edit
          </span>
        </div>
      </summary>
      <div className="border-t border-navy-blue/10 bg-[#fafafd] px-5 py-6">
        <div className="mb-5 rounded-xl bg-navy-blue/[0.045] px-3 py-2">
          <p className="text-xs font-semibold text-navy-blue/70">
            Copy this ID into the Calendar event description
          </p>
          <code className="mt-1 block break-all text-xs">{discount.id}</code>
        </div>
        <form action={updateAction}>
          <DiscountFields discount={discount} />
          <Button
            className="mt-6 bg-burned-orange-ink hover:bg-burned-orange-ink/90"
            type="submit"
          >
            <Save aria-hidden className="size-4" />
            Save discount
          </Button>
        </form>
        <div className="mt-7 flex flex-col gap-3 border-t border-navy-blue/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-6 text-navy-blue/62">
            Delete only when no code or active Calendar event references this
            discount.
          </p>
          <DeleteForm
            action={deleteAction}
            confirmation={`Delete the discount “${discount.labels["en-US"]}”? This cannot be undone.`}
          />
        </div>
      </div>
    </details>
  );
}

function DiscountFields({ discount }: { readonly discount?: AdminDiscount }) {
  const selectedProducts = new Set(
    discount?.products.map(getWorkspaceProductKey)
  );
  const adjustment = discount?.adjustment;

  return (
    <div className="grid gap-7">
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Customer labels</legend>
        <FormField label="English (en-US)" name="labelEn">
          <Input
            defaultValue={discount?.labels["en-US"]}
            id={fieldId("labelEn", discount?.id)}
            name="labelEn"
            required
          />
        </FormField>
        <FormField label="Czech (cs-CZ)" name="labelCs">
          <Input
            defaultValue={discount?.labels["cs-CZ"]}
            id={fieldId("labelCs", discount?.id)}
            name="labelCs"
            required
          />
        </FormField>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Adjustment</legend>
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1fr_1fr_0.8fr_0.8fr]">
          <FormField label="Type" name="adjustmentKind">
            <select
              className="min-h-12 w-full rounded-[1.1rem] border border-navy-blue/12 bg-white px-4 py-3 text-base outline-none focus-visible:border-burned-orange focus-visible:ring-4 focus-visible:ring-burned-orange/10"
              defaultValue={adjustment?.kind ?? "percentage"}
              id={fieldId("adjustmentKind", discount?.id)}
              name="adjustmentKind"
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </FormField>
          <FormField label="Basis points" name="percentageBasisPoints">
            <Input
              defaultValue={
                adjustment?.kind === "percentage"
                  ? adjustment.basisPoints
                  : 1000
              }
              id={fieldId("percentageBasisPoints", discount?.id)}
              max={10000}
              min={1}
              name="percentageBasisPoints"
              type="number"
            />
          </FormField>
          <FormField label="Fixed value" name="fixedAmountValue">
            <Input
              defaultValue={
                adjustment?.kind === "fixed" ? adjustment.amount.value : 10000
              }
              id={fieldId("fixedAmountValue", discount?.id)}
              min={1}
              name="fixedAmountValue"
              type="number"
            />
          </FormField>
          <FormField label="Exponent" name="fixedAmountExponent">
            <Input
              defaultValue={
                adjustment?.kind === "fixed" ? adjustment.amount.exponent : 2
              }
              id={fieldId("fixedAmountExponent", discount?.id)}
              min={0}
              name="fixedAmountExponent"
              type="number"
            />
          </FormField>
          <FormField label="Currency" name="fixedAmountCurrency">
            <Input
              defaultValue={
                adjustment?.kind === "fixed"
                  ? adjustment.amount.currency
                  : "CZK"
              }
              id={fieldId("fixedAmountCurrency", discount?.id)}
              maxLength={3}
              minLength={3}
              name="fixedAmountCurrency"
            />
          </FormField>
        </div>
        <p className="mt-3 text-xs leading-5 text-navy-blue/70">
          100 basis points = 1%. Fixed value 10000 with exponent 2 = 100.00 in
          the selected currency. Only the selected type is saved.
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">
          Eligible products
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {productOptions.map((product) => (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-xl bg-navy-blue/[0.045] px-4 py-3 text-sm font-medium hover:bg-navy-blue/[0.075]"
              key={product.key}
            >
              <input
                className="size-4 accent-[var(--brand-burned-orange)]"
                defaultChecked={selectedProducts.has(product.key)}
                name="products"
                type="checkbox"
                value={product.key}
              />
              {product.label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function CodesSection({
  codes,
  discounts,
}: {
  readonly codes: readonly AdminDiscountCode[];
  readonly discounts: readonly AdminDiscount[];
}) {
  return (
    <section className="scroll-mt-8" id="codes">
      <SectionHeading
        count={codes.length}
        description="Codes point at one discount definition and add their own availability window, enabled state, and optional capacity."
        icon={KeyRound}
        title="Discount codes"
      />

      {discounts.length === 0 ? (
        <div className="mt-7 rounded-2xl bg-white px-5 py-6 text-sm text-navy-blue/65">
          Create a discount before adding a code.
        </div>
      ) : (
        <details className="group mt-7 rounded-2xl bg-white shadow-[0_16px_36px_-28px_rgba(0,2,79,0.5)]">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 font-semibold marker:hidden">
            <span className="grid size-9 place-items-center rounded-full bg-burned-orange-ink text-white">
              <Plus aria-hidden className="size-4" />
            </span>
            Create a discount code
            <span className="ml-auto text-sm font-normal text-navy-blue/70 group-open:hidden">
              Open form
            </span>
          </summary>
          <form action={createDiscountCodeAdminForm} className="px-5 pb-6">
            <DiscountCodeFields discounts={discounts} />
            <Button
              className="mt-6 bg-burned-orange-ink hover:bg-burned-orange-ink/90"
              type="submit"
            >
              <Plus aria-hidden className="size-4" />
              Create code
            </Button>
          </form>
        </details>
      )}

      <div className="mt-5 divide-y divide-navy-blue/10 overflow-hidden rounded-2xl bg-white shadow-[0_16px_36px_-28px_rgba(0,2,79,0.5)]">
        {codes.length === 0 ? (
          <EmptyState message="No discount codes yet." />
        ) : (
          codes.map((code) => (
            <DiscountCodeEditor
              code={code}
              discounts={discounts}
              key={code.id}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DiscountCodeEditor({
  code,
  discounts,
}: {
  readonly code: AdminDiscountCode;
  readonly discounts: readonly AdminDiscount[];
}) {
  const updateAction = updateDiscountCodeAdminForm.bind(null, code.id);
  const deleteAction = deleteDiscountCodeAdminForm.bind(null, code.id);
  const discount = discounts.find(({ id }) => id === code.discountId);

  return (
    <details className="group">
      <summary className="grid cursor-pointer list-none gap-3 px-5 py-5 marker:hidden sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <p className="truncate font-mono text-lg font-semibold">
            {code.code}
          </p>
          <p className="mt-1 truncate text-sm text-navy-blue/62">
            {discount?.labels["en-US"] ?? code.discountId}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={code.enabled ? "default" : "subtle"}>
            {code.enabled ? "Enabled" : "Disabled"}
          </Badge>
          {code.maxUses !== null && (
            <Badge variant="subtle">Max {code.maxUses}</Badge>
          )}
          <span className="text-sm font-semibold text-burned-orange-ink group-open:hidden">
            Edit
          </span>
        </div>
      </summary>
      <div className="border-t border-navy-blue/10 bg-[#fafafd] px-5 py-6">
        <p className="mb-5 break-all font-mono text-xs text-navy-blue/70">
          {code.id}
        </p>
        <form action={updateAction}>
          <DiscountCodeFields code={code} discounts={discounts} />
          <Button
            className="mt-6 bg-burned-orange-ink hover:bg-burned-orange-ink/90"
            type="submit"
          >
            <Save aria-hidden className="size-4" />
            Save code
          </Button>
        </form>
        <div className="mt-7 flex flex-col gap-3 border-t border-navy-blue/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm leading-6 text-navy-blue/62">
            Disable a code to preserve redemption history. Deletion succeeds
            only when no historical redemption references it.
          </p>
          <DeleteForm
            action={deleteAction}
            confirmation={`Delete the code “${code.code}”? This cannot be undone.`}
          />
        </div>
      </div>
    </details>
  );
}

function DiscountCodeFields({
  code,
  discounts,
}: {
  readonly code?: AdminDiscountCode;
  readonly discounts: readonly AdminDiscount[];
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <FormField label="Code" name="code">
          <Input
            autoCapitalize="characters"
            defaultValue={code?.code}
            id={fieldId("code", code?.id)}
            maxLength={64}
            minLength={3}
            name="code"
            required
          />
        </FormField>
        <FormField label="Discount" name="discountId">
          <select
            className="min-h-12 w-full rounded-[1.1rem] border border-navy-blue/12 bg-white px-4 py-3 text-base outline-none focus-visible:border-burned-orange focus-visible:ring-4 focus-visible:ring-burned-orange/10"
            defaultValue={code?.discountId}
            id={fieldId("discountId", code?.id)}
            name="discountId"
            required
          >
            {discounts.map((discount) => (
              <option key={discount.id} value={discount.id}>
                {discount.labels["en-US"]}
              </option>
            ))}
          </select>
        </FormField>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 self-end rounded-[1.1rem] bg-navy-blue/[0.045] px-4 py-3 text-sm font-semibold">
          <input
            className="size-4 accent-[var(--brand-burned-orange)]"
            defaultChecked={code?.enabled ?? true}
            name="enabled"
            type="checkbox"
          />
          Enabled
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <FormField label="Valid from (ISO instant)" name="validFrom">
          <Input
            defaultValue={code?.validFrom?.toString()}
            id={fieldId("validFrom", code?.id)}
            name="validFrom"
            placeholder="2026-08-01T00:00:00+02:00"
          />
        </FormField>
        <FormField label="Valid until (ISO instant)" name="validUntil">
          <Input
            defaultValue={code?.validUntil?.toString()}
            id={fieldId("validUntil", code?.id)}
            name="validUntil"
            placeholder="2026-09-01T00:00:00+02:00"
          />
        </FormField>
        <FormField label="Maximum uses" name="maxUses">
          <Input
            defaultValue={code?.maxUses ?? ""}
            id={fieldId("maxUses", code?.id)}
            min={1}
            name="maxUses"
            placeholder="Unlimited"
            type="number"
          />
        </FormField>
      </div>
      <p className="text-xs leading-5 text-navy-blue/70">
        Times require an offset. Both bounds are optional; “valid until” is
        exclusive. Leave maximum uses blank for unlimited.
      </p>
    </div>
  );
}

function CalendarSection({
  calendar,
}: {
  readonly calendar: DiscountAdminDashboard["calendar"];
}) {
  return (
    <section className="scroll-mt-8 pb-6" id="calendar">
      <SectionHeading
        count={calendar.events.length}
        description={`Read-only events from ${calendar.from} through ${calendar.to}. Timing stays in Google Calendar; the description links to Postgres.`}
        icon={CalendarDays}
        title="Calendar sales"
      />

      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_16px_36px_-28px_rgba(0,2,79,0.5)]">
          {calendar.unavailable ? (
            <EmptyState message="Google Calendar is temporarily unavailable. Database editing still works." />
          ) : calendar.events.length === 0 ? (
            <EmptyState message="No Calendar events found in this window." />
          ) : (
            <div className="divide-y divide-navy-blue/10">
              {calendar.events.map((event) => (
                <CalendarSaleRow event={event} key={event.eventReference} />
              ))}
            </div>
          )}
        </div>

        <aside className="h-fit rounded-2xl bg-sunset-yellow/20 p-5 lg:sticky lg:top-5">
          <h3 className="text-xl">Associate an event</h3>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-navy-blue/78">
            <li>1. Open the event in Google Calendar.</li>
            <li>2. Make it an all-day event and give it a title.</li>
            <li>
              3. Replace the entire Description with the chosen discount UUID.
              Do not add any other text.
            </li>
            <li>4. Save the event. Refresh this page to verify the match.</li>
          </ol>
          <Button
            asChild
            className="mt-5 w-full bg-burned-orange-ink hover:bg-burned-orange-ink/90"
          >
            <a href={calendar.calendarUrl} rel="noreferrer" target="_blank">
              Open sales Calendar
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
          </Button>
        </aside>
      </div>
    </section>
  );
}

function CalendarSaleRow({ event }: { readonly event: AdminCalendarSale }) {
  return (
    <article className="grid gap-4 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg">{event.title}</h3>
          <AssociationBadge association={event.association} />
          {event.status !== "confirmed" && (
            <Badge variant="subtle">{event.status}</Badge>
          )}
        </div>
        <p className="mt-2 text-sm text-navy-blue/62">
          {event.start} → {event.end}
        </p>
        <div className="mt-3 rounded-xl bg-navy-blue/[0.045] px-3 py-2">
          <p className="text-xs font-semibold text-navy-blue/70">
            Event description
          </p>
          <code className="mt-1 block break-all text-xs">
            {event.description || "Empty"}
          </code>
        </div>
        {event.association.kind === "associated" && (
          <p className="mt-3 text-sm text-navy-blue/70">
            Linked to{" "}
            <span className="font-semibold">
              {event.association.discountLabel}
            </span>{" "}
            ·{" "}
            <code className="break-all text-xs">
              {event.association.discountId}
            </code>
          </p>
        )}
        {event.association.kind === "missing-discount" && (
          <p className="mt-3 text-sm text-navy-blue/70">
            No database discount has ID{" "}
            <code className="break-all text-xs">
              {event.association.discountId}
            </code>
          </p>
        )}
      </div>
      <Button asChild className="min-h-11 self-start" variant="secondary">
        <a href={event.eventUrl} rel="noreferrer" target="_blank">
          Open event
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </Button>
    </article>
  );
}

function AssociationBadge({
  association,
}: {
  readonly association: AdminCalendarSale["association"];
}) {
  if (association.kind === "associated") {
    return <Badge className="bg-burned-orange-ink">Associated</Badge>;
  }

  if (association.kind === "missing-discount") {
    return <Badge variant="emphasis">Discount not found</Badge>;
  }

  if (association.kind === "invalid-description") {
    return <Badge variant="emphasis">Invalid description</Badge>;
  }

  return <Badge variant="subtle">No discount ID</Badge>;
}

function SectionHeading({
  count,
  description,
  icon: Icon,
  title,
}: {
  readonly count: number;
  readonly description: string;
  readonly icon: typeof CircleDollarSign;
  readonly title: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
      <span className="grid size-11 place-items-center rounded-xl bg-navy-blue text-white">
        <Icon aria-hidden className="size-5" />
      </span>
      <div>
        <h2 className="text-3xl leading-tight">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-navy-blue/65">
          {description}
        </p>
      </div>
      <Badge className="w-fit" variant="subtle">
        {count} total
      </Badge>
    </div>
  );
}

function FormField({
  children,
  label,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly name: string;
}) {
  return (
    <Label className="grid gap-2">
      <span>{label}</span>
      {children}
    </Label>
  );
}

function EmptyState({ message }: { readonly message: string }) {
  return (
    <div className="px-5 py-10 text-center text-sm text-navy-blue/62">
      {message}
    </div>
  );
}

function AdminSectionLink({
  children,
  href,
}: {
  readonly children: React.ReactNode;
  readonly href: string;
}) {
  return (
    <a
      className="inline-flex min-h-11 items-center rounded-full border border-white/18 px-4 py-2 text-sm font-semibold text-white/85 transition hover:border-white/45 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      href={href}
    >
      {children}
    </a>
  );
}

const fieldId = (name: string, id?: string) => (id ? `${name}-${id}` : name);

const formatAdjustment = (discount: AdminDiscount) =>
  discount.adjustment.kind === "percentage"
    ? `${discount.adjustment.basisPoints / 100}%`
    : `${discount.adjustment.amount.value / 10 ** discount.adjustment.amount.exponent} ${discount.adjustment.amount.currency}`;

const productOptions = [
  { key: "cowork:basic", label: "Cowork Basic" },
  { key: "cowork:plus", label: "Cowork Plus" },
  { key: "cowork:profi", label: "Cowork Profi" },
  { key: "meeting-room:60", label: "Meeting room · 60 min" },
  { key: "meeting-room:240", label: "Meeting room · 240 min" },
  { key: "meeting-room:1440", label: "Meeting room · full day" },
] as const;
