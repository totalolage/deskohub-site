"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { CircleCheck, FileText } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { managePostOrderInvoice } from "@/features/accounting/actions/manage-post-order-invoice";
import type { PostOrderInvoiceState } from "@/features/accounting/backend/reservation-invoice";
import type {
  InvoiceBuyerAddress,
  InvoiceBuyerAddressInput,
} from "@/features/accounting/billing-identity";
import { postOrderInvoiceAddressFormSchema } from "@/features/accounting/post-order-invoice";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { type Locale, m } from "@/features/i18n";
import { ReservationBillingAddressFields } from "@/features/reservation/components/reservation-billing-fields";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { Button } from "@/shared/components/ui/button";
import { Form } from "@/shared/components/ui/form";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type DisplayState = PostOrderInvoiceState | "created";

export function PostOrderInvoicePage({
  accessToken,
  initialDeliveryFailed = false,
  initialState,
  locale,
  orderId,
}: {
  readonly accessToken?: string;
  readonly initialDeliveryFailed?: boolean;
  readonly initialState: DisplayState;
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
}) {
  const [displayState, setDisplayState] = useState<DisplayState>(initialState);
  const [deliveryFailed, setDeliveryFailed] = useState(initialDeliveryFailed);
  const [notice, setNotice] = useState<string | null>(null);
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
    resolver: standardSchemaResolver(postOrderInvoiceAddressFormSchema),
  });
  const { execute, isExecuting } = useWorkspaceAction(managePostOrderInvoice, {
    actionName: "managePostOrderInvoice",
    onSuccess: ({ data }) => {
      if (data?.status === "resent") {
        setNotice(m.postOrderInvoiceResentLead({}, { locale }));
        return;
      }
      if (data?.status === "created") {
        setDeliveryFailed(!data.delivered);
        setDisplayState("created");
        return;
      }
      if (data?.status === "already-issued") {
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
  const token = accessToken ?? "";
  const title = {
    create: m.postOrderInvoiceTitle({}, { locale }),
    created: m.postOrderInvoiceCreatedTitle({}, { locale }),
    issued: m.postOrderInvoiceIssuedTitle({}, { locale }),
    unavailable: m.postOrderInvoiceUnavailableTitle({}, { locale }),
  }[displayState];

  const resend = () => {
    setNotice(null);
    execute({ locale, orderId, accessToken: token, operation: "resend" });
  };

  return (
    <CheckoutFlowLayout activeStepKey="access" locale={locale}>
      <section
        className="overflow-hidden rounded-[2.25rem] border border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm"
        data-ph-mask=""
        data-ph-no-capture=""
        data-post-order-invoice={displayState}
      >
        <div className="p-6 sm:p-10">
          <div className="flex items-start gap-4 sm:items-center sm:gap-6">
            <div className="mt-1 flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-aquamarine-green/14 text-aquamarine-ink ring-8 ring-aquamarine-green/8 sm:mt-0 sm:h-16 sm:w-16">
              {displayState === "created" ? (
                <CircleCheck
                  aria-hidden="true"
                  className="h-8 w-8 sm:h-9 sm:w-9"
                />
              ) : (
                <FileText
                  aria-hidden="true"
                  className="h-8 w-8 sm:h-9 sm:w-9"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-balance text-[1.75rem] leading-none sm:text-5xl">
                {title}
              </h1>
              <p className="mt-5 text-lg leading-8 text-navy-blue/70">
                {
                  {
                    create: m.postOrderInvoiceCreateLead({}, { locale }),
                    created: deliveryFailed
                      ? m.postOrderInvoiceCreatedDeliveryFailedLead(
                          {},
                          { locale }
                        )
                      : m.postOrderInvoiceCreatedLead({}, { locale }),
                    issued: m.postOrderInvoiceIssuedLead({}, { locale }),
                    unavailable: m.postOrderInvoiceUnavailableLead(
                      {},
                      { locale }
                    ),
                  }[displayState]
                }
              </p>
            </div>
          </div>

          {displayState === "create" && (
            <Form {...form}>
              <form
                className="mt-8 space-y-6"
                noValidate
                onSubmit={form.handleSubmit(({ address }) => {
                  setNotice(null);
                  execute({
                    locale,
                    orderId,
                    accessToken: token,
                    operation: "create",
                    address,
                  });
                })}
              >
                <ReservationBillingAddressFields
                  address="address"
                  locale={locale}
                />
                <Button
                  className="h-12 w-full rounded-full sm:w-auto"
                  disabled={isExecuting}
                  type="submit"
                >
                  {isExecuting
                    ? m.postOrderInvoiceCreatingButton({}, { locale })
                    : m.postOrderInvoiceCreateButton({}, { locale })}
                </Button>
              </form>
            </Form>
          )}

          {(displayState === "issued" ||
            (displayState === "created" && deliveryFailed)) && (
            <Button
              className="mt-8 h-12 w-full rounded-full sm:w-auto"
              disabled={isExecuting}
              onClick={resend}
              type="button"
            >
              {isExecuting
                ? m.postOrderInvoiceResendingButton({}, { locale })
                : m.postOrderInvoiceResendButton({}, { locale })}
            </Button>
          )}

          {notice && (
            <output
              aria-live="polite"
              className="mt-5 block rounded-xl bg-navy-blue/5 px-4 py-3 text-sm text-navy-blue/75"
            >
              {notice}
            </output>
          )}
        </div>
      </section>
    </CheckoutFlowLayout>
  );
}
