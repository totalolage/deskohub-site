import "server-only";

import { Effect, Schema } from "effect";
import { ContactService } from "@/features/contact/backend/contact.service";
import type { ContactFormValues } from "@/features/contact/schemas/contact";
import {
  contactDefaultValues,
  createContactSchema,
} from "@/features/contact/schemas/contact";
import { type Locale, m } from "@/features/i18n";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";

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

const isContactField = (
  key: PropertyKey | undefined
): key is keyof ContactFormValues =>
  key !== undefined && Object.hasOwn(contactDefaultValues, key);

/** The first failed check per form field, keyed by the issue's top path. */
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

    const field = path[0];
    if (current._tag === "Filter" && isContactField(field)) {
      fieldErrors[field] ??= String(current);
    }
  };

  collect(issue);
  return fieldErrors;
};

export const processContactSubmission = Effect.fn("submitContactForm")(
  function* ({ locale, submittedValues }: SubmitContactFormInput) {
    const botProtection = yield* BotProtectionService;
    // Contact: a verified customer agent may write on the customer's behalf;
    // unverified bots stay rejected.
    yield* botProtection.verifyHuman({
      verificationFailurePolicy: "deny",
      verifiedBots: { allow: customerAgentNames },
      callSite: "contact.submit",
    });

    yield* Effect.annotateLogsScoped({ submittedValues, locale });
    yield* Effect.logInfo("Workspace contact form action received");

    const validation = yield* Schema.decodeUnknownEffect(
      createContactSchema(locale),
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
            message: m.automatedRequestRejected({}, { locale }),
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
