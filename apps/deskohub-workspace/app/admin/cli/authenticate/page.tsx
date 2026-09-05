import type { AdministrationActorUsernameType } from "@deskohub/workspace-admin-api";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { Suspense } from "react";
import { approveCliAuthentication } from "@/features/admin-cli/actions";
import { loadCliAuthenticationApproval } from "@/features/admin-cli/page-data.server";
import {
  AdministrationAlert,
  AdministrationPage,
  AdministrationPageHeader,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { AdministrationPanelLoading } from "@/features/administration/loading";
import { Button } from "@/shared/components/ui/button";

export default function CliAuthenticationApprovalPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly code?: string;
    readonly result?: string;
  }>;
}) {
  return (
    <AdministrationPage className="max-w-4xl">
      <AdministrationPageHeader
        description="Confirm that this command-line client may access the Workspace administration API."
        eyebrow="CLI security"
        title="Approve CLI authentication"
      />
      <Suspense
        fallback={
          <AdministrationPanelLoading label="CLI authentication request" />
        }
      >
        <CliAuthenticationRequest searchParams={searchParams} />
      </Suspense>
    </AdministrationPage>
  );
}

export async function CliAuthenticationRequest({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly code?: string;
    readonly result?: string;
  }>;
}) {
  const params = await searchParams;
  const approval = await loadCliAuthenticationApproval(params.code);

  if (!approval?.request) {
    return (
      <AuthenticationMessage
        description="Return to the CLI and run dhw auth again to create a fresh request."
        icon={ShieldAlert}
        title="This authentication request is invalid or has expired"
      />
    );
  }

  const { request, username } = approval;

  return (
    <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
      <dl className="grid divide-y divide-navy-blue/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <AuthenticationDetail label="Client" value={request.clientName} />
        <AuthenticationDetail
          label="CLI build"
          value={`${request.cliVersion} · ${request.buildTarget}`}
        />
      </dl>
      <div className="border-t border-navy-blue/10 px-5 py-5 sm:px-6">
        <AuthenticationRequestState
          code={params.code}
          request={request}
          username={username}
        />
      </div>
    </div>
  );
}

function AuthenticationRequestState({
  code,
  request,
  username,
}: {
  readonly code?: string;
  readonly request: NonNullable<
    NonNullable<
      Awaited<ReturnType<typeof loadCliAuthenticationApproval>>
    >["request"]
  >;
  readonly username: AdministrationActorUsernameType;
}) {
  if (request.state === "pending") {
    return (
      <>
        <AdministrationAlert className="mb-5" status="warning">
          <p>
            This request expires at{" "}
            <strong>{formatAdministrationDateTime(request.expiresAt)}</strong>.
            Approve it only if you initiated the request in your terminal.
            Approving as <strong>{username}</strong>.
          </p>
        </AdministrationAlert>
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
