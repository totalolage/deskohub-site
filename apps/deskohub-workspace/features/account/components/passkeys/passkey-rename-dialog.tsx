"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  type AccountPasskey,
  PASSKEY_NAME_MAXIMUM_LENGTH,
  type PasskeyChangeResult,
  passkeyDisplayName,
} from "@/features/account/passkeys";
import { type Locale, m } from "@/features/i18n";
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

const createRenameFormSchema = (locale: Locale) =>
  Schema.Struct({
    name: Schema.Trim.check(
      Schema.isNonEmpty({
        message: m.accountPasskeyRenameRequired({}, { locale }),
      }),
      Schema.isMaxLength(PASSKEY_NAME_MAXIMUM_LENGTH, {
        message: m.accountPasskeyRenameMaximum(
          { max: PASSKEY_NAME_MAXIMUM_LENGTH },
          { locale }
        ),
      })
    ),
  });

type RenameFormSchema = ReturnType<typeof createRenameFormSchema>;

type PasskeyRenameDialogProps = {
  readonly locale: Locale;
  /** The passkey being renamed; the dialog is closed while null. */
  readonly passkey: AccountPasskey | null;
  readonly renamePasskey: (
    id: string,
    name: string
  ) => Promise<PasskeyChangeResult>;
  readonly onRenamed: () => void;
  readonly onClose: () => void;
};

export function PasskeyRenameDialog({
  locale,
  passkey,
  renamePasskey,
  onRenamed,
  onClose,
}: PasskeyRenameDialogProps) {
  return (
    <Dialog
      open={passkey !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        aria-describedby="rename-passkey-dialog-description"
        locale={locale}
      >
        {passkey && (
          <PasskeyRenameForm
            key={passkey.id}
            locale={locale}
            onClose={onClose}
            onRenamed={onRenamed}
            passkey={passkey}
            renamePasskey={renamePasskey}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PasskeyRenameForm({
  locale,
  passkey,
  renamePasskey,
  onRenamed,
  onClose,
}: Omit<PasskeyRenameDialogProps, "passkey"> & {
  readonly passkey: AccountPasskey;
}) {
  const [failed, setFailed] = useState(false);
  const currentName = passkeyDisplayName(passkey, locale);
  const form = useForm<
    RenameFormSchema["Encoded"],
    unknown,
    RenameFormSchema["Type"]
  >({
    defaultValues: { name: currentName },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(createRenameFormSchema(locale)),
  });
  const pending = form.formState.isSubmitting;

  const save = async ({ name }: RenameFormSchema["Type"]) => {
    setFailed(false);
    if (name === currentName) {
      onClose();
      return;
    }
    const result = await renamePasskey(passkey.id, name);
    if (result === "saved") onRenamed();
    else setFailed(true);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{m.accountPasskeyRenameTitle({}, { locale })}</DialogTitle>
        <DialogDescription id="rename-passkey-dialog-description">
          {m.accountPasskeyRenameBody({}, { locale })}
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form
          className="mt-5"
          noValidate
          onSubmit={(event) => void form.handleSubmit(save)(event)}
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel htmlFor="rename-passkey-name">
                  {m.accountPasskeyRenameNameLabel({}, { locale })}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    id="rename-passkey-name"
                    maxLength={PASSKEY_NAME_MAXIMUM_LENGTH}
                  />
                </FormControl>
                <FormMessage className="text-sm font-normal text-red-700" />
              </FormItem>
            )}
          />
          <div aria-live="polite" className="mt-3 min-h-5 text-sm text-red-700">
            {failed && m.accountPasskeyRenameFailed({}, { locale })}
          </div>
          <DialogFooter className="mt-4">
            <Button
              disabled={pending}
              onClick={onClose}
              type="button"
              variant="ghost"
            >
              {m.accountPasskeyDialogCancel({}, { locale })}
            </Button>
            <Button id="rename-passkey-save" pending={pending} type="submit">
              {pending
                ? m.accountPasskeyRenameSaving({}, { locale })
                : m.accountPasskeyRenameSave({}, { locale })}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </>
  );
}
