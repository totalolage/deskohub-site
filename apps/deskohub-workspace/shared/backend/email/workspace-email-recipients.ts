import type { EmailRecipient } from "@deskohub/email";
import { env } from "@/env";
import { workspaceSiteConstants } from "@/shared/utils";

export const workspaceEmailRecipient: EmailRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
};

export const internalWorkspaceEmailRecipient: EmailRecipient =
  env.VERCEL_ENV === "production"
    ? workspaceEmailRecipient
    : {
        email: "delivered+workspace-internal@resend.dev",
        name: workspaceSiteConstants.brand.name,
      };
