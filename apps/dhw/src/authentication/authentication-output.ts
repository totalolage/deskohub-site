import type { CliSessionType } from "@deskohub/workspace-admin-api";
import { Console } from "effect";

export const reportAuthenticationStarted = ({
  approvalUrl,
  expiresAt,
  json,
}: {
  readonly approvalUrl: string;
  readonly expiresAt: string;
  readonly json: boolean;
}) => {
  const message = `Approve this CLI in your browser:\n${approvalUrl}\n\nThis request expires at ${expiresAt}.`;

  return json
    ? Console.error(message)
    : Console.log(`${message}\n\nWaiting for approval…`);
};

export const reportAuthenticationGranted = ({
  json,
  session,
}: {
  readonly json: boolean;
  readonly session: CliSessionType;
}) =>
  Console.log(
    json
      ? JSON.stringify({ authStatus: "granted", session })
      : `Authenticated as ${session.clientName}.`
  );
