"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import Interpolate from "@doist/react-interpolate";
import { FlaskConical, Lock, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import { AdministrationAlert } from "@/features/administration/notice";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import type { CampaignId } from "../../campaign-identifiers";
import { useCampaignOperation } from "../use-campaign-operation";
import { describeCampaignLocales } from "./campaign-locale-names";
import { campaignSendingFailureCopy } from "./campaign-sending-failure";
import {
  createTestRecipientFieldSchema,
  type TestRecipientFieldSchema,
} from "./contracts";

type TestSendReceipt = {
  readonly recipients: readonly string[];
  readonly locales: readonly Locale[];
  /** When the confirmation code expires, in the admin's locale. */
  readonly codeExpiry: string;
};

const emptyRecipientField = { email: "" };

const testSendFailureCopy = campaignSendingFailureCopy((locale) =>
  m.emailCampaignsTestSendFailed({}, { locale })
);

export function CampaignTestSendDialog({
  adminInbox,
  campaignId,
  contentLocales,
  unsavedChanges,
}: {
  /** Null where campaign email isn't configured; a test send reports it. */
  readonly adminInbox: string | null;
  readonly campaignId: CampaignId;
  readonly contentLocales: readonly Locale[];
  readonly unsavedChanges: boolean;
}) {
  const locale = useRouteLocale();
  const recipientFieldSchema = useMemo(
    () => createTestRecipientFieldSchema(locale),
    [locale]
  );
  const [extraRecipients, setExtraRecipients] = useState<readonly string[]>([]);
  const [receipt, setReceipt] = useState<TestSendReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<
    TestRecipientFieldSchema["Encoded"],
    unknown,
    TestRecipientFieldSchema["Type"]
  >({
    defaultValues: emptyRecipientField,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(recipientFieldSchema),
  });
  const { execute, isExecuting } = useCampaignOperation("testSendCampaign", {
    failureCopy: testSendFailureCopy,
    onSuccess: ({ recipients, locales, codeExpiresAt }) =>
      setReceipt({
        recipients,
        locales,
        codeExpiry: formatAdministrationDateTime(codeExpiresAt, locale),
      }),
    onFailure: setError,
  });

  const addRecipient = (email: string) => {
    const normalized = email.toLowerCase();
    if (
      normalized === adminInbox?.toLowerCase() ||
      extraRecipients.includes(normalized)
    ) {
      form.setError("email", {
        message: m.emailCampaignsTestSendRecipientDuplicate({}, { locale }),
      });
      return;
    }
    setExtraRecipients([...extraRecipients, normalized]);
    form.reset(emptyRecipientField);
  };

  const blocked = unsavedChanges || contentLocales.length === 0;

  return (
    <Dialog
      onOpenChange={() => {
        setReceipt(null);
        setError(null);
        form.reset(emptyRecipientField);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="secondary">
          <FlaskConical aria-hidden className="size-4" />
          {m.emailCampaignsTestSendSubmit({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl" locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {m.emailCampaignsTestSendTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.emailCampaignsTestSendDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5 space-y-4" role="status">
          {receipt && (
            <AdministrationAlert status="success">
              <p className="font-semibold">
                {m.emailCampaignsTestSendSent(
                  {
                    count: receipt.recipients.length * receipt.locales.length,
                    languages: describeCampaignLocales(receipt.locales, locale),
                  },
                  { locale }
                )}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {receipt.recipients.map((recipient) => (
                  <li key={recipient}>{recipient}</li>
                ))}
              </ul>
              <p className="mt-2">
                {m.emailCampaignsTestSendCodeExpires(
                  { expiresAt: receipt.codeExpiry },
                  { locale }
                )}
              </p>
            </AdministrationAlert>
          )}
        </div>
        {!receipt && (
          <div className="space-y-5">
            {unsavedChanges && (
              <AdministrationAlert status="warning">
                {m.emailCampaignsTestSendUnsavedChanges({}, { locale })}
              </AdministrationAlert>
            )}
            {contentLocales.length === 0 ? (
              <AdministrationAlert status="warning">
                {m.emailCampaignsTestSendContentMissing({}, { locale })}
              </AdministrationAlert>
            ) : (
              <p className="text-sm text-navy-blue/70">
                <Interpolate
                  mapping={{
                    languages: (
                      <span className="font-semibold text-navy-blue">
                        {describeCampaignLocales(contentLocales, locale)}
                      </span>
                    ),
                  }}
                  string={m.emailCampaignsTestSendPerLanguage(
                    { languages: "{languages}" },
                    { locale }
                  )}
                />
              </p>
            )}
            <div>
              <p className="mb-2 text-sm font-semibold">
                {m.emailCampaignsTestSendRecipients({}, { locale })}
              </p>
              <ul
                className="flex flex-wrap gap-2"
                aria-label={m.emailCampaignsTestSendRecipientsLabel(
                  {},
                  { locale }
                )}
              >
                {adminInbox !== null && (
                  <li className="inline-flex items-center gap-1.5 rounded-full border border-navy-blue/15 bg-navy-blue/5 px-3 py-1 text-sm">
                    <Lock aria-hidden className="size-3.5 text-navy-blue/55" />
                    {adminInbox}
                    <span className="sr-only">
                      {m.emailCampaignsTestSendAdminInboxNote({}, { locale })}
                    </span>
                  </li>
                )}
                {extraRecipients.map((recipient) => (
                  <li
                    className="inline-flex items-center gap-1 rounded-full border border-navy-blue/15 bg-white py-1 pl-3 pr-1 text-sm"
                    key={recipient}
                  >
                    {recipient}
                    <Button
                      aria-label={m.emailCampaignsTestSendRemoveRecipient(
                        { email: recipient },
                        { locale }
                      )}
                      disabled={isExecuting}
                      onClick={() =>
                        setExtraRecipients(
                          extraRecipients.filter((item) => item !== recipient)
                        )
                      }
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <X aria-hidden className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-navy-blue/60">
                {m.emailCampaignsTestSendAdminInboxAlways({}, { locale })}
              </p>
            </div>
            <Form {...form}>
              <form
                className="flex items-start gap-2"
                noValidate
                onSubmit={(event) => {
                  void form.handleSubmit(({ email }) => addRecipient(email))(
                    event
                  );
                }}
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field: { onChange, ...field }, fieldState }) => (
                    <FormItem className="min-w-0 flex-1">
                      <FormLabel className="sr-only">
                        {m.emailCampaignsTestSendAddRecipientLabel(
                          {},
                          { locale }
                        )}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoComplete="off"
                          disabled={isExecuting}
                          onInput={onChange}
                          placeholder="name@deskohub.test"
                          type="email"
                          variant={fieldState.error ? "error" : "default"}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  disabled={isExecuting}
                  type="submit"
                  variant="secondary"
                >
                  <Plus aria-hidden className="size-4" />
                  {m.emailCampaignsTestSendAdd({}, { locale })}
                </Button>
              </form>
            </Form>
          </div>
        )}
        <div role="alert">
          {error && !receipt && (
            <p className="mt-4 rounded-xl bg-burned-orange/10 px-4 py-3 text-sm font-semibold text-burned-orange-ink">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={isExecuting} type="button" variant="secondary">
              {receipt
                ? m.emailCampaignsTestSendDone({}, { locale })
                : m.emailCampaignsTestSendCancel({}, { locale })}
            </Button>
          </DialogClose>
          {!receipt && (
            <Button
              disabled={blocked || isExecuting}
              onClick={() => {
                setError(null);
                execute({ campaignId, recipients: extraRecipients });
              }}
              type="button"
            >
              {isExecuting
                ? m.emailCampaignsTestSendSubmitting({}, { locale })
                : m.emailCampaignsTestSendSubmit({}, { locale })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
