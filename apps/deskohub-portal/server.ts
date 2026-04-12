import { extname, join, resolve } from "node:path";

const appDirectory = import.meta.dir;
const sourceHtmlPath = join(appDirectory, "index.html");
const distDirectory = join(appDirectory, "dist");
const distManifestPath = join(distDirectory, ".vite", "manifest.json");
const pageRoutes = new Set(["/", "/index.html"]);
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

const server = Bun.serve({
  port,
  development: isDevelopment,
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const { pathname, search } = requestUrl;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (pageRoutes.has(pathname)) {
      const html = await renderPageHtml();
      return new Response(request.method === "HEAD" ? null : html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (isStaticRoute(pathname)) {
      return isDevelopment
        ? fetch(`${viteOrigin}${pathname}${search}`)
        : serveBuiltStaticFile(pathname, request.method);
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

async function renderPageHtml() {
  const htmlTemplate = await getIndexTemplate();

  if (isDevelopment) {
    return htmlTemplate;
  }

  const manifest = await getBuildManifest();
  const stylesheetPath = getStylesheetPath(manifest);

  if (!stylesheetPath) {
    throw new Error(
      "Missing built stylesheet for portal index.html in Vite manifest."
    );
  }

  return htmlTemplate.replace(
    'href="/styles.css"',
    `href="/${stylesheetPath}"`
  );
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
