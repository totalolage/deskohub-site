import {
  type AudienceAttribute,
  audienceAttributeCatalogue,
  audienceAttributeSections,
} from "@deskohub/workspace-admin-api";
import { isSavedAudienceAttribute } from "../../audience-filter-usage";

export const isAudienceAttribute = (
  value: string
): value is AudienceAttribute =>
  Object.hasOwn(audienceAttributeCatalogue, value);

/**
 * The attribute menu: each section with the attributes a saved audience can
 * hold, in catalogue order.
 */
export const audienceAttributeMenu = audienceAttributeSections.map(
  (section) => ({
    section,
    attributes: Object.keys(audienceAttributeCatalogue).filter(
      (attribute): attribute is AudienceAttribute =>
        isAudienceAttribute(attribute) &&
        isSavedAudienceAttribute(attribute) &&
        audienceAttributeCatalogue[attribute].section === section
    ),
  })
);
