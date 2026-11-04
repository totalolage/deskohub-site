import {
  type EmailRecipient,
  internalRecipientForOrigin,
  staffEmailSubject,
} from "@deskohub/email";
import { env } from "@/env";
import { workspaceSiteConstants } from "@/shared/utils";

export const workspaceEmailRecipient: EmailRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
};

/** Staff copy of mail triggered by the customer or submitter at `originEmail`. */
export const internalWorkspaceEmailRecipientFor = (
  originEmail: string
): EmailRecipient =>
  internalRecipientForOrigin(originEmail, {
    real: workspaceEmailRecipient,
    testLocalPart: "workspace-internal",
  });

/** The deployment staff mail is sent from; read at send time. */
export const workspaceEmailEnvironment = (): {
  readonly isProduction: boolean;
} => ({ isProduction: env.VERCEL_ENV === "production" });

/** Subject for a staff copy; tagged as test mail outside production. */
export const internalWorkspaceEmailSubject = (subject: string): string =>
  staffEmailSubject(subject, workspaceEmailEnvironment());
