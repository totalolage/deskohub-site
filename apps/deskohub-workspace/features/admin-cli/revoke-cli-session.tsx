"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import {
  CliSessionId,
  type CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import { m } from "@/features/administration/i18n";
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
import { revokeCliSession } from "./actions";

const revokeCliSessionFormSchema = Schema.Struct({
  sessionId: CliSessionId,
});

type RevokeCliSessionFormInput = typeof revokeCliSessionFormSchema.Encoded;

type RevokeCliSessionFormValues = typeof revokeCliSessionFormSchema.Type;

export function RevokeCliSession({
  clientName,
  revoked,
  sessionId,
}: {
  readonly clientName: string;
  readonly revoked: boolean;
  readonly sessionId: CliSessionIdType;
}) {
  const locale = useRouteLocale();
  const [isPending, startTransition] = useTransition();
  const submissionStarted = useRef(false);
  const form = useForm<
    RevokeCliSessionFormInput,
    unknown,
    RevokeCliSessionFormValues
  >({
    defaultValues: { sessionId },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(revokeCliSessionFormSchema, {
      onExcessProperty: "error",
    }),
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={revoked} size="sm" type="button" variant="secondary">
          {m.adminCliRevokeTrigger({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent locale={locale}>
        <DialogHeader>
          <DialogTitle>{m.adminCliRevokeTitle({}, { locale })}</DialogTitle>
          <DialogDescription>
            {m.adminCliRevokeDescription({ clientName }, { locale })}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            void form.handleSubmit((values) => {
              if (submissionStarted.current) return;
              submissionStarted.current = true;

              const formData = new FormData();
              formData.set("sessionId", values.sessionId);
              startTransition(async () => {
                try {
                  await revokeCliSession(formData);
                } finally {
                  submissionStarted.current = false;
                }
              });
            })(event);
          }}
        >
          <input type="hidden" {...form.register("sessionId")} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {m.adminCliRevokeCancel({}, { locale })}
              </Button>
            </DialogClose>
            <Button disabled={isPending} type="submit">
              {isPending
                ? m.adminCliRevokeSubmitting({}, { locale })
                : m.adminCliRevokeSubmit({}, { locale })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
