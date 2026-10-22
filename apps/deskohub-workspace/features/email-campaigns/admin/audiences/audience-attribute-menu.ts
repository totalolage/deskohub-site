import {
  type AudienceAttribute,
  audienceAttributeCatalogue,
  audienceAttributeSections,
} from "@deskohub/workspace-admin-api";
import {
  type AudienceFilterHolder,
  canHoldAttribute,
} from "../../audience-filter-usage";

const isAudienceAttribute = (value: string): value is AudienceAttribute =>
  Object.hasOwn(audienceAttributeCatalogue, value);

/**
 * The attribute menu: each section with the attributes `holder` can hold, in
 * catalogue order.
 */
export const audienceAttributeMenu = (holder: AudienceFilterHolder) =>
  audienceAttributeSections.map((section) => ({
    section,
    attributes: Object.keys(audienceAttributeCatalogue).filter(
      (attribute): attribute is AudienceAttribute =>
        isAudienceAttribute(attribute) &&
        canHoldAttribute(holder, attribute) &&
        audienceAttributeCatalogue[attribute].section === section
    ),
  }));
