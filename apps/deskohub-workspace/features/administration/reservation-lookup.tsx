"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { getAdministrationReservation } from "./actions";
import {
  type ReservationLookupInput,
  reservationLookupSchema,
} from "./contracts";
import { AdministrationAlert } from "./notice";

export function ReservationLookup({
  variant = "card",
}: {
  readonly variant?: "card" | "toolbar";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ReservationLookupInput, unknown, ReservationLookupInput>(
    {
      defaultValues: { identifier: "" },
      mode: "onSubmit",
      reValidateMode: "onChange",
      resolver: effectSchemaResolver(reservationLookupSchema, {
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
          setError("No reservation matched that ID.");
          return;
        }
        setError(null);
        router.push(
          `/admin/reservations/${encodeURIComponent(data.reservationId)}`
        );
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ??
            "The reservation lookup could not be completed."
        ),
      onTransportError: () =>
        setError("The reservation lookup could not be completed."),
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
                <FormLabel>Reservation or payment ID</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    maxLength={256}
                    onInput={onChange}
                    placeholder="Paste any associated ID"
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
            {isExecuting ? "Looking up…" : "Get reservation"}
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
