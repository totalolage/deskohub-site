"use client";

import type { AutomationDetail } from "@deskohub/workspace-admin-api";
import { Archive, Eye, Pause, Play, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdministrationLink } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import { ConfirmDialog } from "@/features/administration/confirm-dialog";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { useCampaignOperation } from "../../use-campaign-operation";
import {
  archiveFailureCopy,
  pauseFailureCopy,
  resumeFailureCopy,
} from "./automation-failure-copy";

/**
 * Pause, resume and archive for an automated campaign's header, plus the
 * way to the preview tab while there is something to activate. A draft can
 * be archived too, so an abandoned one can be retired.
 */
export function AutomationLifecycleActions({
  automation,
}: {
  readonly automation: AutomationDetail;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const succeeded = () => {
    setError(null);
    router.refresh();
  };
  const pause = useCampaignOperation("pauseAutomation", {
    failureCopy: pauseFailureCopy,
    onSuccess: succeeded,
    onFailure: setError,
  });
  const resume = useCampaignOperation("resumeAutomation", {
    failureCopy: resumeFailureCopy,
    onSuccess: succeeded,
    onFailure: setError,
  });
  const archive = useCampaignOperation("archiveAutomation", {
    failureCopy: archiveFailureCopy,
    onSuccess: () => {
      setArchiveOpen(false);
      succeeded();
    },
    onFailure: setArchiveError,
  });
  const { campaignId, status } = automation;
  if (status === "archived") return null;
  const previewHref = administrationHref(
    "/[locale]/admin/email-campaigns/[campaignId]/preview",
    { campaignId }
  );
  const pending =
    pause.isExecuting || resume.isExecuting || archive.isExecuting;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <TooltipProvider>
        <div className="flex flex-wrap items-center gap-2">
          {status === "draft" && (
            <Button asChild size="sm">
              <AdministrationLink href={previewHref}>
                <Rocket aria-hidden className="size-4" />
                {m.emailAutomationActivationPreviewAndActivate({}, { locale })}
              </AdministrationLink>
            </Button>
          )}
          {status !== "draft" && automation.pendingChanges && (
            <Button asChild size="sm" variant="secondary">
              <AdministrationLink href={previewHref}>
                <Eye aria-hidden className="size-4" />
                {m.emailAutomationActivationPreviewChanges({}, { locale })}
              </AdministrationLink>
            </Button>
          )}
          {status === "active" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  disabled={pending}
                  onClick={() => pause.execute({ campaignId })}
                  pending={pause.isExecuting}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Pause aria-hidden className="size-4" />
                  {m.emailAutomationActivationPause({}, { locale })}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {m.emailAutomationActivationPauseHint({}, { locale })}
              </TooltipContent>
            </Tooltip>
          )}
          {status === "paused" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  disabled={pending}
                  onClick={() => resume.execute({ campaignId })}
                  pending={resume.isExecuting}
                  size="sm"
                  type="button"
                >
                  <Play aria-hidden className="size-4" />
                  {m.emailAutomationActivationResume({}, { locale })}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {m.emailAutomationActivationResumeHint({}, { locale })}
              </TooltipContent>
            </Tooltip>
          )}
          <ConfirmDialog
            confirmLabel={m.emailAutomationActivationArchiveConfirm(
              {},
              { locale }
            )}
            description={m.emailAutomationActivationArchiveDescription(
              {},
              { locale }
            )}
            error={archiveError}
            onConfirm={() => archive.execute({ campaignId })}
            onOpenChange={(open) => {
              setArchiveOpen(open);
              setArchiveError(null);
            }}
            open={archiveOpen}
            pending={archive.isExecuting}
            title={m.emailAutomationActivationArchiveTitle({}, { locale })}
            trigger={
              <Button
                disabled={pending}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Archive aria-hidden className="size-4" />
                {m.emailAutomationActivationArchive({}, { locale })}
              </Button>
            }
          />
        </div>
      </TooltipProvider>
      <p className="text-burned-orange-ink text-sm empty:hidden" role="alert">
        {error}
      </p>
    </div>
  );
}
