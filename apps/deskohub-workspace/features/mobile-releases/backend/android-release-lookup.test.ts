import { describe, expect, test } from "bun:test";
import { Effect, Exit, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  androidReleaseNotes,
  githubMobileRelease,
} from "../android-release.test-utils";
import {
  findLatestAndroidRelease,
  MobileReleaseLookupError,
} from "./android-release-lookup";
import { fakeGitHubApi } from "./github-api.test-utils";

const lookUp = (api: ReturnType<typeof fakeGitHubApi>) =>
  findLatestAndroidRelease().pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, api.fetch),
    Effect.runPromiseExit
  );

const refs = (...tags: string[]) =>
  Response.json(tags.map((tag) => ({ ref: `refs/tags/${tag}` })));

describe("findLatestAndroidRelease", () => {
  test("looks up only the highest mobile tag when it has a usable release", async () => {
    const api = fakeGitHubApi({
      "/git/matching-refs/tags/mobile-v": () =>
        refs("mobile-v1.9.0", "mobile-v1.10.0", "mobile-v1.2", "mobile-v1.2.0"),
      "/releases/tags/mobile-v1.10.0": () =>
        Response.json(githubMobileRelease("1.10.0")),
    });

    const exit = await lookUp(api);

    expect(exit).toEqual(
      Exit.succeed(
        Option.some(expect.objectContaining({ versionName: "1.10.0" }))
      )
    );
    expect(api.requests.map(({ path }) => path)).toEqual([
      "/repos/totalolage/deskohub-site/git/matching-refs/tags/mobile-v",
      "/repos/totalolage/deskohub-site/releases/tags/mobile-v1.10.0",
    ]);
    for (const { headers } of api.requests) {
      expect(headers.get("accept")).toBe("application/vnd.github+json");
      expect(headers.get("x-github-api-version")).toMatch(
        /^\d{4}-\d{2}-\d{2}$/
      );
      expect(headers.get("user-agent")).toBe("deskohub-workspace");
      expect(headers.get("authorization")).toBeNull();
    }
  });

  test("falls back to the next tag when a tag has no published release", async () => {
    const api = fakeGitHubApi({
      "/git/matching-refs/tags/mobile-v": () =>
        refs("mobile-v1.0.0", "mobile-v1.1.0"),
      "/releases/tags/mobile-v1.1.0": () =>
        Response.json({ message: "Not Found" }, { status: 404 }),
      "/releases/tags/mobile-v1.0.0": () =>
        Response.json(githubMobileRelease("1.0.0")),
    });

    expect(await lookUp(api)).toEqual(
      Exit.succeed(
        Option.some(expect.objectContaining({ versionName: "1.0.0" }))
      )
    );
  });

  test("falls back to the next tag when a release isn't usable", async () => {
    const api = fakeGitHubApi({
      "/git/matching-refs/tags/mobile-v": () =>
        refs("mobile-v1.0.0", "mobile-v1.1.0"),
      "/releases/tags/mobile-v1.1.0": () =>
        Response.json(
          githubMobileRelease("1.1.0", {
            body: androidReleaseNotes("1.1.0", {
              certificateSha256: "00:".repeat(31).concat("00"),
            }),
          })
        ),
      "/releases/tags/mobile-v1.0.0": () =>
        Response.json(githubMobileRelease("1.0.0")),
    });

    expect(await lookUp(api)).toEqual(
      Exit.succeed(
        Option.some(expect.objectContaining({ versionName: "1.0.0" }))
      )
    );
  });

  test("finds no release without mobile tags", async () => {
    const api = fakeGitHubApi({
      "/git/matching-refs/tags/mobile-v": () => refs(),
    });

    expect(await lookUp(api)).toEqual(Exit.succeed(Option.none()));
    expect(api.requests).toHaveLength(1);
  });

  test("gives up after the three highest tags", async () => {
    const api = fakeGitHubApi({
      "/git/matching-refs/tags/mobile-v": () =>
        refs(
          "mobile-v1.0.0",
          "mobile-v1.1.0",
          "mobile-v1.2.0",
          "mobile-v1.3.0"
        ),
    });

    expect(await lookUp(api)).toEqual(Exit.succeed(Option.none()));
    expect(api.requests.map(({ path }) => path.split("/").at(-1))).toEqual([
      "mobile-v",
      "mobile-v1.3.0",
      "mobile-v1.2.0",
      "mobile-v1.1.0",
    ]);
  });

  test("fails when GitHub can't list the tags", async () => {
    const api = fakeGitHubApi({
      "/git/matching-refs/tags/mobile-v": () =>
        new Response("unavailable", { status: 503 }),
    });

    expectLookupFailure(await lookUp(api));
  });

  test("fails, rather than finding nothing, when GitHub can't serve a release", async () => {
    const api = fakeGitHubApi({
      "/git/matching-refs/tags/mobile-v": () => refs("mobile-v1.0.0"),
      "/releases/tags/mobile-v1.0.0": () =>
        new Response("bad gateway", { status: 502 }),
    });

    expectLookupFailure(await lookUp(api));
  });

  test("fails when the rate limit is spent", async () => {
    const api = fakeGitHubApi({
      "/git/matching-refs/tags/mobile-v": () =>
        Response.json(
          { message: "API rate limit exceeded" },
          { status: 403, headers: { "x-ratelimit-remaining": "0" } }
        ),
    });

    expectLookupFailure(await lookUp(api));
  });

  test("fails on a response it can't read", async () => {
    for (const api of [
      fakeGitHubApi({
        "/git/matching-refs/tags/mobile-v": () =>
          new Response("{not json", {
            headers: { "content-type": "application/json" },
          }),
      }),
      fakeGitHubApi({
        "/git/matching-refs/tags/mobile-v": () => refs("mobile-v1.0.0"),
        "/releases/tags/mobile-v1.0.0": () =>
          Response.json({ tag_name: "mobile-v1.0.0" }),
      }),
    ]) {
      expectLookupFailure(await lookUp(api));
    }
  });
});

const expectLookupFailure = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  expect(
    Exit.findErrorOption(exit).pipe(
      Option.map((error) => error instanceof MobileReleaseLookupError)
    )
  ).toEqual(Option.some(true));
};
