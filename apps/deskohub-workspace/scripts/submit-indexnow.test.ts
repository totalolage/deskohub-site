import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSitemap } from "next/dist/build/webpack/loaders/metadata/resolve-route-data";
import { getWorkspaceAlternates, locales } from "@/features/i18n";
import { indexNowKey, publicPages } from "@/features/public-pages";
import { runCommand } from "./shared/command";

const scriptPath = fileURLToPath(
  new URL("./submit-indexnow.ts", import.meta.url)
);
const fixturePath = fileURLToPath(
  new URL("./submit-indexnow.http-fixture.ts", import.meta.url)
);
const workspaceRoot = resolve(import.meta.dir, "..");

// Every registry page in both locales, rendered the way the production
// sitemap renders it, including the hreflang alternates.
const canonicalPages = publicPages.flatMap(({ pathname }) =>
  locales.map((locale) => {
    const { canonical, languages } = getWorkspaceAlternates(locale, pathname);
    return { url: canonical, alternates: { languages } };
  })
);
const previewUrl = "https://deskohub-workspace-git-feature.vercel.app/en-US";
const sitemap = resolveSitemap([...canonicalPages, { url: previewUrl }]);

interface IndexNowRequest {
  readonly contentType: string | null;
  readonly body: string;
}

let recordDirectory: string | undefined;
afterEach(() => {
  if (recordDirectory)
    rmSync(recordDirectory, { recursive: true, force: true });
  recordDirectory = undefined;
});

const submit = async ({
  indexNowStatus = "200",
  sitemapStatus = "200",
}: {
  readonly indexNowStatus?: string;
  readonly sitemapStatus?: string;
}) => {
  recordDirectory = mkdtempSync(join(tmpdir(), "indexnow-"));
  const recordFile = join(recordDirectory, "requests.jsonl");
  const result = await runCommand(
    [process.execPath, "--preload", fixturePath, scriptPath],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        INDEXNOW_FIXTURE_RECORD: recordFile,
        INDEXNOW_FIXTURE_SITEMAP: sitemap,
        INDEXNOW_FIXTURE_SITEMAP_STATUS: sitemapStatus,
        INDEXNOW_FIXTURE_STATUS: indexNowStatus,
      },
      timeoutMs: 20_000,
    }
  );
  const requests: ReadonlyArray<IndexNowRequest> = existsSync(recordFile)
    ? readFileSync(recordFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
  return { ...result, output: `${result.stdout}${result.stderr}`, requests };
};

describe("submit-indexnow", () => {
  test("submits the canonical sitemap pages of both locales with the served key", async () => {
    const result = await submit({ indexNowStatus: "200" });

    expect(result.exitCode).toBe(0);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.contentType).toBe(
      "application/json; charset=utf-8"
    );
    expect(JSON.parse(result.requests[0]?.body ?? "")).toEqual({
      host: "workspace.deskohub.cz",
      key: indexNowKey,
      keyLocation: `https://workspace.deskohub.cz/${indexNowKey}.txt`,
      urlList: canonicalPages.map(({ url }) => url),
    });
  });

  test("never submits a URL outside the canonical production origin", async () => {
    const result = await submit({ indexNowStatus: "202" });
    const { urlList } = JSON.parse(result.requests[0]?.body ?? "");

    expect(urlList).not.toContain(previewUrl);
    for (const url of urlList) {
      expect(new URL(url).origin).toBe("https://workspace.deskohub.cz");
    }
  });

  test("logs the accepted status and URL count without the key", async () => {
    const result = await submit({ indexNowStatus: "202" });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("IndexNow accepted the published pages");
    expect(result.output).toContain("status=202");
    expect(result.output).toContain(`urlCount=${canonicalPages.length}`);
    expect(result.output).not.toContain(indexNowKey);
  });

  test("warns without failing when IndexNow rejects the submission", async () => {
    const result = await submit({ indexNowStatus: "403" });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      "::warning title=IndexNow submission skipped::IndexNow answered HTTP 403"
    );
    expect(result.output).not.toContain(indexNowKey);
  });

  test("warns without failing when IndexNow is unreachable", async () => {
    const result = await submit({ indexNowStatus: "unreachable" });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      "::warning title=IndexNow submission skipped::The IndexNow request failed"
    );
    expect(result.output).not.toContain(indexNowKey);
  });

  test("submits nothing and warns when the production sitemap can't be read", async () => {
    const result = await submit({ sitemapStatus: "404" });

    expect(result.exitCode).toBe(0);
    expect(result.requests).toHaveLength(0);
    expect(result.output).toContain(
      "::warning title=IndexNow submission skipped::The production sitemap could not be read"
    );
  });
});
