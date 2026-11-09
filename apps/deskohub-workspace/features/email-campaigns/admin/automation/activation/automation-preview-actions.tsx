"use client";

import type {
  AdministrationCampaignId,
  AutomationPreviewId,
} from "@deskohub/workspace-admin-api";
import { Play, Rocket, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  type AdministrationHref,
  administrationHref,
  localizeAdministrationHref,
} from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { useCampaignOperation } from "../../use-campaign-operation";
import {
  activateFailureCopy,
  dryRunFailureCopy,
} from "./automation-failure-copy";

const previewHref = (
  campaignId: AdministrationCampaignId,
  previewId: string
): AdministrationHref =>
  `${administrationHref(
    "/[locale]/admin/email-campaigns/[campaignId]/preview",
    { campaignId }
  )}?${new URLSearchParams({ preview: previewId })}`;

/**
 * Starts a dry run of the working copy and keeps its job in the URL, so the
 * tab can still show it if it fails or the working copy changes under it.
 */
export function AutomationDryRunButton({
  campaignId,
  again,
}: {
  readonly campaignId: AdministrationCampaignId;
  readonly again: boolean;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useCampaignOperation("dryRunAutomation", {
    failureCopy: dryRunFailureCopy,
    onSuccess: ({ previewId }) => {
      setError(null);
      router.replace(
        localizeAdministrationHref(previewHref(campaignId, previewId), locale)
      );
    },
    onFailure: setError,
  });
  const Icon = again ? RotateCw : Play;
  return (
    <div className="space-y-2">
      <Button
        onClick={() => execute({ campaignId })}
        pending={isExecuting}
        size="sm"
        type="button"
        variant={again ? "secondary" : "primary"}
      >
        <Icon aria-hidden className="size-4" />
        {again
          ? m.emailAutomationActivationRunAgain({}, { locale })
          : m.emailAutomationActivationRun({}, { locale })}
      </Button>
      <p className="text-burned-orange-ink text-sm empty:hidden" role="alert">
        {error}
      </p>
    </div>
  );
}

/**
 * Activates the dry-run job `previewId`, or stays disabled without one. The
 * page passes a job only while the automation's activation is `Ready`; the
 * port still decides.
 */
export function AutomationActivateButton({
  campaignId,
  previewId,
  publishesChanges,
}: {
  readonly campaignId: AdministrationCampaignId;
  readonly previewId: AutomationPreviewId | undefined;
  readonly publishesChanges: boolean;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useCampaignOperation("activateAutomation", {
    failureCopy: activateFailureCopy,
    onSuccess: (_, input) => {
      setError(null);
      router.replace(
        localizeAdministrationHref(
          previewHref(campaignId, input.previewId),
          locale
        )
      );
    },
    onFailure: setError,
  });
  return (
    <div className="space-y-2">
      <Button
        disabled={previewId === undefined}
        onClick={() => previewId && execute({ campaignId, previewId })}
        pending={isExecuting}
        type="button"
      >
        <Rocket aria-hidden className="size-4" />
        {publishesChanges
          ? m.emailAutomationActivationPublish({}, { locale })
          : m.emailAutomationActivationActivate({}, { locale })}
      </Button>
      <p className="text-burned-orange-ink text-sm empty:hidden" role="alert">
        {error}
      </p>
    </div>
  );
}
