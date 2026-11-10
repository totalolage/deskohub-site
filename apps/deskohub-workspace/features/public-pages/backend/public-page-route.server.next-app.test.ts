import { afterAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import { withNextAppFixture } from "@/shared/testing/next-app-fixture.test-utils";
import { postHogFeatureFlags } from "../../feature-flags/generated/contract";

// A production build of pages gated like the meeting-room page, served by
// `next start`, against a synthetic PostHog that answers the flag-definition
// list as each test sets it. Remote evaluation is never reached: the gate is
// constant or no classification could be read.
let definitionList: "meeting-room-off" | "unavailable" = "meeting-room-off";

const synthetic = {
  id: 1,
  uuid: "00000000-0000-4000-8000-000000000001",
  email: testEmailAddress("feature-flags"),
  hedgehog_config: null,
};
const definition = (key: string, index: number) => ({
  id: index + 1,
  key,
  name: key,
  active: key !== "meeting_room_page",
  archived: false,
  deleted: false,
  ensure_experience_continuity: false,
  filters: {
    groups: [{ properties: [], rollout_percentage: 100 }],
    multivariate: null,
    payloads: {},
  },
  created_by: synthetic,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_modified_by: synthetic,
  experiment_set: [],
  experiment_set_metadata: [],
  surveys: null,
  features: null,
  can_edit: true,
  usage_dashboard: null,
  user_access_level: null,
  status: "ACTIVE",
  last_called_at: null,
  is_used_in_replay_settings: false,
  is_eligible_for_experiment: false,
});

const postHog = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const { pathname } = new URL(request.url);
    if (!pathname.endsWith("/feature_flags/")) {
      return Response.json({ status: 1 });
    }
    if (definitionList === "unavailable") {
      return Response.json({ detail: "unavailable" }, { status: 503 });
    }
    const results = postHogFeatureFlags.keys.map(definition);
    return Response.json({ count: results.length, next: null, results });
  },
});
afterAll(() => postHog.stop(true));
const postHogOrigin = `http://127.0.0.1:${postHog.port}`;

const appRoot = resolve(import.meta.dir, "../../..");

const files = (pages: Readonly<Record<string, string>>) => ({
  "next.config.mjs": `
export default {
  cacheComponents: true,
  cacheLife: { publicContent: { stale: 30, revalidate: 60, expire: 300 } },
  experimental: { externalDir: true },
  typescript: { ignoreBuildErrors: true },
  webpack: (config) => {
    // A snapshot older than its age limit, so a failed list leaves the
    // flags unclassified.
    config.resolve.alias[${JSON.stringify(
      join(appRoot, "features/feature-flags/generated/flag-snapshot.ts")
    )}] = new URL(
      "./stale-flag-snapshot.ts",
      import.meta.url
    ).pathname;
    return config;
  },
};
`,
  "stale-flag-snapshot.ts": `
export const postHogFeatureFlagSnapshot = {
  generatedAt: "2020-01-01T00:00:00.000Z",
  constantValues: { meeting_room_page: true },
};
`,
  "test-env.ts": `
const values: Record<string, string> = {
  VERCEL_ENV: "production",
  POSTHOG_API_HOST: "${postHogOrigin}",
  POSTHOG_API_KEY: "phx_synthetic",
  POSTHOG_INGEST_HOST: "${postHogOrigin}",
  POSTHOG_PROJECT_ID: "1",
  POSTHOG_SERVICE_NAME: "deskohub-workspace-fixture",
  POSTHOG_SERVICE_NAMESPACE: "deskohub",
};
export const env = new Proxy(values, {
  get: (target, key) => (typeof key === "string" ? target[key] : undefined),
});
`,
  "app/[locale]/layout.tsx": `
export function generateStaticParams() {
  return [{ locale: "cs-CZ" }];
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <html lang={locale}><body>{children}</body></html>;
}
`,
  ...pages,
});

// The meeting-room page's gate, in its metadata and its static shell.
const gatedPage = `
import {
  publicPageMetadata,
  requirePublishedPublicPage,
} from "@/features/public-pages/backend/public-page-route.server";

export const instant = false;

export const generateMetadata = publicPageMetadata("/meeting-room");

export default async function GatedPage() {
  await requirePublishedPublicPage("/meeting-room");
  return <h1 id="published-page">Published</h1>;
}
`;

const fixture = <A>(
  name: string,
  pages: Readonly<Record<string, string>>,
  run: (url: string) => Promise<A>
) =>
  withNextAppFixture(
    {
      files: files(pages),
      mode: "production",
      name,
      paths: { "@/env": ["./test-env.ts"] },
    },
    ({ url }) => run(url)
  );

const read = async (url: string) => {
  const response = await fetch(url, { redirect: "manual" });
  const body = await response.text();
  return {
    status: response.status,
    published: body.includes('id="published-page"'),
    notFound: body.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
  };
};

describe("a gated public page in a production server", () => {
  test("answers a real 404 while PostHog turns its gate off", {
    timeout: 240_000,
  }, async () => {
    definitionList = "meeting-room-off";

    await fixture(
      "workspace-closed-public-page",
      {
        "app/[locale]/gated/page.tsx": gatedPage,
        "app/[locale]/gated-by-slug/[slug]/page.tsx": `${gatedPage}
export function generateStaticParams() {
  return [{ slug: "prerendered" }];
}
`,
      },
      async (url) => {
        // The prerendered page and a path the build never rendered.
        for (const path of ["/cs-CZ/gated", "/cs-CZ/gated-by-slug/on-demand"]) {
          const page = await read(`${url}${path}`);

          expect(page.status).toBe(404);
          expect(page.published).toBe(false);
        }
      }
    );
  });

  test("never answers not found while PostHog can't decide its gate", {
    timeout: 240_000,
  }, async () => {
    // No classification could be read. A prerender of the page would fail
    // the build, so this page renders per request, as one without a cached
    // copy does.
    definitionList = "unavailable";

    await fixture(
      "workspace-undecided-public-page",
      {
        "app/[locale]/per-request/page.tsx": `
import { connection } from "next/server";
import { requirePublishedPublicPage } from "@/features/public-pages/backend/public-page-route.server";

export const instant = false;

export default async function PerRequestPage() {
  await connection();
  await requirePublishedPublicPage("/meeting-room");
  return <h1 id="published-page">Published</h1>;
}
`,
      },
      async (url) => {
        const page = await read(`${url}/cs-CZ/per-request`);

        expect(page.published).toBe(false);
        expect(page.notFound).toBe(false);
        expect(page.status).not.toBe(404);
      }
    );
  });
});
