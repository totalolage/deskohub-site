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
import { Activity, StrictMode, useState } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type Point = {
  readonly subtract: (point: Point) => Point;
  readonly x: number;
  readonly y: number;
};

type MapListener = () => void;
type FakeOptions = object;

type FakeMediaQueryList = {
  readonly addEventListenerCallCount: number;
  readonly dispatchChange: () => void;
  readonly matches: boolean;
  readonly removeEventListenerCallCount: number;
};

const mapInstances: FakeMap[] = [];
const mediaQueries: FakeMediaQueryList[] = [];

class FakeMap {
  readonly dragging = {
    disable: () => {
      this.assertLive();
    },
    enable: () => {
      this.assertLive();
    },
  };
  disposed = false;
  disposedOperationCount = 0;
  offCallCount = 0;
  removeCallCount = 0;
  private readonly listeners = new globalThis.Map<string, Set<MapListener>>();

  constructor(
    readonly container: HTMLElement,
    readonly options: FakeOptions
  ) {
    mapInstances.push(this);
  }

  addLayer(_layer: FakeLayer) {
    this.assertLive();
    return this;
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  getSize() {
    this.assertLive();
    return makePoint(800, 600);
  }

  getZoom() {
    this.assertLive();
    return 17;
  }

  off(type: string, listener: MapListener) {
    this.offCallCount += 1;
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  on(type: string, listener: MapListener) {
    this.assertLive();
    const listeners = this.listeners.get(type) ?? new Set<MapListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return this;
  }

  project(_coordinates: readonly [number, number], _zoom: number) {
    this.assertLive();
    return makePoint(400, 300);
  }

  remove() {
    this.removeCallCount += 1;
    this.disposed = true;
    return this;
  }

  removeLayer(_layer: FakeLayer) {
    return this;
  }

  setView(
    _coordinates: readonly [number, number],
    _zoom: number,
    _options?: FakeOptions
  ) {
    this.assertLive();
    return this;
  }

  unproject(_point: Point, _zoom: number) {
    this.assertLive();
    return [50, 14] as const;
  }

  private assertLive() {
    if (!this.disposed) return;
    this.disposedOperationCount += 1;
    throw new Error("framing used a disposed map");
  }
}

class FakeLayer {
  addTo(map: FakeMap) {
    map.addLayer(this);
    return this;
  }
}

class FakeMarker extends FakeLayer {
  constructor(
    readonly coordinates: readonly [number, number],
    readonly options: FakeOptions
  ) {
    super();
  }
}

class FakeTileLayer extends FakeLayer {
  constructor(
    readonly url: string,
    readonly options: FakeOptions
  ) {
    super();
  }
}

const makePoint = (x: number, y: number): Point => ({
  subtract: (point) => makePoint(x - point.x, y - point.y),
  x,
  y,
});

const makeMediaQuery = (): FakeMediaQueryList => {
  let addEventListenerCallCount = 0;
  let removeEventListenerCallCount = 0;
  const listeners = new Set<() => void>();
  const mediaQuery = {
    addEventListenerCallCount,
    dispatchChange: () => {
      for (const listener of listeners) listener();
    },
    matches: false,
    removeEventListenerCallCount,
  };

  Object.assign(mediaQuery, {
    addEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      addEventListenerCallCount += 1;
      mediaQuery.addEventListenerCallCount = addEventListenerCallCount;
      listeners.add(listener as () => void);
    },
    removeEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      removeEventListenerCallCount += 1;
      mediaQuery.removeEventListenerCallCount = removeEventListenerCallCount;
      listeners.delete(listener as () => void);
    },
  });

  mediaQueries.push(mediaQuery);
  return mediaQuery;
};

const fakeLeaflet = {
  divIcon: (options: FakeOptions) => options,
  map: (container: HTMLElement, options?: FakeOptions) =>
    new FakeMap(container, options ?? {}),
  marker: (coordinates: readonly [number, number], options: FakeOptions) =>
    new FakeMarker(coordinates, options),
  point: makePoint,
  tileLayer: (url: string, options: FakeOptions) =>
    new FakeTileLayer(url, options),
};

