"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpRight,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  Fragment,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { AdministrationAlert } from "@/features/administration/notice";
import { AdministrationSortHead } from "@/features/administration/sort-head";
import { AdministrationStatusBadge } from "@/features/administration/status-badge";
import { AdministrationTableFrame } from "@/features/administration/table-frame";
import {
  formatWorkspaceMoney,
  type WorkspaceMoney,
} from "@/features/checkout/workspace-money";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import type {
  DiscountCodeId,
  StoredDiscountId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { generatePromotionCode } from "@/features/discounts/promotion-code";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  defaultWorkspaceCurrency,
  findWorkspaceCurrencyDefinition,
  workspaceCurrencyDefinitions,
} from "@/shared/money/currencies";
import {
  cn,
  temporalInstantToLocalDateTimeString,
  workspaceSiteConstants,
} from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateDiscountAdmin } from "./actions";
import type { DiscountAdminMutation } from "./contracts";
import type { AdminCalendarSale } from "./discount-administration.service";
import { getDiscountAdminValidationMessage } from "./form-feedback";
import {
  readDiscountCodeForm,
  readDiscountForm,
  readVoucherConfigurationForm,
  readVoucherCreditForm,
} from "./form-input";

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

const isTableRowControl = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest("a, button, input, select, textarea, label, summary"));

const getCodeBenefitLabel = (
  code: DiscountCodeTableItem,
  discountLabels: ReadonlyMap<StoredDiscountId, string>
) => discountLabels.get(code.discountId) ?? code.discountId;

