"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import { ConfirmDialog } from "@/features/administration/confirm-dialog";
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
      setError(error.serverError ?? "The campaign could not be deleted."),
    onTransportError: () =>
      setError("The campaign could not be deleted. Try again."),
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
          Delete draft
        </Button>
      }
      title="Delete this draft?"
      description="This can't be undone. The draft, its content, and any unsaved changes are removed. Sent campaigns can't be deleted."
      confirmLabel={isExecuting ? "Deleting…" : "Delete draft"}
      pending={isExecuting}
      error={error}
      onConfirm={() => execute({ campaignId })}
    />
  );
}
