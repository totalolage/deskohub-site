import { extname, join, resolve } from "node:path";

import { baseLocale, m, setLocale } from "./features/i18n";
import {
  assertIsLocale,
  cookieName,
  extractLocaleFromHeader,
  isLocale,
  type Locale,
} from "./features/i18n/paraglide/runtime.js";

const appDirectory = import.meta.dir;
const sourceHtmlPath = join(appDirectory, "index.html");
const distDirectory = join(appDirectory, "dist");
const distManifestPath = join(distDirectory, ".vite", "manifest.json");
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
const isDevelopment =
  process.env.PORTAL_DEV === "1" || process.env.NODE_ENV === "development";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const vitePort = Number.parseInt(process.env.VITE_PORT ?? "5173", 10);
const viteOrigin = `http://127.0.0.1:${vitePort}`;

type ViteManifest = Record<string, { css?: string[]; file: string }>;

let cachedIndexTemplate: string | null = null;
let cachedManifest: ViteManifest | null = null;

type PortalCopy = ReturnType<typeof getPortalCopy>;

await assertProductionBuildReady();

const server = Bun.serve({
  port,
  development: isDevelopment,
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const { pathname, search } = requestUrl;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (isStaticRoute(pathname)) {
      return isDevelopment
        ? fetch(`${viteOrigin}${pathname}${search}`)
        : serveBuiltStaticFile(pathname, request.method);
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

    if (normalizedRoutePath === "/") {
      const html = await renderPageHtml(localizedRequest.locale);
      return new Response(request.method === "HEAD" ? null : html, {
        headers: {
          "set-cookie": createLocaleCookie(localizedRequest.locale),
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

if (server.port !== port) {
  throw new Error(`Portal server failed to bind to port ${port}.`);
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

async function renderPageHtml(locale: Locale) {
  const htmlTemplate = await getIndexTemplate();
  const localizedHtml = renderLocalizedHtml(
    htmlTemplate,
    getPortalCopy(locale)
  );

  if (isDevelopment) {
    return localizedHtml;
  }

  const manifest = await getBuildManifest();
  const stylesheetPath = getStylesheetPath(manifest);

  if (!stylesheetPath) {
    throw new Error(
      "Missing built stylesheet for portal index.html in Vite manifest."
    );
  }

  return localizedHtml.replace(
    'href="/styles.css"',
    `href="/${stylesheetPath}"`
  );
}

function getPortalCopy(locale: Locale) {
  setLocale(locale);

  return {
    lang: locale,
    metaDescription: m.portalMetaDescription(),
    mainAriaLabel: m.portalMainAriaLabel(),
    productsAriaLabel: m.portalProductsAriaLabel(),
    title: m.portalTitle(),
    kicker: m.portalKicker(),
    barDescription: m.portalBarDescription(),
    barHeading: m.portalBarHeading(),
    barLabel: m.portalBarLabel(),
    workspaceDescription: m.portalWorkspaceDescription(),
    workspaceHeading: m.portalWorkspaceHeading(),
    workspaceLabel: m.portalWorkspaceLabel(),
  };
}

function renderLocalizedHtml(htmlTemplate: string, copy: PortalCopy) {
  return htmlTemplate
    .replaceAll("__PORTAL_LANG__", escapeHtml(copy.lang))
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

async function getIndexTemplate() {
  if (cachedIndexTemplate) {
    return cachedIndexTemplate;
  }

  const htmlTemplate = await Bun.file(sourceHtmlPath).text();
  cachedIndexTemplate = htmlTemplate;
  return htmlTemplate;
}

async function getBuildManifest() {
  if (cachedManifest) {
    return cachedManifest;
  }

  const manifestFile = Bun.file(distManifestPath);

  if (!(await manifestFile.exists())) {
    throw new Error(
      `Missing Vite manifest at ${distManifestPath}. Run \`bun run build\` first.`
    );
  }

  const manifest = (await manifestFile.json()) as ViteManifest;
  cachedManifest = manifest;
  return manifest;
}

async function serveBuiltStaticFile(pathname: string, method: "GET" | "HEAD") {
  const filePath = await resolveStaticFilePath(pathname);

  if (!filePath) {
    return new Response("Not Found", { status: 404 });
  }

  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(method === "HEAD" ? null : file);
}

async function resolveStaticFilePath(pathname: string) {
  if (pathname === "/styles.css") {
    const manifest = await getBuildManifest();
    const stylesheetPath = getStylesheetPath(manifest);

    if (!stylesheetPath) {
      throw new Error("Missing built stylesheet alias for /styles.css.");
    }

    return resolveInsideDist(stylesheetPath);
  }

  return resolveInsideDist(pathname);
}

function resolveInsideDist(pathname: string) {
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

async function assertProductionBuildReady() {
  if (isDevelopment) {
    return;
  }

  const manifestFile = Bun.file(distManifestPath);

  if (await manifestFile.exists()) {
    return;
  }

  throw new Error(
    `Missing Vite manifest at ${distManifestPath}. Run \`bun run build\` before starting the portal server.`
  );
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
  return `${cookieName}=${locale}; Max-Age=34560000; Path=/; SameSite=Lax`;
}

function redirectResponse(redirectUrl: URL, locale: Locale) {
  return new Response(null, {
    status: 307,
    headers: {
      location: redirectUrl.href,
      "set-cookie": createLocaleCookie(locale),
      vary: "Accept-Language",
    },
  });
}
