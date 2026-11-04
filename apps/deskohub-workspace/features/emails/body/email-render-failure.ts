import type { EmailValueName } from "@deskohub/workspace-admin-api";
import { Data } from "effect";

/** The email has no translation for the requested Workspace language. */
export class EmailLanguageMissing extends Data.TaggedError(
  "EmailLanguageMissing"
)<{ readonly locale: string }> {}

/** The email shows a value the caller supplied no snapshot for. */
export class EmailValueMissing extends Data.TaggedError("EmailValueMissing")<{
  readonly name: EmailValueName;
}> {}

/** A value's snapshot doesn't have the shape the email shows it in. */
export class EmailValueMismatch extends Data.TaggedError("EmailValueMismatch")<{
  readonly name: EmailValueName;
}> {}

/** Why one language of an email couldn't render from the given values. */
export type EmailRenderFailure =
  | EmailLanguageMissing
  | EmailValueMissing
  | EmailValueMismatch;
