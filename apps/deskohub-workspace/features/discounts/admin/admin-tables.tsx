"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { formatCurrencyName } from "@deskohub/i18n/currency";
import type { Schema } from "effect";
import { ArrowUpRight, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useRef, useState } from "react";
import {
  type DefaultValues,
  type FieldValues,
  useForm,
  useFormContext,
  useWatch,
} from "react-hook-form";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { formatAdministrationMoney } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import { AdministrationAlert } from "@/features/administration/notice";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import type {
  DiscountCodeId,
  StoredDiscountId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import {
  getWorkspaceProductTargetKey,
  type WorkspaceProductTarget,
} from "@/features/discounts/product-target";
import { generatePromotionCode } from "@/features/discounts/promotion-code";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { Button } from "@/shared/components/ui/button";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import { DisclosureButton } from "@/shared/components/ui/disclosure-button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import {
  defaultWorkspaceCurrencyCode,
  findWorkspaceCurrencyDefinition,
  workspaceCurrencyDefinitions,
} from "@/shared/money/currencies";
import {
  temporalInstantToLocalDateTimeString,
  workspaceSiteConstants,
} from "@/shared/utils";
import { formatCount } from "@/shared/utils/number";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { getDiscountAdminActionFailureMessage } from "./action-failure-message";
import { mutateDiscountAdmin } from "./actions";
import type { DiscountAdminMutation } from "./contracts";
import type { AdminCalendarSale } from "./discount-administration.service";
import {
  toCreateDiscountCodeInput,
  toCreateDiscountInput,
  toVoucherConfigurationInput,
  toVoucherCreditInput,
} from "./form-input";
import {
  createDiscountCodeFormSchema,
  createDiscountDefinitionFormSchema,
  createVoucherFormSchema,
  type DiscountCodeConfigurationFormValues,
  type DiscountCodeFormValues,
  type DiscountDefinitionFormValues,
  type VoucherFormValues,
} from "./form-schemas";
import {
  discountProductTargetOptions,
  formatDiscountProductTargets,
  getDiscountProductTargetLabel,
} from "./product-target-options";
import { formatDiscountUsageLimit } from "./usage-limit";

export type DiscountTableItem = {
  readonly id: StoredDiscountId;
  readonly labels: {
    readonly "cs-CZ": string;
    readonly "en-US": string;
  };
  readonly adjustment: DiscountAdjustment;
  readonly products: readonly WorkspaceProductTarget[];
  readonly codeCount: number;
};

export type DiscountCodeTableItem = {
  readonly id: DiscountCodeId;
  readonly discountId: StoredDiscountId;
  readonly code: string;
  readonly enabled: boolean;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly maxUses: number | null;
  readonly maxUsesPerCustomer: number | null;
  readonly audienceSize: number;
  readonly reservedUses: number;
  readonly redeemedUses: number;
  readonly remainingUses: number | null;
};

/** A Calendar sale with its dates already formatted on the server. */
export type CalendarSaleTableItem = AdminCalendarSale & {
  readonly dates: string;
};

export type VoucherTableItem = {
  readonly id: VoucherId;
  readonly code: string;
  readonly issuedCredit: WorkspaceMoney;
  readonly remainingCredit: WorkspaceMoney;
  readonly enabled: boolean;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly audienceSize: number;
  readonly reservedUses: number;
  readonly redeemedUses: number;
};

const getCodeBenefitLabel = (
  code: DiscountCodeTableItem,
  discountLabels: ReadonlyMap<StoredDiscountId, string>
) => discountLabels.get(code.discountId) ?? code.discountId;

const getStatusLabel = (enabled: boolean, locale: Locale) =>
  enabled
    ? m.discountsStatusEnabled({}, { locale })
    : m.discountsStatusDisabled({}, { locale });

const getAudienceLabel = (audienceSize: number, locale: Locale) =>
  audienceSize === 0
    ? m.discountsAudienceUnrestricted({}, { locale })
    : m.discountsAudienceCustomerCount({ count: audienceSize }, { locale });

const getCalendarStatusLabel = (status: string, locale: Locale) => {
  switch (status) {
    case "confirmed":
      return m.discountsCalendarStatusConfirmed({}, { locale });
    case "tentative":
      return m.discountsCalendarStatusTentative({}, { locale });
    case "cancelled":
      return m.discountsCalendarStatusCancelled({}, { locale });
    case "unknown":
      return m.discountsCalendarStatusUnknown({}, { locale });
    default:
      return status;
  }
};

