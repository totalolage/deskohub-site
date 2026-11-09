import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { renderOnLocaleRoute } from "@/features/gallery/components/gallery-render.test-utils";
import { getLocale, m, setLocale } from "@/features/i18n";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

let NotFound: typeof import("./not-found").NotFound;

beforeAll(async () => {
  setBoardgameTestEnv();
  // Next's bundler imports a PNG as StaticImageData; Bun imports its path.
  mock.module("@/assets/images/logo/for-light-bg.png", () => ({
    default: {
      src: "/_next/static/media/for-light-bg.png",
      width: 4096,
      height: 4096,
    },
  }));
  ({ NotFound } = await import("./not-found"));
});

// Rendering adopts the route's locale; keep it from leaking into other tests.
const initialLocale = getLocale();

afterEach(() => {
  setLocale(initialLocale, { reload: false });
});

const escaped = (text: string) => Bun.escapeHTML(text);

/** The attributes and content of each rendered `<button>`. */
const buttonsOf = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(
    ([, attributes = "", content = ""]) => ({
      classes: /class="([^"]*)"/.exec(attributes)?.[1]?.split(" "),
      disabled: /\sdisabled=""/.test(attributes),
      content,
    })
  );

describe("NotFound", () => {
  test("explains the missing page and links back home", () => {
    const html = renderOnLocaleRoute(<NotFound />);

    expect(html).toContain(escaped(m["notFound.title"]()));
    expect(html).toContain(escaped(m["notFound.description"]()));
    const links = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)];
    expect(links.map(([, href]) => href)).toEqual(["/"]);
    expect(links[0]?.[2]).toContain(escaped(m["notFound.homeButton"]()));
  });

  test("shows the fourth die face and an enabled roll button before the first roll", () => {
    const [die, rollAgain] = buttonsOf(renderOnLocaleRoute(<NotFound />));

    expect(die?.content).toContain("lucide-dice-4");
    expect(die?.classes).toContain("hover:scale-110");
    expect(die?.classes).not.toContain("animate-spin");
    expect(rollAgain?.disabled).toBe(false);
    expect(rollAgain?.content).toContain(
      escaped(m["notFound.rollAgainButton"]())
    );
    expect(rollAgain?.content).not.toContain("animate-spin");
  });
});
