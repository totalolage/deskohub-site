"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { useForm } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
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
import { grantAdministrator } from "./actions";
import { makeGrantAdministratorSchema } from "./contracts";

type GrantAdministratorSchema = ReturnType<typeof makeGrantAdministratorSchema>;

const grantAdministratorFormDefaults: GrantAdministratorSchema["Encoded"] = {
  email: "",
};

export function GrantAdministratorForm({
  onOutcome,
}: {
  readonly onOutcome: (
    outcome:
      | { readonly kind: "granted"; readonly email: string }
      | { readonly kind: "already-administrator"; readonly email: string }
      | { readonly kind: "failed"; readonly message: string }
  ) => void;
}) {
  const locale = useRouteLocale();
  const form = useForm<
    GrantAdministratorSchema["Encoded"],
    unknown,
    GrantAdministratorSchema["Type"]
  >({
    defaultValues: grantAdministratorFormDefaults,
    resolver: effectSchemaResolver(makeGrantAdministratorSchema(locale), {
      onExcessProperty: "error",
    }),
  });
  const { executeAsync, isExecuting } = useWorkspaceAction(grantAdministrator, {
    onSuccess: ({ data }) => {
      if (!data) return;
      form.reset(grantAdministratorFormDefaults);
      onOutcome({
        kind: data.changed ? "granted" : "already-administrator",
        email: data.email,
      });
    },
    onError: ({ error }) => {
      onOutcome({
        kind: "failed",
        message:
          error.serverError ?? m.administratorsGrantFailed({}, { locale }),
      });
    },
    onTransportError: () => {
      onOutcome({
        kind: "failed",
        message: m.administratorsServerUnreachable({}, { locale }),
      });
    },
  });

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          await executeAsync(values);
        })}
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="min-w-0 flex-1">
              <FormLabel className="sr-only">
                {m.administratorsGrantEmailLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  autoComplete="off"
                  placeholder={m.administratorsGrantEmailLabel({}, { locale })}
                  type="email"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button disabled={isExecuting} type="submit">
          {isExecuting
            ? m.administratorsGrantSubmitting({}, { locale })
            : m.administratorsGrantSubmit({}, { locale })}
        </Button>
      </form>
    </Form>
  );
}
