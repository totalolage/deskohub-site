"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { get, useForm, useWatch } from "react-hook-form";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  administrationHref,
  localizeAdministrationHref,
} from "@/features/administration/administration-href";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { ConfirmDialog } from "@/features/administration/confirm-dialog";
import { m } from "@/features/administration/i18n";
import { AdministrationAlert } from "@/features/administration/notice";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { audienceSingleLocale } from "../../audience-filter";
import type { CampaignAudienceId } from "../../campaign-identifiers";
import {
  type AudienceValueLookups,
  describeAudienceFilter,
} from "../audience-filter-summary";
import { useCampaignOperation } from "../use-campaign-operation";
import {
  type AudienceFormValues,
  createAudienceFormSchema,
} from "./audience-contracts";
import {
  audienceArchiveFailureCopy,
  audienceDeleteFailureCopy,
  audienceSaveFailureCopy,
  audienceUnarchiveFailureCopy,
} from "./audience-failure-copy";
import { AudienceFilterBuilder } from "./audience-filter-builder";
import { asRootGroup } from "./audience-filter-editing";
import { AudienceStatusBadge, audienceHref } from "./audience-list";
import type { AudienceEditorData } from "./audience-page-data.server";

const audienceListHref = administrationHref("/[locale]/admin/email-audiences");

/** Which content an audience of one locale's speakers needs. */
const singleLocaleNotes = {
  "cs-CZ": m.emailCampaignsAudienceEditorSingleLocaleCzech,
  "en-US": m.emailCampaignsAudienceEditorSingleLocaleEnglish,
} as const;

type Feedback = {
  readonly kind: "success" | "error";
  readonly message: string;
};

export function AudienceEditorPage({
  audience,
  lookups = {},
}: {
  /** Omitted when creating a new audience. */
  readonly audience?: AudienceEditorData;
  readonly lookups?: AudienceValueLookups;
}) {
  const locale = useRouteLocale();
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        eyebrow={m.emailCampaignsAudienceEditorEyebrow({}, { locale })}
        title={
          audience?.title ??
          m.emailCampaignsAudienceEditorNewTitle({}, { locale })
        }
        description={m.emailCampaignsAudienceEditorDescription({}, { locale })}
        actions={
          audience ? (
            <div className="flex flex-wrap items-center gap-2">
              <AudienceStatusBadge archived={audience.archived} />
              {audience.archived ? (
                <UnarchiveAudienceControl audienceId={audience.id} />
              ) : (
                <ArchiveAudienceControl audienceId={audience.id} />
              )}
              <DeleteAudienceControl audienceId={audience.id} />
            </div>
          ) : null
        }
      />
      {audience?.archived ? (
        <AdministrationAlert status="warning" className="mb-5">
          {m.emailCampaignsAudienceEditorArchivedNotice({}, { locale })}
        </AdministrationAlert>
      ) : null}
      <AudienceForm audience={audience} lookups={lookups} />
    </AdministrationPage>
  );
}