export function DiscountCodesAdminTable({
  codes,
  discounts,
}: {
  readonly codes: readonly DiscountCodeTableItem[];
  readonly discounts: readonly DiscountTableItem[];
}) {
  const [expandedId, setExpandedId] = useState<DiscountCodeId | null>(null);
  const discountLabels = useMemo(
    () =>
      new Map(
        discounts.map((discount) => [discount.id, discount.labels["en-US"]])
      ),
    [discounts]
  );
  const columns = useMemo<ColumnDef<DiscountCodeTableItem>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Code",
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
        header: "Benefit",
      },
      {
        accessorFn: (code) => (code.enabled ? "Enabled" : "Disabled"),
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <AdministrationStatusBadge
            tone={row.original.enabled ? "positive" : "neutral"}
          >
            {row.original.enabled ? "Enabled" : "Disabled"}
          </AdministrationStatusBadge>
        ),
      },
      {
        accessorKey: "audienceSize",
        header: "Audience",
        cell: ({ row }) =>
          row.original.audienceSize === 0
            ? "Unrestricted"
            : `${row.original.audienceSize} customers`,
      },
      {
        accessorKey: "reservedUses",
        header: "Reserved",
      },
      {
        accessorKey: "redeemedUses",
        header: "Redeemed",
      },
      {
        accessorFn: (code) => code.remainingUses ?? Number.POSITIVE_INFINITY,
        id: "remaining",
        header: "Remaining globally",
        cell: ({ row }) => row.original.remainingUses ?? "Unlimited",
      },
      {
        accessorFn: (code) =>
          code.maxUsesPerCustomer ?? Number.POSITIVE_INFINITY,
        id: "maxUsesPerCustomer",
        header: "Uses per customer",
        cell: ({ row }) => row.original.maxUsesPerCustomer ?? "Unlimited",
      },
    ],
    [discountLabels]
  );

  return (
    <AdminDataTable
      ariaLabel="Discount codes"
      columns={columns}
      data={codes}
      expandedId={expandedId}
      getId={(code) => code.id}
      onRowActivate={(code, expanded) =>
        setExpandedId(expanded ? null : code.id)
      }
      renderActions={(code, expanded) => (
        <RowActions
          confirmation={`Delete the code “${code.code}”? Codes with claim history cannot be deleted. Disable it to preserve history. This cannot be undone.`}
          deleteLabel={`Delete ${code.code}`}
          editLabel={`Edit ${code.code}`}
          expanded={expanded}
          keepDeleteVisible
          onDelete={() => ({ kind: "delete-code", id: code.id })}
          onEdit={() => setExpandedId(expanded ? null : code.id)}
        />
      )}
      renderEditor={(code) => (
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
  const [expandedId, setExpandedId] = useState<VoucherId | null>(null);
  const columns = useMemo<ColumnDef<VoucherTableItem>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Voucher",
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
        header: "Issued",
        cell: ({ row }) =>
          formatWorkspaceMoney(row.original.issuedCredit, "en-US"),
      },
      {
        accessorFn: (voucher) => voucher.remainingCredit.value,
        id: "remainingCredit",
        header: "Remaining",
        cell: ({ row }) =>
          formatWorkspaceMoney(row.original.remainingCredit, "en-US"),
      },
      {
        accessorFn: (voucher) => (voucher.enabled ? "Enabled" : "Disabled"),
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <AdministrationStatusBadge
            tone={row.original.enabled ? "positive" : "neutral"}
          >
            {row.original.enabled ? "Enabled" : "Disabled"}
          </AdministrationStatusBadge>
        ),
      },
      {
        accessorKey: "audienceSize",
        header: "Audience",
        cell: ({ row }) =>
          row.original.audienceSize === 0
            ? "Unrestricted"
            : `${row.original.audienceSize} customers`,
      },
      { accessorKey: "redeemedUses", header: "Redemptions" },
    ],
    []
  );

  return (
    <AdminDataTable
      ariaLabel="Vouchers"
      columns={columns}
      data={items}
      expandedId={expandedId}
      getId={(voucher) => voucher.id}
      onRowActivate={(voucher, expanded) =>
        setExpandedId(expanded ? null : voucher.id)
      }
      renderActions={(voucher, expanded) => (
        <RowActions
          confirmation={`Delete the voucher “${voucher.code}”? Vouchers with claim history cannot be deleted. Disable it to preserve history. This cannot be undone.`}
          deleteLabel={`Delete ${voucher.code}`}
          editLabel={`Edit ${voucher.code}`}
          expanded={expanded}
          keepDeleteVisible
          onDelete={() => ({ kind: "delete-voucher", id: voucher.id })}
          onEdit={() => setExpandedId(expanded ? null : voucher.id)}
        />
      )}
      renderEditor={(voucher) => <VoucherEditor voucher={voucher} />}
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
  return (
    <div>
      <p className="mb-5 break-all font-mono text-xs text-navy-blue/70">
        {voucher.id}
      </p>
      <MutationForm
        actionName={`updateVoucher.${voucher.id}`}
        buildMutation={(formData) => ({
          kind: "update-voucher",
          voucher: {
            id: voucher.id,
            ...readVoucherConfigurationForm(formData),
            credit: readVoucherCreditForm(formData),
          },
        })}
        deleteControl={
          deletable ? (
            <DeleteButton
              confirmation={`Delete the voucher “${voucher.code}”? Vouchers with claim history cannot be deleted. Disable it to preserve history. This cannot be undone.`}
              label={`Delete ${voucher.code}`}
              mutation={() => ({ kind: "delete-voucher", id: voucher.id })}
              onDeleted={
                deleteRedirect ? () => router.push(deleteRedirect) : undefined
              }
            />
          ) : undefined
        }
        requireDirty
        submitLabel="Save voucher"
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
  return (
    <div className="grid gap-7">
      <section>
        <h3 className="mb-4 font-semibold">Code</h3>
        <DiscountCodeEditor code={code} discounts={discounts} />
      </section>
      {discount && (
        <section className="border-t border-navy-blue/10 pt-6">
          <h3 className="mb-4 font-semibold">Discount</h3>
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
  readonly events: readonly AdminCalendarSale[];
}) {
  const [expandedReference, setExpandedReference] = useState<string | null>(
    null
  );
  const discountsById = useMemo(
    () => new Map(discounts.map((discount) => [discount.id, discount])),
    [discounts]
  );

  return (
    <AdministrationTableFrame className="overflow-x-auto">
      <Table aria-label="Calendar sales" className="min-w-[760px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Event</TableHead>
            <TableHead>Dates</TableHead>
            <TableHead>Calendar status</TableHead>
            <TableHead>Association</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event, index) => {
            const discount =
              event.association.kind === "associated"
                ? discountsById.get(event.association.discountId)
                : undefined;
            const rowReference =
              event.eventReference ?? `${event.start}:${event.title}:${index}`;
            const expanded = expandedReference === rowReference;
            const toggleEditor = () =>
              setExpandedReference((current) =>
                current === rowReference ? null : rowReference
              );
            return (
              <Fragment key={rowReference}>
                <TableRow
                  aria-expanded={discount ? expanded : undefined}
                  className={cn(
                    discount &&
                      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-burned-orange",
                    expanded && "bg-navy-blue/[0.025]"
                  )}
                  onClick={(clickEvent) => {
                    if (!discount || isTableRowControl(clickEvent.target)) {
                      return;
                    }
                    toggleEditor();
                  }}
                  onKeyDown={(keyboardEvent) => {
                    if (
                      !discount ||
                      keyboardEvent.target !== keyboardEvent.currentTarget ||
                      (keyboardEvent.key !== "Enter" &&
                        keyboardEvent.key !== " ")
                    ) {
                      return;
                    }
                    keyboardEvent.preventDefault();
                    toggleEditor();
                  }}
                  tabIndex={discount ? 0 : undefined}
                >
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
                    <AdministrationStatusBadge tone="neutral">
                      {event.status}
                    </AdministrationStatusBadge>
                  </TableCell>
                  <TableCell>
                    <CalendarAssociationBadge association={event.association} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button asChild size="icon" variant="ghost">
                        <a
                          aria-label={`Open ${event.title} in Google Calendar`}
                          href={event.eventUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ArrowUpRight aria-hidden className="size-4" />
                        </a>
                      </Button>
                      {discount && (
                        <Button
                          aria-expanded={expanded}
                          aria-label={`Edit discount for ${event.title}`}
                          aria-pressed={expanded}
                          onClick={toggleEditor}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Pencil aria-hidden className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {expanded && discount && (
                  <TableRow className="bg-[#fafafd] hover:bg-[#fafafd]">
                    <TableCell
                      className="border-t border-navy-blue/10 p-5"
                      colSpan={5}
                    >
                      <DiscountEditor
                        deletable={false}
                        discount={discount}
                        onDeleted={() => setExpandedReference(null)}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </AdministrationTableFrame>
  );
}

function CalendarAssociationBadge({
  association,
}: {
  readonly association: AdminCalendarSale["association"];
}) {
  if (association.kind === "associated") {
    return (
      <div>
        <AdministrationStatusBadge tone="positive">
          Associated
        </AdministrationStatusBadge>
        <p className="mt-1 max-w-48 truncate text-xs text-navy-blue/70">
          {association.discountLabel}
        </p>
      </div>
    );
  }
  if (association.kind === "missing-discount") {
    return (
      <AdministrationStatusBadge tone="attention">
        Discount not found
      </AdministrationStatusBadge>
    );
  }
  if (association.kind === "invalid-description") {
    return (
      <AdministrationStatusBadge tone="attention">
        Invalid description
      </AdministrationStatusBadge>
    );
  }
  return (
    <AdministrationStatusBadge tone="neutral">
      No discount ID
    </AdministrationStatusBadge>
  );
}

export function CreateDiscountForm({
  onCreated,
}: {
  readonly onCreated?: (message: string) => void;
} = {}) {
  return (
    <MutationForm
      actionName="createDiscount"
      buildMutation={(formData) => ({
        kind: "create-discount",
        discount: readDiscountForm(formData),
      })}
      onSuccess={onCreated}
      submitLabel="Create discount"
      submitIcon={<Plus aria-hidden className="size-4" />}
    >
      <DiscountDefinitionFields />
    </MutationForm>
  );
}

export function CreateVoucherForm({
  onCreated,
}: {
  readonly onCreated?: (message: string) => void;
} = {}) {
  return (
    <MutationForm
      actionName="createVoucher"
      buildMutation={(formData) => ({
        kind: "create-voucher",
        voucher: {
          ...readVoucherConfigurationForm(formData),
          credit: readVoucherCreditForm(formData),
        },
      })}
      onSuccess={onCreated}
      submitLabel="Create voucher"
      submitIcon={<Plus aria-hidden className="size-4" />}
    >
      <div className="grid gap-5">
        <VoucherCreditFields />
        <DiscountCodeConfigurationFields showMaxUses={false} />
      </div>
    </MutationForm>
  );
}

function AdminDataTable<T>({
  ariaLabel,
  columns,
  data,
  expandedId,
  getId,
  renderActions,
  renderEditor,
  onRowActivate,
}: {
  readonly ariaLabel: string;
  readonly columns: readonly ColumnDef<T>[];
  readonly data: readonly T[];
  readonly expandedId: string | null;
  readonly getId: (item: T) => string;
  readonly renderActions: (item: T, expanded: boolean) => ReactNode;
  readonly renderEditor: (item: T) => ReactNode;
  readonly onRowActivate?: (item: T, expanded: boolean) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const tableColumns = useMemo(() => [...columns], [columns]);
  const tableData = useMemo(() => [...data], [data]);
  // TanStack Table intentionally returns dynamic accessors; this component is
  // kept outside memoized boundaries.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns: tableColumns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (item) => getId(item),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <AdministrationTableFrame>
      <Table aria-label={ariaLabel} className="min-w-[760px]">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow className="hover:bg-transparent" key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <AdministrationSortHead
                    direction={sorted}
                    key={header.id}
                    onToggle={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </AdministrationSortHead>
                );
              })}
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => {
            const expanded = row.id === expandedId;
            return (
              <Fragment key={row.id}>
                <TableRow
                  aria-expanded={onRowActivate ? expanded : undefined}
                  className={cn(
                    onRowActivate &&
                      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-burned-orange",
                    expanded && "bg-navy-blue/[0.025]"
                  )}
                  onClick={(event) => {
                    if (!onRowActivate) return;
                    if (isTableRowControl(event.target)) return;
                    onRowActivate(row.original, expanded);
                  }}
                  onKeyDown={(event) => {
                    if (
                      !onRowActivate ||
                      event.target !== event.currentTarget ||
                      (event.key !== "Enter" && event.key !== " ")
                    ) {
                      return;
                    }
                    event.preventDefault();
                    onRowActivate(row.original, expanded);
                  }}
                  tabIndex={onRowActivate ? 0 : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    {renderActions(row.original, expanded)}
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className="bg-[#fafafd] hover:bg-[#fafafd]">
                    <TableCell
                      className="border-t border-navy-blue/10 p-5"
                      colSpan={row.getVisibleCells().length + 1}
                    >
                      {renderEditor(row.original)}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </AdministrationTableFrame>
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
      <Button
        aria-label={editLabel}
        aria-expanded={expanded}
        aria-pressed={expanded}
        onClick={onEdit}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Pencil aria-hidden className="size-4" />
      </Button>
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
  return (
    <div>
      <div className="mb-5 rounded-xl bg-navy-blue/[0.045] px-3 py-2">
        <p className="text-xs font-semibold text-navy-blue/70">Calendar ID</p>
        <code className="mt-1 block break-all text-xs">{discount.id}</code>
      </div>
      <MutationForm
        actionName={`updateDiscount.${discount.id}`}
        buildMutation={(formData) => ({
          kind: "update-discount",
          discount: {
            id: discount.id,
            ...readDiscountForm(formData),
          },
        })}
        deleteControl={
          deletable ? (
            <DeleteButton
              confirmation={`Delete the discount “${discount.labels["en-US"]}”? Referenced discounts cannot be deleted. This cannot be undone.`}
              label={`Delete ${discount.labels["en-US"]}`}
              mutation={() => ({ kind: "delete-discount", id: discount.id })}
              onDeleted={onDeleted}
            />
          ) : undefined
        }
        requireDirty
        submitLabel="Save discount"
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
  return (
    <div>
      <p className="mb-5 break-all font-mono text-xs text-navy-blue/70">
        {code.id}
      </p>
      <MutationForm
        actionName={`updateDiscountCode.${code.id}`}
        buildMutation={(formData) => ({
          kind: "update-code",
          code: {
            id: code.id,
            ...readDiscountCodeForm(formData),
          },
        })}
        requireDirty
        submitLabel="Save code"
        submitIcon={<Save aria-hidden className="size-4" />}
      >
        <DiscountCodeFields code={code} discounts={discounts} />
      </MutationForm>
    </div>
  );
}

function MutationForm({
  actionName,
  buildMutation,
  children,
  deleteControl,
  requireDirty = false,
  submitIcon,
  submitLabel,
  onSuccess,
}: {
  readonly actionName: string;
  readonly buildMutation: (formData: FormData) => DiscountAdminMutation;
  readonly children: ReactNode;
  readonly deleteControl?: ReactNode;
  readonly requireDirty?: boolean;
  readonly submitIcon: ReactNode;
  readonly submitLabel: string;
  readonly onSuccess?: (message: string) => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const initialFingerprint = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<{
    readonly kind: "error" | "success";
    readonly message: string;
  } | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName,
    onSuccess: ({ data }) => {
      if (!data) return;
      const form = formRef.current;
      if (form) {
        initialFingerprint.current = fingerprintForm(form);
      }
      setDirty(false);
      const message = data.createdDiscountId
        ? `${data.notice} Calendar ID: ${data.createdDiscountId}`
        : data.notice;
      if (onSuccess) onSuccess(message);
      else setFeedback({ kind: "success", message });
      router.refresh();
    },
    onError: ({ error }) => {
      setFeedback({
        kind: "error",
        message:
          error.serverError ??
          getDiscountAdminValidationMessage(error.validationErrors) ??
          "The change could not be saved. Check the form and try again.",
      });
    },
    onTransportError: () => {
      setFeedback({
        kind: "error",
        message: "The change could not be saved. Try again.",
      });
    },
  });

  const disabled = isExecuting || (requireDirty && !dirty);
  const handleFormChange = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    initialFingerprint.current ??= fingerprintForm(form);
    setDirty(fingerprintForm(form) !== initialFingerprint.current);
    setFeedback(null);
  };

  return (
    <form
      onChange={handleFormChange}
      onInput={handleFormChange}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        initialFingerprint.current ??= fingerprintForm(event.currentTarget);
        execute(buildMutation(new FormData(event.currentTarget)));
      }}
      ref={(form) => {
        formRef.current = form;
        if (form && initialFingerprint.current === null) {
          initialFingerprint.current = fingerprintForm(form);
        }
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
          className={
            dirty
              ? "bg-burned-orange-ink shadow-[0_7px_18px_rgba(174,69,26,0.24)] hover:bg-burned-orange-ink/90"
              : ""
          }
          disabled={disabled}
          type="submit"
        >
          {submitIcon}
          {isExecuting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
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
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName: label,
    onSuccess: ({ data }) => {
      if (!data) return;
      onDeleted?.();
      router.refresh();
    },
    onError: ({ error: actionError }) => {
      setError(
        actionError.serverError ??
          getDiscountAdminValidationMessage(actionError.validationErrors) ??
          "The item could not be deleted."
      );
    },
    onTransportError: () => {
      setError("The item could not be deleted. Try again.");
    },
  });

  return (
    <>
      <Button
        aria-label={label}
        className="border-burned-orange/25 text-burned-orange-ink hover:border-burned-orange"
        disabled={isExecuting}
        onClick={() => {
          setError(null);
          if (globalThis.confirm(confirmation)) {
            execute(mutation());
          }
        }}
        size={iconOnly ? "icon" : "default"}
        type="button"
        variant="secondary"
      >
        <Trash2 aria-hidden className="size-4" />
        {!iconOnly && (isExecuting ? "Deleting…" : "Delete")}
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
  const selectedProducts = new Set(discount?.products.map(({ kind }) => kind));
  const adjustment = discount?.adjustment;
  const [kind, setKind] = useState<"fixed" | "percentage">(
    adjustment?.kind ?? "percentage"
  );
  const existingFixedCurrency =
    adjustment?.kind === "fixed" ? adjustment.amount.currency : undefined;

  return (
    <div className="grid gap-7">
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Customer labels</legend>
        <FormField label="English (en-US)">
          <Input
            defaultValue={discount?.labels["en-US"]}
            id={fieldId("labelEn", discount?.id)}
            name="labelEn"
            required
          />
        </FormField>
        <FormField label="Czech (cs-CZ)">
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
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Type">
            <select
              className={selectClassName}
              id={fieldId("adjustmentKind", discount?.id)}
              name="adjustmentKind"
              onChange={(event) =>
                setKind(event.currentTarget.value as "fixed" | "percentage")
              }
              value={kind}
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </FormField>
          {kind === "percentage" ? (
            <FormField label="Percentage">
              <Input
                defaultValue={
                  adjustment?.kind === "percentage"
                    ? adjustment.basisPoints / 100
                    : 10
                }
                id={fieldId("percentage", discount?.id)}
                max={100}
                min={0.01}
                name="percentage"
                required
                step={0.01}
                type="number"
              />
            </FormField>
          ) : (
            <>
              <FormField label="Fixed value">
                <Input
                  defaultValue={
                    adjustment?.kind === "fixed"
                      ? adjustment.amount.value
                      : 10_000
                  }
                  id={fieldId("fixedAmountValue", discount?.id)}
                  min={1}
                  name="fixedAmountValue"
                  required
                  step={1}
                  type="number"
                />
              </FormField>
              <FormField label="Currency">
                <select
                  className={selectClassName}
                  defaultValue={
                    adjustment?.kind === "fixed"
                      ? adjustment.amount.currency
                      : defaultWorkspaceCurrency.code
                  }
                  id={fieldId("fixedAmountCurrency", discount?.id)}
                  name="fixedAmountCurrency"
                  required
                >
                  {existingFixedCurrency &&
                    !findWorkspaceCurrencyDefinition(existingFixedCurrency) && (
                      <option value={existingFixedCurrency}>
                        {existingFixedCurrency} — unsupported
                      </option>
                    )}
                  {workspaceCurrencyDefinitions.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code} — {currency.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          )}
        </div>
        {kind === "fixed" && (
          <p className="mt-3 text-xs leading-5 text-navy-blue/70">
            Fixed values use minor units: 10000 = 100.00.
          </p>
        )}
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

function DiscountCodeFields({
  code,
  discounts,
}: {
  readonly code?: DiscountCodeTableItem;
  readonly discounts: readonly DiscountTableItem[];
}) {
  return (
    <div className="grid gap-5">
      <FormField label="Discount">
        <select
          className={selectClassName}
          defaultValue={code?.discountId ?? undefined}
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
  const [codeValue, setCodeValue] = useState(code?.code ?? "");
  const codeInputId = fieldId("code", code?.id);

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={codeInputId}>Code</Label>
          <div
            className={
              code ? undefined : "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            }
          >
            <Input
              autoCapitalize="characters"
              className="font-mono uppercase"
              id={codeInputId}
              maxLength={64}
              minLength={3}
              name="code"
              onChange={(event) => setCodeValue(event.currentTarget.value)}
              required
              spellCheck={false}
              value={codeValue}
            />
            {!code && (
              <Button
                className="h-12 rounded-[1.1rem] px-5"
                onClick={() => setCodeValue(generatePromotionCode())}
                type="button"
                variant="secondary"
              >
                <RefreshCw aria-hidden className="size-4" />
                Generate code
              </Button>
            )}
          </div>
        </div>
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
      <div className="grid gap-4 md:grid-cols-4">
        <FormField label="Valid from">
          <Input
            defaultValue={toDateTimeInputValue(code?.validFrom)}
            id={fieldId("validFrom", code?.id)}
            name="validFrom"
            type="datetime-local"
          />
        </FormField>
        <FormField label="Valid until">
          <Input
            defaultValue={toDateTimeInputValue(code?.validUntil)}
            id={fieldId("validUntil", code?.id)}
            name="validUntil"
            type="datetime-local"
          />
        </FormField>
        {showMaxUses && (
          <>
            <FormField label="Maximum uses">
              <Input
                defaultValue={
                  code && "maxUses" in code ? (code.maxUses ?? "") : ""
                }
                id={fieldId("maxUses", code?.id)}
                min={1}
                name="maxUses"
                placeholder="Unlimited"
                type="number"
              />
            </FormField>
            <FormField label="Maximum uses per customer">
              <Input
                defaultValue={
                  code && "maxUsesPerCustomer" in code
                    ? (code.maxUsesPerCustomer ?? "")
                    : ""
                }
                id={fieldId("maxUsesPerCustomer", code?.id)}
                min={1}
                name="maxUsesPerCustomer"
                placeholder="Unlimited"
                type="number"
              />
            </FormField>
          </>
        )}
      </div>
      <p className="text-xs leading-5 text-navy-blue/70">
        Times use the Workspace’s Prague time zone. Both bounds are optional;
        “valid until” is exclusive.
      </p>
    </div>
  );
}

export function VoucherCreditFields({
  credit,
}: {
  readonly credit?: WorkspaceMoney | null;
}) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold">Voucher credit</legend>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Value in minor units">
          <Input
            defaultValue={credit?.value ?? 10_000}
            min={1}
            name="voucherValue"
            required
            step={1}
            type="number"
          />
        </FormField>
        <FormField label="Currency">
          <select
            className={selectClassName}
            defaultValue={credit?.currency ?? defaultWorkspaceCurrency.code}
            name="voucherCurrency"
            required
          >
            {workspaceCurrencyDefinitions.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <p className="mt-3 text-xs leading-5 text-navy-blue/70">
        Credit uses minor units: 10000 = 100.00. Existing claims remain in the
        history if the issued credit is increased later.
      </p>
    </fieldset>
  );
}

function FormField({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <Label className="grid gap-2">
      <span>{label}</span>
      {children}
    </Label>
  );
}

const fingerprintForm = (form: HTMLFormElement) =>
  JSON.stringify(
    [...new FormData(form).entries()]
      .map(([key, value]) => [key, String(value)] as const)
      .toSorted(([leftKey, leftValue], [rightKey, rightValue]) =>
        `${leftKey}:${leftValue}`.localeCompare(`${rightKey}:${rightValue}`)
      )
  );

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

const productOptions = [
  { key: "cowork", label: "Cowork" },
  { key: "meeting-room", label: "Meeting room" },
  { key: "office", label: "Private office" },
];
