import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthPageShell } from "@/features/account/components/auth-card";
import { CustomerAgentNotice } from "@/features/account/components/customer-agent-notice";
import { readCustomerAgentSession } from "@/features/account/components/customer-agent-session.server";
import { resolveCustomerAgentConnectStep } from "@/features/account/customer-agent-routes";
import { getAccountSignInPath } from "@/features/account/routes";
import { m } from "@/features/i18n";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  type SearchParamsRecord,
  toURLSearchParams,
} from "@/shared/utils/search-params";

// Blocking, so every outcome but a notice is an HTTP redirect.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.customerAgentConnectMetadataTitle({}, { locale }),
    description: m.customerAgentConnectMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

/**
 * The OAuth server's sign-in step for connecting an AI assistant. A signed-in
 * customer continues to the authorization request, and from there to consent;
 * anyone else signs in first and comes back here.
 */
export default async function CustomerAgentConnectPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  await connection();
  return runWithRequestLocale(async (locale) => {
    const [session, query] = await Promise.all([
      readCustomerAgentSession("account.agent-connect"),
      searchParams,
    ]);
    if (session === "deletion-pending" || session === "unavailable") {
      return (
        <AuthPageShell>
          <CustomerAgentNotice locale={locale} notice={session} />
        </AuthPageShell>
      );
    }

    const step = resolveCustomerAgentConnectStep({
      connectPath: getLocalizedPagePath(locale, "/[locale]/auth/connect"),
      query: toURLSearchParams(query),
      signedIn: session === "signed-in",
    });
    if (step.step === "sign-in") {
      redirect(getAccountSignInPath(locale, step.returnTo, "assistant"));
    }
    if (step.step === "authorize") redirect(step.location);

    return (
      <AuthPageShell>
        <CustomerAgentNotice locale={locale} notice="unknown-request" />
      </AuthPageShell>
    );
  });
}
