export type AdministrationRedirectSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export const getAdministrationRedirectUrl = (
  path: string,
  searchParams: AdministrationRedirectSearchParams
) => {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    for (const item of [value].flat()) {
      if (item !== undefined) query.append(name, item);
    }
  }
  return query.size === 0 ? path : `${path}?${query}`;
};
