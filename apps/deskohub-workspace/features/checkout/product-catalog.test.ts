import { describe, expect, test } from "bun:test";
import {
  getWorkspaceProductMessage,
  workspaceProductTierCardMessages,
  workspaceProductTierMessages,
} from "./product-catalog.i18n";

describe("workspace product catalog", () => {
  test("does not advertise post-mix water", () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const basicCopy = [
        getWorkspaceProductMessage(
          workspaceProductTierMessages.basic.description,
          locale
        ),
        ...workspaceProductTierCardMessages.basic.perks.map(({ message }) =>
          getWorkspaceProductMessage(message, locale)
        ),
      ].join(" ");

      expect(basicCopy.toLocaleLowerCase(locale)).not.toMatch(/post.?mix/);
    }
  });
});
