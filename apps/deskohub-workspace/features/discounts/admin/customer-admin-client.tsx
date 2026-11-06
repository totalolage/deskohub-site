"use client";

import {
  DotyposCustomerIdSchema,
  type DotyposDiscountGroupId,
  DotyposDiscountGroupIdSchema,
} from "@deskohub/dotypos/types";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { Minus, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { type DefaultValues, type FieldValues, useForm } from "react-hook-form";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  type AdministrationHref,
  administrationHref,
  localizeAdministrationHref,
} from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { AdministrationAlert } from "@/features/administration/notice";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type {
  DiscountCodeId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateDiscountAdmin, searchDiscountAdminCustomers } from "./actions";
import type { DiscountAdminMutation } from "./contracts";
import { formatDiscountAdminCustomerContact } from "./customer-contact";
import { formatDiscountAdminCustomerName } from "./customer-display-name";
import {
  type CustomerPromotionCode,
  type CustomerPromotionCodeMutations,
  type CustomerPromotionDialogMode,
  type CustomerPromotionEligibilityCopy,
  customerPromotionCodeMutations,
  customerPromotionDialogConfirmation,
  customerPromotionDialogMode,
  customerPromotionDialogText,
  customerPromotionEligibilityCopy,
} from "./customer-promotion-dialog";
import type {
  AdminCustomerSearchResult,
  AdminDiscountGroup,
} from "./discount-administration.service";
import {
  createCustomerCodeAudienceFormSchema,
  customerDiscountGroupFormSchema,
} from "./form-schemas";

const selectClassName =
  "flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20";

const decodeDotyposDiscountGroupId = Schema.decodeUnknownSync(
  DotyposDiscountGroupIdSchema
);
const decodeDotyposCustomerId = Schema.decodeUnknownSync(
  DotyposCustomerIdSchema
);

const createSearchFormSchema = (locale: Locale) =>
  Schema.Struct({
    query: Schema.String.check(
      Schema.makeFilter((value) => value.trim().length >= 2, {
        message: m.discountsValidationSearchQueryLength({}, { locale }),
      })
    ),
  });

const formatDiscountGroupPercentage = (basisPoints: number, locale: Locale) =>
  formatDiscountAdjustment({ kind: "percentage", basisPoints }, locale);

type AdminCustomerSearchMatch = AdminCustomerSearchResult["customers"][number];

/**
 * Searches Dotypos customers by name or email. Each match opens its customer
 * page unless `renderCustomerAction` offers another action for it.
 */
