import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { PreferenceRow } from "@/shared/components/ui/preference-row";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

beforeAll(registerWorkspaceComponentTestEnv);

afterEach(cleanup);

afterAll(unregisterWorkspaceComponentTestEnv);

function renderRow(props: Partial<Parameters<typeof PreferenceRow>[0]> = {}) {
  return render(
    <PreferenceRow
      description="Synthetic description"
      descriptionId="synthetic-description-id"
      title="Synthetic title"
      titleId="synthetic-title-id"
      {...props}
    />
  );
}

function getArticle(view: ReturnType<typeof render>) {
  const article = view.container.querySelector("article");
  if (!article) throw new Error("Preference row was not rendered");
  return article;
}

test("keeps the preference-row data slot despite a caller-supplied data-slot", () => {
  const view = renderRow({ "data-slot": "x" } as never);

  expect(getArticle(view).getAttribute("data-slot")).toBe("preference-row");
});

test("keeps base layout classes over conflicting caller utilities while non-conflicting ones survive", () => {
  const view = renderRow({ className: "p-0 gap-0 block mb-2" });
  const classNames = getArticle(view).className;

  expect(classNames).toContain("p-5");
  expect(classNames).toContain("gap-5");
  expect(classNames).toContain("flex");
  expect(classNames).not.toContain("p-0");
  expect(classNames).not.toContain("gap-0");
  expect(classNames).not.toContain("block");
  expect(classNames).toContain("mb-2");
});
