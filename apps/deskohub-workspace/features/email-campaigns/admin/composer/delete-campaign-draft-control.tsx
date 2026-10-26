"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/features/administration/confirm-dialog";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import { Button } from "@/shared/components/ui/button";
import type { CampaignId } from "../../campaign-identifiers";
import type { CampaignOperationFailureCopy } from "../campaign-operation-failure";
import { useCampaignOperation } from "../use-campaign-operation";

const draftDeleteFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) => m.emailCampaignsDraftDeleteFailed({}, { locale }),
  codes: {
    "campaign-read-only": (locale) =>
      m.emailCampaignsDraftDeleteReadOnly({}, { locale }),
  },
};

export function DeleteCampaignDraftControl({
  campaignId,
}: {
  readonly campaignId: CampaignId;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useCampaignOperation("deleteCampaign", {
    failureCopy: draftDeleteFailureCopy,
    onSuccess: () =>
      router.push(
        getLocalizedPagePath(locale, "/[locale]/admin/email-campaigns")
      ),
    onFailure: setError,
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
      trigger={
        <Button type="button" variant="ghost" size="sm">
          <Trash2 className="h-4 w-4" aria-hidden />
          {m.emailCampaignsDraftDelete({}, { locale })}
        </Button>
      }
      title={m.emailCampaignsDraftDeleteTitle({}, { locale })}
      description={m.emailCampaignsDraftDeleteDescription({}, { locale })}
      confirmLabel={
        isExecuting
          ? m.emailCampaignsDraftDeleting({}, { locale })
          : m.emailCampaignsDraftDelete({}, { locale })
      }
      pending={isExecuting}
      error={error}
      onConfirm={() => execute({ campaignId })}
    />
  );
}
