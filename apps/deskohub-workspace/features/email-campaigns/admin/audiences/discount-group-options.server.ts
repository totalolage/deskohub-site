import "server-only";

import { DotyposService } from "@deskohub/dotypos";
import { Effect } from "effect";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { m } from "@/features/administration/i18n";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
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
    return await Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const groups = yield* dotypos.getDiscountGroups();
      return groups
        .flatMap(({ id, name, deleted }) =>
          id && !deleted
            ? [
                {
                  id: String(id),
                  name:
                    name?.trim() ||
                    m.emailCampaignsAudienceDiscountGroupUnnamed(
                      { id: String(id) },
                      { locale }
                    ),
                },
              ]
            : []
        )
        .toSorted((left, right) => left.name.localeCompare(right.name, locale));
    }).pipe(
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
