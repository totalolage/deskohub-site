"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import {
  CliSessionId,
  type CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import { Option, Schema } from "effect";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { m } from "@/features/administration/i18n";
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
import { renameCliSession } from "./actions";
import { renameCliSessionSchema } from "./contracts";

// The contract's client name rule fails with library messages in English, so
// the dialog applies that rule and reports it in operator copy.
const createRenameCliSessionFormSchema = (locale: Locale) =>
  Schema.Struct({
    sessionId: CliSessionId,
    clientName: Schema.String.check(
      Schema.makeFilter((clientName) => {
        if (isValidClientName(clientName)) return true;
        return clientName.trim() === ""
          ? m.adminCliRenameLabelRequired({}, { locale })
          : m.adminCliRenameLabelTooLong({}, { locale });
      })
    ),
  });

const isValidClientName = (clientName: string) =>
  Option.isSome(
    Schema.decodeUnknownOption(renameCliSessionSchema.fields.clientName)(
      clientName
    )
  );

type RenameCliSessionFormInput = {
  readonly sessionId: string;
  readonly clientName: string;
};

type RenameCliSessionFormValues = {
  readonly sessionId: CliSessionIdType;
  readonly clientName: string;
};

export function RenameCliSession({
  clientName,
  sessionId,
}: {
  readonly clientName: string;
  readonly sessionId: CliSessionIdType;
}) {
  const locale = useRouteLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<
    RenameCliSessionFormInput,
    unknown,
    RenameCliSessionFormValues
  >({
    defaultValues: { sessionId, clientName },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(createRenameCliSessionFormSchema(locale), {
      onExcessProperty: "error",
    }),
  });
  const { execute, isExecuting } = useWorkspaceAction(renameCliSession, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setOpen(false);
      router.refresh();
    },
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ?? m.adminCliRenameFailed({}, { locale })
      ),
    onTransportError: () => setError(m.adminCliRenameFailed({}, { locale })),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setError(null);
        form.reset({ sessionId, clientName });
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="secondary">
          <Pencil aria-hidden className="size-4" />
          {m.adminCliRenameTrigger({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent locale={locale}>
        <DialogHeader>
          <DialogTitle>{m.adminCliRenameTitle({}, { locale })}</DialogTitle>
          <DialogDescription>
            {m.adminCliRenameDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="mt-5"
            onSubmit={(event) => {
              void form.handleSubmit((values) => {
                setError(null);
                execute({
                  clientName: values.clientName,
                  sessionId: values.sessionId,
                });
              })(event);
            }}
          >
            <FormField
              control={form.control}
              name="clientName"
              render={({ field: { onChange, ...field }, fieldState }) => (
                <FormItem>
                  <FormLabel>{m.adminCliRenameLabel({}, { locale })}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      maxLength={80}
                      onInput={onChange}
                      variant={fieldState.error ? "error" : "default"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && (
              <p
                className="mt-3 rounded-xl bg-burned-orange/10 px-4 py-3 text-sm font-semibold text-burned-orange-ink"
                role="alert"
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  disabled={isExecuting}
                  type="button"
                  variant="secondary"
                >
                  {m.adminCliRenameCancel({}, { locale })}
                </Button>
              </DialogClose>
              <Button disabled={isExecuting} type="submit">
                {isExecuting
                  ? m.adminCliRenameSaving({}, { locale })
                  : m.adminCliRenameSubmit({}, { locale })}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
