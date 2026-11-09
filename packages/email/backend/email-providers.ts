import { Context } from "effect";
import type { EmailMessage } from "../types/email.types";
import type { EmailProvider } from "./capabilities";

/**
 * The stream a message belongs to. Marketing mail, such as campaigns, may
 * use providers that transactional mail must never reach.
 */
export type EmailStream = "transactional" | "marketing";

/**
 * The ordered providers each stream tries for a message. A message moves to
 * the next provider only after a provider-level failure; an empty chain sends
 * through the internal Console provider. Categories in `marketingCategories`
 * are marketing, every other message is transactional.
 */
export interface EmailProviderChains {
  readonly transactional: ReadonlyArray<EmailProvider>;
  readonly marketing: ReadonlyArray<EmailProvider>;
  readonly marketingCategories: ReadonlySet<string>;
}

/** The app's provider chains; each app composes its own, there is no default. */
export class EmailProviders extends Context.Service<
  EmailProviders,
  EmailProviderChains
>()("EmailProviders") {}

/** A message's category is its first tag. */
export const emailCategoryOf = (message: Pick<EmailMessage, "tags">) =>
  message.tags?.[0];

export const emailStreamOf = (
  message: Pick<EmailMessage, "tags">,
  marketingCategories: ReadonlySet<string>
): EmailStream => {
  const category = emailCategoryOf(message);
  return category !== undefined && marketingCategories.has(category)
    ? "marketing"
    : "transactional";
};
