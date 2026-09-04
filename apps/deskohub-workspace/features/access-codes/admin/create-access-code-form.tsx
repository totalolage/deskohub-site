"use client";

import type {
  AdministrationStandaloneAccessCodeAttemptIdType,
  AdministrationStandaloneAccessCodeCleanupTargetType,
  AdministrationStandaloneAccessCodeCreationOutcome,
} from "@deskohub/workspace-admin-api";
import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Result } from "effect";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  AccessCodeCopyButton,
  AccessCodeDigits,
} from "@/features/access-codes/components/access-code-digits";
import { AdministrationAlert } from "@/features/administration/notice";
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
  standaloneAccessCodeCleanupConfirmationLabel,
  standaloneAccessCodeEarliestLocalEnd,
  standaloneAccessCodeElapsedHours,
  standaloneAccessCodeFailureNotices,
  standaloneAccessCodeMaximumDurationHours,
  standaloneAccessCodeMinimumDurationHours,
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

export function CreateStandaloneAccessCodeForm() {
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
    resolver: standardSchemaResolver(createStandaloneAccessCodeFormSchema),
  });
  const [watchedStartsAt, watchedEndsAt] = useWatch({
    control: form.control,
    name: ["startsAt", "endsAt"],
  });
  const startsAt = watchedStartsAt ?? "";
  const endsAt = watchedEndsAt ?? "";

  const { execute, isExecuting } = useWorkspaceAction(
    createStandaloneAccessCode,
    {
      actionName: "createStandaloneAccessCode",
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
          setNotice(standaloneAccessCodeFailureNotices.rejected);
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
        setNotice(standaloneAccessCodeFailureNotices[failure.outcome]);
      },
      onError: ({ error }) => {
        cleanupConfirmedRef.current = null;
        setNotice(
          error.serverError ??
            "The access code could not be created. Try again."
        );
      },
      onTransportError: () => {
        cleanupConfirmedRef.current = null;
        setNotice(
          "The server could not be reached. This attempt is kept, so you can safely try again."
        );
      },
    }
  );

  const elapsedHours = standaloneAccessCodeElapsedHours({ startsAt, endsAt });
  const endMin = isStandaloneAccessCodeLocalDateTime(startsAt)
    ? standaloneAccessCodeEarliestLocalEnd(startsAt)
    : undefined;
  const endMax = isStandaloneAccessCodeLocalDateTime(startsAt)
    ? shiftStandaloneAccessCodeLocalEnd({
        startsAt,
        hours: standaloneAccessCodeMaximumDurationHours,
      })
    : undefined;

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
    const { outcome } = creation;
    return (
      <div
        className="rounded-xl outline-none"
        data-standalone-access-code-creation="created"
        ref={focusOnMount}
        tabIndex={-1}
      >
        <AdministrationAlert className="font-semibold" status="warning">
          This PIN is shown only once and cannot be retrieved later. Copy it
          somewhere safe before leaving this page.
        </AdministrationAlert>
        <div className="mt-6">
          <AccessCodeDigits code={outcome.pin} />
          <div className="mt-5">
            <AccessCodeCopyButton code={outcome.pin} />
          </div>
        </div>
        <dl className="mt-7 grid gap-x-6 gap-y-4 border-t border-navy-blue/10 pt-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-navy-blue/65">Access code</dt>
            <dd className="mt-0.5 font-medium">{outcome.name}</dd>
          </div>
          <div>
            <dt className="font-semibold text-navy-blue/65">Valid from</dt>
            <dd className="mt-0.5 font-medium">
              {formatStandaloneAccessCodeLocalDateTime(outcome.startsAt)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-navy-blue/65">Valid until</dt>
            <dd className="mt-0.5 font-medium">
              {formatStandaloneAccessCodeLocalDateTime(outcome.endsAt)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-navy-blue/65">Duration</dt>
            <dd className="mt-0.5 font-medium">
              {formatStandaloneAccessCodeDuration(
                standaloneAccessCodeElapsedHours(outcome) ??
                  standaloneAccessCodeMinimumDurationHours
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-6 border-t border-navy-blue/10 pt-5">
          <Button
            className="w-full sm:w-auto"
            onClick={startNewAttempt}
            type="button"
          >
            <Plus aria-hidden className="size-4" />
            Create another access code
          </Button>
        </div>
      </div>
    );
  }

  if (creation.kind === "already-created") {
    return (
      <div
        data-standalone-access-code-creation="already-created"
        ref={focusOnMount}
        tabIndex={-1}
      >
        <AdministrationAlert className="font-semibold" status="warning">
          This access code was already created. Its PIN was shown only once at
          creation and cannot be displayed again.
        </AdministrationAlert>
        <div className="mt-6 border-t border-navy-blue/10 pt-5">
          <Button
            className="w-full sm:w-auto"
            onClick={startNewAttempt}
            type="button"
          >
            <Plus aria-hidden className="size-4" />
            Create another access code
          </Button>
        </div>
      </div>
    );
  }

  if (creation.kind === "cleanup-confirm") {
    return (
      <div
        data-standalone-access-code-creation={creation.reason}
        ref={focusOnMount}
        tabIndex={-1}
      >
        <AdministrationAlert role="alert" status="warning">
          {creation.reason === "ambiguous"
            ? "The provider did not confirm whether this access code exists. This attempt is closed; it will not be retried automatically."
            : "A previous attempt for this window is still ambiguous. Its possible credential must be resolved at the lock before another code is created."}
        </AdministrationAlert>
        <p className="mt-5 text-sm leading-6 text-navy-blue/70">
          Before creating another code for this window, check the lock in the
          Igloohome app over Bluetooth and remove{" "}
          {`“${creation.cleanupTarget.name}”`} if it is there.
        </p>
        <CleanupConfirmationForm
          onConfirmed={() => confirmLockCleanup(creation.cleanupTarget)}
          onStartOver={startNewAttempt}
        />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form
        aria-label="Create an access code"
        data-standalone-access-code-creation="editing"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
      >
        <div className="grid gap-5">
          <FormField
            control={form.control}
            name="name"
            render={({ field: { onChange, ...field }, fieldState }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
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
              Access window ({WORKSPACE_SITE_TIME_ZONE})
            </legend>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startsAt"
                rules={{ deps: ["endsAt"] }}
                render={({ field: { onChange, ...field }, fieldState }) => (
                  <FormItem>
                    <FormLabel>Starts</FormLabel>
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
                    <FormLabel>Ends</FormLabel>
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

        {elapsedHours !== null &&
          isStandaloneAccessCodeWindowValid({ startsAt, endsAt }) && (
            <p aria-live="polite" className="mt-4 text-sm text-navy-blue/65">
              Duration: {formatStandaloneAccessCodeDuration(elapsedHours)}
            </p>
          )}

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
            {isExecuting ? "Creating…" : "Create access code"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function CleanupConfirmationForm({
  onConfirmed,
  onStartOver,
}: {
  readonly onConfirmed: () => void;
  readonly onStartOver: () => void;
}) {
  const cleanupForm = useForm<{
    providerCredentialRemoved: boolean;
  }>({
    defaultValues: { providerCredentialRemoved: false },
  });
  const cleanupConfirmed = useWatch({
    control: cleanupForm.control,
    name: "providerCredentialRemoved",
  });

  return (
    <Form {...cleanupForm}>
      <form
        aria-label="Confirm the lock is clean"
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
                <span>{standaloneAccessCodeCleanupConfirmationLabel}</span>
              </FormLabel>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="mt-6 flex flex-wrap gap-3 border-t border-navy-blue/10 pt-5">
          <Button disabled={!cleanupConfirmed} type="submit">
            <Plus aria-hidden className="size-4" />
            Create another access code
          </Button>
          <Button onClick={onStartOver} type="button" variant="secondary">
            Start over
          </Button>
        </div>
      </form>
    </Form>
  );
}
