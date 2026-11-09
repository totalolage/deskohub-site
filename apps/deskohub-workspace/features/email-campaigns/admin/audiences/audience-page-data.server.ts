import "server-only";

import type { AdministrationCampaignAudienceType } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import {
  type AudienceFilter,
  audienceSingleLocale,
} from "../../audience-filter";
import type { CampaignAudienceId } from "../../campaign-identifiers";
import { describeAudienceFilter } from "../audience-filter-summary";
import {
  campaignOperationCapabilities,
  invokeCampaignOperation,
} from "../campaign-operation-query.server";
import { loadAudienceValueLookups } from "./audience-value-lookups.server";

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

/** Every audience, archived ones included. */
const listAudiences = () =>
  runAdministrationPage(
    "email-campaigns.admin.list-audiences",
    invokeCampaignOperation("listCampaignAudiences", {}),
    campaignOperationCapabilities
  );

const byTitle = (left: { title: string }, right: { title: string }) =>
  left.title.localeCompare(right.title);

const isArchived = (audience: AdministrationCampaignAudienceType) =>
  audience.archivedAt !== null;

/** Every audience, active ones first, for the audience list. */
export const loadAudienceList = async (): Promise<
  readonly AudienceListItem[]
> => {
  const [audiences, lookups, locale] = await Promise.all([
    listAudiences(),
    loadAudienceValueLookups(),
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
      summary: describeAudienceFilter(audience.filter, locale, lookups),
      archived: isArchived(audience),
      updatedAt: audience.updatedAt,
      updatedAtText: formatAdministrationDateTime(audience.updatedAt, locale),
    }));
};

/** The active audiences a campaign can select, by title. */
export const loadAudienceOptions = async (): Promise<
  readonly AudienceOption[]
> => {
  const [audiences, lookups, locale] = await Promise.all([
    listAudiences(),
    loadAudienceValueLookups(),
    getRequestLocale(),
  ]);
  return audiences
    .filter((audience) => !isArchived(audience))
    .map(({ id, title, filter }) => ({
      id,
      title,
      summary: describeAudienceFilter(filter, locale, lookups),
      singleLocale: audienceSingleLocale(filter),
    }))
    .toSorted(byTitle);
};

/** The audience the editor opens, or the not-found page. */
export const loadAudienceEditor = (
  audienceId: CampaignAudienceId
): Promise<AudienceEditorData> =>
  runAdministrationPage(
    "email-campaigns.admin.load-audience",
    invokeCampaignOperation("getCampaignAudience", { audienceId }).pipe(
      Effect.map(({ id, title, filter, archivedAt }) => ({
        id,
        title,
        filter,
        archived: archivedAt !== null,
      })),
      Effect.catchTag("OperationNotFound", () =>
        Effect.fail(new AdministrationRecordNotFound())
      )
    ),
    campaignOperationCapabilities
  );
