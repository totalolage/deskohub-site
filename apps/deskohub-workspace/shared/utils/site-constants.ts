import { WORKSPACE_SITE_TIME_ZONE } from "@deskohub/workspace-admin-api/site-time-zone";
import { type Locale, locales } from "@/features/i18n";
import type { WorkspaceCurrencyCode } from "@/shared/money/currencies";

export interface WorkspacePaymentAccount {
  readonly accountNumber: string;
  readonly iban: string;
  readonly bic: string;
  readonly bankName: string;
}

export const workspaceSiteConstants = {
  brand: {
    name: "Deskohub Workspace",
    legalName: "Desktechub s.r.o.",
    domain: "workspace.deskohub.cz",
  },
  contact: {
    infoEmail: "workspace@deskohub.cz",
  },
  location: {
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
    timeZone: WORKSPACE_SITE_TIME_ZONE,
  },
  reservation: {
    defaultStartTime: "10:00",
  },
  company: {
    identificationNumber: "24531596",
    taxIdentificationNumber: "CZ24531596",
    establishmentId: "1016069146",
    vatStatus: "not-vat-payer",
    commercialRegister: {
      court: "Městský soud v Praze",
      section: "C",
      file: "442830",
    },
    paymentAccounts: {
      CZK: {
        accountNumber: "2303459272/2010",
        iban: "CZ0620100000002303459272",
        bic: "FIOBCZPPXXX",
        bankName: "Fio banka, a.s.",
      },
    } satisfies Partial<
      Readonly<Record<WorkspaceCurrencyCode, WorkspacePaymentAccount>>
    >,
  },
  social: {
    instagram: "https://www.instagram.com/deskohub/",
    facebook: "https://www.facebook.com/deskohub",
  },
} as const;

export const workspaceSiteOrigin = `https://${workspaceSiteConstants.brand.domain}`;

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
  const url = new URL(canonicalPathname, workspaceSiteOrigin);

  if (searchParams) {
    for (const [key, value] of new URLSearchParams(searchParams)) {
      url.searchParams.append(key, value);
    }
  }

  return url.toString();
}

function getWorkspaceLocalizedCanonicalUrl(
  locale: Locale,
  pathname = "/"
): string {
  const localizedPathname = normalizePathname(pathname);
  const suffix = localizedPathname === "/" ? "" : localizedPathname;

  return getWorkspaceCanonicalUrl(`/${locale}${suffix}`);
}

/**
 * Canonical and hreflang alternates for a page served under every locale
 * prefix. `x-default` is the unprefixed URL, which the proxy redirects to the
 * visitor's resolved locale.
 */
export function getWorkspaceAlternates(locale: Locale, pathname = "/") {
  return {
    canonical: getWorkspaceLocalizedCanonicalUrl(locale, pathname),
    languages: {
      ...Object.fromEntries(
        locales.map((alternateLocale) => [
          alternateLocale,
          getWorkspaceLocalizedCanonicalUrl(alternateLocale, pathname),
        ])
      ),
      "x-default": getWorkspaceCanonicalUrl(pathname),
    },
  };
}
