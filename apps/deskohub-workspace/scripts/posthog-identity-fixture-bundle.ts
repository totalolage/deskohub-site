import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const fixturePath = join(
  appRoot,
  "shared/testing/posthog-identity-browser-fixture.tsx"
);

export const posthogProjectToken = "phc_posthog_identity_browser_fixture";

const createBuildPlugin = (posthogHost: string): Bun.BunPlugin => ({
  name: "posthog-identity-browser-build",
  setup(build) {
    const envNamespace = "posthog-identity-fixture-env";
    const navigationNamespace = "posthog-identity-fixture-navigation";
    const sourceExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

    const fileExists = async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    };

    const resolveAppModule = async (specifier: string) => {
      const candidate = join(appRoot, specifier);
      for (const extension of sourceExtensions) {
        const path = `${candidate}${extension}`;
        if (await fileExists(path)) return path;
      }
      for (const extension of sourceExtensions.slice(1)) {
        const path = join(candidate, `index${extension}`);
        if (await fileExists(path)) return path;
      }
      throw new Error(`missing app module: ${specifier}`);
    };

    // The browser has no `process`, so both the server env and the
    // browser-visible client env resolve to the fixture's PostHog settings.
    build.onResolve({ filter: /^@\/(?:client-)?env$/ }, () => ({
      namespace: envNamespace,
      path: "env",
    }));
    build.onLoad({ filter: /^env$/, namespace: envNamespace }, () => ({
      contents: `export const env = { NEXT_PUBLIC_POSTHOG_HOST: ${JSON.stringify(
        posthogHost
      )}, NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: ${JSON.stringify(
        posthogProjectToken
      )} } as const;\nexport const getClientEnv = () => env;`,
      loader: "ts",
    }));

    build.onResolve({ filter: /^@\// }, async (args) => ({
      path: await resolveAppModule(args.path.slice(2)),
    }));

    build.onResolve({ filter: /^next\/navigation$/ }, () => ({
      namespace: navigationNamespace,
      path: "navigation",
    }));
    build.onLoad(
      { filter: /^navigation$/, namespace: navigationNamespace },
      () => ({
        contents: `
          export const usePathname = () => globalThis.location.pathname;
          export const useSearchParams = () => new URLSearchParams(globalThis.location.search);
          export const useParams = () => ({});
          export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {} });
          export const redirect = () => {};
          export const notFound = () => {};
          export const unstable_rethrow = () => {};
        `,
        loader: "js",
      })
    );
  },
});

/**
 * Bundles the PostHog identity browser fixture exactly as the browser check
 * serves it. Shared with the bundle guard test so CI notices when an import
 * change leaks server or env modules into the browser bundle.
 */
export const buildPosthogIdentityFixtureBundle = (
  posthogHost: string,
  outdir: string
) =>
  Bun.build({
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    entrypoints: [fixturePath],
    format: "esm",
    minify: false,
    outdir,
    plugins: [createBuildPlugin(posthogHost)],
    sourcemap: "none",
    target: "browser",
  });
