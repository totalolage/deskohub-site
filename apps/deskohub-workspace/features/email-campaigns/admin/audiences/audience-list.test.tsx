import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import "@/shared/testing/workspace-component-module-mocks";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CampaignAudienceId } from "../../campaign-identifiers";

mock.module("next/navigation", () => ({
  useParams: () => ({ locale: "cs-CZ" }),
  useRouter: () => ({ push: () => undefined }),
}));

const { AudienceList } = await import("./audience-list");

beforeAll(() => registerWorkspaceComponentTestEnv());
afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

test("shows the update time the server formatted for the locale", () => {
  const view = render(
    <RouteLocaleProvider locale="cs-CZ">
      <AudienceList
        audiences={[
          {
            id: "synthetic-audience" as CampaignAudienceId,
            title: "Synthetic regulars",
            summary: "Zákazníci, kteří mají účet ve Workspace",
            archived: false,
            updatedAt: "2026-10-14T08:00:00Z",
            updatedAtText: "14. října 2026 10:00",
          },
        ]}
      />
    </RouteLocaleProvider>
  );

  expect(view.getAllByText("14. října 2026 10:00").length).toBeGreaterThan(0);
  expect(view.getByText("Upraveno 14. října 2026 10:00")).toBeTruthy();
});