function AudienceForm({
  audience,
  lookups,
}: {
  readonly audience: AudienceEditorData | undefined;
  readonly lookups: AudienceValueLookups;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const form = useForm({
    defaultValues: {
      title: audience?.title ?? "",
      filter: asRootGroup(
        audience?.filter ?? { _tag: "Group", operator: "and", filters: [] }
      ),
    } satisfies AudienceFormValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(createAudienceFormSchema(locale)),
  });
  const filter = useWatch({ control: form.control, name: "filter" });
  const singleLocale = audienceSingleLocale(filter);

  const showSaveFailure = (message: string) =>
    setFeedback({ kind: "error", message });
  const create = useCampaignOperation("createCampaignAudience", {
    failureCopy: audienceSaveFailureCopy,
    onSuccess: (created) =>
      router.push(localizeAdministrationHref(audienceHref(created.id), locale)),
    onFailure: showSaveFailure,
  });
  const update = useCampaignOperation("updateCampaignAudience", {
    failureCopy: audienceSaveFailureCopy,
    onSuccess: (_updated, { title, filter }) => {
      form.reset({ title, filter });
      setFeedback({
        kind: "success",
        message: m.emailCampaignsAudienceEditorSaved({}, { locale }),
      });
      router.refresh();
    },
    onFailure: showSaveFailure,
  });
  const isExecuting = create.isExecuting || update.isExecuting;

  const submitLabel = audience
    ? m.emailCampaignsAudienceEditorSave({}, { locale })
    : m.emailCampaignsAudienceEditorCreate({}, { locale });
  const errorAt = (path: string): string | undefined =>
    get(form.formState.errors, path)?.message;

  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-6"
        onSubmit={form.handleSubmit((values) => {
          setFeedback(null);
          if (audience) update.execute({ audienceId: audience.id, ...values });
          else {
            create.execute({
              requestId: crypto.randomUUID(),
              audience: values,
            });
          }
        })}
      >
        <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {m.emailCampaignsAudienceEditorTitleLabel({}, { locale })}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={m.emailCampaignsAudienceEditorTitlePlaceholder(
                      {},
                      { locale }
                    )}
                    className="max-w-xl"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4 rounded-xl border border-navy-blue/10 bg-white p-5">
          <div>
            <h2 className="font-semibold text-lg">
              {m.emailCampaignsAudienceEditorReachHeading({}, { locale })}
            </h2>
            <p className="mt-1 text-navy-blue/62 text-sm">
              {m.emailCampaignsAudienceEditorReachDescription({}, { locale })}
            </p>
          </div>
          <FormField
            control={form.control}
            name="filter"
            render={({ field }) => (
              <AudienceFilterBuilder
                value={asRootGroup(field.value)}
                onChange={field.onChange}
                path="filter"
                errorAt={errorAt}
                lookups={lookups}
              />
            )}
          />
          <div className="rounded-lg bg-navy-blue/[0.04] px-4 py-3">
            <p className="font-semibold text-[0.7rem] text-navy-blue/55 uppercase tracking-[0.12em]">
              {m.emailCampaignsAudienceEditorSummaryHeading({}, { locale })}
            </p>
            <p className="mt-1 text-sm leading-6">
              {m.emailCampaignsAudienceEditorSummary(
                {
                  summary: describeAudienceFilter(filter, locale, lookups),
                },
                { locale }
              )}
            </p>
            {singleLocale ? (
              <p className="mt-1 text-navy-blue/62 text-sm">
                {singleLocaleNotes[singleLocale]({}, { locale })}
              </p>
            ) : null}
          </div>
        </section>

        {feedback ? (
          <AdministrationAlert
            className="font-semibold"
            role={feedback.kind === "error" ? "alert" : "status"}
            status={feedback.kind}
          >
            {feedback.message}
          </AdministrationAlert>
        ) : null}

        <div className="flex items-center justify-end gap-3 border-navy-blue/10 border-t pt-5">
          <Button asChild variant="ghost">
            <Link href={audienceListHref}>
              {m.emailCampaignsAudienceEditorCancel({}, { locale })}
            </Link>
          </Button>
          <Button
            type="submit"
            disabled={
              isExecuting || (audience !== undefined && !form.formState.isDirty)
            }
          >
            {isExecuting
              ? m.emailCampaignsAudienceEditorSaving({}, { locale })
              : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function ArchiveAudienceControl({
  audienceId,
}: {
  readonly audienceId: CampaignAudienceId;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useCampaignOperation(
    "archiveCampaignAudience",
    {
      failureCopy: audienceArchiveFailureCopy,
      onSuccess: () => {
        setOpen(false);
        router.refresh();
      },
      onFailure: setError,
    }
  );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
      trigger={
        <Button type="button" variant="secondary" size="sm">
          <Archive className="h-4 w-4" aria-hidden />
          {m.emailCampaignsAudienceArchive({}, { locale })}
        </Button>
      }
      title={m.emailCampaignsAudienceArchiveTitle({}, { locale })}
      description={m.emailCampaignsAudienceArchiveDescription({}, { locale })}
      confirmLabel={
        isExecuting
          ? m.emailCampaignsAudienceArchiving({}, { locale })
          : m.emailCampaignsAudienceArchiveConfirm({}, { locale })
      }
      pending={isExecuting}
      error={error}
      onConfirm={() => execute({ audienceId })}
    />
  );
}

function UnarchiveAudienceControl({
  audienceId,
}: {
  readonly audienceId: CampaignAudienceId;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useCampaignOperation(
    "unarchiveCampaignAudience",
    {
      failureCopy: audienceUnarchiveFailureCopy,
      onSuccess: () => router.refresh(),
      onFailure: setError,
    }
  );

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={isExecuting}
        onClick={() => {
          setError(null);
          execute({ audienceId });
        }}
      >
        <ArchiveRestore className="h-4 w-4" aria-hidden />
        {isExecuting
          ? m.emailCampaignsAudienceUnarchiving({}, { locale })
          : m.emailCampaignsAudienceUnarchive({}, { locale })}
      </Button>
      <span
        role="alert"
        className="basis-full text-burned-orange-ink text-sm empty:hidden"
      >
        {error}
      </span>
    </>
  );
}

function DeleteAudienceControl({
  audienceId,
}: {
  readonly audienceId: CampaignAudienceId;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useCampaignOperation(
    "deleteCampaignAudience",
    {
      failureCopy: audienceDeleteFailureCopy,
      onSuccess: () =>
        router.push(localizeAdministrationHref(audienceListHref, locale)),
      onFailure: setError,
    }
  );

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
          {m.emailCampaignsAudienceDelete({}, { locale })}
        </Button>
      }
      title={m.emailCampaignsAudienceDeleteTitle({}, { locale })}
      description={m.emailCampaignsAudienceDeleteDescription({}, { locale })}
      confirmLabel={
        isExecuting
          ? m.emailCampaignsAudienceDeleting({}, { locale })
          : m.emailCampaignsAudienceDeleteConfirm({}, { locale })
      }
      pending={isExecuting}
      error={error}
      onConfirm={() => execute({ audienceId })}
    />
  );
}
