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
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Pencil,
  Plus,
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
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import type {
  DiscountCodeId,
  StoredDiscountId,
} from "@/features/discounts/persistence-contracts";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { Badge } from "@/shared/components/ui/badge";
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
  temporalInstantToLocalDateTimeString,
  workspaceSiteConstants,
} from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateDiscountAdmin } from "./actions";
import type { DiscountAdminMutation } from "./contracts";
import { getDiscountAdminValidationMessage } from "./form-feedback";
import { readDiscountCodeForm, readDiscountForm } from "./form-input";

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
  readonly audienceSize: number;
  readonly reservedUses: number;
  readonly redeemedUses: number;
  readonly remainingUses: number | null;
};

export function DiscountsAdminTable({
  discounts,
}: {
  readonly discounts: readonly DiscountTableItem[];
}) {
  const [expandedId, setExpandedId] = useState<StoredDiscountId | null>(null);
  const columns = useMemo<ColumnDef<DiscountTableItem>[]>(
    () => [
      {
        accessorFn: (discount) => discount.labels["en-US"],
        id: "englishLabel",
        header: "English label",
      },
      {
        accessorFn: (discount) => discount.labels["cs-CZ"],
        id: "czechLabel",
        header: "Czech label",
      },
      {
        accessorFn: formatAdjustment,
        id: "adjustment",
        header: "Adjustment",
        cell: ({ row }) => (
          <Badge variant="subtle">{formatAdjustment(row.original)}</Badge>
        ),
      },
      {
        accessorFn: (discount) => discount.products.length,
        id: "products",
        header: "Products",
      },
      {
        accessorKey: "codeCount",
        header: "Codes",
      },
    ],
    []
  );

  return (
    <AdminDataTable
      ariaLabel="Discounts"
      columns={columns}
      data={discounts}
      expandedId={expandedId}
      getId={(discount) => discount.id}
      renderActions={(discount, expanded) => (
        <RowActions
          deleteLabel={`Delete ${discount.labels["en-US"]}`}
          editLabel={`Edit ${discount.labels["en-US"]}`}
          expanded={expanded}
          onDelete={() => ({
            kind: "delete-discount",
            id: discount.id,
          })}
          onEdit={() => setExpandedId(expanded ? null : discount.id)}
          confirmation={`Delete the discount “${discount.labels["en-US"]}”? Referenced discounts cannot be deleted. This cannot be undone.`}
        />
      )}
      renderEditor={(discount) => (
        <DiscountEditor
          discount={discount}
          onDeleted={() => setExpandedId(null)}
        />
      )}
    />
  );
}

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
        accessorFn: (code) =>
          discountLabels.get(code.discountId) ?? code.discountId,
        id: "discount",
        header: "Discount",
      },
      {
        accessorFn: (code) => (code.enabled ? "Enabled" : "Disabled"),
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? "default" : "subtle"}>
            {row.original.enabled ? "Enabled" : "Disabled"}
          </Badge>
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
        header: "Remaining",
        cell: ({ row }) => row.original.remainingUses ?? "Unlimited",
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
      renderActions={(code, expanded) => (
        <RowActions
          confirmation={`Delete the code “${code.code}”? Redeemed codes cannot be deleted. Disable it to preserve history. This cannot be undone.`}
          deleteLabel={`Delete ${code.code}`}
          editLabel={`Edit ${code.code}`}
          expanded={expanded}
          onDelete={() => ({ kind: "delete-code", id: code.id })}
          onEdit={() => setExpandedId(expanded ? null : code.id)}
        />
      )}
      renderEditor={(code) => (
        <DiscountCodeEditor
          code={code}
          discounts={discounts}
          onDeleted={() => setExpandedId(null)}
        />
      )}
    />
  );
}

export function CreateDiscountForm() {
  return (
    <MutationForm
      actionName="createDiscount"
      buildMutation={(formData) => ({
        kind: "create-discount",
        discount: readDiscountForm(formData),
      })}
      submitLabel="Create discount"
      submitIcon={<Plus aria-hidden className="size-4" />}
    >
      <DiscountDefinitionFields />
    </MutationForm>
  );
}

