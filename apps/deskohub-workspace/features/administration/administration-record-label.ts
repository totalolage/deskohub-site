import type { Locale } from "@/features/i18n";
import {
  type AdministrationRecordArea,
  findAdministrationRecord,
} from "./administration-areas";

/**
 * Loads the label of an area's record, such as an invoice number, through
 * `runAdministrationPage`. A record without one keeps the area's record label.
 */
export type AdministrationRecordLabelLoader = (
  recordId: string,
  locale: Locale
) => Promise<string | null | undefined>;

/**
 * The label of the record a path under `/admin` names, from its area's
 * loader. A path without a record, or a record whose area has no loader, has
 * none.
 */
export const loadAdministrationRecordLabel = async ({
  loaders,
  locale,
  segments,
}: {
  readonly loaders: ReadonlyMap<
    AdministrationRecordArea,
    AdministrationRecordLabelLoader
  >;
  readonly locale: Locale;
  readonly segments: readonly string[];
}): Promise<string | undefined> => {
  const record = findAdministrationRecord(segments);
  const loadRecordLabel = record && loaders.get(record.area);
  if (!record || !loadRecordLabel) return undefined;
  return (await loadRecordLabel(record.recordId, locale)) ?? undefined;
};
