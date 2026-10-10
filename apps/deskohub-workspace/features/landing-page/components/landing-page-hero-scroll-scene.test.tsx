import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

let prefersReducedMotion = false;
const reducedMotionQueries = new Set<MediaQueryList>();
let originalMatchMedia: typeof window.matchMedia;

const setPrefersReducedMotion = (matches: boolean) => {
  prefersReducedMotion = matches;
  for (const query of reducedMotionQueries) {
    query.dispatchEvent(new Event("change"));
  }
};

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  originalMatchMedia = window.matchMedia;
  window.matchMedia = (query: string) => {
    const mediaQueryList = originalMatchMedia.call(window, query);

    if (query.includes("prefers-reduced-motion")) {
      Object.defineProperty(mediaQueryList, "matches", {
        configurable: true,
        get: () => prefersReducedMotion,
      });
      reducedMotionQueries.add(mediaQueryList);
    }

    return mediaQueryList;
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  setPrefersReducedMotion(false);
});

afterAll(async () => {
  window.matchMedia = originalMatchMedia;
  await unregisterWorkspaceComponentTestEnv();
});

describe("LandingPageHeroScrollScene", () => {
  test("hydrates server markup without mismatches for reduced-motion visitors", async () => {
    const { LandingPageHeroScrollScene } = await import(
      "./landing-page-hero-scroll-scene"
    );
    const scene = (
      <LandingPageHeroScrollScene
        ariaLabelledBy="hero-heading"
        background={<div />}
        bottomSection={<div />}
        id="overview"
      >
        <h1 id="hero-heading">Hero</h1>
      </LandingPageHeroScrollScene>
    );
    // The server cannot read the media query, so it renders the default state.
    const serverMarkup = renderToString(scene);
    setPrefersReducedMotion(true);

    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.append(container);
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const recoverableErrors: unknown[] = [];

    try {
      await act(async () => {
        hydrateRoot(container, scene, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });
      });

      expect(recoverableErrors).toEqual([]);
      expect(
        consoleError.mock.calls
          .map((call) => String(call[0]))
          .filter((message) => message.includes("hydrat"))
      ).toEqual([]);
      // Reduced-motion visitors get the scroll transforms neutralized in CSS.
      const animatedLayers = [
        ...container.querySelectorAll<HTMLElement>("[style*='transform']"),
      ];
      expect(animatedLayers).toHaveLength(2);
      for (const layer of animatedLayers) {
        expect(layer.classList).toContain("motion-reduce:transform-none!");
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});
