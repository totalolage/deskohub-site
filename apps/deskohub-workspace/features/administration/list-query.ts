import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Option, Schema, SchemaTransformation } from "effect";
import {
  getHrefWithSearchParams,
  getSearchParamsDecoder,
  type RepeatedSearchParams,
  type SearchParamsRecord,
  type SearchParamValues,
} from "@/shared/utils/search-params";
import { isPlainDateString } from "@/shared/utils/temporal";
import type { AdministrationHref } from "./administration-href";
import type { AdministrationDataTableSorting } from "./data-table";

/** A list param that an absent or invalid value leaves out. */
export const optionalListParam = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(
    schema.pipe(Schema.catchDecoding(() => Effect.succeedNone))
  );

/** A list param that an absent or invalid value sets to `fallback`. */
export const listParamWithDefault = <S extends Schema.Top>(
  schema: S,
  fallback: S["Type"] & S["Encoded"]
) =>
  schema.pipe(
    Schema.catchDecoding(() => Effect.succeedSome(fallback)),
    Schema.withDecodingDefaultKey(Effect.succeed(fallback))
  );

const toListPage = (value: string) => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
};

/** The page of a list: a positive whole number, or else the first page. */
export const listPageParam = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transform({ decode: toListPage, encode: String })
  ),
  Schema.catchDecoding(() => Effect.succeedSome(1)),
  Schema.withDecodingDefaultKey(Effect.succeed("1"))
);

/** A calendar date the filter form accepts, in `YYYY-MM-DD` format. */
export const calendarDateFilterField = Schema.String.check(isPlainDateString());

/** A filter form field the operator may leave empty. */
export const optionalFilterField = <S extends Schema.Top>(schema: S) =>
  Schema.Union([Schema.Literal(""), schema]);

/** The schema of a list's filter form, which the form's resolver checks. */
export const getFilterFormSchema = <S extends Schema.Decoder<unknown>>(
  schema: S
): StandardSchemaV1<S["Encoded"], S["Type"]> =>
  Schema.toStandardSchemaV1(schema);

/** The order of a list a table header link can switch to. */
type SortableListQuery = {
  readonly direction?: "asc" | "desc";
  readonly sort?: string;
};

type AdministrationListQueryDefinition<Params, Query> = {
  /** The list page. */
  readonly path: AdministrationHref;
  /**
   * The URL params. Each decodes on its own, so an invalid value falls back
   * like an absent one instead of failing the list. `page` holds the page.
   * Links name the params in the order they're declared, with the page last.
   */
  readonly params: Schema.Decoder<Params> & {
    readonly fields: Schema.Struct.Fields;
  };
  /** How the list reads a param the URL repeats; by its first value unless set. */
  readonly repeatedParams?: RepeatedSearchParams;
  /**
   * Where a header link names the order it switches to: in the params'
   * declared order (the default), or after the list's other params.
   */
  readonly sortLinkOrder?: "declared" | "afterFilters";
  /** Turns the decoded params into the list's query, such as a default range. */
  readonly normalize: (params: Params) => Query;
};

/**
 * The query of an administration list: the one place that knows its URL
 * params, their values and defaults. The page, its sort links, pagination,
 * filter shortcuts and export all go through it, so every view of the list
 * keeps the operator's filters and order.
 */
type AdministrationListQuery<Query> = {
  /** Reads the list's query from a page's or route's search params. */
  readonly parse: (searchParams: SearchParamsRecord) => Query;
  /** The list showing `query`, on its first page unless `page` says otherwise. */
  readonly href: (
    query: Query,
    options?: { readonly page?: number }
  ) => AdministrationHref;
  /** Table sorting state and the header links that change the order. */
  readonly tableSorting: (query: Query & SortableListQuery) => {
    readonly getSortHref: (
      field: string,
      direction: "asc" | "desc"
    ) => AdministrationHref;
    readonly sorting: AdministrationDataTableSorting;
  };
};

/** The CSV export of a list, which reads the list's query without the page. */
type AdministrationListExport<Query> = {
  readonly exportHref: (query: Query) => AdministrationHref;
  readonly parseExport: (
    searchParams: SearchParamsRecord
  ) => Omit<Query, "page">;
};

export function defineAdministrationListQuery<
  Params extends object,
  Query extends object,
>(
  definition: AdministrationListQueryDefinition<Params, Query> & {
    /** The list's CSV export route. */
    readonly exportPath: AdministrationHref;
  }
): AdministrationListQuery<Query> & AdministrationListExport<Query>;
export function defineAdministrationListQuery<
  Params extends object,
  Query extends object,
>(
  definition: AdministrationListQueryDefinition<Params, Query>
): AdministrationListQuery<Query>;
export function defineAdministrationListQuery<
  Params extends object,
  Query extends object,
>({
  exportPath,
  normalize,
  params,
  path,
  repeatedParams = "first",
  sortLinkOrder = "declared",
}: AdministrationListQueryDefinition<Params, Query> & {
  readonly exportPath?: AdministrationHref;
}): AdministrationListQuery<Query> & Partial<AdministrationListExport<Query>> {
  const decode = getSearchParamsDecoder(params, { repeated: repeatedParams });
  const names = Object.keys(params.fields).filter((name) => name !== "page");
  const filterNames = names.filter(
    (name) => name !== "sort" && name !== "direction"
  );
  const getValues = (
    query: Query,
    linkNames: readonly string[] = names
  ): SearchParamValues => {
    const values = new Map(Object.entries(query));
    return Object.fromEntries(
      linkNames.map((name) => {
        const value = values.get(name);
        return [name, value === undefined ? undefined : String(value)];
      })
    );
  };
  const parse = (searchParams: SearchParamsRecord) =>
    // Every param falls back on its own, so decoding never fails.
    normalize(Option.getOrThrow(decode(searchParams)));

  return {
    parse,
    href: (query, { page } = {}) =>
      getHrefWithSearchParams(path, {
        ...getValues(query),
        page: page && page > 1 ? String(page) : undefined,
      }),
    tableSorting: (query) => ({
      getSortHref: (field, direction) =>
        getHrefWithSearchParams(path, {
          ...getValues(
            query,
            sortLinkOrder === "afterFilters" ? filterNames : names
          ),
          sort: field,
          direction,
        }),
      sorting: query.sort
        ? [{ desc: query.direction === "desc", id: query.sort }]
        : [],
    }),
    ...(exportPath && {
      exportHref: (query: Query) =>
        getHrefWithSearchParams(exportPath, getValues(query)),
      parseExport: (searchParams: SearchParamsRecord) => {
        const { page: _, ...input } = parse(searchParams) as Query & {
          readonly page?: number;
        };
        return input;
      },
    }),
  };
}
