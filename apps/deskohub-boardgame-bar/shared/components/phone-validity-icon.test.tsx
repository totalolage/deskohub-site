import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PhoneValidityIcon } from "./phone-validity-icon";

const iconClassesOf = (html: string) =>
  /<svg[^>]*class="([^"]*)"/.exec(html)?.[1]?.split(" ");

describe("PhoneValidityIcon", () => {
  test("shows a green check for a valid number", () => {
    const classes = iconClassesOf(
      renderToStaticMarkup(<PhoneValidityIcon isValid />)
    );

    expect(classes).toContain("lucide-check");
    expect(classes).toContain("text-green-500");
  });

  test("shows a red cross for an invalid number", () => {
    const classes = iconClassesOf(
      renderToStaticMarkup(<PhoneValidityIcon isValid={false} />)
    );

    expect(classes).toContain("lucide-x");
    expect(classes).toContain("text-red-500");
  });
});