export function CreateDiscountCodeForm({
  discounts,
}: {
  readonly discounts: readonly DiscountTableItem[];
}) {
  return (
    <MutationForm
      actionName="createDiscountCode"
      buildMutation={(formData) => ({
        kind: "create-code",
        code: readDiscountCodeForm(formData),
      })}
      submitLabel="Create code"
      submitIcon={<Plus aria-hidden className="size-4" />}
    >
      <DiscountCodeFields discounts={discounts} />
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
}: {
  readonly ariaLabel: string;
  readonly columns: readonly ColumnDef<T>[];
  readonly data: readonly T[];
  readonly expandedId: string | null;
  readonly getId: (item: T) => string;
  readonly renderActions: (item: T, expanded: boolean) => ReactNode;
  readonly renderEditor: (item: T) => ReactNode;
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
    <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
      <Table aria-label={ariaLabel} className="min-w-[760px]">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow className="hover:bg-transparent" key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                let ariaSort: "ascending" | "descending" | "none" = "none";
                if (sorted === "asc") ariaSort = "ascending";
                else if (sorted === "desc") ariaSort = "descending";
                return (
                  <TableHead aria-sort={ariaSort} key={header.id}>
                    <button
                      className="-ml-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-left hover:bg-navy-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
                      onClick={header.column.getToggleSortingHandler()}
                      type="button"
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                      <SortIcon sorted={sorted} />
                    </button>
                  </TableHead>
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
                <TableRow className={expanded ? "bg-navy-blue/[0.025]" : ""}>
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
    </div>
  );
}

function SortIcon({ sorted }: { readonly sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") {
    return <ArrowUp aria-hidden className="size-3.5" />;
  }
  if (sorted === "desc") {
    return <ArrowDown aria-hidden className="size-3.5" />;
  }
  return <ArrowUpDown aria-hidden className="size-3.5 opacity-55" />;
}

function RowActions({
  confirmation,
  deleteLabel,
  editLabel,
  expanded,
  onDelete,
  onEdit,
}: {
  readonly confirmation: string;
  readonly deleteLabel: string;
  readonly editLabel: string;
  readonly expanded: boolean;
  readonly onDelete: () => DiscountAdminMutation;
  readonly onEdit: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      {!expanded && (
        <DeleteButton
          confirmation={confirmation}
          iconOnly
          label={deleteLabel}
          mutation={onDelete}
        />
      )}
      <Button
        aria-label={editLabel}
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
  discount,
  onDeleted,
}: {
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
          <DeleteButton
            confirmation={`Delete the discount “${discount.labels["en-US"]}”? Referenced discounts cannot be deleted. This cannot be undone.`}
            label={`Delete ${discount.labels["en-US"]}`}
            mutation={() => ({ kind: "delete-discount", id: discount.id })}
            onDeleted={onDeleted}
          />
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
  onDeleted,
}: {
  readonly code: DiscountCodeTableItem;
  readonly discounts: readonly DiscountTableItem[];
  readonly onDeleted: () => void;
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
        deleteControl={
          <DeleteButton
            confirmation={`Delete the code “${code.code}”? Redeemed codes cannot be deleted. Disable it to preserve history. This cannot be undone.`}
            label={`Delete ${code.code}`}
            mutation={() => ({ kind: "delete-code", id: code.id })}
            onDeleted={onDeleted}
          />
        }
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
}: {
  readonly actionName: string;
  readonly buildMutation: (formData: FormData) => DiscountAdminMutation;
  readonly children: ReactNode;
  readonly deleteControl?: ReactNode;
  readonly requireDirty?: boolean;
  readonly submitIcon: ReactNode;
  readonly submitLabel: string;
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
      setFeedback({ kind: "success", message: data.notice });
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
        <p
          className={
            feedback.kind === "error"
              ? "mt-5 rounded-xl bg-burned-orange/10 px-4 py-3 text-sm font-semibold text-burned-orange-ink"
              : "mt-5 rounded-xl bg-aquamarine-green/15 px-4 py-3 text-sm font-semibold text-aquamarine-ink"
          }
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
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
        <span className="sr-only" role="alert">
          {error}
        </span>
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
      <DiscountCodeConfigurationFields code={code} />
    </div>
  );
}

export function DiscountCodeConfigurationFields({
  code,
}: {
  readonly code?: DiscountCodeTableItem;
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Code">
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
        <FormField label="Maximum uses">
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
        Times use the Workspace’s Prague time zone. Both bounds are optional;
        “valid until” is exclusive.
      </p>
    </div>
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

const formatAdjustment = (discount: DiscountTableItem) =>
  discount.adjustment.kind === "percentage"
    ? `${discount.adjustment.basisPoints / 100}%`
    : `${discount.adjustment.amount.value / 10 ** discount.adjustment.amount.exponent} ${discount.adjustment.amount.currency}`;

const selectClassName =
  "min-h-12 w-full rounded-[1.1rem] border border-navy-blue/12 bg-white px-4 py-3 text-base outline-none focus-visible:border-burned-orange focus-visible:ring-4 focus-visible:ring-burned-orange/10";

const productOptions = [
  { key: "cowork", label: "Cowork" },
  { key: "meeting-room", label: "Meeting room" },
  { key: "office", label: "Private office" },
];
