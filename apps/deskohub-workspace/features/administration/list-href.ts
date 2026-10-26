/** URL params that keep an administration list's filters and order. */
export type AdministrationListParams = Readonly<
  Record<string, string | undefined>
>;

/** An administration list path with its params; empty values are left out. */
export const getAdministrationListHref = <Path extends string>(
  path: Path,
  params: AdministrationListParams
): Path | `${Path}?${string}` => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};
