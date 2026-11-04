"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import type { CampaignDelivery } from "../../campaign-states";
import type { AudienceOption } from "../audiences/audience-page-data.server";
import type { CampaignOperationFailureCopy } from "../campaign-operation-failure";
import { useCampaignOperation } from "../use-campaign-operation";
import type { CampaignComposerCampaign } from "./campaign-composer";
import {
  type CampaignComposerFields,
  toAdministrationCampaignContent,
  toAdministrationCampaignContentChange,
} from "./campaign-composer-fields";
import type { CampaignComposerForm } from "./campaign-composer-form";

const campaignSaveFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) => m.emailCampaignsComposerSaveCheckFields({}, { locale }),
  codes: {
    "content-invalid": (locale) =>
      m.emailCampaignsComposerSaveContentInvalid({}, { locale }),
    "content-markdown-invalid": (locale) =>
      m.emailCampaignsComposerSaveContentInvalid({}, { locale }),
    "content-document-invalid": (locale) =>
      m.emailCampaignsComposerSaveContentInvalid({}, { locale }),
    "content-locale-missing": (locale) =>
      m.emailCampaignsComposerSaveContentInvalid({}, { locale }),
    "audience-filter-context": (locale) =>
      m.emailCampaignsComposerSaveAudienceFilterUnavailable({}, { locale }),
    "audience-not-found": (locale) =>
      m.emailCampaignsComposerSaveAudienceNotFound({}, { locale }),
    "campaign-read-only": (locale) =>
      m.emailCampaignsComposerSaveReadOnly({}, { locale }),
    "service-unavailable": (locale) =>
      m.emailCampaignsComposerSaveFailed({}, { locale }),
  },
};

/** An automated campaign's edits fail as read-only only once it's archived. */
const automatedEmailSaveFailureCopy: CampaignOperationFailureCopy = {
  ...campaignSaveFailureCopy,
  codes: {
    ...campaignSaveFailureCopy.codes,
    "campaign-read-only": (locale) =>
      m.emailAutomationsEmailSaveArchived({}, { locale }),
  },
};

/** How a refused save reads, by the campaign's delivery. */
const saveFailureCopies = {
  once: campaignSaveFailureCopy,
  automated: automatedEmailSaveFailureCopy,
} as const satisfies Record<CampaignDelivery, CampaignOperationFailureCopy>;

/**
 * Saves the composer: creates a new campaign and opens its page, or updates
 * the saved one and marks the fields it sent saved. `created` holds once a
 * new campaign exists, while its page opens.
 */
export const useCampaignComposerSave = ({
  audience,
  campaign,
  delivery,
  editable,
  form,
  initialFields,
  routeLocale,
}: {
  readonly audience: AudienceOption | undefined;
  readonly campaign: CampaignComposerCampaign | undefined;
  readonly delivery: CampaignDelivery;
  /** The locales whose content the save carries. */
  readonly editable: readonly Locale[];
  readonly form: CampaignComposerForm;
  readonly initialFields: CampaignComposerFields;
  readonly routeLocale: Locale;
}) => {
  const router = useRouter();
  const [saveError, setSaveError] = useState<string>();
  /** Set once a new campaign is created, while its page opens. */
  const [created, setCreated] = useState(false);
  /** The fields of the save in flight, which its success marks saved. */
  const [submittedFields, setSubmittedFields] =
    useState<CampaignComposerFields>(initialFields);

  const create = useCampaignOperation("createCampaign", {
    failureCopy: campaignSaveFailureCopy,
    onSuccess: ({ id }) => {
      setCreated(true);
      form.reset(form.getValues());
      router.push(
        getLocalizedPagePath(
          routeLocale,
          "/[locale]/admin/email-campaigns/[campaignId]",
          { campaignId: id }
        )
      );
    },
    onFailure: setSaveError,
  });
  const update = useCampaignOperation("updateCampaign", {
    failureCopy: saveFailureCopies[delivery],
    onSuccess: () => {
      // Edits made while the save ran stay unsaved.
      form.reset(submittedFields, { keepValues: true });
      router.refresh();
    },
    onFailure: setSaveError,
  });

  const save = form.handleSubmit((values) => {
    // A created campaign's page is opening; another submit would create a
    // second one.
    if (created) return;
    setSaveError(undefined);
    setSubmittedFields(values);
    const fields = {
      title: values.title.trim(),
      purpose: values.purpose,
      templateKey: values.templateKey,
      audienceId: audience?.id ?? null,
    };
    if (campaign) {
      update.execute({
        ...fields,
        campaignId: campaign.id,
        content: toAdministrationCampaignContentChange(values, editable),
      });
    } else {
      create.execute({
        requestId: crypto.randomUUID(),
        campaign: {
          ...fields,
          delivery,
          content: toAdministrationCampaignContent(values, editable),
        },
      });
    }
  });

  return {
    created,
    creating: create.isExecuting,
    save,
    saveError,
    saving: create.isExecuting || update.isExecuting,
  };
};
