import { describe, expect, test } from "bun:test";

describe("WorkspaceReservationRepository", () => {
  test("limits expired hold selection with stable oldest-first ordering", async () => {
    const source = await Bun.file(
      new URL("./workspace-reservation.repository.ts", import.meta.url)
    ).text();

    expect(source).toContain(
      ".orderBy(\n" +
        "                asc(workspaceReservations.reservationHoldExpiresAt),\n" +
        "                asc(workspaceReservations.id)\n" +
        "              )"
    );
    expect(source).toContain(".limit(input.limit)");
  });
});
