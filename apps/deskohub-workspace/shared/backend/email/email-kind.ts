import type { EmailMessage } from "@deskohub/email";
import type { StandardSchemaV1 } from "@standard-schema/spec";

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
