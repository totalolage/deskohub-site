"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { get, useForm, useWatch } from "react-hook-form";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { ConfirmDialog } from "@/features/administration/confirm-dialog";
import { AdministrationAlert } from "@/features/administration/notice";
import { useRouteLocale } from "@/features/i18n/use-route-locale";
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
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { audienceSingleLocale } from "../../audience-filter";
import type { CampaignAudienceId } from "../../campaign-identifiers";
import {
  type DiscountGroupOption,
  describeAudienceFilter,
} from "../audience-filter-summary";
import {
  archiveAudience,
  deleteAudience,
  saveAudience,
  unarchiveAudience,
} from "./actions";
import {
  type AudienceFormValues,
  audienceFormSchema,
} from "./audience-contracts";
import { AudienceFilterBuilder } from "./audience-filter-builder";
import { asRootGroup } from "./audience-filter-editing";
import { AudienceStatusBadge, audienceHref } from "./audience-list";
import type { AudienceEditorData } from "./audience-page-data.server";

const audienceListHref = "/admin/email-audiences";

const localeNames = { "cs-CZ": "Czech", "en-US": "English" } as const;

type Feedback = {
  readonly kind: "success" | "error";
  readonly message: string;
};

export function AudienceEditorPage({
  audience,
  discountGroups,
}: {
  /** Omitted when creating a new audience. */
  readonly audience?: AudienceEditorData;
  readonly discountGroups?: readonly DiscountGroupOption[];
}) {
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        eyebrow="Email audience"
        title={audience?.title ?? "New audience"}
        description="Choose who a campaign reaches. Conditions are checked when a campaign is sent, so draft campaigns always follow the latest version."
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
          This audience is archived. New campaigns can&rsquo;t select it.
        </AdministrationAlert>
      ) : null}
      <AudienceForm audience={audience} discountGroups={discountGroups} />
    </AdministrationPage>
  );
}

function AudienceForm({
  audience,
  discountGroups,
}: {
  readonly audience: AudienceEditorData | undefined;
  readonly discountGroups: readonly DiscountGroupOption[] | undefined;
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
    resolver: effectSchemaResolver(audienceFormSchema),
  });
  const filter = useWatch({ control: form.control, name: "filter" });
  const singleLocale = audienceSingleLocale(filter);

  const { execute, isExecuting } = useWorkspaceAction(saveAudience, {
    actionName: "email-campaigns.admin.save-audience",
    onSuccess: ({ data, input }) => {
      if (!data) return;
      if (!audience) {
        router.push(
          localizeAdministrationHref(audienceHref(data.audienceId), locale)
        );
        return;
      }
      form.reset({ title: input.title, filter: input.filter });
      setFeedback({ kind: "success", message: "Audience saved." });
      router.refresh();
    },
    onError: ({ error }) => {
      setFeedback({
        kind: "error",
        message:
          error.serverError ??
          "The audience could not be saved. Check the form and try again.",
      });
    },
    onTransportError: () => {
      setFeedback({
        kind: "error",
        message: "The audience could not be saved. Try again.",
      });
    },
  });

  const submitLabel = audience ? "Save audience" : "Create audience";
  const errorAt = (path: string): string | undefined =>
    get(form.formState.errors, path)?.message;

  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-6"
        onSubmit={form.handleSubmit((values) => {
          setFeedback(null);
          execute(
            audience ? { audienceId: audience.id, ...values } : { ...values }
          );
        })}
      >
        <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="e.g. Czech customers who visited this year"
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
            <h2 className="font-semibold text-lg">Who it reaches</h2>
            <p className="mt-1 text-navy-blue/62 text-sm">
              Only customers Workspace already knows from reservations,
              accounts, or marketing consent can match. Marketing campaigns also
              skip anyone without active consent.
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
                lookups={{ discountGroups }}
              />
            )}
          />
          <div className="rounded-lg bg-navy-blue/[0.04] px-4 py-3">
            <p className="font-semibold text-[0.7rem] text-navy-blue/55 uppercase tracking-[0.12em]">
              In plain English
            </p>
            <p className="mt-1 text-sm leading-6">
              {describeAudienceFilter(filter, { discountGroups })}.
            </p>
            {singleLocale ? (
              <p className="mt-1 text-navy-blue/62 text-sm">
                Every recipient speaks {localeNames[singleLocale]}, so campaigns
                for this audience need {localeNames[singleLocale]} content only.
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
            <Link href={audienceListHref}>Cancel</Link>
          </Button>
          <Button
            type="submit"
            disabled={
              isExecuting || (audience !== undefined && !form.formState.isDirty)
            }
          >
            {isExecuting ? "Saving…" : submitLabel}
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
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(archiveAudience, {
    actionName: "email-campaigns.admin.archive-audience",
    onSuccess: ({ data }) => {
      if (!data) return;
      setOpen(false);
      router.refresh();
    },
    onError: ({ error }) =>
      setError(error.serverError ?? "The audience could not be archived."),
    onTransportError: () =>
      setError("The audience could not be archived. Try again."),
  });

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
          Archive
        </Button>
      }
      title="Archive this audience?"
      description="New campaigns can no longer select it. Draft campaigns that already use it keep it, and sent campaigns are not affected."
      confirmLabel={isExecuting ? "Archiving…" : "Archive audience"}
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
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(unarchiveAudience, {
    actionName: "email-campaigns.admin.unarchive-audience",
    onSuccess: ({ data }) => {
      if (!data) return;
      router.refresh();
    },
    onError: ({ error }) =>
      setError(error.serverError ?? "The audience could not be unarchived."),
    onTransportError: () =>
      setError("The audience could not be unarchived. Try again."),
  });

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
        {isExecuting ? "Unarchiving…" : "Unarchive"}
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
  const { execute, isExecuting } = useWorkspaceAction(deleteAudience, {
    actionName: "email-campaigns.admin.delete-audience",
    onSuccess: ({ data }) => {
      if (!data) return;
      router.push(localizeAdministrationHref(audienceListHref, locale));
    },
    onError: ({ error }) =>
      setError(error.serverError ?? "The audience could not be deleted."),
    onTransportError: () =>
      setError("The audience could not be deleted. Try again."),
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
          Delete
        </Button>
      }
      title="Delete this audience?"
      description="This can't be undone. Sent campaigns keep their own copy of the filters. An audience that draft campaigns use can only be archived."
      confirmLabel={isExecuting ? "Deleting…" : "Delete audience"}
      pending={isExecuting}
      error={error}
      onConfirm={() => execute({ audienceId })}
    />
  );
}
