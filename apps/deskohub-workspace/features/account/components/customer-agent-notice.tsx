import Link from "next/link";
import { AuthCard } from "@/features/account/components/auth-card";
import { getAccountPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

/** Why the connect or consent step can't continue. */
export type CustomerAgentNoticeKind =
  | "unknown-request"
  | "expired"
  | "unavailable"
  | "deletion-pending"
  /** The assistant asks only for administration, which the account lacks. */
  | "administration-only";

/**
 * The card the AI assistant connect and consent steps show instead of
 * continuing.
 */
export function CustomerAgentNotice({
  locale,
  notice,
}: {
  readonly locale: Locale;
  readonly notice: CustomerAgentNoticeKind;
}) {
  const copy = {
    "unknown-request": {
      title: m.customerAgentUnknownRequestTitle,
      body: m.customerAgentUnknownRequestBody,
    },
    expired: {
      title: m.customerAgentExpiredRequestTitle,
      body: m.customerAgentExpiredRequestBody,
    },
    unavailable: {
      title: m.customerAgentUnavailableTitle,
      body: m.customerAgentUnavailableBody,
    },
    "deletion-pending": {
      title: m.customerAgentDeletionPendingTitle,
      body: m.customerAgentDeletionPendingBody,
    },
    "administration-only": {
      title: m.customerAgentAdministrationOnlyTitle,
      body: m.customerAgentAdministrationOnlyBody,
    },
  }[notice];

  return (
    <AuthCard>
      <h1 className="text-3xl text-navy-blue">{copy.title({}, { locale })}</h1>
      <p className="mt-4 leading-7 text-navy-blue/68">
        {copy.body({}, { locale })}
      </p>
      {notice === "deletion-pending" && (
        <Button asChild className="mt-8">
          <Link href={getAccountPath(locale)} prefetch={false}>
            {m.customerAgentDeletionPendingAction({}, { locale })}
          </Link>
        </Button>
      )}
    </AuthCard>
  );
}
