import { Effect, Option } from "effect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CustomerAgentClientDirectory } from "@/features/account/backend/auth/customer-agent-client-directory.service";
import { AuthPageShell } from "@/features/account/components/auth-card";
import { CustomerAgentConsent } from "@/features/account/components/customer-agent-consent";
import { CustomerAgentNotice } from "@/features/account/components/customer-agent-notice";
import { readCustomerAgentSession } from "@/features/account/components/customer-agent-session.server";
import {
  type CustomerAgentConsentRequest,
  readCustomerAgentConsentRequest,
} from "@/features/account/customer-agent-routes";
import { getAccountSignInPath } from "@/features/account/routes";
import { currentAdministratorAccess } from "@/features/administrators/backend/current-administrator";
import { administratorAccessLayer } from "@/features/administrators/server/administrator-access-layer.server";
import { type Locale, m } from "@/features/i18n";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";
import {
  type SearchParamsRecord,
  toURLSearchParams,
} from "@/shared/utils/search-params";
import { resolveCustomerAgentConsentOutcome } from "./customer-agent-consent-outcome";

type PendingCustomerAgentConsentRequest = Extract<
  CustomerAgentConsentRequest,
  { readonly status: "pending" }
>;

// Blocking, so sending a signed-out customer to sign in is an HTTP redirect.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.customerAgentConsentMetadataTitle({}, { locale }),
    description: m.customerAgentConsentMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

/**
 * Whether the signed-in account holds the administrator grant now, read only
 * when the assistant asks for administration.
 */
const readAdministrator = (requested: boolean) =>
  requested
    ? currentAdministratorAccess.pipe(
        Effect.map(({ kind }) => kind === "administrator"),
        Effect.provide(administratorAccessLayer),
        runWorkspaceEffectOrElse("account.agent-consent.administrator", {
          boundary: "page",
          failureCode: "customer_agent_administrator_unavailable",
          orElse: () => "unavailable" as const,
        })
      )
    : Promise.resolve(false);

/** The agent's client the request names, read for the signed-in customer. */
const readConsentClient = (clientId: string) =>
  Effect.flatMap(CustomerAgentClientDirectory, (directory) =>
    directory.find(clientId)
  ).pipe(
    Effect.provide(CustomerAgentClientDirectory.Default),
    Effect.map(Option.getOrUndefined),
    runWorkspaceEffectOrElse("account.agent-consent.client", {
      boundary: "page",
      failureCode: "customer_agent_client_unavailable",
      orElse: () => "unavailable" as const,
    })
  );

/** The signed-in customer's decision on a pending request, or why not. */
const renderConsentDecision = async (
  locale: Locale,
  request: PendingCustomerAgentConsentRequest
) => {
  const [client, administrator] = await Promise.all([
    readConsentClient(request.clientId),
    readAdministrator(request.administration),
  ]);
  const outcome = resolveCustomerAgentConsentOutcome({
    request,
    client,
    administrator,
  });
  return (
    <AuthPageShell>
      {"notice" in outcome ? (
        <CustomerAgentNotice locale={locale} notice={outcome.notice} />
      ) : (
        <CustomerAgentConsent
          locale={locale}
          client={outcome.client}
          redirect={request.redirect}
          scopes={request.scopes}
          administration={outcome.administration}
        />
      )}
    </AuthPageShell>
  );
};

/**
 * The OAuth server's consent step: the signed-in customer decides whether an
 * AI assistant may act for their account. A signed-out customer signs in and
 * comes back to the same signed request while it is still valid. Only an
 * administrator is asked about the administration scope; for anyone else
 * the page leaves it out of what Allow grants.
 */
export default async function CustomerAgentConsentPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  await connection();
  return runWithRequestLocale(async (locale) => {
    const [session, record] = await Promise.all([
      readCustomerAgentSession("account.agent-consent"),
      searchParams,
    ]);
    const query = toURLSearchParams(record);
    // A request that can't succeed isn't worth signing in for.
    const request = readCustomerAgentConsentRequest(query, Date.now());
    if (request.status !== "pending") {
      return (
        <AuthPageShell>
          <CustomerAgentNotice locale={locale} notice={request.status} />
        </AuthPageShell>
      );
    }
    if (session === "signed-out") {
      const consentPath = getLocalizedPagePath(
        locale,
        "/[locale]/auth/consent"
      );
      redirect(
        getAccountSignInPath(locale, `${consentPath}?${query}`, "assistant")
      );
    }
    if (session !== "signed-in") {
      return (
        <AuthPageShell>
          <CustomerAgentNotice locale={locale} notice={session} />
        </AuthPageShell>
      );
    }
    return renderConsentDecision(locale, request);
  });
}
