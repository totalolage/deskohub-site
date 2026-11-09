import "../../shared/polyfills/temporal";

import { AdministrationStandaloneAccessCodeName } from "@deskohub/workspace-admin-api";
import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import { Schema } from "effect";

export interface AccessCodeCreationPlan {
  readonly endsAtLocal: string;
  readonly name: AdministrationStandaloneAccessCodeName;
  readonly startsAtLocal: string;
}

const syntheticAccessCodeNamePrefix = "dsk-e2e-";
const maximumSyntheticAccessCodeNameLength = 60;
const accessCodeWindowLeadHours = 2;
const accessCodeWindowDurationHours = 3;

export const makeSyntheticAccessCodeName =
  (): AdministrationStandaloneAccessCodeName => {
    const name = `${syntheticAccessCodeNamePrefix}${crypto.randomUUID()}`;
    if (name.length > maximumSyntheticAccessCodeNameLength) {
      throw new Error(
        "The synthetic access code name exceeds the provider access-name bound"
      );
    }
    return Schema.decodeSync(AdministrationStandaloneAccessCodeName)(name);
  };

export const planAccessCodeCreationAttempt = (input: {
  readonly name: AdministrationStandaloneAccessCodeName;
  readonly now?: Temporal.Instant;
}): AccessCodeCreationPlan => {
  const now = input.now ?? Temporal.Now.instant();
  const start = now
    .toZonedDateTimeISO(WORKSPACE_SITE_TIME_ZONE)
    .round({ roundingMode: "ceil", smallestUnit: "hour" })
    .add({ hours: accessCodeWindowLeadHours });
  const end = start.add({ hours: accessCodeWindowDurationHours });

  return {
    endsAtLocal: formatWholeHourLocal(end),
    name: input.name,
    startsAtLocal: formatWholeHourLocal(start),
  };
};

const hopByHopAndClientOwnedHeaders = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "transfer-encoding",
  "x-vercel-protection-bypass",
  "x-vercel-set-bypass-cookie",
]);

export const selectActionReplayHeaders = (
  headers: Record<string, string | undefined>
): Record<string, string> => {
  const replayHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (hopByHopAndClientOwnedHeaders.has(name.toLowerCase())) continue;
    replayHeaders[name] = value;
  }
  return replayHeaders;
};

const formatWholeHourLocal = (value: Temporal.ZonedDateTime) =>
  value.toPlainDateTime().toString({ smallestUnit: "minute" });
