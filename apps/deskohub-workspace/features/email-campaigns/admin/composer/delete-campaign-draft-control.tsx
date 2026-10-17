"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import { ConfirmDialog } from "@/features/administration/confirm-dialog";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import type { CampaignId } from "../../campaign-identifiers";
import { deleteCampaign } from "./actions";

export function DeleteCampaignDraftControl({
  campaignId,
}: {
  readonly campaignId: CampaignId;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(deleteCampaign, {
    actionName: "email-campaigns.admin.delete",
    onSuccess: ({ data }) => {
      if (!data) return;
      router.push(localizeAdministrationHref("/admin/email-campaigns", locale));
    },
    onError: ({ error }) =>
      setError(
        error.serverError ?? m.emailCampaignsDraftDeleteFailed({}, { locale })
      ),
    onTransportError: () =>
      setError(m.emailCampaignsDraftDeleteFailed({}, { locale })),
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
