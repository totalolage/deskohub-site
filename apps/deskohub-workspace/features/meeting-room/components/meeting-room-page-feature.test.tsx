import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { workspaceUseFeatureFlagEnabled as useFeatureFlagEnabled } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

describe("MeetingRoomPageFeature", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    useFeatureFlagEnabled.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders its content only while the PostHog flag is enabled", async () => {
    const { MeetingRoomPageFeature } = await import(
      "./meeting-room-page-feature"
    );
    useFeatureFlagEnabled.mockReturnValue(false);

    const view = render(
      <MeetingRoomPageFeature initialEnabled>
        <p>Meeting room</p>
      </MeetingRoomPageFeature>
    );

    expect(view.queryByText("Meeting room")).toBeNull();
    expect(useFeatureFlagEnabled).toHaveBeenCalledWith(
      "meeting_room_page",
      true
    );
  });
});
