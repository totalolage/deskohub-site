"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type { AdministrationWorkspaceReservationIdType } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
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
import { AdministrationAlert } from "./notice";

const reservationCancellationFormSchema = Schema.Struct({
  providerCredentialRemoved: Schema.Boolean,
  sendCancellationEmail: Schema.Boolean,
});

const confirmedReservationCancellationFormSchema =
  reservationCancellationFormSchema.check(
    Schema.makeFilter<{
      readonly providerCredentialRemoved: boolean;
      readonly sendCancellationEmail: boolean;
    }>(
      (values) =>
        values.providerCredentialRemoved || {
          path: ["providerCredentialRemoved"],
          issue: "Confirm that the door PIN was removed from the lock.",
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
        ? confirmedReservationCancellationFormSchema
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
            failed:
              "Reservation cancelled, but the cancellation email could not be sent.",
            not_requested:
              "Reservation cancelled without emailing the customer.",
            sent: "Reservation cancelled and the customer was emailed.",
          }[data.email]
        );
        router.refresh();
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ?? "The reservation could not be cancelled."
        ),
      onTransportError: () =>
        setError(
          "The cancellation response was interrupted. Refresh before trying again."
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
              Cancel reservation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel this reservation?</DialogTitle>
              <DialogDescription>
                This cancels the booking in Dotypos and cannot be undone. Any
                paid online payment will be marked as needing a refund; no
                refund is issued automatically.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form
                aria-label="Cancel this reservation"
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
                        <FormLabel className="flex cursor-pointer items-start gap-3 rounded-xl border border-burned-orange/25 bg-burned-orange/5 p-4 text-sm leading-6 text-navy-blue/70">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) =>
                                onChange(checked === true)
                              }
                            />
                          </FormControl>
                          <span>
                            I removed the active door PIN from the lock in
                            Igloohome
                          </span>
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
                      <FormLabel className="flex cursor-pointer items-start gap-3 rounded-xl border border-navy-blue/10 bg-navy-blue/2.5 p-4 text-sm leading-6 text-navy-blue/70">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) =>
                              onChange(checked === true)
                            }
                          />
                        </FormControl>
                        <span>Send a cancellation email to the customer</span>
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
                      Keep reservation
                    </Button>
                  </DialogClose>
                  <Button
                    className="bg-burned-orange-ink hover:bg-burned-orange-ink/90"
                    disabled={
                      isExecuting ||
                      (requiresProviderCredentialRemoval &&
                        !providerCredentialRemoved)
                    }
                    type="submit"
                  >
                    {isExecuting ? "Cancelling…" : "Cancel reservation"}
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
