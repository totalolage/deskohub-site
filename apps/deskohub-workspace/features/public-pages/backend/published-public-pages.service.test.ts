import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect, Layer, Logger } from "effect";
import type { IWorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { MeetingRoomPageFeatureFlagService } from "@/features/meeting-room/backend/meeting-room-page-feature-flag.service";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { publicPages } from "../public-page-definitions";
import { PublishedPublicPagesService } from "./published-public-pages.service";

type FlagKey = Parameters<IWorkspaceFeatureFlagService["isEnabled"]>[0];
type FlagLookup = "on" | "off" | "unavailable";

const listPublishedPathnames = (
  flags: Partial<Record<FlagKey, FlagLookup>>
) => {
  const isEnabled = mock((key: FlagKey) => {
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
            MeetingRoomPageFeatureFlagService.Default,
            OfficeReservationFeatureFlagService.Default
          )
        ),
        Layer.provide(WorkspaceFeatureFlagServiceMock({ isEnabled }))
      )
    ),
    Effect.provide(Logger.layer([])),
    Effect.runPromise
  );
};

const ungatedPathnames = publicPages
  .filter(({ releaseGate }) => releaseGate === undefined)
  .map(({ pathname }) => pathname);

describe("PublishedPublicPagesService", () => {
  test("lists every public page while every release gate is on", async () => {
    await expect(
      listPublishedPathnames({ meeting_room_page: "on", office_page: "on" })
    ).resolves.toEqual(publicPages.map(({ pathname }) => pathname));
  });

  test("leaves out a gated page whose gate is off", async () => {
    const pathnames = await listPublishedPathnames({
      meeting_room_page: "on",
      office_page: "off",
    });

    expect(pathnames).not.toContain("/reservation/office");
    expect(pathnames).toContain("/meeting-room");
    expect(pathnames).toEqual(expect.arrayContaining(ungatedPathnames));
  });

  test("leaves out a gated page whose gate can't be evaluated", async () => {
    const pathnames = await listPublishedPathnames({
      meeting_room_page: "unavailable",
      office_page: "on",
    });

    expect(pathnames).not.toContain("/meeting-room");
    expect(pathnames).toContain("/reservation/office");
    expect(pathnames).toEqual(expect.arrayContaining(ungatedPathnames));
  });

  test("keeps ungated pages, in registry order, when every gate is off", async () => {
    await expect(
      listPublishedPathnames({ meeting_room_page: "off", office_page: "off" })
    ).resolves.toEqual(ungatedPathnames);
  });
});
