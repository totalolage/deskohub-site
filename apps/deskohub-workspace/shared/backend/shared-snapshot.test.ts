import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { Data, Effect } from "effect";
import { notFound, redirect } from "next/navigation";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";

const nextCache = recordNextCache();

mock.module("@/instrumentation", () => ({ postHogLoggerProvider: undefined }));
mock.module("next/cache", () => nextCache.module);

const { readSharedSnapshot } = await import("./shared-snapshot");

class SyntheticLoadFailure extends Data.TaggedError("SyntheticLoadFailure") {}

interface Snapshot {
  readonly complete: boolean;
}

const complete = { lifetime: "minutes", tags: ["synthetic:all"] } as const;
const incomplete = {
  when: (snapshot: Snapshot) => !snapshot.complete,
  lifetime: { stale: 300, revalidate: 1, expire: 300 },
  tags: ["synthetic:incomplete"],
} as const;
const fallbackSnapshot = { complete: false, fallback: true } as const;

const withFallback = () => {
  const fallback = mock(() => fallbackSnapshot);
  return {
    fallback,
    failure: {
      failureCode: "synthetic.snapshot.load_failed",
      fallback,
      lifetime: { stale: 30, revalidate: 60, expire: 300 },
      tags: ["synthetic:failure"],
    },
  };
};

let warn: ReturnType<typeof spyOn<Console, "warn">>;

beforeEach(() => {
  nextCache.clear();
  warn = spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => warn.mockRestore());

describe("readSharedSnapshot", () => {
  test("shares a complete value under the complete lifetime and tags", async () => {
    await expect(
      readSharedSnapshot(
        "synthetic.snapshot.load",
        Effect.succeed<Snapshot>({ complete: true }),
        { complete, incomplete, ...withFallback() }
      )
    ).resolves.toEqual({ complete: true });

    expect(nextCache.calls).toEqual([
      { cacheLife: "minutes" },
      { cacheTag: ["synthetic:all"] },
    ]);
  });

  test("shares an incomplete value under the incomplete lifetime and tags only", async () => {
    await expect(
      readSharedSnapshot(
        "synthetic.snapshot.load",
        Effect.succeed<Snapshot>({ complete: false }),
        { complete, incomplete }
      )
    ).resolves.toEqual({ complete: false });

    expect(nextCache.calls).toEqual([
      { cacheLife: { stale: 300, revalidate: 1, expire: 300 } },
      { cacheTag: ["synthetic:incomplete"] },
    ]);
  });

  test("sets no tags for an outcome without any", async () => {
    await readSharedSnapshot("synthetic.snapshot.load", Effect.succeed(1), {
      complete: { lifetime: "max" },
    });

    expect(nextCache.calls).toEqual([{ cacheLife: "max" }]);
  });

  test.each([
    ["typed failure", Effect.fail(new SyntheticLoadFailure())],
    ["defect", Effect.die(new Error("synthetic defect"))],
  ] as const)(
    "serves the fallback once for a %s, under the failure lifetime and tags, logged once",
    async (_name, load) => {
      const { fallback, failure } = withFallback();

      await expect(
        readSharedSnapshot("synthetic.snapshot.load", load, {
          complete,
          incomplete,
          failure,
        })
      ).resolves.toBe(fallbackSnapshot);

      expect(fallback).toHaveBeenCalledTimes(1);
      expect(nextCache.calls).toEqual([
        { cacheLife: { stale: 30, revalidate: 60, expire: 300 } },
        { cacheTag: ["synthetic:failure"] },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.flat().join(" ")).toContain(
        "synthetic.snapshot.load_failed"
      );
    }
  );

  test.each([
    ["typed failure", new SyntheticLoadFailure()],
    ["defect", new Error("synthetic defect")],
  ] as const)(
    "rejects a %s without a fallback, unshared",
    async (name, cause) => {
      await expect(
        readSharedSnapshot(
          "synthetic.snapshot.load",
          name === "defect" ? Effect.die(cause) : Effect.fail(cause),
          { complete, incomplete }
        )
      ).rejects.toBe(cause);

      expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
    }
  );

  test("rejects unshared with the fallback's error when the fallback throws", async () => {
    const fallbackFailure = new Error("synthetic fallback failure");

    await expect(
      readSharedSnapshot(
        "synthetic.snapshot.load",
        Effect.fail(new SyntheticLoadFailure()),
        {
          complete,
          failure: {
            ...withFallback().failure,
            fallback: () => {
              throw fallbackFailure;
            },
          },
        }
      )
    ).rejects.toBe(fallbackFailure);

    expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
  });

  test.each([
    ["notFound", () => notFound(), "NEXT_HTTP_ERROR_FALLBACK;404"],
    ["redirect", () => redirect("/target"), "NEXT_REDIRECT"],
  ] as const)(
    "passes Next.js %s through unchanged and unshared, without the fallback",
    async (_name, control, digest) => {
      const { fallback, failure } = withFallback();

      await expect(
        readSharedSnapshot("synthetic.snapshot.load", Effect.sync(control), {
          complete,
          failure,
        })
      ).rejects.toMatchObject({ digest: expect.stringContaining(digest) });

      expect(fallback).not.toHaveBeenCalled();
      expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
    }
  );

  test("answers an incompleteness check that throws as a failure", async () => {
    const checkFailure = new Error("synthetic check failure");
    const throwingCheck = {
      ...incomplete,
      when: () => {
        throw checkFailure;
      },
    };

    await expect(
      readSharedSnapshot(
        "synthetic.snapshot.load",
        Effect.succeed<Snapshot>({ complete: true }),
        { complete, incomplete: throwingCheck, ...withFallback() }
      )
    ).resolves.toBe(fallbackSnapshot);
    expect(nextCache.calls).toEqual([
      { cacheLife: { stale: 30, revalidate: 60, expire: 300 } },
      { cacheTag: ["synthetic:failure"] },
    ]);

    nextCache.clear();
    await expect(
      readSharedSnapshot(
        "synthetic.snapshot.load",
        Effect.succeed<Snapshot>({ complete: true }),
        { complete, incomplete: throwingCheck }
      )
    ).rejects.toBe(checkFailure);
    expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
  });

  test.each([
    ["lifetime", "cacheLife", [{ cacheLife: "minutes" }]],
    [
      "tags",
      "cacheTag",
      [{ cacheLife: "minutes" }, { cacheTag: ["synthetic:all"] }],
    ],
  ] as const)(
    "rejects unshared when applying the outcome's %s throws",
    async (_name, fn, applied) => {
      const applyFailure = new Error("synthetic apply failure");
      nextCache.failNext(fn, applyFailure);

      await expect(
        readSharedSnapshot(
          "synthetic.snapshot.load",
          Effect.succeed<Snapshot>({ complete: true }),
          { complete }
        )
      ).rejects.toBe(applyFailure);
      expect(nextCache.calls).toEqual([
        ...applied,
        { cacheLife: { expire: 0 } },
      ]);
    }
  );

  test("rejects an interrupted load unshared, without the fallback", async () => {
    const { fallback, failure } = withFallback();

    await expect(
      readSharedSnapshot("synthetic.snapshot.load", Effect.interrupt, {
        complete,
        failure,
      })
    ).rejects.toBeDefined();

    expect(fallback).not.toHaveBeenCalled();
    expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
  });
});
