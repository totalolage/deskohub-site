import { access, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { baseLocale, m, setLocale } from "./features/i18n";
import {
  assertIsLocale,
  cookieMaxAge,
  cookieName,
  extractLocaleFromHeader,
  isLocale,
  type Locale,
} from "./features/i18n/paraglide/runtime.js";

const pageRoutes = new Set(["/", "/index.html"]);
const pageRouteRedirects = new Map<string, string>([["/index.html", "/"]]);
const passthroughStaticRoutes = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
]);
const staticRoutePrefixes = [
  "/assets/",
  "/images/",
  "/fonts/",
  "/@fs/",
  "/@vite/",
];
const staticFileExtensions = new Set([
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".png",
  ".svg",
  ".txt",
  ".webmanifest",
  ".webp",
  ".woff",
  ".woff2",
]);
const immutableAssetCacheControl = "public, max-age=31536000, immutable";
const localizedHtmlCacheControl = "public, max-age=0, must-revalidate";
const redirectCacheControl = "private, no-store, max-age=0";
const portalOrigin = "https://www.deskohub.cz";
const viteAssetProxyHeaderAllowlist = [
  "accept",
  "accept-encoding",
  "cache-control",
  "if-modified-since",
  "if-none-match",
  "range",
] as const;
const contentTypesByExtension: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

type PortalServerOptions = {
  appDirectory: string;
  isDevelopment: boolean;
  viteOrigin?: string;
};

type ViteManifest = Record<string, { css?: string[]; file: string }>;
type PortalCopy = ReturnType<typeof getPortalCopy>;

export async function assertProductionBuildReady(options: PortalServerOptions) {
  if (options.isDevelopment) {
    return;
  }

  const distManifestPath = getDistManifestPath(options.appDirectory);

  if (await fileExists(distManifestPath)) {
    return;
  }

  throw new Error(
    `Missing Vite manifest at ${distManifestPath}. Run \`bun run build\` before starting the portal server.`
  );
}

export function createPortalRequestHandler(options: PortalServerOptions) {
  const sourceHtmlPath = join(options.appDirectory, "index.html");
  const distDirectory = getDistDirectory(options.appDirectory);
  const distHtmlPath = join(distDirectory, "index.html");
  const distManifestPath = getDistManifestPath(options.appDirectory);

  let cachedIndexTemplate: string | null = null;
  let cachedManifest: ViteManifest | null = null;

  return async function handlePortalRequest(request: Request) {
    const requestUrl = new URL(request.url);
    const { pathname, search } = requestUrl;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (isStaticRoute(pathname)) {
      if (options.isDevelopment) {
        if (!options.viteOrigin) {
          throw new Error(
            "Missing Vite origin for development static asset proxying."
          );
        }

        return fetch(
          new Request(`${options.viteOrigin}${pathname}${search}`, {
            headers: getViteAssetProxyHeaders(request.headers),
            method: request.method,
          })
        );
      }

      return serveBuiltStaticFile(pathname, request.method, {
        distDirectory,
        getBuildManifest,
      });
    }

    const localizedRequest = getLocalizedPageRequest(pathname);

    if (!localizedRequest) {
      if (hasUnsupportedLocalePrefix(pathname)) {
        return new Response("Not Found", { status: 404 });
      }

      if (!pageRoutes.has(pathname)) {
        return new Response("Not Found", { status: 404 });
      }

      return redirectToLocalizedPage(requestUrl, request);
    }

    if (!pageRoutes.has(localizedRequest.routePath)) {
      return new Response("Not Found", { status: 404 });
    }

    const normalizedRoutePath =
      pageRouteRedirects.get(localizedRequest.routePath) ??
      localizedRequest.routePath;

    if (normalizedRoutePath !== localizedRequest.routePath) {
      const redirectUrl = new URL(
        `/${localizedRequest.locale}${normalizedRoutePath}${search}`,
        requestUrl
      );
      return redirectResponse(redirectUrl, localizedRequest.locale);
    }

    if (normalizedRoutePath !== "/") {
      return new Response("Not Found", { status: 404 });
    }

    const html = await renderPageHtml(localizedRequest.locale);

    return new Response(request.method === "HEAD" ? null : html, {
      headers: {
        "cache-control": localizedHtmlCacheControl,
        "content-type": "text/html; charset=utf-8",
        "set-cookie": createLocaleCookie(localizedRequest.locale),
      },
    });
  };

  async function renderPageHtml(locale: Locale) {
    const htmlTemplate = await getIndexTemplate();
    return renderLocalizedHtml(htmlTemplate, getPortalCopy(locale));
  }

  async function getIndexTemplate() {
    if (cachedIndexTemplate) {
      return cachedIndexTemplate;
    }

    const templatePath = options.isDevelopment ? sourceHtmlPath : distHtmlPath;
    cachedIndexTemplate = await readFile(templatePath, "utf8");
    return cachedIndexTemplate;
  }

  async function getBuildManifest() {
    if (cachedManifest) {
      return cachedManifest;
    }

    if (!(await fileExists(distManifestPath))) {
      throw new Error(
        `Missing Vite manifest at ${distManifestPath}. Run \`bun run build\` first.`
      );
    }

    cachedManifest = JSON.parse(
      await readFile(distManifestPath, "utf8")
    ) as ViteManifest;
    return cachedManifest;
  }
}

