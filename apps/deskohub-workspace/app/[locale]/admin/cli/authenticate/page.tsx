import { CliAuthenticationScreen } from "@/features/admin-cli/cli-authentication-screen";

export default function CliAuthenticationApprovalPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly code?: string;
    readonly result?: string;
  }>;
}) {
  return <CliAuthenticationScreen searchParams={searchParams} />;
}
