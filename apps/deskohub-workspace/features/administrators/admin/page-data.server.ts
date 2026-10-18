import "server-only";

import { Effect } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { formatInstantDateTime } from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { AdministratorRoster } from "../backend/administrator-roster.service";
import { authorizeAdministratorPage } from "../server/administrator-authorization.server";

/** One administrator as the roster page shows it. */
export type AdministratorListItem = {
  readonly accountId: CustomerAccountId;
  readonly email: string;
  /** Null when a bootstrap granted the role or the granter was deleted. */
  readonly grantedByEmail: string | null;
  readonly grantedAt: string;
  /** `grantedAt` in the route locale, formatted on the server. */
  readonly grantedAtLabel: string;
};

export type AdministratorsPageData = {
  readonly actorAccountId: CustomerAccountId;
  readonly administrators: ReadonlyArray<AdministratorListItem>;
};

export const loadAdministrators = async (): Promise<AdministratorsPageData> => {
  const actor = await authorizeAdministratorPage();
  const locale = await getRequestLocale();
  const grants = await AdministratorRoster.pipe(
    Effect.flatMap((roster) => roster.list),
    Effect.provide(AdministratorRoster.Live),
    runWorkspaceEffect("administrators.list", { boundary: "page" })
  );
  return {
    actorAccountId: actor.accountId,
    administrators: grants.map(
      (grant): AdministratorListItem => ({
        accountId: grant.accountId,
        email: grant.email,
        grantedByEmail: grant.grantedBy?.email ?? null,
        grantedAt: grant.grantedAt.toString(),
        grantedAtLabel: formatInstantDateTime({
          instant: grant.grantedAt,
          locale,
          timeZone: workspaceSiteConstants.location.timeZone,
        }),
      })
    ),
  };
};
