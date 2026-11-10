import type { EmailMessage, EmailSentEvent } from "@deskohub/email";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Predicate, Record } from "effect";

/**
 * One kind of email a sender declares: its `category` tag and the metadata
 * tags it carries. Delivery reports find their handler by the category and
 * hand it the metadata decoded with the kind's schema.
 */
export interface EmailKind<Metadata> {
  readonly category: string;
  readonly metadata: StandardSchemaV1<unknown, Metadata>;
}

/**
 * The deployment that sent the email. A deployment ignores delivery reports
 * about another deployment's emails.
 */
export type EmailDeployment = {
  readonly deploymentEnvironment: string;
};

/** The provider tags of one email of `kind`. */
export const emailKindTags = <
  Metadata extends Readonly<Record<string, string>>,
>(
  kind: EmailKind<Metadata>,
  metadata: NoInfer<Metadata> & EmailDeployment
): Required<Pick<EmailMessage, "tags" | "metadata">> => ({
  tags: [kind.category],
  metadata,
});

/** The tag that names an email's kind. */
export const emailCategoryTag = "category";

/** The tag that names the deployment that sent an email. */
export const emailDeploymentTag =
  "deploymentEnvironment" satisfies keyof EmailDeployment;

/**
 * Of the tags an email was sent with, the ones a delivery report about it
 * needs: its category, its deployment, and the metadata its kind's schema
 * declares. Any other metadata, such as a recipient's name, is left out; an
 * email of none of `kinds`, or whose metadata its kind rejects, keeps only
 * its category and deployment.
 */
export const emailDeliveryReportTags = (
  kinds: readonly EmailKind<unknown>[],
  email: Pick<EmailSentEvent, "category" | "metadata">
): Record.ReadonlyRecord<string, string> => {
  const tags = Record.filter(email.metadata ?? {}, Predicate.isString);
  const kind = kinds.find(({ category }) => category === email.category);
  // A struct schema's output holds only the keys it declares.
  const declared = kind && decodeStandardSchema(kind.metadata, tags);
  const declaredKeys = Predicate.isObject(declared)
    ? Object.keys(declared)
    : [];
  return {
    ...(email.category !== undefined && { [emailCategoryTag]: email.category }),
    ...Record.filter(
      tags,
      (_, key) => key === emailDeploymentTag || declaredKeys.includes(key)
    ),
  };
};
