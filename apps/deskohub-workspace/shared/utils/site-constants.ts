export const workspaceSiteConstants = {
  brand: {
    name: "Deskohub Workspace",
    legalName: "Desktechub s.r.o.",
    domain: "workspace.deskohub.cz",
  },
  contact: {
    infoEmail: "workspace@deskohub.cz",
    address: {
      street: "Turnovská 430/10",
      cityDistrict: "Libeň",
      city: "Praha 8",
      postalCode: "180 00",
    },
    coordinates: {
      lat: 50.103277,
      lng: 14.479023,
    },
  },
  company: {
    identificationNumber: "24531596",
    establishmentId: "1016069146",
    vatStatus: "not-vat-payer",
  },
  social: {
    instagram: "https://www.instagram.com/deskohub/",
    facebook: "https://www.facebook.com/deskohub",
  },
} as const;

type WorkspaceCanonicalSearchParams = ConstructorParameters<
  typeof URLSearchParams
>[0];

const normalizePathname = (pathname: string) => {
  if (pathname === "" || pathname === "/") return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
};

export function getWorkspaceCanonicalUrl(
  pathname: string | URL = "/",
  searchParams?: WorkspaceCanonicalSearchParams
): string {
  const canonicalPathname =
    pathname instanceof URL
      ? `${pathname.pathname}${pathname.search}${pathname.hash}`
      : normalizePathname(pathname);
  const url = new URL(
    canonicalPathname,
    `https://${workspaceSiteConstants.brand.domain}`
  );

  if (searchParams) {
    for (const [key, value] of new URLSearchParams(searchParams)) {
      url.searchParams.append(key, value);
    }
  }

  return url.toString();
}

export function getWorkspaceLocalizedCanonicalUrl(
  locale: string,
  pathname = "/"
): string {
  const localizedPathname = normalizePathname(pathname);
  const suffix = localizedPathname === "/" ? "" : localizedPathname;

  return getWorkspaceCanonicalUrl(`/${locale}${suffix}`);
}
