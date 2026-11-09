import "server-only";

import { Effect } from "effect";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { m } from "@/features/administration/i18n";
import { runAdministrationPage } from "@/features/administrators/server/administration-request.server";
import { listDiscountGroups } from "@/features/discounts/discount-groups";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type { DiscountGroupOption } from "../audience-filter-summary";

/**
 * The Dotypos discount groups an audience can filter by, by name. Undefined
 * when Dotypos can't be reached: the builder then takes a raw group ID and
 * summaries show IDs.
 */
export const loadDiscountGroupOptions = cache(
  (): Promise<readonly DiscountGroupOption[] | undefined> =>
    runAdministrationPage(
      "email-campaigns.admin.load-discount-groups",
      Effect.gen(function* () {
        const locale = yield* Effect.promise(() => getRequestLocale());
        const groups = yield* listDiscountGroups;
        return groups
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
          );
      }).pipe(
        Effect.catch((cause) => {
          unstable_rethrow(cause);
          return Effect.logWarning("Dotypos discount groups unavailable", {
            cause,
          }).pipe(Effect.as(undefined));
        })
      ),
      WorkspaceDotyposLayer
    )
);
