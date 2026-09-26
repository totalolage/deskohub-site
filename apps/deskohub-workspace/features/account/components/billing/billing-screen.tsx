"use client";

import { Download, FileDown, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { FutureFeatureTooltip } from "@/features/account/components/future-feature-tooltip";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import type {
  SavedCardFlowFeedback,
  SavedCardsPageState,
  SavedCardView,
} from "@/features/account/contracts";
import {
  removeSavedCard,
  startSavedCardEnrollment,
} from "@/features/account/saved-card-actions";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

/*
 * THESIS: The payment-methods section is functional while the other billing
 * capabilities stay honest about being unavailable.
 * OWN-WORLD: Sculpin, navy, slate, and white surfaces extend the account shell
 * with compact controls and quiet empty states.
 * STORY: Visitors add a saved card, see their saved cards, remove a card after
 * confirming, and read one clear outcome message at a time.
 * FIRST VIEWPORT: One padded billing card places title, payment methods,
 * billing details, invoice history, and the caller-owned footer in one stack.
 * FORM: This shell never owns form markup, fields, values, or persistence; the
 * caller owns them. All card controls are type="button" so they never submit
 * the caller's profile form.
 */

export interface BillingScreenCopy {
  readonly title: string;
  readonly currency: string;
  readonly paymentMethodsTitle: string;
  readonly paymentMethodsUnavailable: string;
  readonly addPaymentCard: string;
  readonly removePaymentCard: string;
  readonly billingDetailsTitle: string;
  readonly syncAres: string;
  readonly invoiceHistoryTitle: string;
  readonly invoiceHistoryUnavailable: string;
  readonly downloadInvoice: string;
  readonly exportInvoices: string;
}

export interface BillingScreenProps {
  readonly copy: BillingScreenCopy;
  readonly cardFlow?: SavedCardFlowFeedback;
  readonly cards: SavedCardsPageState;
  readonly locale: Locale;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function BillingScreen({
  cardFlow,
  cards,
  children,
  copy,
  footer,
  locale,
}: BillingScreenProps) {
  const router = useRouter();
  const instanceId = useId();
  const titleId = `${instanceId}-billing-title`;
  const paymentMethodsTitleId = `${instanceId}-payment-methods-title`;
  const billingDetailsTitleId = `${instanceId}-billing-details-title`;
  const invoiceHistoryTitleId = `${instanceId}-invoice-history-title`;
  const invoiceHistoryUnavailableId = `${instanceId}-invoice-history-unavailable`;

  const [dismissedCardFlow, setDismissedCardFlow] =
    useState<SavedCardFlowFeedback | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<SavedCardView | null>(
    null
  );

  const { execute: executeEnrollment, isExecuting: isEnrolling } =
    useWorkspaceAction(startSavedCardEnrollment, {
      actionName: "account.saved-card.start-enrollment",
      onSuccess: ({ data }) => {
        if (data?.status === "redirect") {
          window.location.assign(data.hostedPage);
          return;
        }
        setActionNotice(m.accountSavedCardGenericError({}, { locale }));
      },
      onError: ({ error }) => {
        setActionNotice(
          error.serverError ?? m.accountSavedCardGenericError({}, { locale })
        );
      },
    });

  const { execute: executeRemoval, isExecuting: isRemoving } =
    useWorkspaceAction(removeSavedCard, {
      actionName: "account.saved-card.remove",
      onSuccess: ({ data }) => {
        setPendingRemoval(null);
        if (data?.status === "removed") {
          setActionNotice(m.accountSavedCardRemoved({}, { locale }));
          router.refresh();
          return;
        }
        if (data?.status === "retry") {
          setActionNotice(m.accountSavedCardRemovalRetry({}, { locale }));
          return;
        }
        setActionNotice(m.accountSavedCardRemovalFailed({}, { locale }));
      },
      onError: ({ error }) => {
        setPendingRemoval(null);
        setActionNotice(
          error.serverError ?? m.accountSavedCardRemovalFailed({}, { locale })
        );
      },
    });

  const flowNotice =
    cardFlow && cardFlow !== dismissedCardFlow
      ? {
          confirmed: m.accountSavedCardFlowConfirmed({}, { locale }),
          cancelled: m.accountSavedCardFlowCancelled({}, { locale }),
          failed: m.accountSavedCardFlowFailed({}, { locale }),
          pending: m.accountSavedCardFlowPending({}, { locale }),
          session: m.accountSessionExpired({}, { locale }),
        }[cardFlow]
      : null;
  const notice = actionNotice ?? flowNotice;

  const cardSentence = (card: SavedCardView) =>
    card.circuit && card.suffix
      ? m.accountSavedCardDisplayWithSuffix(
          { circuit: card.circuit, suffix: card.suffix },
          { locale }
        )
      : m.accountSavedCardDisplayWithoutSuffix({}, { locale });

  return (
    <AccountSectionPanel
      className="min-w-0"
      footer={footer}
      title={copy.title}
      titleId={titleId}
    >
      <section aria-labelledby={paymentMethodsTitleId} className="min-w-0">
        <h3
          id={paymentMethodsTitleId}
          className="break-words text-[15px] font-bold uppercase tracking-[0.075em] text-[#344258]"
        >
          {copy.paymentMethodsTitle}
        </h3>

        <div
          aria-live="polite"
          className="flex min-h-5 flex-wrap items-center gap-2 text-sm leading-6 text-[#51627c]"
          role="status"
        >
          {notice ? <p className="min-w-0 break-words">{notice}</p> : null}
          {flowNotice ? (
            <Button
              aria-label={m.accountSavedCardFeedbackDismiss({}, { locale })}
              className="size-7 shrink-0 text-[#53657f]"
              onClick={() => setDismissedCardFlow(cardFlow ?? null)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </div>

        <ul className="mt-4 min-w-0 space-y-3">
          {cards.kind === "loaded" && cards.cards.length > 0
            ? cards.cards.map((card) => (
                <li
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e0e6ee] bg-[#fbfcfd] px-4 py-3"
                  key={card.contractId}
                >
                  <p className="min-w-0 flex-1 break-words text-sm leading-6 text-[#344258]">
                    {cardSentence(card)}
                  </p>
                  <Button
                    className="h-auto max-w-full shrink-0 whitespace-normal text-left text-[#53657f]"
                    disabled={isRemoving}
                    onClick={() => setPendingRemoval(card)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <Trash2 aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 break-words">
                      {copy.removePaymentCard}
                    </span>
                  </Button>
                </li>
              ))
            : null}
          {cards.kind === "loaded" && cards.cards.length === 0 ? (
            <li className="min-w-0 rounded-2xl border border-dashed border-[#cbd7e5] bg-[#fbfcfd] px-4 py-5 text-sm leading-6 text-[#51627c]">
              {m.accountSavedCardListEmpty({}, { locale })}
            </li>
          ) : null}
          {cards.kind === "unavailable" ? (
            <li className="min-w-0 rounded-2xl border border-dashed border-[#cbd7e5] bg-[#fbfcfd] px-4 py-5 text-sm leading-6 text-[#51627c]">
              {m.accountSavedCardListUnavailable({}, { locale })}
            </li>
          ) : null}
        </ul>

        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          <Button
            className="flex h-auto min-h-[5rem] min-w-0 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#cbd7e5] bg-[#fbfcfd] px-4 py-6 text-center text-[#53657f] whitespace-normal hover:bg-[#f1f5f9]"
            disabled={isEnrolling}
            onClick={() => executeEnrollment({})}
            type="button"
            variant="ghost"
          >
            <Plus
              aria-hidden="true"
              className="size-5 shrink-0 text-[#8291a6]"
            />
            <span className="min-w-0 max-w-full break-words">
              {isEnrolling
                ? m.accountSavedCardAdding({}, { locale })
                : copy.addPaymentCard}
            </span>
          </Button>
        </div>
      </section>

      <hr className="my-7 h-px border-0 bg-[#e6ebf1]" />

      <section aria-labelledby={billingDetailsTitleId} className="min-w-0">
        <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:justify-between">
          <div className="min-w-0 flex-1">
            <h3
              id={billingDetailsTitleId}
              className="min-w-0 break-words text-lg font-semibold text-[#344258]"
            >
              {copy.billingDetailsTitle}
            </h3>
          </div>
          <FutureFeatureTooltip locale={locale}>
            <Button
              className="h-auto max-w-full shrink-0 whitespace-normal text-left text-[#53657f] disabled:pointer-events-none disabled:opacity-100 disabled:text-[#53657f]"
              disabled
              size="sm"
              type="button"
              variant="secondary"
            >
              <RefreshCw aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 break-words">{copy.syncAres}</span>
            </Button>
          </FutureFeatureTooltip>
        </div>
        <div className="mt-6 min-w-0">{children}</div>
      </section>

      <hr className="my-7 h-px border-0 bg-[#e6ebf1]" />

      <section aria-labelledby={invoiceHistoryTitleId} className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <h3
            id={invoiceHistoryTitleId}
            className="min-w-0 flex-1 break-words text-lg font-semibold text-[#344258]"
          >
            {copy.invoiceHistoryTitle}
          </h3>
          <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto">
            <FutureFeatureTooltip locale={locale}>
              <Button
                aria-describedby={invoiceHistoryUnavailableId}
                className="h-auto max-w-full whitespace-normal text-left text-[#53657f] disabled:pointer-events-none disabled:opacity-100 disabled:text-[#53657f]"
                disabled
                size="sm"
                type="button"
                variant="secondary"
              >
                <Download aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 break-words">
                  {copy.downloadInvoice}
                </span>
              </Button>
            </FutureFeatureTooltip>
            <FutureFeatureTooltip locale={locale}>
              <Button
                aria-describedby={invoiceHistoryUnavailableId}
                className="h-auto max-w-full whitespace-normal text-left text-[#53657f] disabled:pointer-events-none disabled:opacity-100 disabled:text-[#53657f]"
                disabled
                size="sm"
                type="button"
                variant="secondary"
              >
                <FileDown aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 break-words">
                  {copy.exportInvoices}
                </span>
              </Button>
            </FutureFeatureTooltip>
          </div>
        </div>
        <div className="mt-4 min-w-0 rounded-2xl border border-[#e0e6ee] bg-[#fbfcfd] px-4 py-5">
          <p
            id={invoiceHistoryUnavailableId}
            className="min-w-0 break-words text-sm leading-6 text-[#51627c]"
          >
            {copy.invoiceHistoryUnavailable}
          </p>
        </div>
      </section>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
        open={pendingRemoval !== null}
      >
        <DialogContent aria-describedby="remove-saved-card-description">
          <DialogHeader>
            <DialogTitle>
              {m.accountSavedCardRemoveConfirmTitle({}, { locale })}
            </DialogTitle>
            <DialogDescription id="remove-saved-card-description">
              {pendingRemoval
                ? m.accountSavedCardRemoveConfirmBody(
                    {
                      card: cardSentence(pendingRemoval),
                    },
                    { locale }
                  )
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setPendingRemoval(null)}
              type="button"
              variant="ghost"
            >
              {m.accountSavedCardRemoveCancelAction({}, { locale })}
            </Button>
            <Button
              className="bg-red-800 hover:bg-red-900"
              disabled={isRemoving || !pendingRemoval}
              id="remove-saved-card-confirm"
              onClick={() => {
                if (!pendingRemoval) return;
                executeRemoval({ contractId: pendingRemoval.contractId });
              }}
              type="button"
            >
              {m.accountSavedCardRemoveConfirmAction({}, { locale })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AccountSectionPanel>
  );
}
