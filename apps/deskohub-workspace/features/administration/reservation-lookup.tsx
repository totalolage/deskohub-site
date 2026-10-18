"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { Locale } from "@/features/i18n";
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
import { cn } from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { getAdministrationActionFailureMessage } from "./action-failure-message";
import { getAdministrationReservation } from "./actions";
import { localizeAdministrationHref } from "./administration-href";
import type { ReservationLookupInput } from "./contracts";
import { m } from "./i18n";
import { AdministrationAlert } from "./notice";

const reservationLookupIdentifierMaximumLength = 256;

// The lookup action validates the same rules with `reservationLookupSchema`;
// this copy only adds the operator's language to the form errors.
const getReservationLookupFormSchema = (locale: Locale) =>
  Schema.Struct({
    identifier: Schema.Trim.check(
      Schema.isNonEmpty({
        message: m.administrationReservationLookupRequired({}, { locale }),
      }),
      Schema.isMaxLength(reservationLookupIdentifierMaximumLength, {
        message: m.administrationReservationLookupTooLong(
          { maximum: reservationLookupIdentifierMaximumLength },
          { locale }
        ),
      })
    ),
  });

export function ReservationLookup({
  variant = "card",
}: {
  readonly variant?: "card" | "toolbar";
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ReservationLookupInput, unknown, ReservationLookupInput>(
    {
      defaultValues: { identifier: "" },
      mode: "onSubmit",
      reValidateMode: "onChange",
      resolver: effectSchemaResolver(getReservationLookupFormSchema(locale), {
        onExcessProperty: "error",
      }),
    }
  );
  const { execute, isExecuting } = useWorkspaceAction(
    getAdministrationReservation,
    {
      actionName: "getAdministrationReservation",
      onSuccess: ({ data }) => {
        if (!data) return;
        if (!data.reservationId) {
          setError(m.administrationReservationLookupNoMatch({}, { locale }));
          return;
        }
        setError(null);
        router.push(
          localizeAdministrationHref(
            `/admin/reservations/${encodeURIComponent(data.reservationId)}`,
            locale
          )
        );
      },
      onError: ({ error: actionError }) =>
        setError(
          getAdministrationActionFailureMessage(actionError.serverError, {
            fallback: m.administrationReservationLookupFailed({}, { locale }),
            locale,
          })
        ),
      onTransportError: () =>
        setError(m.administrationReservationLookupFailed({}, { locale })),
    }
  );

  return (
    <div className="space-y-4">
      <Form {...form}>
        <form
          className={cn(
            "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
            variant === "card" &&
              "rounded-xl border border-navy-blue/10 bg-white p-5"
          )}
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit(({ identifier }) => {
              setError(null);
              execute({ identifier });
            })(event);
          }}
        >
          <FormField
            control={form.control}
            name="identifier"
            render={({ field: { onChange, ...field }, fieldState }) => (
              <FormItem>
                <FormLabel>
                  {m.administrationReservationLookupLabel({}, { locale })}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    maxLength={reservationLookupIdentifierMaximumLength}
                    onInput={onChange}
                    placeholder={m.administrationReservationLookupPlaceholder(
                      {},
                      { locale }
                    )}
                    required
                    type="search"
                    variant={fieldState.error ? "error" : "default"}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button disabled={isExecuting} type="submit">
            <Search aria-hidden className="size-4" />
            {isExecuting
              ? m.administrationReservationLookupSubmitting({}, { locale })
              : m.administrationReservationLookupSubmit({}, { locale })}
          </Button>
        </form>
      </Form>

      {error && (
        <AdministrationAlert
          className="font-semibold"
          role="alert"
          status="error"
        >
          {error}
        </AdministrationAlert>
      )}
    </div>
  );
}
