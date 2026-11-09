import { describe, expect, test } from "bun:test";
import { getAdministrationExternalOrderPageIds } from "./listing";

describe("administration listings", () => {
  test("paginates provider ordering with unavailable references last", () => {
    expect(
      getAdministrationExternalOrderPageIds({
        offset: 1,
        orderedExternalIds: ["provider-c", "provider-a", "provider-b"],
        pageSize: 3,
        references: [
          { externalId: "provider-a", id: "workspace-a" },
          { externalId: "provider-b", id: "workspace-b" },
          { externalId: "provider-c", id: "workspace-c" },
          { externalId: null, id: "workspace-missing-b" },
          { externalId: "provider-missing", id: "workspace-missing-a" },
        ],
      })
    ).toEqual(["workspace-a", "workspace-b", "workspace-missing-a"]);
  });
});
