"use client";

import { Copy, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import type { CampaignId } from "../../campaign-identifiers";
import { useCampaignOperation } from "../use-campaign-operation";
import { campaignSendingFailureCopy } from "./campaign-sending-failure";

const duplicateFailureCopy = campaignSendingFailureCopy((locale) =>
  m.emailCampaignsSentDuplicateFailed({}, { locale })
);

const retryFailureCopy = campaignSendingFailureCopy((locale) =>
  m.emailCampaignsSentRetryFailed({}, { locale })
);

type ActionFeedback = {
  readonly kind: "error" | "success";
  readonly message: string;
};

/**
 * Duplicate for any sent campaign, plus Retry undelivered once it failed.
 * The retry skips unconfirmed recipients unless the admin opts them in.
 */
export function SentCampaignActions({
  campaignId,
  retryable,
  unconfirmedCount,
}: {
  readonly campaignId: CampaignId;
  readonly retryable: boolean;
  readonly unconfirmedCount: number;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const includeUnconfirmedId = useId();
  const [includeUnconfirmed, setIncludeUnconfirmed] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const showFailure = (message: string) =>
    setFeedback({ kind: "error", message });
  const duplicate = useCampaignOperation("duplicateCampaign", {
    failureCopy: duplicateFailureCopy,
    onSuccess: (copy) =>
      router.push(
        getLocalizedPagePath(
          locale,
          "/[locale]/admin/email-campaigns/[campaignId]",
          { campaignId: copy.id }
        )
      ),
    onFailure: showFailure,
  });
  const retry = useCampaignOperation("retryCampaign", {
    failureCopy: retryFailureCopy,
    onSuccess: ({ retriedCount }) => {
      setFeedback({
        kind: "success",
        message: m.emailCampaignsSentRetryStarted(
          { count: retriedCount },
          { locale }
        ),
      });
      router.refresh();
    },
    onFailure: showFailure,
  });
  const busy = duplicate.isExecuting || retry.isExecuting;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {retryable && (
          <RetryUndeliveredButton
            busy={busy}
            locale={locale}
            onClick={() => {
              setFeedback(null);
              retry.execute({
                campaignId,
                includeUnconfirmed: unconfirmedCount > 0 && includeUnconfirmed,
              });
            }}
            retrying={retry.isExecuting}
          />
        )}
        <DuplicateCampaignButton
          busy={busy}
          duplicating={duplicate.isExecuting}
          locale={locale}
          onClick={() => {
            setFeedback(null);
            duplicate.execute({ campaignId, requestId: crypto.randomUUID() });
          }}
        />
      </div>
      {retryable && unconfirmedCount > 0 && (
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor={includeUnconfirmedId}
        >
          <Checkbox
            checked={includeUnconfirmed}
            disabled={busy}
            id={includeUnconfirmedId}
            onCheckedChange={(checked) =>
              setIncludeUnconfirmed(checked === true)
            }
          />
          {m.emailCampaignsSentIncludeUnconfirmed({}, { locale })}
        </label>
      )}
      <SentCampaignActionFeedback feedback={feedback} />
    </div>
  );
}

function RetryUndeliveredButton({
  busy,
  locale,
  onClick,
  retrying,
}: {
  readonly busy: boolean;
  readonly locale: Locale;
  readonly onClick: () => void;
  readonly retrying: boolean;
}) {
  return (
    <Button
      disabled={busy}
      onClick={onClick}
      size="sm"
      type="button"
      variant="secondary"
    >
      <RotateCw aria-hidden className="size-4" />
      {retrying
        ? m.emailCampaignsSentRetrying({}, { locale })
        : m.emailCampaignsSentRetry({}, { locale })}
    </Button>
  );
}

function DuplicateCampaignButton({
  busy,
  duplicating,
  locale,
  onClick,
}: {
  readonly busy: boolean;
  readonly duplicating: boolean;
  readonly locale: Locale;
  readonly onClick: () => void;
}) {
  return (
    <Button disabled={busy} onClick={onClick} size="sm" type="button">
      <Copy aria-hidden className="size-4" />
      {duplicating
        ? m.emailCampaignsSentDuplicating({}, { locale })
        : m.emailCampaignsSentDuplicate({}, { locale })}
    </Button>
  );
}

/** A started retry as status, a failed action as alert; both stay mounted. */
function SentCampaignActionFeedback({
  feedback,
}: {
  readonly feedback: ActionFeedback | null;
}) {
  return (
    <>
      <p className="text-sm font-semibold" role="status">
        {feedback?.kind === "success" && (
          <span className="text-aquamarine-ink">{feedback.message}</span>
        )}
      </p>
      <p className="text-sm font-semibold text-burned-orange-ink" role="alert">
        {feedback?.kind === "error" && feedback.message}
      </p>
    </>
  );
}
