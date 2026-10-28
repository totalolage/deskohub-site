import { getHrefWithSearchParams } from "@/shared/utils/search-params";
import type { AdministrationHref } from "./administration-href";

export type AdministrationTableSorting<T extends string> = {
  readonly direction: "asc" | "desc";
  readonly field: T;
  readonly params?: Readonly<Record<string, string | undefined>>;
};

export const getAdministrationTableSortHref = ({
  basePath,
  direction,
  field,
  params,
}: {
  readonly basePath: AdministrationHref;
  readonly direction: "asc" | "desc";
  readonly field: string;
  readonly params?: Readonly<Record<string, string | undefined>>;
}) => getHrefWithSearchParams(basePath, { ...params, sort: field, direction });
