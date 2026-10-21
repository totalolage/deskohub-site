import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

type LookupCallback = (
  error: Error | null,
  address: string | ReadonlyArray<{ address: string; family: number }>,
  family?: number
) => void;

type PinnedLookup = (
  hostname: string,
  options: { readonly all?: boolean },
  callback: LookupCallback
) => void;

const pinned = { address: "203.0.114.10", family: 4 };
let capturedLookup: PinnedLookup | undefined;

mock.module("node:dns/promises", () => ({
  lookup: async () => [pinned],
}));

mock.module("node:https", () => ({
  request: (_url: URL, options: { readonly lookup: PinnedLookup }) => {
    capturedLookup = options.lookup;
    const request = new EventEmitter();
    return Object.assign(request, { end: () => undefined });
  },
}));

const { fetchClientMetadataResource } = await import("@better-auth/cimd/node");

/**
 * Guards the `@better-auth/cimd` 1.7.2 patch: the transport pins one DNS
 * answer, and Node asks the pinned lookup for every address at once when it
 * selects the address family itself, which is its default.
 */
describe("customer agent client metadata transport", () => {
  test("answers Node's all-addresses lookup with the pinned address", async () => {
    void fetchClientMetadataResource("https://agent.example/oauth/client.json");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capturedLookup).toBeDefined();

    const allAnswer = mock<LookupCallback>(() => undefined);
    capturedLookup!("agent.example", { all: true }, allAnswer);
    expect(allAnswer).toHaveBeenCalledWith(null, [pinned]);

    const singleAnswer = mock<LookupCallback>(() => undefined);
    capturedLookup!("agent.example", {}, singleAnswer);
    expect(singleAnswer).toHaveBeenCalledWith(
      null,
      pinned.address,
      pinned.family
    );
  });
});
