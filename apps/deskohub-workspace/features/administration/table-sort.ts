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
  readonly basePath: string;
  readonly direction: "asc" | "desc";
  readonly field: string;
  readonly params?: Readonly<Record<string, string | undefined>>;
}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) search.set(key, value);
  }
  search.set("sort", field);
  search.set("direction", direction);
  return `${basePath}?${search.toString()}`;
};
