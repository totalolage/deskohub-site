import type { EmailDraft } from "@deskohub/workspace-admin-api";
import { useFormContext } from "react-hook-form";

/**
 * The values of the host's draft form: the encoded `EmailDraft`. The host
 * creates the form as
 * `useForm<EmailDraftFormValues, unknown, EmailDraft>({ resolver: effectSchemaResolver(EmailDraft) })`,
 * so saving validates only the draft shape; publication problems never block
 * it.
 */
export type EmailDraftFormValues = typeof EmailDraft.Encoded;

/** One block of the shared structure, as the draft holds it. */
export type EmailDraftComponent = NonNullable<
  EmailDraftFormValues["structure"]
>[number];

/** One block kind. */
export type EmailDraftComponentTag = EmailDraftComponent["_tag"];

/** One language's texts, as the draft holds them. */
export type EmailDraftTranslation = NonNullable<
  EmailDraftFormValues["translations"]
>[string];

/** A translated text: its inline parts. */
export type EmailDraftInlineParts = NonNullable<
  EmailDraftTranslation["subject"]
>;

/** One inline part of a translated text. */
export type EmailDraftInlinePart = EmailDraftInlineParts[number];

/** One named value definition, as the draft holds it. */
export type EmailDraftValueDefinition = NonNullable<
  EmailDraftFormValues["values"]
>[number];

/** A value definition's source settings. */
export type EmailDraftValueSource = NonNullable<
  EmailDraftValueDefinition["source"]
>;

/** One level of a text list. */
export type EmailDraftTextListItems = NonNullable<EmailDraftComponent["items"]>;

/** The translated fields every language has besides block texts. */
export type EmailTranslationField =
  | "subject"
  | "preheader"
  | "operationalReason";

/** The host's draft form, typed for the editor's field components. */
export const useEmailDraftForm = () =>
  useFormContext<EmailDraftFormValues, unknown, EmailDraft>();

/**
 * A fresh identifier for a block, a translated text, a link destination or a
 * list item. Identifiers only need to be unique within one email; a random
 * suffix keeps blocks added in parallel editing sessions apart. Works on
 * plain http too, such as a development server reached over the network.
 */
export const newEmailEditorKey = (prefix: string): string =>
  // `crypto.randomUUID` exists only in secure contexts; random values don't.
  `${prefix}-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
