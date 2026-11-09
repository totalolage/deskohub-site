import "../shared/polyfills/temporal";
import {
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "../features/checkout/product-catalog";

let tableReads = 0;
const table = (id: string, tags: readonly string[], seats = "24") => ({
  id,
  _cloudId: "123",
  name: "Synthetic table",
  enabled: true,
  display: true,
  seats,
  tags,
});
const inventory = [
  table("private-selected-table", ["cowork:open-space"]),
  table("private-reserved-table", ["cowork:reserved-desk"]),
  ...workspaceProductMonitorOptions.map((option) =>
    table(`private-${option}`, [
      "cowork:reserved-desk",
      ...workspaceProductMonitorOptionTableTags[option],
    ])
  ),
  ...Array.from({ length: 4 }, (_, index) =>
    table(`private-room-${index}`, ["reservation:meeting-room"])
  ),
  table("private-office", ["reservation:office"]),
];
const page = (data: unknown[]) => ({
  data,
  currentPage: "1",
  perPage: "100",
  totalItemsOnPage: String(data.length),
  totalItemsCount: String(data.length),
  firstPage: "1",
  lastPage: "1",
  prevPage: null,
  nextPage: null,
});

// This preload owns every HTTP request in the child; unexpected requests fail locally.
globalThis.fetch = (async (input) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.dotykacka.cz")
    throw new Error("Unexpected fixture origin");
  if (url.pathname === "/v2/signin/token")
    return process.argv.includes("--fixture-token404")
      ? new Response(null, { status: 404 })
      : Response.json({ accessToken: "private-test-token" });
  if (url.pathname === "/v2/clouds/123/tables") {
    tableReads++;
    if (tableReads > 1 && process.argv.includes("--fixture-checkout-unknown"))
      return Response.json(
        { error: "private-selected-table private-test-token" },
        { status: 400 }
      );
    if (tableReads > 1 && process.argv.includes("--fixture-checkout-failure"))
      return Response.json(page([]));
    return Response.json(
      page(
        inventory.map((record, index) =>
          tableReads === 1 &&
          index === 0 &&
          process.argv.includes("--fixture-insufficient")
            ? { ...record, seats: "6" }
            : record
        )
      )
    );
  }
  if (url.pathname === "/v2/clouds/123/reservations")
    return Response.json(page([]));
  throw new Error("Unexpected fixture request");
}) as typeof fetch;
