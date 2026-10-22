import { AlertTriangle, Check, ShieldAlert, X } from "lucide-react";
import { administrationAgentScope } from "@/features/account/agent-scopes";
import { AuthCard } from "@/features/account/components/auth-card";
import { CustomerAgentConsentActions } from "@/features/account/components/customer-agent-consent-actions";
import type {
  CustomerAgentConsentRedirect,
  CustomerAgentConsentScope,
} from "@/features/account/customer-agent-routes";
import { describeCustomerAgentScope } from "@/features/account/customer-agent-scope-copy";
import { type Locale, m } from "@/features/i18n";

/**
 * The consent step: which AI assistant asks, where its access goes, what it
 * will be able to do, what it never can, and the customer's Allow or Deny.
 * A redirect that stays on the customer's device gets a warning, since any app
 * there can claim to be the assistant. The client's logo is not shown, since
 * loading it would be a request to a host the assistant picks.
 * Allow grants exactly the listed scopes, plus administration when the page
 * offers it to an administrator.
 */
export function CustomerAgentConsent({
  locale,
  client,
  redirect,
  scopes,
  administration = false,
}: {
  readonly locale: Locale;
  readonly client: { readonly name: string; readonly host?: string };
  readonly redirect: CustomerAgentConsentRedirect;
  readonly scopes: ReadonlyArray<CustomerAgentConsentScope>;
  /** Whether the assistant asks an administrator for administration. */
  readonly administration?: boolean;
}) {
  const granted = administration
    ? [...scopes, administrationAgentScope]
    : scopes;
  return (
    <AuthCard>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-burned-orange">
        {m.customerAgentConsentEyebrow({}, { locale })}
      </p>
      <h1 className="mt-3 text-3xl text-navy-blue">
        {m.customerAgentConsentTitle({ client: client.name }, { locale })}
      </h1>
      {client.host && (
        <p className="mt-2 break-all text-sm text-navy-blue/68">
          {m.customerAgentConsentHost({ host: client.host }, { locale })}
        </p>
      )}
      {redirect.local ? (
        <p className="mt-4 flex items-start gap-2 break-words rounded-xl border border-sunset-yellow/45 bg-sunset-yellow/14 p-3 text-sm leading-6 text-navy-blue/80">
          <AlertTriangle
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 text-chilean-fire"
          />
          <span className="min-w-0">
            {m.customerAgentConsentLocalRedirect(
              { host: redirect.host, client: client.name },
              { locale }
            )}
          </span>
        </p>
      ) : (
        <p className="mt-1 break-all text-sm text-navy-blue/68">
          {m.customerAgentConsentRedirect({ host: redirect.host }, { locale })}
        </p>
      )}
      <h2 className="mt-8 text-sm font-semibold text-navy-blue">
        {m.customerAgentConsentCanTitle({}, { locale })}
      </h2>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-navy-blue/80">
        {scopes.map((scope) => (
          <li key={scope} className="flex gap-2">
            <Check
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-emerald-600"
            />
            {describeCustomerAgentScope(scope, locale)}
          </li>
        ))}
      </ul>
      <h2 className="mt-6 text-sm font-semibold text-navy-blue">
        {m.customerAgentConsentCannotTitle({}, { locale })}
      </h2>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-navy-blue/80">
        {(
          [
            ["pay", m.customerAgentConsentCannotPay],
            ["cancel", m.customerAgentConsentCannotCancel],
            ["change-account", m.customerAgentConsentCannotChangeAccount],
          ] as const
        ).map(([key, limit]) => (
          <li key={key} className="flex gap-2">
            <X
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-burned-orange"
            />
            {limit({}, { locale })}
          </li>
        ))}
      </ul>
      <p className="mt-6 rounded-xl border border-navy-blue/10 bg-navy-blue/[0.03] p-3 text-sm leading-6 text-navy-blue/80">
        {m.customerAgentConsentPaymentNote({}, { locale })}
      </p>
      {administration && (
        <section
          aria-labelledby="customer-agent-consent-administration"
          className="mt-6 rounded-xl border border-burned-orange/40 bg-burned-orange/[0.06] p-4"
        >
          <h2
            className="flex items-center gap-2 text-sm font-semibold text-navy-blue"
            id="customer-agent-consent-administration"
          >
            <ShieldAlert
              aria-hidden="true"
              className="size-4 shrink-0 text-burned-orange"
            />
            {m.customerAgentConsentAdministrationTitle({}, { locale })}
          </h2>
          <p className="mt-2 text-sm leading-6 text-navy-blue/80">
            {m.customerAgentConsentAdministrationBody({}, { locale })}
          </p>
          <p className="mt-2 text-sm leading-6 text-navy-blue/68">
            {m.customerAgentConsentAdministrationRevocation({}, { locale })}
          </p>
        </section>
      )}
      <CustomerAgentConsentActions
        locale={locale}
        clientName={client.name}
        scope={granted.join(" ")}
      />
    </AuthCard>
  );
}
