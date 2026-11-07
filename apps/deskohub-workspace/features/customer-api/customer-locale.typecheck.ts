import type { CustomerLocale } from "@deskohub/workspace-customer-api";
import type { Locale } from "@/features/i18n";

/**
 * The customer API names the Workspace's locales in its contract, so a
 * locale added to or removed from the Inlang project must change the
 * package too.
 */
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type AssertTrue<Value extends true> = Value;

export type EveryCustomerLocaleIsAWorkspaceLocale = AssertTrue<
  IsAssignable<CustomerLocale, Locale>
>;
export type EveryWorkspaceLocaleIsACustomerLocale = AssertTrue<
  IsAssignable<Locale, CustomerLocale>
>;
