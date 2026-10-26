"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Match, Option, Schema } from "effect";
import { useForm } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { campaignButtonLabelIssue } from "../../body/campaign-body-rules";
import { normalizeCampaignLinkHref } from "./campaign-link-href";

export type CtaButtonValues = {
  readonly label: string;
  readonly href: string;
};

/** The button form; `locale` is the admin's language for its messages. */
const createCtaButtonFields = (locale: Locale) =>
  Schema.Struct({
    label: Schema.String.check(
      Schema.makeFilter((label) =>
        // Checks the label as the button keeps it: trimmed.
        Option.match(campaignButtonLabelIssue(label.trim(), ["label"]), {
          onNone: () => true,
          onSome: (issue) =>
            Match.valueTags(issue, {
              ButtonLabelMissing: () =>
                m.emailCampaignsCtaLabelRequired({}, { locale }),
              ButtonLabelLineBreaks: () =>
                m.emailCampaignsBodyButtonLabelLineBreaks({}, { locale }),
            }),
        })
      )
    ),
    href: Schema.String.check(
      Schema.makeFilter(
        (href) =>
          normalizeCampaignLinkHref(href) !== undefined ||
          m.emailCampaignsLinkHrefHint({}, { locale })
      )
    ),
  });

type CtaButtonSchema = ReturnType<typeof createCtaButtonFields>;

/** Inserts or edits a call-to-action button: its text and where it links. */
export function CtaButtonDialog({
  initialValues,
  onOpenChange,
  onRemove,
  onSubmit,
  open,
}: {
  /** Set when editing an existing button. */
  readonly initialValues?: CtaButtonValues;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRemove?: () => void;
  readonly onSubmit: (values: CtaButtonValues) => void;
  readonly open: boolean;
}) {
  const locale = useRouteLocale();

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {initialValues
              ? m.emailCampaignsCtaEdit({}, { locale })
              : m.emailCampaignsCtaInsert({}, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.emailCampaignsCtaDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CtaButtonForm
            initialValues={initialValues}
            locale={locale}
            onCancel={() => onOpenChange(false)}
            onRemove={onRemove}
            onSubmit={(values) => {
              onSubmit(values);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CtaButtonForm({
  initialValues,
  locale,
  onCancel,
  onRemove,
  onSubmit,
}: {
  readonly initialValues: CtaButtonValues | undefined;
  readonly locale: Locale;
  readonly onCancel: () => void;
  readonly onRemove: (() => void) | undefined;
  readonly onSubmit: (values: CtaButtonValues) => void;
}) {
  const form = useForm<
    CtaButtonSchema["Encoded"],
    unknown,
    CtaButtonSchema["Type"]
  >({
    resolver: effectSchemaResolver(createCtaButtonFields(locale)),
    defaultValues: initialValues ?? { label: "", href: "" },
  });

  return (
    <Form {...form}>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          // The dialog portals out of the composer form, but React still
          // bubbles submit events through the component tree.
          event.stopPropagation();
          return form.handleSubmit(({ label, href }) =>
            onSubmit({
              label: label.trim(),
              href: normalizeCampaignLinkHref(href) ?? href,
            })
          )(event);
        }}
      >
        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {m.emailCampaignsCtaLabelLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={m.emailCampaignsCtaLabelPlaceholder(
                    {},
                    { locale }
                  )}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="href"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {m.emailCampaignsCtaHrefLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  inputMode="url"
                  placeholder="https://workspace.deskohub.cz"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          {onRemove && (
            <Button
              className="sm:mr-auto"
              onClick={onRemove}
              size="sm"
              type="button"
              variant="ghost"
            >
              {m.emailCampaignsCtaRemove({}, { locale })}
            </Button>
          )}
          <Button
            onClick={onCancel}
            size="sm"
            type="button"
            variant="secondary"
          >
            {m.emailCampaignsCtaCancel({}, { locale })}
          </Button>
          <Button size="sm" type="submit">
            {initialValues
              ? m.emailCampaignsCtaUpdate({}, { locale })
              : m.emailCampaignsCtaInsert({}, { locale })}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
