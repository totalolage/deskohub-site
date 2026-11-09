import "server-only";

import { Layer } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { AccountRoleGrants } from "../backend/account-role-grants.service";

/** The session and grant reads behind the administration guards. */
export const administratorAccessLayer = Layer.mergeAll(
  CustomerAuthentication.Default,
  AccountRoleGrants.Live
);
