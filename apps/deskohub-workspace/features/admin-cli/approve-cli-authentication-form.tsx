"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { CliAuthenticationCode } from "@deskohub/workspace-admin-api";
import { Option, Schema } from "effect";
import { useRef, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { approveCliAuthentication } from "@/features/admin-cli/actions";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  cliSessionLifetimeAmountFieldSchema,
  cliSessionLifetimeAmountLimits,
  cliSessionLifetimeUnitSchema,
  cliSessionLifetimeUnits,
} from "./contracts";

const approveCliAuthenticationFields = Schema.Struct({
  code: CliAuthenticationCode,
  lifetimeAmount: Schema.String,
  lifetimeUnit: cliSessionLifetimeUnitSchema,
  neverExpire: Schema.Boolean,
});

const createApproveCliAuthenticationFormSchema = (locale: Locale) =>
  approveCliAuthenticationFields.check(
    // The duration is disabled while "Never expire" is checked, so only an
    // active duration carries a validation rule.
    Schema.makeFilter<typeof approveCliAuthenticationFields.Type>(
      (value) =>
        value.neverExpire ||
        Option.isSome(
          Schema.decodeUnknownOption(cliSessionLifetimeAmountFieldSchema)(
            value.lifetimeAmount
          )
        ) || {
          path: ["lifetimeAmount"],
          issue: m.adminCliApprovalFormDurationInvalid(
            cliSessionLifetimeAmountLimits,
            { locale }
          ),
        }
    )
  );

type ApproveCliAuthenticationFormSchema = ReturnType<
  typeof createApproveCliAuthenticationFormSchema
>;

type ApproveCliAuthenticationFormInput =
  ApproveCliAuthenticationFormSchema["Encoded"];

type ApproveCliAuthenticationFormValues =
  ApproveCliAuthenticationFormSchema["Type"];

const sessionLifetimeDefaults = {
  lifetimeAmount: "30",
  lifetimeUnit: "days",
  neverExpire: false,
} satisfies Omit<ApproveCliAuthenticationFormInput, "code">;

const sessionLifetimeUnitLabels = {
  hours: m.adminCliApprovalFormUnitHours,
  days: m.adminCliApprovalFormUnitDays,
  weeks: m.adminCliApprovalFormUnitWeeks,
  months: m.adminCliApprovalFormUnitMonths,
  years: m.adminCliApprovalFormUnitYears,
} satisfies Record<
  (typeof cliSessionLifetimeUnits)[number],
  typeof m.adminCliApprovalFormUnitHours
>;

const toApprovalFormData = (values: ApproveCliAuthenticationFormValues) => {
  const formData = new FormData();
  formData.set("code", values.code);
  if (values.neverExpire) {
    formData.set("neverExpire", "on");
  } else {
    formData.set("lifetimeAmount", values.lifetimeAmount);
    formData.set("lifetimeUnit", values.lifetimeUnit);
  }
  return formData;
};

export function ApproveCliAuthenticationForm({
  code,
}: {
  readonly code?: string;
}) {
  const locale = useRouteLocale();
  const [isPending, startTransition] = useTransition();
  const submissionStarted = useRef(false);
  const form = useForm<
    ApproveCliAuthenticationFormInput,
    unknown,
    ApproveCliAuthenticationFormValues
  >({
    defaultValues: { code: code ?? "", ...sessionLifetimeDefaults },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(
      createApproveCliAuthenticationFormSchema(locale),
      {
        onExcessProperty: "error",
      }
    ),
  });
  const neverExpire = useWatch({ control: form.control, name: "neverExpire" });

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            if (submissionStarted.current) return;
            submissionStarted.current = true;

            const formData = toApprovalFormData(values);
            startTransition(async () => {
              try {
                await approveCliAuthentication(formData);
              } finally {
                submissionStarted.current = false;
              }
            });
          })(event);
        }}
      >
        <input type="hidden" {...form.register("code")} />
        <fieldset className="mb-5 grid gap-3">
          <legend className="mb-3 text-sm font-semibold">
            {m.adminCliApprovalFormLifetimeLegend({}, { locale })}
          </legend>
          <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,12rem)] gap-3 items-start">
            <FormField
              control={form.control}
              name="lifetimeAmount"
              render={({ field: { onChange, ...field }, fieldState }) => (
                <FormItem>
                  <FormLabel className="sr-only">
                    {m.adminCliApprovalFormDurationLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={neverExpire}
                      inputMode="numeric"
                      max={cliSessionLifetimeAmountLimits.maximum}
                      min={cliSessionLifetimeAmountLimits.minimum}
                      onInput={onChange}
                      step={1}
                      type="number"
                      variant={fieldState.error ? "error" : "default"}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lifetimeUnit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">
                    {m.adminCliApprovalFormUnitLabel({}, { locale })}
                  </FormLabel>
                  <Select
                    disabled={neverExpire}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {cliSessionLifetimeUnits.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {sessionLifetimeUnitLabels[unit]({}, { locale })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="neverExpire"
            rules={{ deps: ["lifetimeAmount"] }}
            render={({ field: { onChange, value, ...field } }) => (
              <FormItem>
                <FormLabel className="flex cursor-pointer items-center gap-3">
                  <FormControl>
                    <Checkbox
                      {...field}
                      checked={value}
                      onCheckedChange={(checked) => onChange(checked === true)}
                    />
                  </FormControl>
                  <span>
                    {m.adminCliApprovalFormNeverExpire({}, { locale })}
                  </span>
                </FormLabel>
              </FormItem>
            )}
          />
        </fieldset>
        <Button aria-busy={isPending} disabled={isPending} type="submit">
          {m.adminCliApprovalFormSubmit({}, { locale })}
        </Button>
      </form>
    </Form>
  );
}
