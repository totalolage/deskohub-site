import "server-only";

import { Effect, Option } from "effect";
import { notFound } from "next/navigation";
import type { CampaignAudienceRow } from "@/db/schema";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  type AudienceFilter,
  audienceSingleLocale,
} from "../../audience-filter";
import { CampaignAudienceService } from "../../backend/campaign-audience.service";
import type { CampaignAudienceId } from "../../campaign-identifiers";
import { describeAudienceFilter } from "../audience-filter-summary";
import { loadDiscountGroupOptions } from "./discount-group-options.server";

/** An audience a campaign can select. */
export type AudienceOption = {
  readonly id: CampaignAudienceId;
  readonly title: string;
  readonly summary: string;
  /** Every recipient speaks this locale, so content needs only it. */
  readonly singleLocale: Locale | undefined;
};

export type AudienceListItem = {
  readonly id: CampaignAudienceId;
  readonly title: string;
  readonly summary: string;
  readonly archived: boolean;
  /** ISO instant. */
  readonly updatedAt: string;
  /** `updatedAt` formatted for the request locale. */
  readonly updatedAtText: string;
};

export type AudienceEditorData = {
  readonly id: CampaignAudienceId;
  readonly title: string;
  readonly filter: AudienceFilter;
  readonly archived: boolean;
};

const listAudiences = Effect.fn("loadAudienceList")(function* (
  includeArchived: boolean
) {
  const audiences = yield* CampaignAudienceService;
  return yield* audiences.list({ includeArchived });
});

const runAudienceListing = (includeArchived: boolean) =>
  listAudiences(includeArchived).pipe(
    Effect.provide(CampaignAudienceService.Live),
    runWorkspaceEffect("email-campaigns.admin.list-audiences", {
      boundary: "route",
    })
  );

const byTitle = (left: { title: string }, right: { title: string }) =>
  left.title.localeCompare(right.title);

const isArchived = (audience: CampaignAudienceRow) =>
  audience.archivedAt !== null;

/** Every audience, active ones first, for the audience list. */
export const loadAudienceList = async (): Promise<
  readonly AudienceListItem[]
> => {
  await authorizeAdministratorPage();
  const [audiences, discountGroups, locale] = await Promise.all([
    runAudienceListing(true),
    loadDiscountGroupOptions(),
    getRequestLocale(),
  ]);
  return audiences
    .toSorted(
      (left, right) =>
        Number(isArchived(left)) - Number(isArchived(right)) ||
        byTitle(left, right)
    )
    .map((audience) => ({
      id: audience.id,
      title: audience.title,
      summary: describeAudienceFilter(audience.filter, locale, {
        discountGroups,
      }),
      archived: isArchived(audience),
      updatedAt: audience.updatedAt.toString(),
      updatedAtText: formatAdministrationDateTime(
        audience.updatedAt.toString(),
        locale
      ),
    }));
};

/** The active audiences a campaign can select, by title. */
export const loadAudienceOptions = async (): Promise<
  readonly AudienceOption[]
> => {
  await authorizeAdministratorPage();
  const [audiences, discountGroups, locale] = await Promise.all([
    runAudienceListing(false),
    loadDiscountGroupOptions(),
    getRequestLocale(),
  ]);
  return audiences
    .map(({ id, title, filter }) => ({
      id,
      title,
      summary: describeAudienceFilter(filter, locale, { discountGroups }),
      singleLocale: audienceSingleLocale(filter),
    }))
    .toSorted(byTitle);
};

/** The audience the editor opens, or the not-found page. */
export const loadAudienceEditor = async (
  audienceId: CampaignAudienceId
): Promise<AudienceEditorData> => {
  await authorizeAdministratorPage();
  const audience = await Effect.gen(function* () {
    const audiences = yield* CampaignAudienceService;
    return yield* audiences.get(audienceId).pipe(Effect.option);
  }).pipe(
    Effect.provide(CampaignAudienceService.Live),
    runWorkspaceEffect("email-campaigns.admin.load-audience", {
      boundary: "route",
    })
  );
  const { id, title, filter, archivedAt } = Option.getOrElse(audience, () =>
    notFound()
  );
  return { id, title, filter, archived: archivedAt !== null };
};
