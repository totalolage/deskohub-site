import { CliSessionUnauthorized } from "@deskohub/workspace-admin-api";

/**
 * The error an administrator's AI assistant gets once its token, its
 * administration scope or the administrator grant no longer lets it act.
 */
export const assistantAccessEnded = () =>
  new CliSessionUnauthorized({
    message:
      "This assistant's administrator access ended. Reconnect the assistant to your Workspace account to continue.",
  });
