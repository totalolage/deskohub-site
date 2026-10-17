import Interpolate from "@doist/react-interpolate";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { Suspense } from "react";
import {
  AdministrationAlert,
  AdministrationPage,
  AdministrationPageHeader,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { AdministrationPanelLoading } from "@/features/administration/loading";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { ApproveCliAuthenticationForm } from "./approve-cli-authentication-form";
import { loadCliAuthenticationApproval } from "./page-data.server";

type CliAuthenticationSearchParams = Promise<{
  readonly code?: string;
  readonly result?: string;
}>;

/** The `dhw auth` approval screen. Only the locale is awaited before the frame. */
export async function CliAuthenticationScreen({
  searchParams,
}: {
  readonly searchParams: CliAuthenticationSearchParams;
}) {
  const locale = await getRequestLocale();
  return (
    <AdministrationPage className="max-w-4xl">
      <AdministrationPageHeader
        description={m.adminCliAuthenticateDescription({}, { locale })}
        eyebrow={m.adminCliAuthenticateEyebrow({}, { locale })}
        title={m.adminCliAuthenticateTitle({}, { locale })}
      />
      <Suspense
        fallback={
          <AdministrationPanelLoading
            label={m.adminCliAuthenticateLoading({}, { locale })}
          />
        }
      >
        <CliAuthenticationRequest locale={locale} searchParams={searchParams} />
      </Suspense>
    </AdministrationPage>
  );
}

export async function CliAuthenticationRequest({
  locale,
  searchParams,
}: {
  readonly locale: Locale;
  readonly searchParams: CliAuthenticationSearchParams;
}) {
  const params = await searchParams;
  const approval = await loadCliAuthenticationApproval(params.code);

  if (!approval?.request) {
    return (
      <AuthenticationMessage
        description={m.adminCliAuthenticateRestartDescription({}, { locale })}
        icon={ShieldAlert}
        title={m.adminCliAuthenticateInvalidTitle({}, { locale })}
      />
    );
  }

  const { request, administratorEmail } = approval;

  return (
    <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
      <dl className="grid divide-y divide-navy-blue/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <AuthenticationDetail
          label={m.adminCliAuthenticateClientLabel({}, { locale })}
          value={request.clientName}
        />
        <AuthenticationDetail
          label={m.adminCliAuthenticateBuildLabel({}, { locale })}
          value={`${request.cliVersion} · ${request.buildTarget}`}
        />
      </dl>
      <div className="border-t border-navy-blue/10 px-5 py-5 sm:px-6">
        <AuthenticationRequestState
          code={params.code}
          failed={params.result === "error"}
          locale={locale}
          request={request}
          administratorEmail={administratorEmail}
        />
      </div>
    </div>
  );
}

function AuthenticationRequestState({
  code,
  failed,
  locale,
  request,
  administratorEmail,
}: {
  readonly code?: string;
  readonly failed: boolean;
  readonly locale: Locale;
  readonly request: NonNullable<
    NonNullable<
      Awaited<ReturnType<typeof loadCliAuthenticationApproval>>
    >["request"]
  >;
  readonly administratorEmail: string;
}) {
  if (request.state === "pending") {
    return (
      <>
        <AdministrationAlert className="mb-5" status="warning">
          <p>
            <Interpolate
              string={m.adminCliAuthenticateRequestExpiresAt({}, { locale })}
              mapping={{
                expiresAt: (
                  <strong>
                    {formatAdministrationDateTime(request.expiresAt, locale)}
                  </strong>
                ),
              }}
            />{" "}
            {m.adminCliAuthenticateApproveOnlyOwnRequest({}, { locale })}{" "}
            <Interpolate
              string={m.adminCliAuthenticateApprovingAs({}, { locale })}
              mapping={{ email: <strong>{administratorEmail}</strong> }}
            />
          </p>
        </AdministrationAlert>
        {failed && (
          <AdministrationAlert className="mb-5" status="error">
            <p>{m.adminCliAuthenticateApprovalFailed({}, { locale })}</p>
          </AdministrationAlert>
        )}
        <ApproveCliAuthenticationForm code={code} />
      </>
    );
  }

  if (request.state === "approved") {
    return (
      <AuthenticationMessage
        compact
        description={m.adminCliAuthenticateApprovedDescription({}, { locale })}
        icon={CheckCircle2}
        title={m.adminCliAuthenticateApprovedTitle({}, { locale })}
      />
    );
  }

  if (request.state === "granted") {
    return (
      <AuthenticationMessage
        compact
        description={m.adminCliAuthenticateGrantedDescription({}, { locale })}
        icon={CheckCircle2}
        title={m.adminCliAuthenticateGrantedTitle({}, { locale })}
      />
    );
  }

  return (
    <AuthenticationMessage
      compact
      description={m.adminCliAuthenticateRestartDescription({}, { locale })}
      icon={ShieldAlert}
      title={
        request.state === "revoked"
          ? m.adminCliAuthenticateRevokedTitle({}, { locale })
          : m.adminCliAuthenticateExpiredTitle({}, { locale })
      }
    />
  );
}

function AuthenticationDetail({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/60">
        {label}
      </dt>
      <dd className="mt-2 font-semibold">{value}</dd>
    </div>
  );
}

function AuthenticationMessage({
  compact = false,
  description,
  icon: Icon,
  title,
}: {
  readonly compact?: boolean;
  readonly description: string;
  readonly icon: typeof CheckCircle2;
  readonly title: string;
}) {
  return (
    <div
      className={
        compact
          ? "flex items-start gap-3"
          : "rounded-xl border border-navy-blue/10 bg-white p-6"
      }
    >
      <Icon aria-hidden className="mt-0.5 size-6 shrink-0 text-burned-orange" />
      <div>
        <h2 className="text-xl">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-navy-blue/65">
          {description}
        </p>
      </div>
    </div>
  );
}
