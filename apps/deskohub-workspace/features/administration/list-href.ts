/** URL params that keep an administration list's filters and order. */
export type AdministrationListParams = Readonly<
  Record<string, string | undefined>
>;

/** An administration list path with its params; empty values are left out. */
export const getAdministrationListHref = (
  path: string,
  params: AdministrationListParams
) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};

/**
 * The CSV export of the list at `basePath`. Pass the same params the list's
 * sort links and pagination carry, so the file matches what the operator sees.
 */
export const getAdministrationListExportHref = (
  basePath: string,
  params: AdministrationListParams
) => getAdministrationListHref(`${basePath}/export`, params);
