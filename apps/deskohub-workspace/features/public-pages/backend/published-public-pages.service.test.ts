import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect, Layer, Logger, Result } from "effect";
import type { IWorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import { ReleaseGateUnavailableError } from "@/features/feature-flags/backend/release-gate";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { MeetingRoomPageReleaseGate } from "@/features/meeting-room/backend/meeting-room-page-release-gate";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { publicPages } from "../public-page-definitions";
import { PublishedPublicPagesService } from "./published-public-pages.service";

type FlagKey = Parameters<IWorkspaceFeatureFlagService["isEnabled"]>[0];
type FlagLookup = "on" | "off" | "unavailable";

const listPublishedPathnames = (
  flags: Partial<Record<FlagKey, FlagLookup>>
) => {
  // The list is stored in pages and the sitemap, so it reads each gate's
  // decision for stored output, never its fail-closed answer.
  const decision = mock((key: FlagKey) => {
    const lookup = flags[key];
    if (lookup === undefined) {
      return Effect.die(`Unexpected lookup of ${key}`);
    }
    return lookup === "unavailable"
      ? Effect.fail(
          new PostHogFeatureFlagEvaluationError({
            message: "Could not evaluate the PostHog feature flag.",
            cause: undefined,
          })
        )
      : Effect.succeed(lookup === "on");
  });

  return PublishedPublicPagesService.pipe(
    Effect.flatMap((publishedPages) => publishedPages.list),
    Effect.map((pages) => pages.map(({ pathname }) => pathname)),
    Effect.provide(
      PublishedPublicPagesService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            MeetingRoomPageReleaseGate.Default,
            OfficeReleaseGate.Default
          )
        ),
        Layer.provide(WorkspaceFeatureFlagServiceMock({ decision }))
      )
    ),
    Effect.provide(Logger.layer([])),
    Effect.result,
    Effect.runPromise
  );
};

const published = async (flags: Partial<Record<FlagKey, FlagLookup>>) => {
  const result = await listPublishedPathnames(flags);
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
};

const ungatedPathnames = publicPages
  .filter(({ releaseGate }) => releaseGate === undefined)
  .map(({ pathname }) => pathname);

describe("PublishedPublicPagesService", () => {
  test("lists every public page while every release gate is on", async () => {
    await expect(
      published({ meeting_room_page: "on", office_page: "on" })
    ).resolves.toEqual(publicPages.map(({ pathname }) => pathname));
  });

  test("leaves out a gated page whose gate is off", async () => {
    const pathnames = await published({
      meeting_room_page: "on",
      office_page: "off",
    });

    expect(pathnames).not.toContain("/reservation/office");
    expect(pathnames).toContain("/meeting-room");
    expect(pathnames).toEqual(expect.arrayContaining(ungatedPathnames));
  });

  test("fails instead of leaving out a gated page whose gate PostHog can't decide", async () => {
    const result = await listPublishedPathnames({
      meeting_room_page: "unavailable",
      office_page: "on",
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ReleaseGateUnavailableError);
      expect(result.failure.flags).toEqual(["meeting_room_page"]);
    }
  });

  test("keeps ungated pages, in registry order, when every gate is off", async () => {
    await expect(
      published({ meeting_room_page: "off", office_page: "off" })
    ).resolves.toEqual(ungatedPathnames);
  });
});
