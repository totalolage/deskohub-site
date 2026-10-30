import { EmailServiceTag, makeEmailConfigLayer } from "@deskohub/email";
import { Config, Layer } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";

export const workspaceDefaultFromAddress = "reservations@workspace.deskohub.cz";

const EmailConfigLayer = makeEmailConfigLayer(
  Config.succeed({
    email: workspaceDefaultFromAddress,
    name: workspaceSiteConstants.brand.name,
  })
);

export const WorkspaceEmailLayer = EmailServiceTag.RecipientRouted.pipe(
  Layer.provideMerge(EmailConfigLayer)
);
