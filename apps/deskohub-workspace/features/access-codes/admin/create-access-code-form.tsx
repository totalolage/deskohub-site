"use client";

import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import { Plus } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  AccessCodeCopyButton,
  AccessCodeDigits,
} from "@/features/access-codes/components/access-code-digits";
import { AdministrationAlert } from "@/features/administration/notice";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { createStandaloneAccessCode } from "./actions";
import {
  type CreateStandaloneAccessCodeResult,
  createStandaloneAccessCodeAttemptId,
  formatStandaloneAccessCodeDuration,
  formatStandaloneAccessCodeLocalDateTime,
  isSameStandaloneAccessCodeWindow,
  isStandaloneAccessCodeLocalDateTime,
  isStandaloneAccessCodeWindowValid,
  type StandaloneAccessCodeFormFieldErrors,
  type StandaloneAccessCodeWindowValues,
  shiftStandaloneAccessCodeLocalEnd,
  standaloneAccessCodeCleanupConfirmationLabel,
  standaloneAccessCodeEarliestLocalEnd,
  standaloneAccessCodeElapsedHours,
  standaloneAccessCodeFailureNotices,
  standaloneAccessCodeMaximumDurationHours,
  standaloneAccessCodeMinimumDurationHours,
  validateStandaloneAccessCodeForm,
} from "./create-access-code";

type CreatedOutcome = Extract<
  CreateStandaloneAccessCodeResult,
  { outcome: "created" }
>;

type CreationState =
  | { readonly kind: "editing" }
  | { readonly kind: "created"; readonly outcome: CreatedOutcome }
  | { readonly kind: "already-created" }
  | {
      readonly kind: "cleanup-confirm";
      readonly reason: "ambiguous" | "cleanup-required";
      readonly name: string;
    };

interface WindowPreview {
  readonly startsAt: string;
  readonly endsAt: string;
}

const readStandaloneAccessCodeFormValues = (
  form: HTMLFormElement
): StandaloneAccessCodeWindowValues => {
  const fields = new FormData(form);
  return {
    name: (fields.get("name")?.toString() ?? "").trim(),
    startsAt: fields.get("startsAt")?.toString() ?? "",
    endsAt: fields.get("endsAt")?.toString() ?? "",
  };
};