mock.module("leaflet", () => ({ ...fakeLeaflet, default: fakeLeaflet }));
mock.module("leaflet/dist/leaflet.css", () => ({}));

let originalMatchMedia: typeof window.matchMedia;

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  originalMatchMedia = window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
  mapInstances.length = 0;
  mediaQueries.length = 0;
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

describe("LandingPageInteractiveMap", () => {
  test("recreates a live map when Activity reconnects the same DOM node", async () => {
    const { LandingPageInteractiveMap } = await import(
      "./landing-page-interactive-map"
    );
    window.matchMedia = (() => makeMediaQuery()) as typeof window.matchMedia;

    function ActivityHarness() {
      const [mode, setMode] = useState<"hidden" | "visible">("visible");
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setMode((currentMode) =>
                currentMode === "visible" ? "hidden" : "visible"
              )
            }
          >
            Toggle activity
          </button>
          <Activity mode={mode}>
            <LandingPageInteractiveMap />
          </Activity>
        </>
      );
    }

    const view = render(
      <StrictMode>
        <ActivityHarness />
      </StrictMode>
    );
    const toggle = view.getByRole("button", { name: "Toggle activity" });
    const firstSetup = mapInstances[0];
    const strictModeSetup = mapInstances[1];

    expect(mapInstances).toHaveLength(2);
    expect(firstSetup).toBeDefined();
    expect(strictModeSetup).toBeDefined();
    expect(firstSetup).not.toBe(strictModeSetup);
    expect(firstSetup?.removeCallCount).toBe(1);
    expect(strictModeSetup?.removeCallCount).toBe(0);
    expect(mediaQueries).toHaveLength(2);
    expect(mediaQueries[0]?.removeEventListenerCallCount).toBe(1);
    expect(mediaQueries[1]?.removeEventListenerCallCount).toBe(0);

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(strictModeSetup?.removeCallCount).toBe(1);
    expect(strictModeSetup?.offCallCount).toBe(1);
    expect(mediaQueries[1]?.removeEventListenerCallCount).toBe(1);
    expect(() => strictModeSetup?.emit("resize")).not.toThrow();
    mediaQueries[1]?.dispatchChange();
    expect(strictModeSetup?.disposedOperationCount).toBe(0);

    await act(async () => {
      fireEvent.click(toggle);
    });

    const activityReconnectSetup = mapInstances[2];
    const strictActivityReconnectSetup = mapInstances[3];
    expect(mapInstances).toHaveLength(4);
    expect(activityReconnectSetup).toBeDefined();
    expect(strictActivityReconnectSetup).toBeDefined();
    expect(activityReconnectSetup).not.toBe(strictModeSetup);
    expect(strictActivityReconnectSetup).not.toBe(activityReconnectSetup);
    expect(activityReconnectSetup?.removeCallCount).toBe(1);
    expect(strictActivityReconnectSetup?.removeCallCount).toBe(0);
    expect(mediaQueries).toHaveLength(4);
    expect(mediaQueries[2]?.removeEventListenerCallCount).toBe(1);
    expect(mediaQueries[3]?.removeEventListenerCallCount).toBe(0);

    view.unmount();

    expect(mapInstances).toHaveLength(4);
    expect(new Set(mapInstances).size).toBe(mapInstances.length);
    expect(new Set(mapInstances.map((map) => map.container)).size).toBe(1);
    expect(mapInstances[0]?.container.className).toBe("h-full w-full");
    expect(
      mapInstances.every(
        (map) => map.removeCallCount === 1 && map.offCallCount === 1
      )
    ).toBe(true);
    expect(
      mediaQueries.every((mediaQuery) => {
        return mediaQuery.addEventListenerCallCount === 1;
      })
    ).toBe(true);
    expect(
      mediaQueries.every(
        (mediaQuery) => mediaQuery.removeEventListenerCallCount === 1
      )
    ).toBe(true);
    for (const map of mapInstances) {
      expect(() => map.emit("resize")).not.toThrow();
      expect(map.disposedOperationCount).toBe(0);
    }
  });
});
