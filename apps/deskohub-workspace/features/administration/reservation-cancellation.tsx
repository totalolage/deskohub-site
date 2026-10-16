"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type { AdministrationWorkspaceReservationIdType } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
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
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { cancelAdministrationReservation } from "./actions";
import { m } from "./i18n";
import { AdministrationAlert } from "./notice";

const reservationCancellationFormSchema = Schema.Struct({
  providerCredentialRemoved: Schema.Boolean,
  sendCancellationEmail: Schema.Boolean,
});

const getConfirmedReservationCancellationFormSchema = (locale: Locale) =>
  reservationCancellationFormSchema.check(
    Schema.makeFilter<{
      readonly providerCredentialRemoved: boolean;
      readonly sendCancellationEmail: boolean;
    }>(
      (values) =>
        values.providerCredentialRemoved || {
          path: ["providerCredentialRemoved"],
          issue: m.administrationReservationCancellationPinRemovedRequired(
            {},
            { locale }
          ),
        }
    )
  );

type ReservationCancellationFormInput =
  typeof reservationCancellationFormSchema.Encoded;

type ReservationCancellationFormValues =
  typeof reservationCancellationFormSchema.Type;

const reservationCancellationFormDefaults = {
  providerCredentialRemoved: false,
  sendCancellationEmail: true,
} satisfies ReservationCancellationFormInput;

export function ReservationCancellation({
  canCancel,
  accessGrantUpdatedAt,
  requiresProviderCredentialRemoval,
  reservationId,
}: {
  readonly canCancel: boolean;
  readonly accessGrantUpdatedAt: string | null;
  readonly requiresProviderCredentialRemoval: boolean;
  readonly reservationId: AdministrationWorkspaceReservationIdType;
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<
    ReservationCancellationFormInput,
    unknown,
    ReservationCancellationFormValues
  >({
    defaultValues: reservationCancellationFormDefaults,
    mode: "onSubmit",
    resolver: effectSchemaResolver(
      requiresProviderCredentialRemoval
        ? getConfirmedReservationCancellationFormSchema(locale)
        : reservationCancellationFormSchema
    ),
  });
  const [providerCredentialRemoved] = useWatch({
    control: form.control,
    name: ["providerCredentialRemoved", "sendCancellationEmail"],
  });
  const { execute, isExecuting } = useWorkspaceAction(
    cancelAdministrationReservation,
    {
      actionName: "cancelAdministrationReservation",
      onSuccess: ({ data }) => {
        if (!data) return;
        setOpen(false);
        setMessage(
          {
            failed: m.administrationReservationCancellationEmailFailed,
            not_requested:
              m.administrationReservationCancellationEmailNotRequested,
            sent: m.administrationReservationCancellationEmailSent,
          }[data.email]({}, { locale })
        );
        router.refresh();
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ??
            m.administrationReservationCancellationFailed({}, { locale })
        ),
      onTransportError: () =>
        setError(
          m.administrationReservationCancellationInterrupted({}, { locale })
        ),
    }
  );

  if (!canCancel && !message) return null;

  return (
    <div className="space-y-2">
      {canCancel && (
        <Dialog
          onOpenChange={(nextOpen) => {
            setError(null);
            setOpen(nextOpen);
          }}
          open={open}
        >
          <DialogTrigger asChild>
            <Button type="button" variant="secondary">
              {m.administrationReservationCancellationOpen({}, { locale })}
            </Button>
          </DialogTrigger>
          <DialogContent locale={locale}>
            <DialogHeader>
              <DialogTitle>
                {m.administrationReservationCancellationTitle({}, { locale })}
              </DialogTitle>
              <DialogDescription>
                {m.administrationReservationCancellationDescription(
                  {},
                  { locale }
                )}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form
                aria-label={m.administrationReservationCancellationFormLabel(
                  {},
                  { locale }
                )}
                noValidate
                onSubmit={(event) => {
                  void form.handleSubmit((values) => {
                    setError(null);
                    execute({
                      accessGrantUpdatedAt,
                      providerCredentialRemoved:
                        values.providerCredentialRemoved,
                      reservationId,
                      sendCancellationEmail: values.sendCancellationEmail,
                    });
                  })(event);
                }}
              >
                {requiresProviderCredentialRemoval && (
                  <FormField
                    control={form.control}
                    name="providerCredentialRemoved"
                    render={({ field: { onChange, ...field } }) => (
                      <FormItem>
                        <FormLabel asChild>
                          <ChoiceCard tone="warning">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={(checked) =>
                                  onChange(checked === true)
                                }
                              />
                            </FormControl>
                            <span className="leading-6">
                              {m.administrationReservationCancellationPinRemoved(
                                {},
                                { locale }
                              )}
                            </span>
                          </ChoiceCard>
                        </FormLabel>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="sendCancellationEmail"
                  render={({ field: { onChange, ...field } }) => (
                    <FormItem>
                      <FormLabel asChild>
                        <ChoiceCard>
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) =>
                                onChange(checked === true)
                              }
                            />
                          </FormControl>
                          <span className="leading-6 text-navy-blue/70">
                            {m.administrationReservationCancellationSendEmail(
                              {},
                              { locale }
                            )}
                          </span>
                        </ChoiceCard>
                      </FormLabel>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {error && (
                  <AdministrationAlert role="alert" status="error">
                    {error}
                  </AdministrationAlert>
                )}
                <DialogFooter>
                  <DialogClose asChild>
                    <Button
                      disabled={isExecuting}
                      type="button"
                      variant="secondary"
                    >
                      {m.administrationReservationCancellationKeep(
                        {},
                        { locale }
                      )}
                    </Button>
                  </DialogClose>
                  <Button
                    disabled={
                      isExecuting ||
                      (requiresProviderCredentialRemoval &&
                        !providerCredentialRemoved)
                    }
                    tone="burned-orange-ink"
                    type="submit"
                  >
                    {isExecuting
                      ? m.administrationReservationCancellationSubmitting(
                          {},
                          { locale }
                        )
                      : m.administrationReservationCancellationSubmit(
                          {},
                          { locale }
                        )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}
      {message && (
        <AdministrationAlert role="status" status="success">
          {message}
        </AdministrationAlert>
      )}
    </div>
  );
}
