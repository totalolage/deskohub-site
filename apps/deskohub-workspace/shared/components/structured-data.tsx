import type { StaticImageData } from "next/image";
import type { Locale } from "@/features/i18n";
import { getWorkspaceCanonicalUrl } from "@/shared/utils/site-constants";
import {
  getLocalBusinessStructuredData,
  type StructuredDataDocument,
  serializeStructuredData,
} from "@/shared/utils/structured-data";

/** Schema.org JSON-LD in the initial HTML, for search engines and agents. */
export function StructuredData({
  data,
}: {
  readonly data: StructuredDataDocument;
}) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must be raw script text; serializeStructuredData escapes `<`.
      dangerouslySetInnerHTML={{ __html: serializeStructuredData(data) }}
    />
  );
}

/** The business node every public page carries. */
export function LocalBusinessStructuredData({
  image,
  locale,
}: {
  /** A photo of the space. */
  readonly image: StaticImageData;
  readonly locale: Locale;
}) {
  return (
    <StructuredData
      data={getLocalBusinessStructuredData({
        image: getWorkspaceCanonicalUrl(image.src),
        locale,
      })}
    />
  );
}