export function CustomerSearch({
  renderCustomerAction,
  variant = "card",
}: {
  readonly renderCustomerAction?: (
    customer: AdminCustomerSearchMatch
  ) => ReactNode;
  readonly variant?: "card" | "toolbar" | "inline";
}) {
  const locale = useRouteLocale();
  const [result, setResult] = useState<AdminCustomerSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ query: string }>({
    defaultValues: { query: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(createSearchFormSchema(locale)),
  });
  const { execute, isExecuting } = useWorkspaceAction(
    searchDiscountAdminCustomers,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        setError(null);
        setResult(data);
      },
      onError: ({ error: actionError }) => {
        setResult(null);
        setError(
          actionError.serverError ??
            m.discountsCustomerSearchFailed({}, { locale })
        );
      },
      onTransportError: () => {
        setResult(null);
        setError(m.discountsCustomerSearchFailed({}, { locale }));
      },
    }
  );

  return (
    <div
      className={
        {
          card: "space-y-4",
          toolbar: "space-y-4",
          inline: "@container space-y-4",
        }[variant]
      }
    >
      <Form {...form}>
        <form
          className={
            {
              card: "grid gap-3 rounded-xl border border-navy-blue/10 bg-white p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
              toolbar:
                "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
              inline:
                "grid gap-3 @md:grid-cols-[minmax(0,1fr)_auto] @md:items-end",
            }[variant]
          }
          noValidate
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            setResult(null);
            const query = values.query.trim();
            if (!query) return;
            execute({ query });
          })}
        >
          <FormField
            control={form.control}
            name="query"
            render={({ field, fieldState }) => (
              <FormItem className="grid gap-1.5">
                <FormLabel>
                  {m.discountsCustomerSearchLabel({}, { locale })}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    minLength={2}
                    placeholder={m.discountsCustomerSearchPlaceholder(
                      {},
                      { locale }
                    )}
                    required
                    type="search"
                    variant={fieldState.error ? "error" : "default"}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button disabled={isExecuting} type="submit">
            <Search aria-hidden className="size-4" />
            {isExecuting
              ? m.discountsCustomerSearching({}, { locale })
              : m.discountsCustomerSearchSubmit({}, { locale })}
          </Button>
        </form>
      </Form>

      {error && (
        <AdministrationAlert
          className="font-semibold"
          role="alert"
          status="error"
        >
          {error}
        </AdministrationAlert>
      )}
      {result && (
        <div
          aria-live="polite"
          className="rounded-xl border border-navy-blue/10 bg-white"
        >
          {result.customers.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-navy-blue/65">
              {m.discountsCustomerSearchEmpty({}, { locale })}
            </p>
          ) : (
            <>
              {result.kind === "ambiguous" && (
                <p className="border-b border-navy-blue/10 px-5 py-3 text-sm text-navy-blue/70">
                  {m.discountsCustomerSearchAmbiguous({}, { locale })}
                </p>
              )}
              <ul className="divide-y divide-navy-blue/10">
                {result.customers.map((customer) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                    key={customer.id}
                  >
                    <div>
                      <p className="font-semibold">
                        {formatDiscountAdminCustomerName(customer, locale)}
                      </p>
                      <p className="mt-1 text-sm text-navy-blue/65">
                        {formatDiscountAdminCustomerContact(customer, locale)}
                      </p>
                    </div>
                    {renderCustomerAction ? (
                      renderCustomerAction(customer)
                    ) : (
                      <Button asChild size="sm" variant="secondary">
                        <Link
                          href={administrationHref(
                            "/[locale]/admin/customers/[customerId]",
                            { customerId: customer.id }
                          )}
                        >
                          {m.discountsOpenCustomer({}, { locale })}
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AddCodeCustomerForm({
  codeId,
}: {
  readonly codeId: DiscountCodeId;
}) {
  const locale = useRouteLocale();
  return (
    <AdminMutationForm
      buildMutation={(values) => ({
        kind: "add-code-customer",
        codeId,
        customerId: decodeDotyposCustomerId(values.customerId.trim()),
      })}
      defaultValues={{ customerId: "" }}
      schema={createCustomerCodeAudienceFormSchema(locale)}
      submitLabel={m.discountsAddCustomer({}, { locale })}
    >
      {({ control }) => (
        <FormField
          control={control}
          name="customerId"
          render={({ field, fieldState }) => (
            <FormItem className="grid gap-1.5">
              <FormLabel htmlFor={`audience-customer-${codeId}`}>
                {m.discountsDotyposCustomerIdLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  id={`audience-customer-${codeId}`}
                  required
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </AdminMutationForm>
  );
}

export function AddVoucherCustomerForm({
  voucherId,
}: {
  readonly voucherId: VoucherId;
}) {
  const locale = useRouteLocale();
  return (
    <AdminMutationForm
      buildMutation={(values) => ({
        kind: "add-voucher-customer",
        voucherId,
        customerId: decodeDotyposCustomerId(values.customerId.trim()),
      })}
      defaultValues={{ customerId: "" }}
      schema={createCustomerCodeAudienceFormSchema(locale)}
      submitLabel={m.discountsAddCustomer({}, { locale })}
    >
      {({ control }) => (
        <FormField
          control={control}
          name="customerId"
          render={({ field, fieldState }) => (
            <FormItem className="grid gap-1.5">
              <FormLabel htmlFor={`voucher-audience-customer-${voucherId}`}>
                {m.discountsDotyposCustomerIdLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  id={`voucher-audience-customer-${voucherId}`}
                  required
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </AdminMutationForm>
  );
}

export function CustomerDiscountGroupForm({
  customerId,
  currentGroupId,
  discountGroups,
}: {
  readonly customerId: DotyposCustomerId;
  readonly currentGroupId: DotyposDiscountGroupId | null;
  readonly discountGroups: readonly AdminDiscountGroup[];
}) {
  const locale = useRouteLocale();
  const currentIsAvailable =
    currentGroupId === null ||
    discountGroups.some(({ id }) => id === currentGroupId);

  return (
    <AdminMutationForm
      buildMutation={(values) => ({
        kind: "set-customer-discount-group",
        customerId,
        discountGroupId:
          values.discountGroupId === ""
            ? null
            : decodeDotyposDiscountGroupId(values.discountGroupId),
      })}
      defaultValues={{ discountGroupId: currentGroupId ?? "" }}
      resetOnSuccessTo="submitted"
      schema={customerDiscountGroupFormSchema}
      submitLabel={m.discountsSaveGroup({}, { locale })}
    >
      {({ register }) => (
        <div className="grid gap-1.5">
          <Label htmlFor={`discount-group-${customerId}`}>
            {m.discountsCustomerDiscountGroupTitle({}, { locale })}
          </Label>
          <select
            className={selectClassName}
            id={`discount-group-${customerId}`}
            {...register("discountGroupId")}
          >
            <option value="">
              {m.discountsDiscountGroupNone({}, { locale })}
            </option>
            {!currentIsAvailable && currentGroupId && (
              <option value={currentGroupId}>
                {m.discountsDiscountGroupUnavailable(
                  { groupId: currentGroupId },
                  { locale }
                )}
              </option>
            )}
            {discountGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {`${group.name} (${formatDiscountGroupPercentage(group.basisPoints, locale)})`}
              </option>
            ))}
          </select>
        </div>
      )}
    </AdminMutationForm>
  );
}

export function AdminMutationButton({
  children,
  confirmation,
  mutation,
  variant = "secondary",
}: {
  readonly children: ReactNode;
  readonly confirmation?: string;
  readonly mutation: DiscountAdminMutation;
  readonly variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    onSuccess: () => router.refresh(),
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ?? m.discountsSaveFailed({}, { locale })
      ),
    onTransportError: () =>
      setError(m.discountsSaveFailedRetry({}, { locale })),
  });

  return (
    <>
      <Button
        disabled={isExecuting}
        onClick={() => {
          setError(null);
          if (!confirmation || globalThis.confirm(confirmation)) {
            execute(mutation);
          }
        }}
        size="sm"
        type="button"
        variant={variant}
      >
        {isExecuting ? m.discountsSaving({}, { locale }) : children}
      </Button>
      {error && (
        <AdministrationAlert className="mt-3" role="alert" status="error">
          {error}
        </AdministrationAlert>
      )}
    </>
  );
}

/**
 * Adds a customer to a code or voucher, or removes them, after a dialog that
 * explains how the change moves the promotion's audience.
 */
export function CustomerPromotionCodeAction({
  audienceSize,
  code,
  customerId,
  customerName,
  deleteRedirect,
  eligible,
  labeled = false,
  promotion,
}: {
  readonly audienceSize: number;
  readonly code: string;
  readonly customerId: DotyposCustomerId;
  readonly customerName: string;
  /** Where to go after the dialog deletes the promotion whose page is open. */
  readonly deleteRedirect?: AdministrationHref;
  readonly eligible: boolean;
  /** Shows the action's verb beside its icon instead of the icon alone. */
  readonly labeled?: boolean;
  readonly promotion: CustomerPromotionCode;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutations = customerPromotionCodeMutations(promotion, customerId);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    onSuccess: ({ input }) => {
      setOpen(false);
      if (deleteRedirect && input.kind === mutations.delete.kind) {
        router.push(localizeAdministrationHref(deleteRedirect, locale));
        return;
      }
      router.refresh();
    },
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ?? m.discountsSaveFailed({}, { locale })
      ),
    onTransportError: () =>
      setError(m.discountsSaveFailedRetry({}, { locale })),
  });

  const copy = customerPromotionEligibilityCopy(promotion.kind);
  const names = { code, customerName };
  const label = (eligible ? copy.removeLabel : copy.addLabel)(names, {
    locale,
  });
  const Icon = eligible ? Minus : Plus;
  const mode = customerPromotionDialogMode(eligible, audienceSize);
  const dialogText = customerPromotionDialogText(mode, {
    audienceSize,
    copy,
    locale,
    names,
  });

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setError(null);
        setOpen(nextOpen);
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button
          aria-label={label}
          className="relative z-10"
          size={labeled ? "sm" : "icon-sm"}
          title={label}
          variant={labeled ? "secondary" : "ghost"}
        >
          <Icon aria-hidden className="size-4" />
          {labeled &&
            (eligible
              ? m.discountsRemove({}, { locale })
              : m.discountsAdd({}, { locale }))}
        </Button>
      </DialogTrigger>
      <DialogContent locale={locale}>
        <DialogHeader>
          <DialogTitle>{dialogText.title}</DialogTitle>
          <DialogDescription>{dialogText.description}</DialogDescription>
        </DialogHeader>
        {error && (
          <p
            className="mt-4 text-sm font-semibold text-burned-orange-ink"
            role="alert"
          >
            {error}
          </p>
        )}
        <DialogFooter>
          <CustomerPromotionDialogActions
            copy={copy}
            execute={execute}
            isExecuting={isExecuting}
            locale={locale}
            mode={mode}
            mutations={mutations}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomerPromotionDialogActions({
  copy,
  execute,
  isExecuting,
  locale,
  mode,
  mutations,
}: {
  readonly copy: CustomerPromotionEligibilityCopy;
  readonly execute: (mutation: DiscountAdminMutation) => void;
  readonly isExecuting: boolean;
  readonly locale: Locale;
  readonly mode: CustomerPromotionDialogMode;
  readonly mutations: CustomerPromotionCodeMutations;
}) {
  if (mode === "remove-only-customer") {
    return (
      <>
        <Button
          disabled={isExecuting}
          onClick={() => execute(mutations.delete)}
          type="button"
          variant="secondary"
        >
          {copy.deleteLabel({}, { locale })}
        </Button>
        <Button
          disabled={isExecuting}
          onClick={() => execute(mutations.makeUnrestricted)}
          tone="burned-orange-ink"
          type="button"
        >
          {m.discountsMakeAvailableToAll({}, { locale })}
        </Button>
      </>
    );
  }
  const confirmation = customerPromotionDialogConfirmation[mode];
  return (
    <>
      <DialogClose asChild>
        <Button type="button" variant="secondary">
          {confirmation.cancelLabel({}, { locale })}
        </Button>
      </DialogClose>
      <Button
        disabled={isExecuting}
        onClick={() => execute(mutations[confirmation.mutation])}
        tone="burned-orange-ink"
        type="button"
      >
        {confirmation.confirmLabel({}, { locale })}
      </Button>
    </>
  );
}

function AdminMutationForm<Input extends FieldValues, Values = Input>({
  buildMutation,
  children,
  defaultValues,
  resetOnSuccessTo = "initial",
  schema,
  submitLabel,
}: {
  readonly buildMutation: (values: Values) => DiscountAdminMutation;
  readonly children: (api: {
    readonly control: ReturnType<
      typeof useForm<Input, unknown, Values>
    >["control"];
    readonly register: ReturnType<
      typeof useForm<Input, unknown, Values>
    >["register"];
  }) => ReactNode;
  readonly defaultValues: DefaultValues<Input>;
  /**
   * Edit forms rebase onto the submitted values so a follow-up edit submits
   * the saved state plus the new change; audience-add forms clear.
   */
  readonly resetOnSuccessTo?: "initial" | "submitted";
  readonly schema: Schema.Codec<Values, Input>;
  readonly submitLabel: string;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [feedback, setFeedback] = useState<{
    readonly kind: "error" | "success";
    readonly message: string;
  } | null>(null);
  const form = useForm<Input, unknown, Values>({
    defaultValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(schema),
  });
  // Snapshot taken at submit entry so the success reset cannot absorb values
  // edited while the request is in flight.
  const [submittedValues, setSubmittedValues] = useState<Input | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setFeedback({ kind: "success", message: data.notice });
      // Rebase the defaults onto the submitted snapshot while retaining every
      // current value, so dirty state recomputes against the snapshot and an
      // in-flight edit that reverted a field to its original value survives.
      if (resetOnSuccessTo === "submitted") {
        form.reset(submittedValues ?? undefined, { keepValues: true });
      } else {
        form.reset();
      }
      router.refresh();
    },
    onError: ({ error }) =>
      setFeedback({
        kind: "error",
        message: error.serverError ?? m.discountsSaveFailed({}, { locale }),
      }),
    onTransportError: () =>
      setFeedback({
        kind: "error",
        message: m.discountsSaveFailedRetry({}, { locale }),
      }),
  });

  return (
    <Form {...form}>
      <form
        className="grid gap-3"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          setFeedback(null);
          setSubmittedValues(form.getValues());
          execute(buildMutation(values));
        })}
      >
        {children({ control: form.control, register: form.register })}
        {feedback && (
          <p
            className={
              feedback.kind === "error"
                ? "text-sm font-semibold text-burned-orange-ink"
                : "text-sm font-semibold text-aquamarine-ink"
            }
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </p>
        )}
        <Button
          className="justify-self-start"
          disabled={isExecuting}
          type="submit"
        >
          {isExecuting ? m.discountsSaving({}, { locale }) : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
