import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type InteractiveMapProps = {
  readonly onMount: (container: HTMLElement) => void;
  readonly onMoveStart: () => void;
  readonly onTilesLoad: () => void;
};

// Stands in for Leaflet: mounts a focusable container and lets each test
// report the map's first move or its loaded tiles.
mock.module("./landing-page-interactive-map", () => ({
  LandingPageInteractiveMap: ({
    onMount,
    onMoveStart,
    onTilesLoad,
  }: InteractiveMapProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // Report the mount once, as the real map does.
    const onMountRef = useRef(onMount);
    useEffect(() => {
      if (containerRef.current) onMountRef.current(containerRef.current);
    }, []);
    return (
      <div data-testid="interactive-map" ref={containerRef} tabIndex={-1}>
        <button onClick={onMoveStart} type="button">
          move
        </button>
        <button onClick={onTilesLoad} type="button">
          tiles
        </button>
      </div>
    );
  },
}));

const label = "Location map";
const activateLabel = "Explore the map";

const { LandingPageLocationMap } = await import("./landing-page-location-map");

const renderMap = () =>
  render(
    <LandingPageLocationMap activateLabel={activateLabel} label={label} />
  );

const staticMap = (view: ReturnType<typeof render>) =>
  view.container.querySelector("picture");

const openStreetMapLink = (view: ReturnType<typeof render>) =>
  view.container.querySelector(
    'a[href="https://www.openstreetmap.org/copyright"]'
  );

const activate = async (view: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: activateLabel }));
  });
  return view.findByTestId("interactive-map");
};

describe("LandingPageLocationMap", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("shows the static map, the activate button and the attribution until asked", () => {
    const view = renderMap();

    expect(view.getByRole("region", { name: label })).toBeDefined();
    expect(staticMap(view)).not.toBeNull();
    expect(view.getByRole("button", { name: activateLabel })).toBeDefined();
    expect(openStreetMapLink(view)).not.toBeNull();
    expect(view.queryByTestId("interactive-map")).toBeNull();
  });

  test("only preloads on focus or a mouse pointer, without mounting the map", () => {
    const view = renderMap();
    const button = view.getByRole("button", { name: activateLabel });

    fireEvent.pointerEnter(button, { pointerType: "touch" });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    fireEvent.focus(button);

    expect(view.queryByTestId("interactive-map")).toBeNull();
    expect(view.getByRole("button", { name: activateLabel })).toBe(button);
  });

  test("mounts the interactive map and drops the button and attribution", async () => {
    const view = renderMap();
    const map = await activate(view);

    expect(map).toBeDefined();
    expect(view.queryByRole("button", { name: activateLabel })).toBeNull();
    expect(openStreetMapLink(view)).toBeNull();
    // The static map stays until the interactive map moves or covers it.
    expect(staticMap(view)).not.toBeNull();
    expect(document.activeElement).not.toBe(map);
  });

  test("moves focus into the map when the activate button still has it", async () => {
    const view = renderMap();
    view.getByRole("button", { name: activateLabel }).focus();
    const map = await activate(view);

    expect(document.activeElement).toBe(map);
  });

  test.each(["move", "tiles"])(
    "hides the static map once the map reports %s",
    async (event) => {
      const view = renderMap();
      const map = await activate(view);

      fireEvent.click(
        Array.from(map.querySelectorAll("button")).find(
          (button) => button.textContent === event
        ) as HTMLButtonElement
      );

      expect(staticMap(view)).toBeNull();
      expect(view.getByTestId("interactive-map")).toBe(map);
    }
  );
});
