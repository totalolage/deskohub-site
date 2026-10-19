import type { List } from "mdast";
import type { Locale } from "@/features/i18n";
import {
  markdownList,
  markdownListItem,
} from "@/shared/markdown/markdown";
import type { PublicOffering } from "./public-offerings";

/** TODO(stub): every offering with its prices, as a Markdown list. */
export const publicOfferingsMarkdown = (
  offerings: ReadonlyArray<PublicOffering>,
  _locale: Locale
): List => markdownList(offerings.map(({ name }) => markdownListItem(name)));
