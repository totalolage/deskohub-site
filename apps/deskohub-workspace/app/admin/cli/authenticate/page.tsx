import { CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import { approveCliAuthentication } from "@/features/admin-cli/actions";
import { loadCliAuthenticationApproval } from "@/features/admin-cli/page-data.server";
import {
  AdministrationPage,
  AdministrationPageHeader,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { Button } from "@/shared/components/ui/button";

export default async function CliAuthenticationApprovalPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly code?: string;
    readonly result?: string;
  }>;
}) {
  const params = await searchParams;
  const request = await loadCliAuthenticationApproval(params.code);

  return (
    <AdministrationPage className="max-w-4xl">
      <AdministrationPageHeader
        description="Confirm that this command-line client may access the Workspace administration API."
        eyebrow="CLI security"
        title="Approve CLI authentication"
      />

      {!request ? (
        <AuthenticationMessage
          description="Return to the CLI and run dhw auth again to create a fresh request."
          icon={ShieldAlert}
          title="This authentication request is invalid or has expired"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
          <dl className="grid divide-y divide-navy-blue/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <AuthenticationDetail label="Client" value={request.clientName} />
            <AuthenticationDetail
              label="CLI build"
              value={`${request.cliVersion} · ${request.buildTarget}`}
            />
          </dl>
          <div className="border-t border-navy-blue/10 px-5 py-5 sm:px-6">
            <AuthenticationRequestState code={params.code} request={request} />
          </div>
        </div>
      )}
    </AdministrationPage>
  );
}

function AuthenticationRequestState({
  code,
  request,
}: {
  readonly code?: string;
  readonly request: NonNullable<
    Awaited<ReturnType<typeof loadCliAuthenticationApproval>>
  >;
}) {
  if (request.state === "pending") {
    return (
      <>
        <div className="mb-5 flex items-start gap-3 rounded-lg bg-sunset-yellow/15 px-4 py-3 text-sm leading-6">
          <Clock3 aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p>
            This request expires at{" "}
            <strong>{formatAdministrationDateTime(request.expiresAt)}</strong>.
            Approve it only if you initiated the request in your terminal.
          </p>
        </div>
        <form action={approveCliAuthentication}>
          <input name="code" type="hidden" value={code} />
          <Button type="submit">Approve this CLI</Button>
        </form>
      </>
    );
  }

  if (request.state === "approved") {
    return (
      <AuthenticationMessage
        compact
        description="Return to your terminal. The CLI will complete the exchange automatically."
        icon={CheckCircle2}
        title="Authentication approved"
      />
    );
  }

  if (request.state === "granted") {
    return (
      <AuthenticationMessage
        compact
        description="The CLI has received its credential. You can close this page."
        icon={CheckCircle2}
        title="CLI authenticated"
      />
    );
  }

  return (
    <AuthenticationMessage
      compact
      description="Return to the CLI and run dhw auth again to create a fresh request."
      icon={ShieldAlert}
      title={
        request.state === "revoked"
          ? "This CLI session has been revoked"
          : "This authentication request has expired"
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
