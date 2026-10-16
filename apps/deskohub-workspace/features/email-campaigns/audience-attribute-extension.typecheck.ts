import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import {
  audienceAttributeCatalogue,
  countAttribute,
  defineAudienceAttributeCatalogue,
  periodParam,
} from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import {
  type AudienceAttributeResolvers,
  audienceAttributeResolvers,
} from "./backend/audience-attribute-resolvers";

/**
 * A new count attribute takes one catalogue entry and its resolver; the
 * schema, defaults, editor, summary, fact requests, and evaluation work from
 * the entry by kind. `audience-attribute-extension.test.tsx` runs it through
 * them.
 */
export const giftCardCount = countAttribute("giftCardCount", {
  label: "Gift cards bought",
  section: "Reservations",
  params: { period: periodParam },
  defaults: {
    params: { period: { _tag: "Last", count: 30, unit: "day" } },
    operator: "gte",
    value: 2,
  },
});

export const extendedCatalogue = defineAudienceAttributeCatalogue({
  ...audienceAttributeCatalogue,
  giftCardCount,
});

export const extendedResolvers: AudienceAttributeResolvers<
  typeof extendedCatalogue
> = {
  ...audienceAttributeResolvers,
  giftCardCount: {
    count: () =>
      Effect.succeed(new Map([[DotyposCustomerIdSchema.make("buyer"), 3]])),
  },
};

// @ts-expect-error A catalogue entry without a resolver fails the typecheck.
const withoutResolver: AudienceAttributeResolvers<typeof extendedCatalogue> =
  audienceAttributeResolvers;

void withoutResolver;
