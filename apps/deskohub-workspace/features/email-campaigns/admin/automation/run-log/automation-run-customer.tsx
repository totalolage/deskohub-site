import type { AutomationRunSummary } from "@deskohub/workspace-admin-api";
import { AdministrationLink } from "@/features/administration/admin-link";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/** The admin page of a run's Dotypos customer. */
const automationRunCustomerHref = (run: AutomationRunSummary) =>
  `/admin/customers/${encodeURIComponent(run.customerId)}`;

/** Whether Dotypos couldn't be read for any of `runs`' customers. */
export const automationRunContactsUnavailable = (
  runs: readonly AutomationRunSummary[]
) => runs.some((run) => run.customerProfileStatus === "unavailable");

/** An email that wraps before its domain rather than mid-word. */
function EmailAddress({ email }: { readonly email: string }) {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

/**
 * A run's customer: the current name over the email, linking to the
 * customer. Without a name or email, the Dotypos ID, with a quiet note when
 * the profile wasn't found or couldn't be read; `showId` adds the ID under
 * a name too.
 */
export function AutomationRunCustomer({
  locale,
  run,
  showId = false,
}: {
  readonly locale: Locale;
  readonly run: AutomationRunSummary;
  readonly showId?: boolean;
}) {
  const title = run.customerName ?? run.customerEmail;
  if (run.customerProfileStatus !== "found" || title === null) {
    return (
      <div className="grid gap-0.5">
        <AdministrationLink
          className="w-fit font-mono text-xs underline underline-offset-4"
          href={automationRunCustomerHref(run)}
        >
          {run.customerId}
        </AdministrationLink>
        {run.customerProfileStatus !== "found" && (
          <span className="text-navy-blue/60 text-xs">
            {run.customerProfileStatus === "unavailable"
              ? m.emailAutomationRunsCustomerProfileUnavailable({}, { locale })
              : m.emailAutomationRunsCustomerProfileNotFound({}, { locale })}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="grid min-w-0 gap-0.5">
      <AdministrationLink
        className="w-fit font-semibold underline underline-offset-4"
        href={automationRunCustomerHref(run)}
      >
        {title}
      </AdministrationLink>
      {run.customerName !== null && run.customerEmail !== null && (
        <span className="break-words text-navy-blue/65 text-xs">
          <EmailAddress email={run.customerEmail} />
        </span>
      )}
      {showId && (
        <span className="font-mono text-navy-blue/60 text-xs">
          {run.customerId}
        </span>
      )}
    </div>
  );
}
