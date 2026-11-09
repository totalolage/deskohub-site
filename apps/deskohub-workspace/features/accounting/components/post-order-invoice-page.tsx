"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { CircleCheck, FileText } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { managePostOrderInvoice } from "@/features/accounting/actions/manage-post-order-invoice";
import type { PostOrderInvoiceState } from "@/features/accounting/backend/reservation-invoice.service";
import type {
  InvoiceBuyerAddress,
  InvoiceBuyerAddressInput,
} from "@/features/accounting/billing-identity";
import { postOrderInvoiceAddressFormSchema } from "@/features/accounting/post-order-invoice";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { type Locale, m } from "@/features/i18n";
import { ReservationBillingAddressFields } from "@/features/reservation/components/reservation-billing-fields";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { Button } from "@/shared/components/ui/button";
import { Form } from "@/shared/components/ui/form";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type DisplayState = PostOrderInvoiceState | "created";

type PostOrderInvoiceOperation =
  | { readonly operation: "create"; readonly address: InvoiceBuyerAddress }
  | { readonly operation: "resend" };

export function PostOrderInvoicePage({
  accessToken,
  initialDeliveryFailed = false,
  initialState,
  locale,
  orderId,
}: {
  readonly accessToken?: ReservationAccessToken;
  readonly initialDeliveryFailed?: boolean;
  readonly initialState: DisplayState;
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
}) {
  const invoice = usePostOrderInvoiceAction({
    initialDeliveryFailed,
    initialState,
    locale,
  });

  const request = (operation: PostOrderInvoiceOperation) => {
    if (!accessToken) return;
    invoice.setNotice(null);
    invoice.execute({ locale, orderId, accessToken, ...operation });
  };

  return (
    <CheckoutFlowLayout activeStepKey="complete" locale={locale}>
      <section
        className="overflow-hidden rounded-[2.25rem] border border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm"
        data-ph-mask=""
        data-ph-no-capture=""
        data-post-order-invoice={invoice.displayState}
      >
        <div className="p-6 sm:p-10">
          <PostOrderInvoiceHeading
            deliveryFailed={invoice.deliveryFailed}
            displayState={invoice.displayState}
            locale={locale}
          />

          {invoice.displayState === "create" && (
            <PostOrderInvoiceAddressForm
              isExecuting={invoice.isExecuting}
              locale={locale}
              onSubmit={(address) => request({ operation: "create", address })}
            />
          )}

          {invoice.canResend && (
            <Button
              className="mt-8 sm:w-auto"
              fullWidth
              size="lg"
              disabled={invoice.isExecuting}
              onClick={() => request({ operation: "resend" })}
              type="button"
            >
              {invoice.isExecuting
                ? m.postOrderInvoiceResendingButton({}, { locale })
                : m.postOrderInvoiceResendButton({}, { locale })}
            </Button>
          )}

          {invoice.notice && (
            <output
              aria-live="polite"
              className="mt-5 block rounded-xl bg-navy-blue/5 px-4 py-3 text-sm text-navy-blue/75"
            >
              {invoice.notice}
            </output>
          )}
        </div>
      </section>
    </CheckoutFlowLayout>
  );
}

// Tracks what the page shows as invoice requests settle: the created or
// issued invoice, whether its delivery failed, and any notice to announce.
function usePostOrderInvoiceAction({
  initialDeliveryFailed,
  initialState,
  locale,
}: {
  readonly initialDeliveryFailed: boolean;
  readonly initialState: DisplayState;
  readonly locale: Locale;
}) {
  const [displayState, setDisplayState] = useState<DisplayState>(initialState);
  const [deliveryFailed, setDeliveryFailed] = useState(initialDeliveryFailed);
  const [notice, setNotice] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(managePostOrderInvoice, {
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.status === "resent") {
        setDeliveryFailed(false);
        setNotice(m.postOrderInvoiceResentLead({}, { locale }));
        return;
      }
      if (data.status === "created") {
        setDeliveryFailed(!data.delivered);
        setDisplayState("created");
        return;
      }
      if (data.status === "already-issued") {
        setDisplayState("issued");
      }
    },
    onError: ({ error }) =>
      setNotice(
        error.serverError || m.postOrderInvoiceActionError({}, { locale })
      ),
    onTransportError: () =>
      setNotice(m.postOrderInvoiceActionError({}, { locale })),
  });

  return {
    canResend:
      displayState === "issued" ||
      (displayState === "created" && deliveryFailed),
    deliveryFailed,
    displayState,
    execute,
    isExecuting,
    notice,
    setNotice,
  };
}

function PostOrderInvoiceHeading({
  deliveryFailed,
  displayState,
  locale,
}: {
  readonly deliveryFailed: boolean;
  readonly displayState: DisplayState;
  readonly locale: Locale;
}) {
  return (
    <div className="flex items-start gap-4 sm:items-center sm:gap-6">
      <div className="mt-1 flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-aquamarine-green/14 text-aquamarine-ink ring-8 ring-aquamarine-green/8 sm:mt-0 sm:h-16 sm:w-16">
        {displayState === "created" ? (
          <CircleCheck aria-hidden="true" className="h-8 w-8 sm:h-9 sm:w-9" />
        ) : (
          <FileText aria-hidden="true" className="h-8 w-8 sm:h-9 sm:w-9" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="text-balance text-[1.75rem] leading-none sm:text-5xl">
          {
            {
              create: m.postOrderInvoiceTitle({}, { locale }),
              created: m.postOrderInvoiceCreatedTitle({}, { locale }),
              issued: m.postOrderInvoiceIssuedTitle({}, { locale }),
              unavailable: m.postOrderInvoiceUnavailableTitle({}, { locale }),
            }[displayState]
          }
        </h1>
        <p className="mt-5 text-lg leading-8 text-navy-blue/70">
          {
            {
              create: m.postOrderInvoiceCreateLead({}, { locale }),
              created: deliveryFailed
                ? m.postOrderInvoiceCreatedDeliveryFailedLead({}, { locale })
                : m.postOrderInvoiceCreatedLead({}, { locale }),
              issued: m.postOrderInvoiceIssuedLead({}, { locale }),
              unavailable: m.postOrderInvoiceUnavailableLead({}, { locale }),
            }[displayState]
          }
        </p>
      </div>
    </div>
  );
}

function PostOrderInvoiceAddressForm({
  isExecuting,
  locale,
  onSubmit,
}: {
  readonly isExecuting: boolean;
  readonly locale: Locale;
  readonly onSubmit: (address: InvoiceBuyerAddress) => void;
}) {
  const form = useForm<
    { address: InvoiceBuyerAddressInput },
    unknown,
    { address: InvoiceBuyerAddress }
  >({
    defaultValues: {
      address: { line1: "", city: "", postalCode: "", country: "CZ" },
    },
    mode: "onBlur",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(postOrderInvoiceAddressFormSchema),
  });

  return (
    <Form {...form}>
      <form
        className="mt-8 space-y-6"
        noValidate
        onSubmit={form.handleSubmit(({ address }) => onSubmit(address))}
      >
        <ReservationBillingAddressFields address="address" locale={locale} />
        <Button
          className="sm:w-auto"
          fullWidth
          size="lg"
          disabled={isExecuting}
          type="submit"
        >
          {isExecuting
            ? m.postOrderInvoiceCreatingButton({}, { locale })
            : m.postOrderInvoiceCreateButton({}, { locale })}
        </Button>
      </form>
    </Form>
  );
}
