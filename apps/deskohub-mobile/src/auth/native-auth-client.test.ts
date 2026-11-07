import { describe, expect, test } from "bun:test";
import {
  createNativeAuthClient,
  type SessionCookieStore,
} from "./native-auth-client";
import { developmentPreviewAccess } from "./preview-access";

const memoryStore = (): SessionCookieStore => {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    getItemAsync: async (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    setItemAsync: async (key, value) => {
      items.set(key, value);
    },
  };
};

const recordingFetch = () => {
  const requests: Headers[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Headers(init?.headers ?? (input as Request).headers));
    return new Response("null", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { requests, fetch };
};

describe("createNativeAuthClient", () => {
  test("sends no preview bypass header by default", async () => {
    const { requests, fetch } = recordingFetch();
    const client = createNativeAuthClient({
      origin: "https://workspace.deskohub.cz",
      storage: memoryStore(),
      fetch,
    });
    await client.getSession();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.has("x-vercel-protection-bypass")).toBe(false);
    expect(requests[0]?.get("expo-origin")).toBe("deskohub://");
  });

  test("sends the preview bypass header with every request when preview access is on", async () => {
    const { requests, fetch } = recordingFetch();
    const client = createNativeAuthClient({
      origin: "https://preview.example.test",
      storage: memoryStore(),
      fetch,
      previewAccess: developmentPreviewAccess(true, "synthetic-bypass"),
    });
    await client.getSession();
    await client.signOut();
    expect(requests).toHaveLength(2);
    for (const headers of requests) {
      expect(headers.get("x-vercel-protection-bypass")).toBe(
        "synthetic-bypass"
      );
      expect(headers.get("expo-origin")).toBe("deskohub://");
    }
  });
});
