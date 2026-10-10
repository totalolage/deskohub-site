"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type { CliSessionIdType } from "@deskohub/workspace-admin-api";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
    resolver: effectSchemaResolver(renameCliSessionSchema, {
      onExcessProperty: "error",
    }),
  });
  const { execute, isExecuting } = useWorkspaceAction(renameCliSession, {
    actionName: "renameCliSession",
    onSuccess: ({ data }) => {
      if (!data) return;
      setOpen(false);
      router.refresh();
    },
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ?? "The CLI session label could not be updated."
      ),
    onTransportError: () =>
      setError("The CLI session label could not be updated."),
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
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename CLI session</DialogTitle>
          <DialogDescription>
            Choose a label that makes this machine easy to recognize. Renaming
            does not change its access.
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
                  <FormLabel>Client label</FormLabel>
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
                  Cancel
                </Button>
              </DialogClose>
              <Button disabled={isExecuting} type="submit">
                {isExecuting ? "Saving…" : "Save label"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
