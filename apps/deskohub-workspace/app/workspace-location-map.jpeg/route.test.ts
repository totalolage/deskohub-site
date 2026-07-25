import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { GET } from "./route";

test("interrupts image generation when the request disconnects", async () => {
  const originalFetch = globalThis.fetch;
  const fetch = mock(
    async () => new Promise<Response>(() => undefined)
  ) as unknown as typeof globalThis.fetch;
  globalThis.fetch = fetch;
  const controller = new AbortController();

  try {
    const response = GET(
      new Request(
        "https://workspace.deskohub.test/workspace-location-map.jpeg",
        { signal: controller.signal }
      )
    );

    await waitFor(() => fetch.mock.calls.length > 0);
    expect(fetch).toHaveBeenCalled();
    controller.abort();

    await expect(response).rejects.toBeDefined();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