export function DiscountCodesAdminTable({
  codes,
  discounts,
}: {
  readonly codes: readonly DiscountCodeTableItem[];
  readonly discounts: readonly DiscountTableItem[];
}) {
  const locale = useRouteLocale();
  const [expandedId, setExpandedId] = useState<DiscountCodeId | null>(null);
  const discountLabels = useMemo(
    () =>
      new Map(
        discounts.map((discount) => [discount.id, discount.labels[locale]])
      ),
    [discounts, locale]
  );
  const discountProducts = useMemo(
    () =>
      new Map(
        discounts.map((discount) => [
          discount.id,
          formatDiscountProductTargets(discount.products, locale),
        ])
      ),
    [discounts, locale]
  );
  const columns = useMemo<
    AdministrationDataTableColumn<DiscountCodeTableItem>[]
  >(
    () => [
      {
        accessorKey: "code",
        header: m.discountsColumnCode({}, { locale }),
        cell: ({ row }) => (
          <Link
            className="font-mono font-semibold underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
            href={`/admin/codes/${row.original.id}`}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        accessorFn: (code) => getCodeBenefitLabel(code, discountLabels),
        id: "benefit",
        header: m.discountsColumnBenefit({}, { locale }),
      },
      {
        accessorFn: (code) => discountProducts.get(code.discountId) ?? "",
        id: "products",
        header: m.discountsColumnProducts({}, { locale }),
      },
      {
        accessorFn: (code) => getStatusLabel(code.enabled, locale),
        id: "status",
        header: m.discountsColumnStatus({}, { locale }),
        cell: ({ row }) => (
          <StatusBadge tone={row.original.enabled ? "positive" : "neutral"}>
            {getStatusLabel(row.original.enabled, locale)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: "audienceSize",
        header: m.discountsColumnAudience({}, { locale }),
        cell: ({ row }) => getAudienceLabel(row.original.audienceSize, locale),
      },
      {
        accessorKey: "reservedUses",
        header: m.discountsColumnReserved({}, { locale }),
        cell: ({ row }) => formatCount(row.original.reservedUses, locale),
      },
      {
        accessorKey: "redeemedUses",
        header: m.discountsColumnRedeemed({}, { locale }),
        cell: ({ row }) => formatCount(row.original.redeemedUses, locale),
      },
      {
        accessorFn: (code) => code.remainingUses ?? Number.POSITIVE_INFINITY,
        id: "remaining",
        header: m.discountsColumnRemainingGlobally({}, { locale }),
        cell: ({ row }) =>
          formatDiscountUsageLimit(row.original.remainingUses, locale),
      },
      {
        accessorFn: (code) =>
          code.maxUsesPerCustomer ?? Number.POSITIVE_INFINITY,
        id: "maxUsesPerCustomer",
        header: m.discountsColumnUsesPerCustomer({}, { locale }),
        cell: ({ row }) =>
          formatDiscountUsageLimit(row.original.maxUsesPerCustomer, locale),
      },
    ],
    [discountLabels, discountProducts, locale]
  );

  return (
    <AdministrationDataTable
      ariaLabel={m.discountsCodesTableLabel({}, { locale })}
      columns={columns}
      data={codes}
      expandedId={expandedId}
      getRowId={(code) => code.id}
      onRowActivate={(code, expanded) =>
        setExpandedId(expanded ? null : code.id)
      }
      renderActions={(code, expanded) => (
        <RowActions
          confirmation={m.discountsCodeDeleteConfirmation(
            { code: code.code },
            { locale }
          )}
          deleteLabel={m.discountsDeleteItemLabel(
            { name: code.code },
            { locale }
          )}
          editLabel={m.discountsEditItemLabel({ name: code.code }, { locale })}
          expanded={expanded}
          keepDeleteVisible
          onDelete={() => ({ kind: "delete-code", id: code.id })}
          onEdit={() => setExpandedId(expanded ? null : code.id)}
        />
      )}
      renderExpanded={(code) => (
        <CodeAndDiscountEditor
          code={code}
          discount={discounts.find(({ id }) => id === code.discountId)}
          discounts={discounts}
          onDeleted={() => setExpandedId(null)}
        />
      )}
    />
  );
}

export function VouchersAdminTable({
  vouchers: items,
}: {
  readonly vouchers: readonly VoucherTableItem[];
}) {
  const locale = useRouteLocale();
  const [expandedId, setExpandedId] = useState<VoucherId | null>(null);
  const columns = useMemo<AdministrationDataTableColumn<VoucherTableItem>[]>(
    () => [
      {
        accessorKey: "code",
        header: m.discountsColumnVoucher({}, { locale }),
        cell: ({ row }) => (
          <Link
            className="font-mono font-semibold underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
            href={`/admin/vouchers/${row.original.id}`}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        accessorFn: (voucher) => voucher.issuedCredit.value,
        id: "issuedCredit",
        header: m.discountsColumnIssued({}, { locale }),
        cell: ({ row }) =>
          formatAdministrationMoney(row.original.issuedCredit, locale),
      },
      {
        accessorFn: (voucher) => voucher.remainingCredit.value,
        id: "remainingCredit",
        header: m.discountsColumnRemaining({}, { locale }),
        cell: ({ row }) =>
          formatAdministrationMoney(row.original.remainingCredit, locale),
      },
      {
        accessorFn: (voucher) => getStatusLabel(voucher.enabled, locale),
        id: "status",
        header: m.discountsColumnStatus({}, { locale }),
        cell: ({ row }) => (
          <StatusBadge tone={row.original.enabled ? "positive" : "neutral"}>
            {getStatusLabel(row.original.enabled, locale)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: "audienceSize",
        header: m.discountsColumnAudience({}, { locale }),
        cell: ({ row }) => getAudienceLabel(row.original.audienceSize, locale),
      },
      {
        accessorKey: "redeemedUses",
        header: m.discountsColumnRedemptions({}, { locale }),
        cell: ({ row }) => formatCount(row.original.redeemedUses, locale),
      },
    ],
    [locale]
  );

  return (
    <AdministrationDataTable
      ariaLabel={m.discountsVouchersTitle({}, { locale })}
      columns={columns}
      data={items}
      expandedId={expandedId}
      getRowId={(voucher) => voucher.id}
      onRowActivate={(voucher, expanded) =>
        setExpandedId(expanded ? null : voucher.id)
      }
      renderActions={(voucher, expanded) => (
        <RowActions
          confirmation={m.discountsVoucherDeleteConfirmation(
            { code: voucher.code },
            { locale }
          )}
          deleteLabel={m.discountsDeleteItemLabel(
            { name: voucher.code },
            { locale }
          )}
          editLabel={m.discountsEditItemLabel(
            { name: voucher.code },
            { locale }
          )}
          expanded={expanded}
          keepDeleteVisible
          onDelete={() => ({ kind: "delete-voucher", id: voucher.id })}
          onEdit={() => setExpandedId(expanded ? null : voucher.id)}
        />
      )}
      renderExpanded={(voucher) => <VoucherEditor voucher={voucher} />}
    />
  );
}

export function VoucherEditor({
  deletable = false,
  deleteRedirect,
  voucher,
}: {
  readonly deletable?: boolean;
  readonly deleteRedirect?: string;
  readonly voucher: VoucherTableItem;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  return (
    <div>
      <p className="mb-5 break-all font-mono text-xs text-navy-blue/70">
        {voucher.id}
      </p>
      <MutationForm
        actionName={`updateVoucher.${voucher.id}`}
        buildMutation={(values) => ({
          kind: "update-voucher",
          voucher: {
            id: voucher.id,
            ...toVoucherConfigurationInput(values),
            credit: toVoucherCreditInput(values),
          },
        })}
        defaultValues={voucherFormDefaults(voucher)}
        resetOnSuccessTo="submitted"
        deleteControl={
          deletable ? (
            <DeleteButton
              confirmation={m.discountsVoucherDeleteConfirmation(
                { code: voucher.code },
                { locale }
              )}
              label={m.discountsDeleteItemLabel(
                { name: voucher.code },
                { locale }
              )}
              mutation={() => ({ kind: "delete-voucher", id: voucher.id })}
              onDeleted={
                deleteRedirect
                  ? () =>
                      router.push(
                        localizeAdministrationHref(deleteRedirect, locale)
                      )
                  : undefined
              }
            />
          ) : undefined
        }
        requireDirty
        schema={createVoucherFormSchema(locale)}
        submitLabel={m.discountsVoucherSave({}, { locale })}
        submitIcon={<Save aria-hidden className="size-4" />}
      >
        <div className="grid gap-5">
          <VoucherCreditFields credit={voucher.issuedCredit} />
          <DiscountCodeConfigurationFields code={voucher} showMaxUses={false} />
        </div>
      </MutationForm>
    </div>
  );
}

function CodeAndDiscountEditor({
  code,
  discount,
  discounts,
  onDeleted,
}: {
  readonly code: DiscountCodeTableItem;
  readonly discount?: DiscountTableItem;
  readonly discounts: readonly DiscountTableItem[];
  readonly onDeleted: () => void;
}) {
  const locale = useRouteLocale();
  return (
    <div className="grid gap-7">
      <section>
        <h3 className="mb-4 font-semibold">
          {m.discountsCodeHeading({}, { locale })}
        </h3>
        <DiscountCodeEditor code={code} discounts={discounts} />
      </section>
      {discount && (
        <section className="border-t border-navy-blue/10 pt-6">
          <h3 className="mb-4 font-semibold">
            {m.discountsDiscountLabel({}, { locale })}
          </h3>
          <DiscountEditor
            deletable={false}
            discount={discount}
            onDeleted={onDeleted}
          />
        </section>
      )}
    </div>
  );
}

export function CalendarSalesAdminTable({
  discounts,
  events,
}: {
  readonly discounts: readonly DiscountTableItem[];
  readonly events: readonly CalendarSaleTableItem[];
}) {
  const locale = useRouteLocale();
  const [expandedReference, setExpandedReference] = useState<string | null>(
    null
  );
  const discountsById = useMemo(
    () => new Map(discounts.map((discount) => [discount.id, discount])),
    [discounts]
  );
  const columns = useMemo<
    AdministrationDataTableColumn<CalendarSaleTableItem>[]
  >(
    () => [
      {
        accessorKey: "title",
        header: m.discountsColumnEvent({}, { locale }),
        cell: ({ row }) => (
          <>
            <p className="font-semibold">{row.original.title}</p>
            <code className="mt-1 block max-w-64 truncate text-xs text-navy-blue/65">
              {row.original.description ||
                m.discountsCalendarEmptyDescription({}, { locale })}
            </code>
          </>
        ),
      },
      {
        accessorKey: "start",
        header: m.discountsColumnDates({}, { locale }),
        cell: ({ row }) => row.original.dates,
        meta: {
          cellClassName: "whitespace-nowrap text-sm text-navy-blue/70",
        },
      },
      {
        accessorKey: "status",
        header: m.discountsColumnCalendarStatus({}, { locale }),
        cell: ({ row }) => (
          <StatusBadge tone="neutral">
            {getCalendarStatusLabel(row.original.status, locale)}
          </StatusBadge>
        ),
      },
      {
        accessorFn: (event) =>
          event.association.kind === "associated"
            ? (discountsById.get(event.association.discountId)?.labels[
                locale
              ] ?? event.association.discountLabel)
            : event.association.kind,
        id: "association",
        header: m.discountsColumnAssociation({}, { locale }),
        cell: ({ row }) => (
          <CalendarAssociationBadge
            association={row.original.association}
            discountsById={discountsById}
          />
        ),
      },
      {
        accessorFn: (event) => {
          const discount =
            event.association.kind === "associated"
              ? discountsById.get(event.association.discountId)
              : undefined;
          return discount
            ? formatDiscountProductTargets(discount.products, locale)
            : "";
        },
        id: "products",
        header: m.discountsColumnProducts({}, { locale }),
      },
    ],
    [discountsById, locale]
  );
  const getRowReference = (event: CalendarSaleTableItem, index: number) =>
    event.eventReference ?? `${event.start}:${event.title}:${index}`;
  const getDiscount = (event: CalendarSaleTableItem) =>
    event.association.kind === "associated"
      ? discountsById.get(event.association.discountId)
      : undefined;

  return (
    <AdministrationDataTable
      ariaLabel={m.discountsCalendarSalesTitle({}, { locale })}
      canRowActivate={(event) => Boolean(getDiscount(event))}
      columns={columns}
      data={events}
      expandedId={expandedReference}
      getRowId={getRowReference}
      onRowActivate={(event, expanded) =>
        setExpandedReference(
          expanded ? null : getRowReference(event, events.indexOf(event))
        )
      }
      renderActions={(event, expanded) => {
        const discount = getDiscount(event);
        return (
          <div className="flex justify-end gap-1">
            <Button asChild size="icon" variant="ghost">
              <a
                aria-label={m.discountsCalendarOpenEvent(
                  { title: event.title },
                  { locale }
                )}
                href={event.eventUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ArrowUpRight aria-hidden className="size-4" />
              </a>
            </Button>
            {discount && (
              <DisclosureButton
                aria-label={m.discountsCalendarEditDiscount(
                  { title: event.title },
                  { locale }
                )}
                expanded={expanded}
                onClick={() =>
                  setExpandedReference(
                    expanded
                      ? null
                      : getRowReference(event, events.indexOf(event))
                  )
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <Pencil aria-hidden className="size-4" />
              </DisclosureButton>
            )}
          </div>
        );
      }}
      renderExpanded={(event) => {
        const discount = getDiscount(event);
        return discount ? (
          <DiscountEditor
            deletable={false}
            discount={discount}
            onDeleted={() => setExpandedReference(null)}
          />
        ) : null;
      }}
      tableClassName="min-w-[760px]"
    />
  );
}

function CalendarAssociationBadge({
  association,
  discountsById,
}: {
  readonly association: AdminCalendarSale["association"];
  readonly discountsById: ReadonlyMap<StoredDiscountId, DiscountTableItem>;
}) {
  const locale = useRouteLocale();
  if (association.kind === "associated") {
    return (
      <div>
        <StatusBadge tone="positive">
          {m.discountsCalendarAssociated({}, { locale })}
        </StatusBadge>
        <p className="mt-1 max-w-48 truncate text-xs text-navy-blue/70">
          {discountsById.get(association.discountId)?.labels[locale] ??
            association.discountLabel}
        </p>
      </div>
    );
  }
  if (association.kind === "missing-discount") {
    return (
      <StatusBadge tone="attention">
        {m.discountsCalendarDiscountNotFound({}, { locale })}
      </StatusBadge>
    );
  }
  if (association.kind === "invalid-description") {
    return (
      <StatusBadge tone="attention">
        {m.discountsCalendarInvalidDescription({}, { locale })}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral">
      {m.discountsCalendarMissingDiscountId({}, { locale })}
    </StatusBadge>
  );
}

export function CreateDiscountForm({
  onCreated,
}: {
  readonly onCreated?: (message: string) => void;
} = {}) {
  const locale = useRouteLocale();
  return (
    <MutationForm
      actionName="createDiscount"
      buildMutation={(values) => ({
        kind: "create-discount",
        discount: toCreateDiscountInput(values),
      })}
      defaultValues={discountDefinitionFormDefaults()}
      onSuccess={onCreated}
      schema={createDiscountDefinitionFormSchema(locale)}
      submitLabel={m.discountsDiscountCreateSubmit({}, { locale })}
      submitIcon={<Plus aria-hidden className="size-4" />}
    >
      <DiscountDefinitionFields />
    </MutationForm>
  );
}

export function CreateVoucherForm({
  customer,
  onCreated,
}: {
  /** Restricts the new voucher to this customer's audience. */
  readonly customer?: {
    readonly id: DotyposCustomerId;
    readonly displayName: string;
  };
  readonly onCreated?: (message: string) => void;
} = {}) {
  const locale = useRouteLocale();
  return (
    <MutationForm
      actionName={customer ? "createCustomerVoucher" : "createVoucher"}
      buildMutation={(values): DiscountAdminMutation => {
        const voucher = {
          ...toVoucherConfigurationInput(values),
          credit: toVoucherCreditInput(values),
        };
        return customer
          ? {
              kind: "create-customer-voucher",
              voucher: { customerId: customer.id, ...voucher },
            }
          : { kind: "create-voucher", voucher };
      }}
      defaultValues={voucherFormDefaults()}
      onSuccess={onCreated}
      schema={createVoucherFormSchema(locale)}
      submitLabel={m.discountsVoucherCreateSubmit({}, { locale })}
      submitIcon={<Plus aria-hidden className="size-4" />}
    >
      <div className="grid gap-5">
        {customer && (
          <div className="rounded-xl bg-aquamarine-green/12 px-4 py-3 text-sm text-aquamarine-ink">
            {m.discountsVoucherCustomerRestriction(
              { customerName: customer.displayName },
              { locale }
            )}
          </div>
        )}
        <VoucherCreditFields />
        <DiscountCodeConfigurationFields showMaxUses={false} />
      </div>
    </MutationForm>
  );
}

function RowActions({
  confirmation,
  deleteLabel,
  editLabel,
  expanded,
  onDelete,
  onEdit,
  keepDeleteVisible = false,
}: {
  readonly confirmation: string;
  readonly deleteLabel: string;
  readonly editLabel: string;
  readonly expanded: boolean;
  readonly onDelete: () => DiscountAdminMutation;
  readonly onEdit: () => void;
  readonly keepDeleteVisible?: boolean;
}) {
  return (
    <div className="flex justify-end gap-1">
      {(!expanded || keepDeleteVisible) && (
        <DeleteButton
          confirmation={confirmation}
          iconOnly
          label={deleteLabel}
          mutation={onDelete}
        />
      )}
      <DisclosureButton
        aria-label={editLabel}
        expanded={expanded}
        onClick={onEdit}
        size="icon"
        variant="ghost"
      >
        <Pencil aria-hidden className="size-4" />
      </DisclosureButton>
    </div>
  );
}

function DiscountEditor({
  deletable = true,
  discount,
  onDeleted,
}: {
  readonly deletable?: boolean;
  readonly discount: DiscountTableItem;
  readonly onDeleted: () => void;
}) {
  const locale = useRouteLocale();
  return (
    <div>
      <div className="mb-5 rounded-xl bg-navy-blue/[0.045] px-3 py-2">
        <p className="text-xs font-semibold text-navy-blue/70">
          {m.discountsCalendarIdLabel({}, { locale })}
        </p>
        <code className="mt-1 block break-all text-xs">{discount.id}</code>
      </div>
      <MutationForm
        actionName={`updateDiscount.${discount.id}`}
        buildMutation={(values) => ({
          kind: "update-discount",
          discount: {
            id: discount.id,
            ...toCreateDiscountInput(values),
          },
        })}
        defaultValues={discountDefinitionFormDefaults(discount)}
        resetOnSuccessTo="submitted"
        deleteControl={
          deletable ? (
            <DeleteButton
              confirmation={m.discountsDiscountDeleteConfirmation(
                { label: discount.labels[locale] },
                { locale }
              )}
              label={m.discountsDeleteItemLabel(
                { name: discount.labels[locale] },
                { locale }
              )}
              mutation={() => ({ kind: "delete-discount", id: discount.id })}
              onDeleted={onDeleted}
            />
          ) : undefined
        }
        requireDirty
        schema={createDiscountDefinitionFormSchema(locale)}
        submitLabel={m.discountsDiscountSave({}, { locale })}
        submitIcon={<Save aria-hidden className="size-4" />}
      >
        <DiscountDefinitionFields discount={discount} />
      </MutationForm>
    </div>
  );
}

function DiscountCodeEditor({
  code,
  discounts,
}: {
  readonly code: DiscountCodeTableItem;
  readonly discounts: readonly DiscountTableItem[];
}) {
  const locale = useRouteLocale();
  return (
    <div>
      <p className="mb-5 break-all font-mono text-xs text-navy-blue/70">
        {code.id}
      </p>
      <MutationForm
        actionName={`updateDiscountCode.${code.id}`}
        buildMutation={(values) => ({
          kind: "update-code",
          code: {
            id: code.id,
            ...toCreateDiscountCodeInput(values),
          },
        })}
        defaultValues={discountCodeFormDefaults(code)}
        resetOnSuccessTo="submitted"
        requireDirty
        schema={createDiscountCodeFormSchema(locale)}
        submitLabel={m.discountsCodeSave({}, { locale })}
        submitIcon={<Save aria-hidden className="size-4" />}
      >
        <DiscountCodeFields code={code} discounts={discounts} />
      </MutationForm>
    </div>
  );
}

function MutationForm<Input extends FieldValues, Values = Input>({
  actionName,
  buildMutation,
  children,
  defaultValues,
  deleteControl,
  resetOnSuccessTo = "initial",
  requireDirty = false,
  schema,
  submitIcon,
  submitLabel,
  onSuccess,
}: {
  readonly actionName: string;
  readonly buildMutation: (values: Values) => DiscountAdminMutation;
  readonly children: ReactNode;
  readonly defaultValues: DefaultValues<Input>;
  readonly deleteControl?: ReactNode;
  /**
   * Edit forms rebase onto the submitted values so a follow-up edit submits
   * the saved state plus the new change; create forms clear back to defaults.
   */
  readonly resetOnSuccessTo?: "initial" | "submitted";
  readonly requireDirty?: boolean;
  readonly schema: Schema.Codec<Values, Input>;
  readonly submitIcon: ReactNode;
  readonly submitLabel: string;
  readonly onSuccess?: (message: string) => void;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [feedback, setFeedback] = useState<{
    readonly kind: "error" | "success";
    readonly message: string;
    /** The form values this feedback was shown with; unset until it renders. */
    readonly formValues?: Input;
  } | null>(null);
  const form = useForm<Input, unknown, Values>({
    defaultValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(schema),
  });
  const { isDirty } = form.formState;
  // `compute` makes useWatch deep-compare the values, so the snapshot keeps
  // its identity until a field value actually changes.
  const formValues = useWatch({
    control: form.control,
    compute: (values) => values,
  });
  // New feedback adopts the values it first renders with, which already
  // include a success reset; any later edit to those values clears it.
  if (feedback && feedback.formValues !== formValues) {
    setFeedback(feedback.formValues ? null : { ...feedback, formValues });
  }
  // Snapshot taken at submit entry so the success reset cannot absorb values
  // edited while the request is in flight.
  const submittedValuesRef = useRef<Input | null>(null);
  const recordSubmittedValues = (values: Input) => {
    submittedValuesRef.current = values;
  };

  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName,
    onSuccess: ({ data }) => {
      if (!data) return;
      // Rebase the defaults onto the submitted snapshot while retaining every
      // current value, so dirty state recomputes against the snapshot and an
      // in-flight edit that reverted a field to its original value survives.
      form.reset(
        resetOnSuccessTo === "submitted"
          ? (submittedValuesRef.current ?? undefined)
          : undefined,
        resetOnSuccessTo === "submitted" ? { keepValues: true } : undefined
      );
      const message = data.createdDiscountId
        ? m.discountsCreatedDiscountNotice(
            { notice: data.notice, calendarId: data.createdDiscountId },
            { locale }
          )
        : data.notice;
      if (onSuccess) onSuccess(message);
      else setFeedback({ kind: "success", message });
      router.refresh();
    },
    onError: ({ error }) => {
      setFeedback({
        kind: "error",
        message: getDiscountAdminActionFailureMessage(error.serverError, {
          fallback: m.discountsSaveFailedCheckForm({}, { locale }),
          locale,
        }),
      });
    },
    onTransportError: () => {
      setFeedback({
        kind: "error",
        message: m.discountsSaveFailedRetry({}, { locale }),
      });
    },
  });

  const disabled = isExecuting || (requireDirty && !isDirty);

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          // Bound at event time so the submitted-values ref is only written
          // outside render.
          void form.handleSubmit((values) => {
            recordSubmittedValues(form.getValues());
            execute(buildMutation(values));
          })(event);
        }}
      >
        {children}
        {feedback && (
          <AdministrationAlert
            className="mt-5 font-semibold"
            role={feedback.kind === "error" ? "alert" : "status"}
            status={feedback.kind}
          >
            {feedback.message}
          </AdministrationAlert>
        )}
        <div className="mt-6 flex items-center justify-between border-t border-navy-blue/10 pt-5">
          <div>{deleteControl}</div>
          <Button
            disabled={disabled}
            tone={isDirty ? "burned-orange-ink" : "burned-orange"}
            type="submit"
          >
            {submitIcon}
            {isExecuting ? m.discountsSaving({}, { locale }) : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function DeleteButton({
  confirmation,
  iconOnly = false,
  label,
  mutation,
  onDeleted,
}: {
  readonly confirmation: string;
  readonly iconOnly?: boolean;
  readonly label: string;
  readonly mutation: () => DiscountAdminMutation;
  readonly onDeleted?: () => void;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName: "deleteDiscountAdminItem",
    onSuccess: ({ data }) => {
      if (!data) return;
      onDeleted?.();
      router.refresh();
    },
    onError: ({ error: actionError }) => {
      setError(
        getDiscountAdminActionFailureMessage(actionError.serverError, {
          fallback: m.discountsDeleteFailed({}, { locale }),
          locale,
        })
      );
    },
    onTransportError: () => {
      setError(m.discountsDeleteFailedRetry({}, { locale }));
    },
  });

  return (
    <>
      <Button
        aria-label={label}
        disabled={isExecuting}
        onClick={() => {
          setError(null);
          if (globalThis.confirm(confirmation)) {
            execute(mutation());
          }
        }}
        size={iconOnly ? "icon" : "default"}
        tone="burned-orange-ink"
        type="button"
        variant="secondary"
      >
        <Trash2 aria-hidden className="size-4" />
        {!iconOnly &&
          (isExecuting
            ? m.discountsDeleting({}, { locale })
            : m.discountsDelete({}, { locale }))}
      </Button>
      {error && (
        <AdministrationAlert className="mt-3" role="alert" status="error">
          {error}
        </AdministrationAlert>
      )}
    </>
  );
}

export function DiscountDefinitionFields({
  discount,
}: {
  readonly discount?: DiscountTableItem;
}) {
  const locale = useRouteLocale();
  const { control } = useFormContext<DiscountDefinitionFormValues>();
  const kind = useWatch({ control, name: "adjustmentKind" });
  const existingFixedCurrency =
    discount?.adjustment.kind === "fixed"
      ? discount.adjustment.amount.currency
      : undefined;

  return (
    <div className="grid gap-7">
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">
          {m.discountsCustomerLabelsLegend({}, { locale })}
        </legend>
        <FormField
          control={control}
          name="labelEn"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel htmlFor={fieldId("labelEn", discount?.id)}>
                {m.discountsLabelEnglish({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id={fieldId("labelEn", discount?.id)}
                  required
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="labelCs"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel htmlFor={fieldId("labelCs", discount?.id)}>
                {m.discountsLabelCzech({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id={fieldId("labelCs", discount?.id)}
                  required
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold">
          {m.discountsAdjustmentLegend({}, { locale })}
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={control}
            name="adjustmentKind"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId("adjustmentKind", discount?.id)}>
                  {m.discountsAdjustmentKindLabel({}, { locale })}
                </FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className={selectClassName}
                    id={fieldId("adjustmentKind", discount?.id)}
                  >
                    <option value="percentage">
                      {m.discountsAdjustmentKindPercentage({}, { locale })}
                    </option>
                    <option value="fixed">
                      {m.discountsAdjustmentKindFixed({}, { locale })}
                    </option>
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {kind === "percentage" ? (
            <FormField
              control={control}
              name="percentage"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel htmlFor={fieldId("percentage", discount?.id)}>
                    {m.discountsPercentageLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id={fieldId("percentage", discount?.id)}
                      max={100}
                      min={0.01}
                      required
                      step={0.01}
                      type="number"
                      variant={fieldState.error ? "error" : "default"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <>
              <FormField
                control={control}
                name="fixedAmountValue"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel
                      htmlFor={fieldId("fixedAmountValue", discount?.id)}
                    >
                      {m.discountsFixedValueLabel({}, { locale })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id={fieldId("fixedAmountValue", discount?.id)}
                        min={1}
                        required
                        step={1}
                        type="number"
                        variant={fieldState.error ? "error" : "default"}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="fixedAmountCurrency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel
                      htmlFor={fieldId("fixedAmountCurrency", discount?.id)}
                    >
                      {m.discountsCurrencyLabel({}, { locale })}
                    </FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className={selectClassName}
                        id={fieldId("fixedAmountCurrency", discount?.id)}
                        required
                      >
                        {existingFixedCurrency &&
                          !findWorkspaceCurrencyDefinition(
                            existingFixedCurrency
                          ) && (
                            <option value={existingFixedCurrency}>
                              {m.discountsCurrencyUnsupported(
                                { currency: existingFixedCurrency },
                                { locale }
                              )}
                            </option>
                          )}
                        {workspaceCurrencyDefinitions.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code} —{" "}
                            {formatCurrencyName({
                              currency: currency.code,
                              locale,
                            })}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
        </div>
        {kind === "fixed" && (
          <p className="mt-3 text-xs leading-5 text-navy-blue/70">
            {m.discountsFixedValueHint({}, { locale })}
          </p>
        )}
      </fieldset>

      <FormField
        control={control}
        name="products"
        render={({ field, fieldState }) => (
          <FormItem>
            <fieldset aria-invalid={Boolean(fieldState.error)}>
              <legend className="mb-3 text-sm font-semibold">
                {m.discountsEligibleProductsLegend({}, { locale })}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {discountProductTargetOptions.map((option) => (
                  <ChoiceCard align="center" key={option.key}>
                    <input
                      checked={field.value.includes(option.key)}
                      className="size-4 accent-[var(--brand-burned-orange)]"
                      name={field.name}
                      onBlur={field.onBlur}
                      onChange={(event) =>
                        field.onChange(
                          event.target.checked
                            ? [...field.value, option.key]
                            : field.value.filter((key) => key !== option.key)
                        )
                      }
                      type="checkbox"
                      value={option.key}
                    />
                    <span className="text-sm font-medium">
                      {getDiscountProductTargetLabel(option.target, locale)}
                    </span>
                  </ChoiceCard>
                ))}
              </div>
            </fieldset>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function DiscountCodeFields({
  code,
  discounts,
}: {
  readonly code?: DiscountCodeTableItem;
  readonly discounts: readonly DiscountTableItem[];
}) {
  const locale = useRouteLocale();
  const { control } = useFormContext<DiscountCodeFormValues>();

  return (
    <div className="grid gap-5">
      <FormField
        control={control}
        name="discountId"
        render={({ field }) => (
          <FormItem>
            <FormLabel htmlFor={fieldId("discountId", code?.id)}>
              {m.discountsDiscountLabel({}, { locale })}
            </FormLabel>
            <FormControl>
              <select
                {...field}
                className={selectClassName}
                id={fieldId("discountId", code?.id)}
                required
              >
                {discounts.map((discount) => (
                  <option key={discount.id} value={discount.id}>
                    {discount.labels[locale]}
                  </option>
                ))}
              </select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <DiscountCodeConfigurationFields code={code} />
    </div>
  );
}

export function DiscountCodeConfigurationFields({
  code,
  showMaxUses = true,
}: {
  readonly code?: DiscountCodeTableItem | VoucherTableItem;
  readonly showMaxUses?: boolean;
}) {
  const locale = useRouteLocale();
  const { control, register, setValue } =
    useFormContext<DiscountCodeConfigurationFormValues>();
  const codeInputId = fieldId("code", code?.id);

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name="code"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel htmlFor={codeInputId}>
                {m.discountsCodeLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoCapitalize="characters"
                  className="font-mono uppercase"
                  id={codeInputId}
                  maxLength={64}
                  minLength={3}
                  required
                  spellCheck={false}
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              {code ? null : (
                <Button
                  className="mt-3"
                  onClick={() => setValue("code", generatePromotionCode())}
                  type="button"
                  variant="secondary"
                >
                  {m.discountsGenerateCode({}, { locale })}
                </Button>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <ChoiceCard align="center" className="self-end">
          <input
            {...register("enabled")}
            className="size-4 accent-[var(--brand-burned-orange)]"
            defaultChecked={code?.enabled ?? true}
            type="checkbox"
          />
          <span className="text-sm font-semibold">
            {m.discountsEnabledLabel({}, { locale })}
          </span>
        </ChoiceCard>
      </div>
      <div
        className={`grid gap-4 ${showMaxUses ? "md:grid-cols-4" : "md:grid-cols-2"}`}
      >
        <FormField
          control={control}
          name="validFrom"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel htmlFor={fieldId("validFrom", code?.id)}>
                {m.discountsValidFromLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id={fieldId("validFrom", code?.id)}
                  type="datetime-local"
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="validUntil"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel htmlFor={fieldId("validUntil", code?.id)}>
                {m.discountsValidUntilLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id={fieldId("validUntil", code?.id)}
                  type="datetime-local"
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {showMaxUses && (
          <>
            <FormField
              control={control}
              name="maxUses"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel htmlFor={fieldId("maxUses", code?.id)}>
                    {m.discountsMaxUsesLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id={fieldId("maxUses", code?.id)}
                      min={1}
                      placeholder={m.discountsUnlimited({}, { locale })}
                      type="number"
                      variant={fieldState.error ? "error" : "default"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="maxUsesPerCustomer"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel htmlFor={fieldId("maxUsesPerCustomer", code?.id)}>
                    {m.discountsMaxUsesPerCustomerLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id={fieldId("maxUsesPerCustomer", code?.id)}
                      min={1}
                      placeholder={m.discountsUnlimited({}, { locale })}
                      type="number"
                      variant={fieldState.error ? "error" : "default"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
      </div>
      <p className="text-xs leading-5 text-navy-blue/70">
        {m.discountsValidityHint({}, { locale })}
      </p>
    </div>
  );
}

function VoucherCreditFields(_props: {
  readonly credit?: WorkspaceMoney | null;
}) {
  const locale = useRouteLocale();
  const { control } = useFormContext<VoucherFormValues>();

  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold">
        {m.discountsVoucherCreditLegend({}, { locale })}
      </legend>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name="voucherValue"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel htmlFor="voucherValue">
                {m.discountsVoucherValueLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id="voucherValue"
                  min={1}
                  required
                  step={1}
                  type="number"
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="voucherCurrency"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="voucherCurrency">
                {m.discountsCurrencyLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <select
                  {...field}
                  className={selectClassName}
                  id="voucherCurrency"
                  required
                >
                  {workspaceCurrencyDefinitions.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code} —{" "}
                      {formatCurrencyName({ currency: currency.code, locale })}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-navy-blue/70">
        {m.discountsVoucherCreditHint({}, { locale })}
      </p>
    </fieldset>
  );
}

const discountDefinitionFormDefaults = (
  discount?: DiscountTableItem
): DiscountDefinitionFormValues => ({
  labelEn: discount?.labels["en-US"] ?? "",
  labelCs: discount?.labels["cs-CZ"] ?? "",
  adjustmentKind: discount?.adjustment.kind ?? "percentage",
  percentage:
    discount?.adjustment.kind === "percentage"
      ? String(discount.adjustment.basisPoints / 100)
      : "10",
  fixedAmountValue:
    discount?.adjustment.kind === "fixed"
      ? String(discount.adjustment.amount.value)
      : "10000",
  fixedAmountCurrency:
    discount?.adjustment.kind === "fixed"
      ? discount.adjustment.amount.currency
      : defaultWorkspaceCurrencyCode,
  products: discount?.products.map(getWorkspaceProductTargetKey) ?? [],
});

const discountCodeFormDefaults = (
  code?: DiscountCodeTableItem
): DiscountCodeFormValues => ({
  discountId: code?.discountId ?? "",
  ...discountCodeConfigurationFormDefaults(code),
});

const discountCodeConfigurationFormDefaults = (
  item?: DiscountCodeTableItem | VoucherTableItem
): DiscountCodeConfigurationFormValues => ({
  code: item?.code ?? "",
  enabled: item?.enabled ?? true,
  validFrom: toDateTimeInputValue(item?.validFrom),
  validUntil: toDateTimeInputValue(item?.validUntil),
  maxUses:
    item && "maxUses" in item && item.maxUses !== null
      ? String(item.maxUses)
      : "",
  maxUsesPerCustomer:
    item && "maxUsesPerCustomer" in item && item.maxUsesPerCustomer !== null
      ? String(item.maxUsesPerCustomer)
      : "",
});

const voucherFormDefaults = (
  voucher?: VoucherTableItem
): VoucherFormValues => ({
  voucherValue: voucher ? String(voucher.issuedCredit.value) : "10000",
  voucherCurrency:
    voucher?.issuedCredit.currency ?? defaultWorkspaceCurrencyCode,
  code: voucher?.code ?? "",
  enabled: voucher?.enabled ?? true,
  validFrom: toDateTimeInputValue(voucher?.validFrom),
  validUntil: toDateTimeInputValue(voucher?.validUntil),
});

const toDateTimeInputValue = (value: string | null | undefined) =>
  value
    ? temporalInstantToLocalDateTimeString({
        instant: Temporal.Instant.from(value),
        timeZone: workspaceSiteConstants.location.timeZone,
      })
    : "";

const fieldId = (name: string, id?: string) => (id ? `${name}-${id}` : name);

const selectClassName =
  "min-h-12 w-full rounded-[1.1rem] border border-navy-blue/12 bg-white px-4 py-3 text-base outline-none focus-visible:border-burned-orange focus-visible:ring-4 focus-visible:ring-burned-orange/10";
