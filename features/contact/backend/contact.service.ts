import { Context, Effect, Layer } from "effect";
import { StorageError } from "@/shared/backend/errors";

export interface ContactSubmission {
  name: string;
  email: string;
  phone?: string;
  message: string;
  submittedAt: string;
}

export interface ContactService {
  readonly submit: (
    data: Omit<ContactSubmission, "submittedAt">
  ) => Effect.Effect<ContactSubmission, StorageError>;
}

export const ContactService =
  Context.GenericTag<ContactService>("ContactService");

export const ContactServiceLive = Layer.succeed(
  ContactService,
  ContactService.of({
    submit: (data) =>
      Effect.gen(function* () {
        // Log the contact form submission
        const submission: ContactSubmission = {
          ...data,
          submittedAt: new Date().toISOString(),
        };

        // Simulate processing time
        yield* Effect.sleep("1 second");

        // In production, this would send an email or save to a database
        // For now, we just return the submission
        return submission;
      }).pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            new StorageError({
              message: `Failed to submit contact form: ${error}`,
              operation: "contact.submit",
            })
          )
        )
      ),
  })
);
