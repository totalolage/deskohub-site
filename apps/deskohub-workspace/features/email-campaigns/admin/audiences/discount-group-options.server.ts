import "server-only";

import { Effect } from "effect";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { m } from "@/features/administration/i18n";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import { listDiscountGroups } from "@/features/discounts/discount-groups";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type { DiscountGroupOption } from "../audience-filter-summary";

/**
 * The Dotypos discount groups an audience can filter by, by name. Undefined
 * when Dotypos can't be reached: the builder then takes a raw group ID and
 * summaries show IDs.
 */
export const loadDiscountGroupOptions = cache(
  async (): Promise<readonly DiscountGroupOption[] | undefined> => {
    await authorizeAdministratorPage();
    const locale = await getRequestLocale();
    return await listDiscountGroups.pipe(
      Effect.map((groups) =>
        groups
          .map(({ id, name }) => ({
            id: String(id),
            name:
              name ??
              m.emailCampaignsAudienceDiscountGroupUnnamed(
                { id: String(id) },
                { locale }
              ),
          }))
          .toSorted((left, right) =>
            left.name.localeCompare(right.name, locale)
          )
      ),
      Effect.catch((cause) => {
        unstable_rethrow(cause);
        return Effect.logWarning("Dotypos discount groups unavailable", {
          cause,
        }).pipe(Effect.as(undefined));
      }),
      Effect.provide(WorkspaceDotyposLayer),
      runWorkspaceEffect("email-campaigns.admin.load-discount-groups", {
        boundary: "route",
      })
    );
  }
);