function isStaticRoute(pathname: string) {
  if (passthroughStaticRoutes.has(pathname)) {
    return true;
  }

  if (staticRoutePrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  return staticFileExtensions.has(extname(pathname));
}

function getViteAssetProxyHeaders(requestHeaders: Headers) {
  const forwardedHeaders = new Headers();

  for (const headerName of viteAssetProxyHeaderAllowlist) {
    const headerValue = requestHeaders.get(headerName);

    if (!headerValue) {
      continue;
    }

    forwardedHeaders.set(headerName, headerValue);
  }

  return forwardedHeaders;
}

function getPortalCopy(locale: Locale) {
  setLocale(locale);
  const canonicalUrl = getLocalizedPageUrl(locale);

  return {
    alternateCsCzUrl: getLocalizedPageUrl("cs-CZ"),
    alternateDefaultUrl: `${portalOrigin}/`,
    alternateEnUsUrl: getLocalizedPageUrl("en-US"),
    barDescription: m.portalBarDescription(),
    barHeading: m.portalBarHeading(),
    barLabel: m.portalBarLabel(),
    canonicalUrl,
    kicker: m.portalKicker(),
    lang: locale,
    mainAriaLabel: m.portalMainAriaLabel(),
    metaDescription: m.portalMetaDescription(),
    productsAriaLabel: m.portalProductsAriaLabel(),
    title: m.portalTitle(),
    workspaceDescription: m.portalWorkspaceDescription(),
    workspaceHeading: m.portalWorkspaceHeading(),
    workspaceLabel: m.portalWorkspaceLabel(),
  };
}

function renderLocalizedHtml(htmlTemplate: string, copy: PortalCopy) {
  return htmlTemplate
    .replaceAll("__PORTAL_LANG__", escapeHtml(copy.lang))
    .replaceAll("__PORTAL_CANONICAL_URL__", escapeHtml(copy.canonicalUrl))
    .replaceAll("__PORTAL_ALTERNATE_CS_CZ__", escapeHtml(copy.alternateCsCzUrl))
    .replaceAll("__PORTAL_ALTERNATE_EN_US__", escapeHtml(copy.alternateEnUsUrl))
    .replaceAll(
      "__PORTAL_ALTERNATE_X_DEFAULT__",
      escapeHtml(copy.alternateDefaultUrl)
    )
    .replaceAll("__PORTAL_META_DESCRIPTION__", escapeHtml(copy.metaDescription))
    .replaceAll("__PORTAL_MAIN_ARIA_LABEL__", escapeHtml(copy.mainAriaLabel))
    .replaceAll(
      "__PORTAL_PRODUCTS_ARIA_LABEL__",
      escapeHtml(copy.productsAriaLabel)
    )
    .replaceAll("__PORTAL_TITLE__", escapeHtml(copy.title))
    .replaceAll("__PORTAL_KICKER__", escapeHtml(copy.kicker))
    .replaceAll("__PORTAL_BAR_HEADING__", escapeHtml(copy.barHeading))
    .replaceAll("__PORTAL_BAR_DESCRIPTION__", escapeHtml(copy.barDescription))
    .replaceAll("__PORTAL_BAR_LABEL__", escapeHtml(copy.barLabel))
    .replaceAll(
      "__PORTAL_WORKSPACE_HEADING__",
      escapeHtml(copy.workspaceHeading)
    )
    .replaceAll(
      "__PORTAL_WORKSPACE_DESCRIPTION__",
      escapeHtml(copy.workspaceDescription)
    )
    .replaceAll("__PORTAL_WORKSPACE_LABEL__", escapeHtml(copy.workspaceLabel));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function serveBuiltStaticFile(
  pathname: string,
  method: "GET" | "HEAD",
  options: {
    distDirectory: string;
    getBuildManifest: () => Promise<ViteManifest>;
  }
) {
  const filePath = await resolveStaticFilePath(pathname, options);

  if (!filePath || !(await fileExists(filePath))) {
    return new Response("Not Found", { status: 404 });
  }

  const fileContents = method === "HEAD" ? null : await readFile(filePath);
  const headers = new Headers();
  const contentType = getContentType(filePath);

  if (contentType) {
    headers.set("content-type", contentType);
  }

  if (isImmutableAssetPath(pathname)) {
    headers.set("cache-control", immutableAssetCacheControl);
  }

  return new Response(fileContents, { headers });
}

async function resolveStaticFilePath(
  pathname: string,
  options: {
    distDirectory: string;
    getBuildManifest: () => Promise<ViteManifest>;
  }
) {
  if (pathname === "/styles.css") {
    const manifest = await options.getBuildManifest();
    const stylesheetPath = getStylesheetPath(manifest);

    if (!stylesheetPath) {
      throw new Error("Missing built stylesheet alias for /styles.css.");
    }

    return resolveInsideDist(options.distDirectory, stylesheetPath);
  }

  return resolveInsideDist(options.distDirectory, pathname);
}

function resolveInsideDist(distDirectory: string, pathname: string) {
  const safeRelativePath = pathname.replace(/^\/+/, "");
  const resolvedPath = resolve(distDirectory, safeRelativePath);
  const resolvedDistDirectory = resolve(distDirectory);

  if (
    !resolvedPath.startsWith(`${resolvedDistDirectory}/`) &&
    resolvedPath !== resolvedDistDirectory
  ) {
    return null;
  }

  return resolvedPath;
}

function getStylesheetPath(manifest: ViteManifest) {
  const manifestEntry = manifest["index.html"];

  if (!manifestEntry) {
    return null;
  }

  return manifestEntry.css?.[0] ?? manifestEntry.file;
}

function getContentType(filePath: string) {
  return contentTypesByExtension[extname(filePath)] ?? null;
}

function isImmutableAssetPath(pathname: string) {
  return pathname.startsWith("/assets/");
}

function getLocalizedPageRequest(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const [localeSegment, ...routeSegments] = segments;

  if (!localeSegment || !isLocale(localeSegment)) {
    return null;
  }

  const routePath =
    routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;

  return {
    locale: assertIsLocale(localeSegment),
    routePath,
  } satisfies {
    locale: Locale;
    routePath: string;
  };
}

function hasUnsupportedLocalePrefix(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const localeSegment = segments[0];

  if (!localeSegment || isLocale(localeSegment)) {
    return false;
  }

  return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(localeSegment);
}

function redirectToLocalizedPage(requestUrl: URL, request: Request) {
  const resolvedLocale = resolveRequestLocale(requestUrl, request);
  const redirectUrl = new URL(`/${resolvedLocale}/`, requestUrl);

  return redirectResponse(redirectUrl, resolvedLocale);
}

function resolveRequestLocale(requestUrl: URL, request: Request): Locale {
  const localizedRequest = getLocalizedPageRequest(requestUrl.pathname);

  if (localizedRequest) {
    return localizedRequest.locale;
  }

  const cookieLocale = getLocaleFromCookie(request.headers.get("cookie"));

  if (cookieLocale) {
    return cookieLocale;
  }

  const headerLocale = extractLocaleFromHeader(request);

  if (headerLocale && isLocale(headerLocale)) {
    return assertIsLocale(headerLocale);
  }

  return baseLocale;
}

function getLocaleFromCookie(cookieHeader: string | null) {
  if (!cookieHeader) {
    return null;
  }

  const localeValue = cookieHeader
    .split(/;\s*/)
    .find((cookie) => cookie.startsWith(`${cookieName}=`))
    ?.split("=")[1];

  if (!localeValue || !isLocale(localeValue)) {
    return null;
  }

  return assertIsLocale(localeValue);
}

function createLocaleCookie(locale: Locale) {
  return `${cookieName}=${locale}; Max-Age=${cookieMaxAge}; Path=/; SameSite=Lax`;
}

function redirectResponse(redirectUrl: URL, locale: Locale) {
  return new Response(null, {
    status: 307,
    headers: {
      "cache-control": redirectCacheControl,
      location: redirectUrl.href,
      "set-cookie": createLocaleCookie(locale),
      vary: "Accept-Language, Cookie",
    },
  });
}

function getLocalizedPageUrl(locale: Locale) {
  return `${portalOrigin}/${locale}/`;
}

function getDistDirectory(appDirectory: string) {
  return join(appDirectory, "dist");
}

function getDistManifestPath(appDirectory: string) {
  return join(getDistDirectory(appDirectory), ".vite", "manifest.json");
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
