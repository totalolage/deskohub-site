import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { renderHook } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { useCredentialFreeDocumentUrl } from "./credential-free-url";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

const openDocument = (href: string) => {
  window.happyDOM.setURL(href);
  return spyOn(window.location, "replace").mockImplementation(() => {});
};

describe("useCredentialFreeDocumentUrl", () => {
  afterEach(() => {
    window.happyDOM.setURL("http://localhost/");
  });

  test("reloads a document opened with embedded credentials without them", () => {
    const replace = openDocument(
      "https://admin:secret@workspace.deskohub.cz/admin/reservations/1?tab=a"
    );

    renderHook(() => useCredentialFreeDocumentUrl());

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(
      "https://workspace.deskohub.cz/admin/reservations/1?tab=a"
    );
    replace.mockRestore();
  });

  test("leaves a credential-free document in place", () => {
    const replace = openDocument(
      "https://workspace.deskohub.cz/admin/reservations/1"
    );

    renderHook(() => useCredentialFreeDocumentUrl());

    expect(replace).not.toHaveBeenCalled();
    replace.mockRestore();
  });
});