export function CreateStandaloneAccessCodeForm() {
  const [creation, setCreation] = useState<CreationState>({ kind: "editing" });
  const [cleanupConfirmed, setCleanupConfirmed] = useState(false);
  const [fieldErrors, setFieldErrors] =
    useState<StandaloneAccessCodeFormFieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [windowPreview, setWindowPreview] = useState<WindowPreview>({
    startsAt: "",
    endsAt: "",
  });
  const attemptIdRef = useRef(createStandaloneAccessCodeAttemptId());
  const attemptInputRef = useRef<StandaloneAccessCodeWindowValues | null>(null);
  const cleanupConfirmedWindowRef =
    useRef<StandaloneAccessCodeWindowValues | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const startsAtInputRef = useRef<HTMLInputElement>(null);
  const endsAtInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const focusNameAfterEditRemountRef = useRef(false);
  const nameId = useId();
  const startsAtId = useId();
  const endsAtId = useId();

  // React's synthetic change events are unavailable in the component test
  // environment, so the window preview listens to native input events.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const syncWindow = (event: Event) => {
      const input = event.target;
      if (
        !(input instanceof HTMLInputElement) ||
        (input.name !== "name" &&
          input.name !== "startsAt" &&
          input.name !== "endsAt")
      ) {
        return;
      }
      const { name, value } = input;
      if (name === "startsAt" || name === "endsAt") {
        setWindowPreview((previous) => ({ ...previous, [name]: value }));
      }
      if (name === "startsAt") {
        setFieldErrors((previous) => ({
          ...previous,
          startsAt: undefined,
          endsAt: undefined,
        }));
        return;
      }
      setFieldErrors((previous) => ({ ...previous, [name]: undefined }));
    };
    form.addEventListener("input", syncWindow);
    form.addEventListener("change", syncWindow);
    return () => {
      form.removeEventListener("input", syncWindow);
      form.removeEventListener("change", syncWindow);
    };
  }, []);

  useEffect(() => {
    if (creation.kind === "editing") {
      if (focusNameAfterEditRemountRef.current) {
        focusNameAfterEditRemountRef.current = false;
        nameInputRef.current?.focus();
      }
      return;
    }
    resultRef.current?.focus();
  }, [creation]);

  const { execute, isExecuting } = useWorkspaceAction(
    createStandaloneAccessCode,
    {
      actionName: "createStandaloneAccessCode",
      onSuccess: ({ data }) => {
        cleanupConfirmedWindowRef.current = null;
        if (!data) return;
        if (data.outcome === "created") {
          setNotice(null);
          setCreation({ kind: "created", outcome: data });
          return;
        }
        if (data.outcome === "already-created") {
          setNotice(null);
          setCreation({ kind: "already-created" });
          return;
        }
        if (data.kind === "rejected") {
          attemptInputRef.current = null;
          setNotice(standaloneAccessCodeFailureNotices.rejected);
          return;
        }
        if (data.kind === "ambiguous" || data.kind === "cleanup-required") {
          setCreation({
            kind: "cleanup-confirm",
            reason: data.kind,
            name: attemptInputRef.current?.name ?? "",
          });
          return;
        }
        setNotice(standaloneAccessCodeFailureNotices[data.kind]);
      },
      onError: ({ error }) => {
        cleanupConfirmedWindowRef.current = null;
        setNotice(
          error.serverError ??
            "The access code could not be created. Try again."
        );
      },
      onTransportError: () => {
        cleanupConfirmedWindowRef.current = null;
        setNotice(
          "The server could not be reached. This attempt is kept, so you can safely try again."
        );
      },
    }
  );

  const elapsedHours = standaloneAccessCodeElapsedHours({
    startsAt: windowPreview.startsAt,
    endsAt: windowPreview.endsAt,
  });
  const endMin = isStandaloneAccessCodeLocalDateTime(windowPreview.startsAt)
    ? standaloneAccessCodeEarliestLocalEnd(windowPreview.startsAt)
    : undefined;
  const endMax = isStandaloneAccessCodeLocalDateTime(windowPreview.startsAt)
    ? shiftStandaloneAccessCodeLocalEnd({
        startsAt: windowPreview.startsAt,
        hours: standaloneAccessCodeMaximumDurationHours,
      })
    : undefined;

  const focusFirstInvalidField = (
    errors: StandaloneAccessCodeFormFieldErrors
  ) => {
    if (errors.name) {
      nameInputRef.current?.focus();
    } else if (errors.startsAt) {
      startsAtInputRef.current?.focus();
    } else if (errors.endsAt) {
      endsAtInputRef.current?.focus();
    }
  };

  const resetForm = () => {
    setWindowPreview({ startsAt: "", endsAt: "" });
    setFieldErrors({});
    setNotice(null);
    attemptInputRef.current = null;
    attemptIdRef.current = createStandaloneAccessCodeAttemptId();
    focusNameAfterEditRemountRef.current = true;
    setCreation({ kind: "editing" });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);
    const values = readStandaloneAccessCodeFormValues(event.currentTarget);
    const errors = validateStandaloneAccessCodeForm(values);
    setFieldErrors(errors);
    if (errors.name || errors.startsAt || errors.endsAt) {
      focusFirstInvalidField(errors);
      return;
    }
    setWindowPreview({
      startsAt: values.startsAt,
      endsAt: values.endsAt,
    });

    const bound = attemptInputRef.current;
    if (!bound || !isSameStandaloneAccessCodeWindow(bound, values)) {
      // A changed window is a new intent: it must never reuse the attempt id.
      attemptIdRef.current = createStandaloneAccessCodeAttemptId();
      attemptInputRef.current = values;
      cleanupConfirmedWindowRef.current = null;
    }
    const cleanupConfirmed =
      cleanupConfirmedWindowRef.current !== null &&
      isSameStandaloneAccessCodeWindow(
        cleanupConfirmedWindowRef.current,
        values
      );
    cleanupConfirmedWindowRef.current = null;
    execute({
      attemptId: attemptIdRef.current,
      ...values,
      ...(cleanupConfirmed && { providerCredentialRemoved: true as const }),
    });
  };

  const confirmLockCleanup = () => {
    if (!attemptInputRef.current) return;
    cleanupConfirmedWindowRef.current = attemptInputRef.current;
    setWindowPreview({ startsAt: "", endsAt: "" });
    setFieldErrors({});
    setNotice(null);
    attemptIdRef.current = createStandaloneAccessCodeAttemptId();
    focusNameAfterEditRemountRef.current = true;
    setCreation({ kind: "editing" });
  };

  const fieldError = (
    field: keyof StandaloneAccessCodeFormFieldErrors,
    fieldId: string
  ) => {
    const message = fieldErrors[field];
    if (!message) return null;
    return (
      <p
        className="mt-2 text-sm font-semibold text-burned-orange-ink"
        id={`${fieldId}-error`}
      >
        {message}
      </p>
    );
  };

  if (creation.kind === "created") {
    const { outcome } = creation;
    return (
      <div
        className="rounded-xl outline-none"
        data-standalone-access-code-creation="created"
        ref={resultRef}
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
            onClick={resetForm}
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
        ref={resultRef}
        tabIndex={-1}
      >
        <AdministrationAlert className="font-semibold" status="warning">
          This access code was already created. Its PIN was shown only once at
          creation and cannot be displayed again.
        </AdministrationAlert>
        <div className="mt-6 border-t border-navy-blue/10 pt-5">
          <Button
            className="w-full sm:w-auto"
            onClick={resetForm}
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
        ref={resultRef}
        tabIndex={-1}
      >
        <AdministrationAlert role="alert" status="warning">
          {creation.reason === "ambiguous"
            ? "The provider did not confirm whether this access code exists. This attempt is closed; it will not be retried automatically."
            : "A previous attempt for this window is still ambiguous. Its possible credential must be resolved at the lock before another code is created."}
        </AdministrationAlert>
        <p className="mt-5 text-sm leading-6 text-navy-blue/70">
          Before creating another code for this window, check the lock in the
          Igloohome app over Bluetooth and remove “{creation.name}” if it is
          there.
        </p>
        <form
          aria-label="Confirm the lock is clean"
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!cleanupConfirmed) return;
            confirmLockCleanup();
          }}
        >
          <label className="flex items-start gap-3 text-sm leading-6 text-navy-blue">
            <input
              checked={cleanupConfirmed}
              name="providerCredentialRemoved"
              onChange={(event) => setCleanupConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>{standaloneAccessCodeCleanupConfirmationLabel}</span>
          </label>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-navy-blue/10 pt-5">
            <Button disabled={!cleanupConfirmed} type="submit">
              <Plus aria-hidden className="size-4" />
              Create another access code
            </Button>
            <Button
              onClick={() => {
                setCleanupConfirmed(false);
                resetForm();
              }}
              type="button"
              variant="secondary"
            >
              Start over
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <form
      aria-label="Create an access code"
      data-standalone-access-code-creation="editing"
      noValidate
      onSubmit={submit}
      ref={formRef}
    >
      <div className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
            aria-invalid={fieldErrors.name ? true : undefined}
            id={nameId}
            maxLength={60}
            name="name"
            ref={nameInputRef}
            required
          />
          {fieldError("name", nameId)}
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-navy-blue">
            Access window ({WORKSPACE_SITE_TIME_ZONE})
          </legend>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={startsAtId}>Starts</Label>
              <Input
                aria-describedby={
                  fieldErrors.startsAt ? `${startsAtId}-error` : undefined
                }
                aria-invalid={fieldErrors.startsAt ? true : undefined}
                id={startsAtId}
                name="startsAt"
                ref={startsAtInputRef}
                required
                step={3600}
                type="datetime-local"
              />
              {fieldError("startsAt", startsAtId)}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={endsAtId}>Ends</Label>
              <Input
                aria-describedby={
                  fieldErrors.endsAt ? `${endsAtId}-error` : undefined
                }
                aria-invalid={fieldErrors.endsAt ? true : undefined}
                id={endsAtId}
                max={endMax}
                min={endMin}
                name="endsAt"
                ref={endsAtInputRef}
                required
                step={3600}
                type="datetime-local"
              />
              {fieldError("endsAt", endsAtId)}
            </div>
          </div>
        </fieldset>
      </div>

      {elapsedHours !== null &&
        isStandaloneAccessCodeWindowValid({
          startsAt: windowPreview.startsAt,
          endsAt: windowPreview.endsAt,
        }) && (
          <p className="mt-4 text-sm text-navy-blue/65" aria-live="polite">
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
  );
}
