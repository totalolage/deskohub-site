"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { FlaskConical, Lock, Plus, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
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
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import type { CampaignId } from "../../campaign-identifiers";
import { sendCampaignTest } from "./actions";
import { describeCampaignLocales } from "./campaign-locale-names";
import { testRecipientFieldSchema } from "./contracts";

type TestSendReceipt = {
  readonly recipients: readonly string[];
  readonly locales: readonly Locale[];
  readonly codeExpiresAt: string;
};

const emptyRecipientField = { email: "" };

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
  const [extraRecipients, setExtraRecipients] = useState<readonly string[]>([]);
  const [receipt, setReceipt] = useState<TestSendReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<
    typeof testRecipientFieldSchema.Encoded,
    unknown,
    typeof testRecipientFieldSchema.Type
  >({
    defaultValues: emptyRecipientField,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(testRecipientFieldSchema),
  });
  const { execute, isExecuting } = useWorkspaceAction(sendCampaignTest, {
    actionName: "sendCampaignTest",
    onSuccess: ({ data }) => {
      if (data) setReceipt(data);
    },
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ??
          "The test email could not be sent. Check the addresses and try again."
      ),
  });

  const addRecipient = (email: string) => {
    const normalized = email.toLowerCase();
    if (
      normalized === adminInbox?.toLowerCase() ||
      extraRecipients.includes(normalized)
    ) {
      form.setError("email", { message: "That address is already included." });
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
          Send test
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Send a test email</DialogTitle>
          <DialogDescription>
            Test emails carry the confirmation code you type to send the
            campaign. A new test send replaces the previous code.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5 space-y-4" role="status">
          {receipt && (
            <AdministrationAlert status="success">
              <p className="font-semibold">
                Sent {receipt.recipients.length * receipt.locales.length} test{" "}
                {receipt.recipients.length * receipt.locales.length === 1
                  ? "email"
                  : "emails"}{" "}
                ({describeCampaignLocales(receipt.locales)}).
              </p>
              <ul className="mt-1 list-disc pl-5">
                {receipt.recipients.map((recipient) => (
                  <li key={recipient}>{recipient}</li>
                ))}
              </ul>
              <p className="mt-2">
                The confirmation code expires{" "}
                {formatAdministrationDateTime(receipt.codeExpiresAt, locale)}.
              </p>
            </AdministrationAlert>
          )}
        </div>
        {!receipt && (
          <div className="space-y-5">
            {unsavedChanges && (
              <AdministrationAlert status="warning">
                Save your changes first. A test send uses the saved campaign, so
                its code wouldn't confirm your unsaved edits.
              </AdministrationAlert>
            )}
            {contentLocales.length === 0 ? (
              <AdministrationAlert status="warning">
                Add a subject and body in at least one language before sending a
                test.
              </AdministrationAlert>
            ) : (
              <p className="text-sm text-navy-blue/70">
                Each address gets one [TEST] email per language:{" "}
                <span className="font-semibold text-navy-blue">
                  {describeCampaignLocales(contentLocales)}
                </span>
                .
              </p>
            )}
            <div>
              <p className="mb-2 text-sm font-semibold">Recipients</p>
              <ul className="flex flex-wrap gap-2" aria-label="Test recipients">
                {adminInbox !== null && (
                  <li className="inline-flex items-center gap-1.5 rounded-full border border-navy-blue/15 bg-navy-blue/5 px-3 py-1 text-sm">
                    <Lock aria-hidden className="size-3.5 text-navy-blue/55" />
                    {adminInbox}
                    <span className="sr-only">
                      (admin inbox, always included)
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
                      aria-label={`Remove ${recipient}`}
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
                The admin inbox always receives test emails.
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
                        Add a test recipient
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
                  Add
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
              {receipt ? "Done" : "Cancel"}
            </Button>
          </DialogClose>
          {!receipt && (
            <Button
              disabled={blocked || isExecuting}
              onClick={() => {
                setError(null);
                execute({ campaignId, extraRecipients });
              }}
              type="button"
            >
              {isExecuting ? "Sending…" : "Send test"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
