import "server-only";

import { Effect, Schema } from "effect";
import { ContactService } from "@/features/contact/backend/contact.service";
import type { ContactFormValues } from "@/features/contact/schemas/contact";
import { getContactSchema } from "@/features/contact/schemas/contact";
import { type Locale, m } from "@/features/i18n";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";

export type { ContactFormValues } from "@/features/contact/schemas/contact";

export type ContactFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof ContactFormValues, string>>;
  values?: ContactFormValues;
};

interface SubmitContactFormInput {
  readonly locale: Locale;
  readonly submittedValues: ContactFormValues;
}

const getContactFieldErrors = (issue: Schema.SchemaError["issue"]) => {
  const fieldErrors: ContactFormState["fieldErrors"] = {};

  const collect = (
    current: Schema.SchemaError["issue"],
    path: readonly PropertyKey[] = []
  ): void => {
    if (current._tag === "Pointer") {
      collect(current.issue, [...path, ...current.path]);
      return;
    }

    if (current._tag === "Composite") {
      for (const nested of current.issues) collect(nested, path);
      return;
    }

    if (current._tag !== "Filter") return;

    switch (path[0]) {
      case "name":
        fieldErrors.name ??= String(current);
        break;
      case "email":
        fieldErrors.email ??= String(current);
        break;
      case "phone":
        fieldErrors.phone ??= String(current);
        break;
      case "message":
        fieldErrors.message ??= String(current);
        break;
    }
  };

  collect(issue);
  return fieldErrors;
};

export const processContactSubmission = Effect.fn("submitContactForm")(
  function* ({ locale, submittedValues }: SubmitContactFormInput) {
    const botProtection = yield* BotProtectionService;
    yield* botProtection.verifyHuman({ verificationFailurePolicy: "deny" });

    yield* Effect.annotateLogsScoped({ submittedValues, locale });
    yield* Effect.logInfo("Workspace contact form action received");

    const validation = yield* Schema.decodeUnknownEffect(
      getContactSchema(locale),
      { errors: "all" }
    )(submittedValues).pipe(
      Effect.map((value) => ({ _tag: "Valid" as const, value })),
      Effect.catchTag("SchemaError", (error) =>
        Effect.succeed({ _tag: "Invalid" as const, error })
      )
    );

    if (validation._tag === "Invalid") {
      const fieldErrors = getContactFieldErrors(validation.error.issue);
      yield* Effect.logWarning("Workspace contact form validation failed", {
        fieldErrors,
      });

      return {
        status: "error" as const,
        message: m.contactValidationReviewMessage({}, { locale }),
        values: submittedValues,
        fieldErrors,
      };
    }

    yield* Effect.logInfo("Workspace contact form validation passed");

    const service = yield* ContactService;
    yield* service.submit(validation.value, locale);
    yield* Effect.logInfo("Workspace contact form submit completed");

    return {
      status: "success" as const,
      message: m.contactSuccessMessage({}, { locale }),
    };
  },
  (effect, { locale, submittedValues }) =>
    effect.pipe(
      Effect.scoped,
      Effect.catchTag("BotDetectedError", (error) =>
        Effect.logWarning("Workspace contact form bot rejected", {
          error,
        }).pipe(
          Effect.as({
            status: "error" as const,
            message: m.contactRateLimitMessage({}, { locale }),
            values: submittedValues,
          })
        )
      ),
      Effect.catch((error) =>
        Effect.logError("Workspace contact form submission failed", {
          error,
          submittedValues,
        }).pipe(
          Effect.as({
            status: "error" as const,
            message: m.contactEmailSendError({}, { locale }),
            values: submittedValues,
          })
        )
      )
    )
);
