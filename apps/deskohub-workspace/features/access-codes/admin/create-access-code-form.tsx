"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import {
  ADMINISTRATION_STANDALONE_ACCESS_CODE_MAXIMUM_DURATION_HOURS,
  ADMINISTRATION_STANDALONE_ACCESS_CODE_MINIMUM_DURATION_HOURS,
  type AdministrationStandaloneAccessCodeAttemptIdType,
  type AdministrationStandaloneAccessCodeCleanupTargetType,
  type AdministrationStandaloneAccessCodeCreationOutcome,
} from "@deskohub/workspace-admin-api";
import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import { Result, Schema } from "effect";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { type UseFormReturn, useForm, useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { AdministrationAlert } from "@/features/administration/notice";
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
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { AccessCodeCopyButton, AccessCodeDigits } from "./access-code-digits";
import { createStandaloneAccessCode } from "./actions";
import {
  type CreateStandaloneAccessCodeFormInput,
  type CreateStandaloneAccessCodeFormValues,
  createStandaloneAccessCodeAttemptId,
  createStandaloneAccessCodeFormDefaults,
  createStandaloneAccessCodeFormSchema,
  decodeCreateStandaloneAccessCodeResult,
  formatStandaloneAccessCodeDuration,
  formatStandaloneAccessCodeLocalDateTime,
  isSameStandaloneAccessCodeWindow,
  isStandaloneAccessCodeLocalDateTime,
  isStandaloneAccessCodeWindowValid,
  shiftStandaloneAccessCodeLocalEnd,
  standaloneAccessCodeEarliestLocalEnd,
  standaloneAccessCodeElapsedHours,
  standaloneAccessCodeFailureNotice,
} from "./create-access-code";

type CreatedOutcome = Extract<
  AdministrationStandaloneAccessCodeCreationOutcome,
  { outcome: "created" }
>;

type CreationState =
  | { readonly kind: "editing" }
  | { readonly kind: "created"; readonly outcome: CreatedOutcome }
  | { readonly kind: "already-created" }
  | {
      readonly kind: "cleanup-confirm";
      readonly reason: "ambiguous" | "cleanup-required";
      readonly cleanupTarget: AdministrationStandaloneAccessCodeCleanupTargetType;
    };

const focusOnMount = (node: HTMLDivElement | null) => {
  node?.focus();
};

const cleanupConfirmationFormSchema = (locale: Locale) =>
  Schema.Struct({
    providerCredentialRemoved: Schema.Boolean.check(
      Schema.makeFilter(
        (confirmed) =>
          confirmed || m.accessCodesCleanupConfirmationRequired({}, { locale })
      )
    ),
  });

type CleanupConfirmationFormSchema = ReturnType<
  typeof cleanupConfirmationFormSchema
>;

type CleanupConfirmationFormInput = CleanupConfirmationFormSchema["Encoded"];

type CleanupConfirmationFormValues = CleanupConfirmationFormSchema["Type"];

const cleanupConfirmationFormDefaults = {
  providerCredentialRemoved: false,
} satisfies CleanupConfirmationFormInput;

export function CreateStandaloneAccessCodeForm() {
  const locale = useRouteLocale();
  const [creation, setCreation] = useState<CreationState>({ kind: "editing" });
  const [notice, setNotice] = useState<string | null>(null);
  const [focusNameOnReturn, setFocusNameOnReturn] = useState(false);
  const attemptIdRef = useRef(createStandaloneAccessCodeAttemptId());
  const attemptInputRef = useRef<CreateStandaloneAccessCodeFormValues | null>(
    null
  );
  const cleanupConfirmedRef = useRef<{
    readonly window: CreateStandaloneAccessCodeFormValues;
    readonly targetAttemptId: AdministrationStandaloneAccessCodeAttemptIdType;
  } | null>(null);

  const form = useForm<
    CreateStandaloneAccessCodeFormInput,
    unknown,
    CreateStandaloneAccessCodeFormValues
  >({
    defaultValues: createStandaloneAccessCodeFormDefaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(
      createStandaloneAccessCodeFormSchema(locale)
    ),
  });

  const { execute, isExecuting } = useWorkspaceAction(
    createStandaloneAccessCode,
    {
      onSuccess: ({ data }) => {
        cleanupConfirmedRef.current = null;
        if (!data) return;
        const result = decodeCreateStandaloneAccessCodeResult(data);
        if (Result.isSuccess(result)) {
          const outcome = result.success;
          setNotice(null);
          if (outcome.outcome === "created") {
            setCreation({ kind: "created", outcome });
            return;
          }
          setCreation({ kind: "already-created" });
          return;
        }
        const failure = result.failure;
        if (failure.outcome === "rejected") {
          attemptInputRef.current = null;
          setNotice(standaloneAccessCodeFailureNotice("rejected", locale));
          return;
        }
        if (
          failure.outcome === "ambiguous" ||
          failure.outcome === "cleanup-required"
        ) {
          setCreation({
            kind: "cleanup-confirm",
            reason: failure.outcome,
            cleanupTarget: failure.cleanupTarget,
          });
          return;
        }
        setNotice(standaloneAccessCodeFailureNotice(failure.outcome, locale));
      },
      onError: ({ error }) => {
        cleanupConfirmedRef.current = null;
        setNotice(
          error.serverError ?? m.accessCodesCreateFailed({}, { locale })
        );
      },
      onTransportError: () => {
        cleanupConfirmedRef.current = null;
        setNotice(m.accessCodesServerUnreachable({}, { locale }));
      },
    }
  );

  const startNewAttempt = () => {
    attemptIdRef.current = createStandaloneAccessCodeAttemptId();
    attemptInputRef.current = null;
    cleanupConfirmedRef.current = null;
    setNotice(null);
    form.reset(createStandaloneAccessCodeFormDefaults);
    setFocusNameOnReturn(true);
    setCreation({ kind: "editing" });
  };

  const submit = (values: CreateStandaloneAccessCodeFormValues) => {
    setNotice(null);
    const bound = attemptInputRef.current;
    if (!bound || !isSameStandaloneAccessCodeWindow(bound, values)) {
      // A changed window is a new intent: it must never reuse the attempt id.
      attemptIdRef.current = createStandaloneAccessCodeAttemptId();
      attemptInputRef.current = values;
      cleanupConfirmedRef.current = null;
    }
    const confirmed = cleanupConfirmedRef.current;
    const confirmedTarget =
      confirmed !== null &&
      isSameStandaloneAccessCodeWindow(confirmed.window, values)
        ? confirmed.targetAttemptId
        : null;
    cleanupConfirmedRef.current = null;
    execute({
      attemptId: attemptIdRef.current,
      ...values,
      ...(confirmedTarget && {
        providerCredentialRemovedAttemptId: confirmedTarget,
      }),
    });
  };

  const confirmLockCleanup = (
    cleanupTarget: AdministrationStandaloneAccessCodeCleanupTargetType
  ) => {
    const attemptInput = attemptInputRef.current;
    if (!attemptInput) return;
    // The cleanup closes the earlier attempt: the next submission is a fresh
    // creation attempt for the preserved values, echoing the confirmed target.
    attemptIdRef.current = createStandaloneAccessCodeAttemptId();
    cleanupConfirmedRef.current = {
      window: attemptInput,
      targetAttemptId: cleanupTarget.attemptId,
    };
    setNotice(null);
    form.reset(attemptInput);
    setFocusNameOnReturn(true);
    setCreation({ kind: "editing" });
  };

  if (creation.kind === "created") {
    return (
      <CreatedStandaloneAccessCode
        locale={locale}
        onCreateAnother={startNewAttempt}
        outcome={creation.outcome}
      />
    );
  }

  if (creation.kind === "already-created") {
    return (
      <AlreadyCreatedStandaloneAccessCode
        locale={locale}
        onCreateAnother={startNewAttempt}
      />
    );
  }

  if (creation.kind === "cleanup-confirm") {
    return (
      <StandaloneAccessCodeCleanup
        creation={creation}
        locale={locale}
        onConfirmed={() => confirmLockCleanup(creation.cleanupTarget)}
        onStartOver={startNewAttempt}
      />
    );
  }

  return (
    <StandaloneAccessCodeWindowForm
      focusNameOnReturn={focusNameOnReturn}
      form={form}
      isExecuting={isExecuting}
      locale={locale}
      notice={notice}
      onSubmit={submit}
    />
  );
}

function CreatedStandaloneAccessCode({
  locale,
  onCreateAnother,
  outcome,
}: {
  readonly locale: Locale;
  readonly onCreateAnother: () => void;
  readonly outcome: CreatedOutcome;
}) {
  return (
    <div
      className="rounded-xl outline-none"
      data-standalone-access-code-creation="created"
      ref={focusOnMount}
      tabIndex={-1}
    >
      <AdministrationAlert className="font-semibold" status="warning">
        {m.accessCodesPinShownOnceWarning({}, { locale })}
      </AdministrationAlert>
      <div className="mt-6">
        <AccessCodeDigits code={outcome.pin} />
        <div className="mt-5">
          <AccessCodeCopyButton code={outcome.pin} locale={locale} />
        </div>
      </div>
      <dl className="mt-7 grid gap-x-6 gap-y-4 border-t border-navy-blue/10 pt-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-navy-blue/65">
            {m.accessCodesResultName({}, { locale })}
          </dt>
          <dd className="mt-0.5 font-medium">{outcome.name}</dd>
        </div>
        <div>
          <dt className="font-semibold text-navy-blue/65">
            {m.accessCodesResultValidFrom({}, { locale })}
          </dt>
          <dd className="mt-0.5 font-medium">
            {formatStandaloneAccessCodeLocalDateTime(outcome.startsAt, locale)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-navy-blue/65">
            {m.accessCodesResultValidUntil({}, { locale })}
          </dt>
          <dd className="mt-0.5 font-medium">
            {formatStandaloneAccessCodeLocalDateTime(outcome.endsAt, locale)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-navy-blue/65">
            {m.accessCodesResultDuration({}, { locale })}
          </dt>
          <dd className="mt-0.5 font-medium">
            {formatStandaloneAccessCodeDuration(
              standaloneAccessCodeElapsedHours(outcome) ??
                ADMINISTRATION_STANDALONE_ACCESS_CODE_MINIMUM_DURATION_HOURS,
              locale
            )}
          </dd>
        </div>
      </dl>
      <CreateAnotherStandaloneAccessCode
        locale={locale}
        onCreateAnother={onCreateAnother}
      />
    </div>
  );
}

function AlreadyCreatedStandaloneAccessCode({
  locale,
  onCreateAnother,
}: {
  readonly locale: Locale;
  readonly onCreateAnother: () => void;
}) {
  return (
    <div
      data-standalone-access-code-creation="already-created"
      ref={focusOnMount}
      tabIndex={-1}
    >
      <AdministrationAlert className="font-semibold" status="warning">
        {m.accessCodesAlreadyCreated({}, { locale })}
      </AdministrationAlert>
      <CreateAnotherStandaloneAccessCode
        locale={locale}
        onCreateAnother={onCreateAnother}
      />
    </div>
  );
}

function CreateAnotherStandaloneAccessCode({
  locale,
  onCreateAnother,
}: {
  readonly locale: Locale;
  readonly onCreateAnother: () => void;
}) {
  return (
    <div className="mt-6 border-t border-navy-blue/10 pt-5">
      <Button
        className="sm:w-auto"
        fullWidth
        onClick={onCreateAnother}
        type="button"
      >
        <Plus aria-hidden className="size-4" />
        {m.accessCodesCreateAnother({}, { locale })}
      </Button>
    </div>
  );
}

function StandaloneAccessCodeCleanup({
  creation,
  locale,
  onConfirmed,
  onStartOver,
}: {
  readonly creation: Extract<CreationState, { kind: "cleanup-confirm" }>;
  readonly locale: Locale;
  readonly onConfirmed: () => void;
  readonly onStartOver: () => void;
}) {
  return (
    <div
      data-standalone-access-code-creation={creation.reason}
      ref={focusOnMount}
      tabIndex={-1}
    >
      <AdministrationAlert role="alert" status="warning">
        {creation.reason === "ambiguous"
          ? m.accessCodesAmbiguousNotice({}, { locale })
          : m.accessCodesCleanupRequiredNotice({}, { locale })}
      </AdministrationAlert>
      <p className="mt-5 text-sm leading-6 text-navy-blue/70">
        {m.accessCodesCleanupInstructions(
          { name: creation.cleanupTarget.name },
          { locale }
        )}
      </p>
      <CleanupConfirmationForm
        locale={locale}
        onConfirmed={onConfirmed}
        onStartOver={onStartOver}
      />
    </div>
  );
}

function StandaloneAccessCodeWindowForm({
  focusNameOnReturn,
  form,
  isExecuting,
  locale,
  notice,
  onSubmit,
}: {
  readonly focusNameOnReturn: boolean;
  readonly form: UseFormReturn<
    CreateStandaloneAccessCodeFormInput,
    unknown,
    CreateStandaloneAccessCodeFormValues
  >;
  readonly isExecuting: boolean;
  readonly locale: Locale;
  readonly notice: string | null;
  readonly onSubmit: (values: CreateStandaloneAccessCodeFormValues) => void;
}) {
  const [watchedStartsAt, watchedEndsAt] = useWatch({
    control: form.control,
    name: ["startsAt", "endsAt"],
  });
  const startsAt = watchedStartsAt ?? "";
  const endsAt = watchedEndsAt ?? "";
  const endMin = isStandaloneAccessCodeLocalDateTime(startsAt)
    ? standaloneAccessCodeEarliestLocalEnd(startsAt)
    : undefined;
  const endMax = isStandaloneAccessCodeLocalDateTime(startsAt)
    ? shiftStandaloneAccessCodeLocalEnd({
        startsAt,
        hours: ADMINISTRATION_STANDALONE_ACCESS_CODE_MAXIMUM_DURATION_HOURS,
      })
    : undefined;

  return (
    <Form {...form}>
      <form
        aria-label={m.accessCodesFormName({}, { locale })}
        data-standalone-access-code-creation="editing"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
      >
        <div className="grid gap-5">
          <FormField
            control={form.control}
            name="name"
            render={({ field: { onChange, ...field }, fieldState }) => (
              <FormItem>
                <FormLabel>{m.accessCodesNameLabel({}, { locale })}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoFocus={focusNameOnReturn}
                    maxLength={60}
                    onInput={onChange}
                    required
                    variant={fieldState.error ? "error" : "default"}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <fieldset>
            <legend className="text-sm font-medium text-navy-blue">
              {m.accessCodesWindowLegend(
                { timeZone: WORKSPACE_SITE_TIME_ZONE },
                { locale }
              )}
            </legend>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startsAt"
                rules={{ deps: ["endsAt"] }}
                render={({ field: { onChange, ...field }, fieldState }) => (
                  <FormItem>
                    <FormLabel>
                      {m.accessCodesStartsLabel({}, { locale })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onInput={onChange}
                        required
                        step={3600}
                        type="datetime-local"
                        variant={fieldState.error ? "error" : "default"}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endsAt"
                render={({ field: { onChange, ...field }, fieldState }) => (
                  <FormItem>
                    <FormLabel>
                      {m.accessCodesEndsLabel({}, { locale })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        max={endMax}
                        min={endMin}
                        onInput={onChange}
                        required
                        step={3600}
                        type="datetime-local"
                        variant={fieldState.error ? "error" : "default"}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </fieldset>
        </div>

        <StandaloneAccessCodeDurationSummary
          endsAt={endsAt}
          locale={locale}
          startsAt={startsAt}
        />

        {notice && (
          <AdministrationAlert
            className="mt-5 font-semibold"
            role="alert"
            status="error"
          >
            {notice}
          </AdministrationAlert>
        )}

        <div className="mt-6 flex justify-end border-t border-navy-blue/10 pt-5">
          <Button disabled={isExecuting} type="submit">
            {isExecuting
              ? m.accessCodesSubmitting({}, { locale })
              : m.accessCodesSubmit({}, { locale })}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function StandaloneAccessCodeDurationSummary({
  endsAt,
  locale,
  startsAt,
}: {
  readonly endsAt: string;
  readonly locale: Locale;
  readonly startsAt: string;
}) {
  const elapsedHours = standaloneAccessCodeElapsedHours({ startsAt, endsAt });
  if (
    elapsedHours === null ||
    !isStandaloneAccessCodeWindowValid({ startsAt, endsAt })
  ) {
    return null;
  }
  return (
    <p aria-live="polite" className="mt-4 text-sm text-navy-blue/65">
      {m.accessCodesDurationSummary(
        { duration: formatStandaloneAccessCodeDuration(elapsedHours, locale) },
        { locale }
      )}
    </p>
  );
}

function CleanupConfirmationForm({
  locale,
  onConfirmed,
  onStartOver,
}: {
  readonly locale: Locale;
  readonly onConfirmed: () => void;
  readonly onStartOver: () => void;
}) {
  const cleanupForm = useForm<
    CleanupConfirmationFormInput,
    unknown,
    CleanupConfirmationFormValues
  >({
    defaultValues: cleanupConfirmationFormDefaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(cleanupConfirmationFormSchema(locale)),
  });
  const cleanupConfirmed = useWatch({
    control: cleanupForm.control,
    name: "providerCredentialRemoved",
  });

  return (
    <Form {...cleanupForm}>
      <form
        aria-label={m.accessCodesCleanupFormName({}, { locale })}
        className="mt-5"
        onSubmit={cleanupForm.handleSubmit(onConfirmed)}
      >
        <FormField
          control={cleanupForm.control}
          name="providerCredentialRemoved"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-start gap-3 text-sm leading-6 text-navy-blue">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                  />
                </FormControl>
                <span>
                  {m.accessCodesCleanupConfirmationLabel({}, { locale })}
                </span>
              </FormLabel>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="mt-6 flex flex-wrap gap-3 border-t border-navy-blue/10 pt-5">
          <Button disabled={!cleanupConfirmed} type="submit">
            <Plus aria-hidden className="size-4" />
            {m.accessCodesCreateAnother({}, { locale })}
          </Button>
          <Button onClick={onStartOver} type="button" variant="secondary">
            {m.accessCodesStartOver({}, { locale })}
          </Button>
        </div>
      </form>
    </Form>
  );
}
