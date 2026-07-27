import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Plus,
  Save,
} from "lucide-react";
import Link from "next/link";
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

export function DiscountsAdministrationPage({
  dashboard,
  notice,
}: DiscountAdministrationProps) {
  return (
    <AdminPageShell
      activeSection="discounts"
      count={dashboard.discounts.length}
      notice={notice}
      title="Discounts"
    >
      <DiscountsSection discounts={dashboard.discounts} />
    </AdminPageShell>
  );
}

export function CodesAdministrationPage({
  dashboard,
  notice,
}: DiscountAdministrationProps) {
  return (
    <AdminPageShell
      activeSection="codes"
      count={dashboard.codes.length}
      notice={notice}
      title="Discount codes"
    >
      <CodesSection codes={dashboard.codes} discounts={dashboard.discounts} />
    </AdminPageShell>
  );
}

export function SalesAdministrationPage({
  dashboard,
  notice,
}: DiscountAdministrationProps) {
  return (
    <AdminPageShell
      activeSection="sales"
      count={dashboard.calendar.events.length}
      notice={notice}
      title="Calendar sales"
    >
      <CalendarSection calendar={dashboard.calendar} />
    </AdminPageShell>
  );
}

function AdminPageShell({
  activeSection,
  children,
  count,
  notice,
  title,
}: {
  readonly activeSection: "codes" | "discounts" | "sales";
  readonly children: React.ReactNode;
  readonly count: number;
  readonly notice: DiscountAdministrationProps["notice"];
  readonly title: string;
}) {
  return (
    <main className="min-h-screen bg-[#f4f5f8] text-navy-blue">
      <header className="border-b border-navy-blue/12 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl leading-none">{title}</h1>
            <Badge variant="subtle">{count}</Badge>
          </div>
          <nav aria-label="Administration" className="flex gap-1">
            <AdminSectionLink
              active={activeSection === "discounts"}
              href="/admin/discounts"
            >
              Discounts
            </AdminSectionLink>
            <AdminSectionLink
              active={activeSection === "codes"}
              href="/admin/codes"
            >
              Codes
            </AdminSectionLink>
            <AdminSectionLink
              active={activeSection === "sales"}
              href="/admin/sales"
            >
              Sales
            </AdminSectionLink>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
        {notice && (
          <div
            className={
              notice.status === "success"
                ? "mb-5 flex items-start gap-3 rounded-xl bg-aquamarine-green/15 px-4 py-3 text-aquamarine-ink"
                : "mb-5 flex items-start gap-3 rounded-xl bg-burned-orange/10 px-4 py-3 text-burned-orange-ink"
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
        {children}
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
    <section>
      <details className="group rounded-xl border border-navy-blue/10 bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 font-semibold marker:hidden">
          <span className="grid size-8 place-items-center rounded-lg bg-burned-orange-ink text-white">
            <Plus aria-hidden className="size-4" />
          </span>
          Create a discount
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

      <div className="mt-4 divide-y divide-navy-blue/10 overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
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
          <p className="text-xs font-semibold text-navy-blue/70">Calendar ID</p>
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
        <div className="mt-7 flex justify-end border-t border-navy-blue/10 pt-5">
          <DeleteForm
            action={deleteAction}
            confirmation={`Delete the discount “${discount.labels["en-US"]}”? Referenced discounts cannot be deleted. This cannot be undone.`}
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
    <section>
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

      <div className="mt-4 divide-y divide-navy-blue/10 overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
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
        <div className="mt-7 flex justify-end border-t border-navy-blue/10 pt-5">
          <DeleteForm
            action={deleteAction}
            confirmation={`Delete the code “${code.code}”? Redeemed codes cannot be deleted. Disable it to preserve history. This cannot be undone.`}
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
  active,
  children,
  href,
}: {
  readonly active: boolean;
  readonly children: React.ReactNode;
  readonly href: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "inline-flex min-h-10 items-center rounded-lg bg-navy-blue px-3 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
          : "inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-semibold text-navy-blue/70 transition hover:bg-navy-blue/5 hover:text-navy-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
      }
      href={href}
    >
      {children}
    </Link>
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
