"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { AdministrationAlert } from "@/features/administration/notice";
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
import { sendCampaign } from "./actions";
import {
  type ConfirmationCodeFieldSchema,
  createConfirmationCodeFieldSchema,
} from "./contracts";

const emptyCodeField = { code: "" };

export function CampaignConfirmSendDialog({
  campaignId,
  unsavedChanges,
}: {
  readonly campaignId: CampaignId;
  readonly unsavedChanges: boolean;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const codeFieldSchema = useMemo(
    () => createConfirmationCodeFieldSchema(locale),
    [locale]
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<
    ConfirmationCodeFieldSchema["Encoded"],
    unknown,
    ConfirmationCodeFieldSchema["Type"]
  >({
    defaultValues: emptyCodeField,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(codeFieldSchema),
  });
  const { execute, isExecuting } = useWorkspaceAction(sendCampaign, {
    actionName: "sendCampaign",
    onSuccess: ({ data }) => {
      if (!data) return;
      setOpen(false);
      router.refresh();
    },
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ??
          m.emailCampaignsSendConfirmFailed({}, { locale })
      ),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setError(null);
        form.reset(emptyCodeField);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" type="button">
          <Send aria-hidden className="size-4" />
          {m.emailCampaignsSendConfirmSubmit({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg" locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {m.emailCampaignsSendConfirmTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.emailCampaignsSendConfirmDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        {unsavedChanges && (
          <AdministrationAlert className="mt-5" status="warning">
            {m.emailCampaignsSendConfirmUnsavedChanges({}, { locale })}
          </AdministrationAlert>
        )}
        <Form {...form}>
          <form
            className="mt-5"
            noValidate
            onSubmit={(event) => {
              void form.handleSubmit(({ code }) => {
                setError(null);
                execute({ campaignId, confirmationCode: code });
              })(event);
            }}
          >
            <FormField
              control={form.control}
              name="code"
              render={({ field: { onChange, ...field }, fieldState }) => (
                <FormItem>
                  <FormLabel>
                    {m.emailCampaignsSendConfirmCodeLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoCapitalize="characters"
                      autoComplete="one-time-code"
                      className="font-mono uppercase tracking-[0.2em]"
                      disabled={unsavedChanges || isExecuting}
                      maxLength={12}
                      onInput={onChange}
                      placeholder="ABCD-EFGH"
                      spellCheck={false}
                      variant={fieldState.error ? "error" : "default"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div role="alert">
              {error && (
                <p className="mt-3 rounded-xl bg-burned-orange/10 px-4 py-3 text-sm font-semibold text-burned-orange-ink">
                  {error}
                </p>
              )}
            </div>
            <p className="mt-4 text-sm text-navy-blue/70">
              {m.emailCampaignsSendConfirmIrreversible({}, { locale })}
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  disabled={isExecuting}
                  type="button"
                  variant="secondary"
                >
                  {m.emailCampaignsSendConfirmCancel({}, { locale })}
                </Button>
              </DialogClose>
              <Button disabled={unsavedChanges || isExecuting} type="submit">
                {isExecuting
                  ? m.emailCampaignsSendConfirmSubmitting({}, { locale })
                  : m.emailCampaignsSendConfirmSubmit({}, { locale })}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
