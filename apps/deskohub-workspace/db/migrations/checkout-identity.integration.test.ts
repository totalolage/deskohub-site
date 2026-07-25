import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";

const requireFromEmbeddedPostgres = createRequire(
  import.meta.resolve("embedded-postgres")
);
const embeddedPostgresPlatformPackage = `@embedded-postgres/${process.platform}-${process.arch}`;
const embeddedPostgresPlatformEntry = requireFromEmbeddedPostgres.resolve(
  embeddedPostgresPlatformPackage
);
const { initdb } = (await import(embeddedPostgresPlatformEntry)) as {
  readonly initdb: string;
};
const embeddedPostgresPlatformRoot = dirname(
  dirname(embeddedPostgresPlatformEntry)
);

const migrationUrl = new URL(
  "./20260725232210_majestic_blackheart/migration.sql",
  import.meta.url
);

let postgres: EmbeddedPostgres;
let primaryClient: Client;
let competingClient: Client;
let providerHoldCount = 0;

beforeAll(async () => {
  await hydrateEmbeddedPostgresSymlinks();
  const databaseDir = await mkdtemp(
    join(tmpdir(), "workspace-checkout-identity-")
  );
  const nativeLibraryPath = join(dirname(dirname(initdb)), "lib");
  process.env.LD_LIBRARY_PATH = [nativeLibraryPath, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(":");
  const port = await getAvailablePort();
  postgres = new EmbeddedPostgres({
    databaseDir,
    password: crypto.randomUUID(),
    persistent: false,
    port,
    onError: () => undefined,
    onLog: () => undefined,
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("workspace_checkout_identity");

  primaryClient = postgres.getPgClient("workspace_checkout_identity");
  competingClient = postgres.getPgClient("workspace_checkout_identity");
  await Promise.all([primaryClient.connect(), competingClient.connect()]);

  await primaryClient.query(`
    CREATE TABLE "workspace_reservations" (
      "id" text PRIMARY KEY,
      "checkout_session_key" text NOT NULL,
      "checkout_attempt_key" text NOT NULL,
      "reservation_state" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX "workspace_reservations_attempt_key_unique_idx"
      ON "workspace_reservations" ("checkout_attempt_key");
    CREATE UNIQUE INDEX "workspace_reservations_active_session_unique_idx"
      ON "workspace_reservations" ("checkout_session_key")
      WHERE "reservation_state" <> 'cancelled';
  `);
  await primaryClient.query(await Bun.file(migrationUrl).text());
}, 30_000);

beforeEach(async () => {
  providerHoldCount = 0;
  await primaryClient.query('TRUNCATE TABLE "workspace_reservations"');
});

afterAll(async () => {
  await Promise.allSettled([primaryClient?.end(), competingClient?.end()]);
  await postgres?.stop();
}, 30_000);

test("overlapping legacy and dedicated writers create one row and one provider hold", async () => {
  await assertMixedBoundaryOverlap("legacy");
  await primaryClient.query('TRUNCATE TABLE "workspace_reservations"');
  providerHoldCount = 0;
  await assertMixedBoundaryOverlap("dedicated");
});

test("fails closed when current and identity candidates resolve to different rows", async () => {
  await primaryClient.query(
    `
      INSERT INTO "workspace_reservations" (
        "id",
        "checkout_session_key",
        "checkout_attempt_key",
        "checkout_session_identity_key",
        "checkout_attempt_identity_key",
        "reservation_state"
      )
      VALUES
        ('synthetic-row-a', 'synthetic-session-current-a',
          'synthetic-attempt-dedicated', 'synthetic-session-identity-a',
          'synthetic-attempt-identity-a', 'draft'),
        ('synthetic-row-b', 'synthetic-session-current-b',
          'synthetic-attempt-legacy', 'synthetic-session-identity-b',
          'synthetic-attempt-identity-b', 'draft')
    `
  );

  await expect(
    resolveDedicatedAttempt(primaryClient, {
      current: "synthetic-attempt-dedicated",
      identity: "synthetic-attempt-legacy",
    })
  ).rejects.toThrow("Checkout attempt identity conflict.");
  expect(providerHoldCount).toBe(0);
});

test("rolls back supersession when replacement identity conflicts", async () => {
  await primaryClient.query(
    `
      INSERT INTO "workspace_reservations" (
        "id",
        "checkout_session_key",
        "checkout_attempt_key",
        "checkout_session_identity_key",
        "checkout_attempt_identity_key",
        "reservation_state"
      )
      VALUES
        ('synthetic-previous-row', 'synthetic-previous-session',
          'synthetic-previous-attempt', 'synthetic-previous-session',
          'synthetic-previous-attempt', 'cancelling'),
        ('synthetic-conflict-row', 'synthetic-conflict-session',
          'synthetic-conflict-attempt', 'synthetic-conflict-session',
          'synthetic-conflict-attempt', 'draft')
    `
  );

  await primaryClient.query("BEGIN");
  try {
    await primaryClient.query(
      `
        UPDATE "workspace_reservations"
        SET "reservation_state" = 'cancelled'
        WHERE "id" = 'synthetic-previous-row'
      `
    );
    await primaryClient.query(
      `
        INSERT INTO "workspace_reservations" (
          "id",
          "checkout_session_key",
          "checkout_attempt_key",
          "checkout_session_identity_key",
          "checkout_attempt_identity_key",
          "reservation_state"
        )
        VALUES (
          'synthetic-replacement-row',
          'synthetic-replacement-session',
          'synthetic-replacement-attempt',
          'synthetic-replacement-session',
          'synthetic-conflict-attempt',
          'draft'
        )
      `
    );
    throw new Error("Expected the replacement insert to conflict.");
  } catch {
    await primaryClient.query("ROLLBACK");
  }

  const result = await primaryClient.query<{
    id: string;
    reservation_state: string;
  }>(
    `
      SELECT "id", "reservation_state"
      FROM "workspace_reservations"
      ORDER BY "id"
    `
  );
  expect(result.rows).toEqual([
    { id: "synthetic-conflict-row", reservation_state: "draft" },
    {
      id: "synthetic-previous-row",
      reservation_state: "cancelling",
    },
  ]);
  expect(providerHoldCount).toBe(0);
});

const assertMixedBoundaryOverlap = async (
  firstWriter: "dedicated" | "legacy"
) => {
  const firstClient = primaryClient;
  const secondClient = competingClient;
  const first =
    firstWriter === "legacy" ? insertLegacyAttempt : insertDedicatedAttempt;
  const second =
    firstWriter === "legacy" ? insertDedicatedAttempt : insertLegacyAttempt;

  await firstClient.query("BEGIN");
  const firstResult = await first(firstClient);
  const firstClaimed = await claimReservation(firstClient, firstResult.id);

  const competingResult = second(secondClient);
  const blocked = await Promise.race([
    competingResult.then(
      () => false,
      () => false
    ),
    new Promise<true>((resolve) => setTimeout(() => resolve(true), 50)),
  ]);
  expect(blocked).toBe(true);

  await firstClient.query("COMMIT");
  if (firstClaimed) providerHoldCount += 1;
  if (firstWriter === "legacy") {
    const result = await competingResult;
    await claimProviderHold(secondClient, result.id);
  } else {
    await expect(competingResult).rejects.toThrow(
      "Legacy writer failed closed after identity conflict."
    );
  }

  const count = await primaryClient.query<{ count: string }>(
    'SELECT count(*)::text AS "count" FROM "workspace_reservations"'
  );
  expect(count.rows[0]?.count).toBe("1");
  expect(providerHoldCount).toBe(1);
};

const insertLegacyAttempt = async (client: Client) => {
  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO "workspace_reservations" (
        "id",
        "checkout_session_key",
        "checkout_attempt_key",
        "reservation_state"
      )
      VALUES (
        'synthetic-legacy-row',
        'synthetic-session-legacy',
        'synthetic-attempt-legacy',
        'draft'
      )
      ON CONFLICT DO NOTHING
      RETURNING "id"
    `
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const existing = await client.query<{ id: string }>(
    `
      SELECT "id"
      FROM "workspace_reservations"
      WHERE "checkout_attempt_key" = 'synthetic-attempt-legacy'
      LIMIT 1
    `
  );
  if (!existing.rows[0]) {
    throw new Error("Legacy writer failed closed after identity conflict.");
  }
  return existing.rows[0];
};

const insertDedicatedAttempt = async (client: Client) => {
  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO "workspace_reservations" (
        "id",
        "checkout_session_key",
        "checkout_attempt_key",
        "checkout_session_identity_key",
        "checkout_attempt_identity_key",
        "reservation_state"
      )
      VALUES (
        'synthetic-dedicated-row',
        'synthetic-session-dedicated',
        'synthetic-attempt-dedicated',
        'synthetic-session-legacy',
        'synthetic-attempt-legacy',
        'draft'
      )
      ON CONFLICT DO NOTHING
      RETURNING "id"
    `
  );
  if (inserted.rows[0]) return inserted.rows[0];

  return resolveDedicatedAttempt(client, {
    current: "synthetic-attempt-dedicated",
    identity: "synthetic-attempt-legacy",
  });
};

const resolveDedicatedAttempt = async (
  client: Client,
  keys: { readonly current: string; readonly identity: string }
) => {
  const existing = await client.query<{ id: string }>(
    `
      SELECT "id"
      FROM "workspace_reservations"
      WHERE
        "checkout_attempt_key" = ANY($1::text[])
        OR "checkout_attempt_identity_key" = ANY($1::text[])
    `,
    [[keys.current, keys.identity]]
  );
  if (existing.rows.length !== 1) {
    throw new Error("Checkout attempt identity conflict.");
  }
  return existing.rows[0] as { id: string };
};

const claimProviderHold = async (client: Client, id: string) => {
  if (await claimReservation(client, id)) providerHoldCount += 1;
};

const claimReservation = async (client: Client, id: string) => {
  const claimed = await client.query(
    `
      UPDATE "workspace_reservations"
      SET "reservation_state" = 'creating_hold'
      WHERE "id" = $1 AND "reservation_state" = 'draft'
      RETURNING "id"
    `,
    [id]
  );
  return claimed.rowCount === 1;
};

const getAvailablePort = async () =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local PostgreSQL test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const hydrateEmbeddedPostgresSymlinks = async () => {
  const symlinkSpecs = JSON.parse(
    await readFile(
      join(embeddedPostgresPlatformRoot, "native", "pg-symlinks.json"),
      "utf8"
    )
  ) as readonly { readonly source: string; readonly target: string }[];

  await Promise.all(
    symlinkSpecs.map(async ({ source, target }) => {
      const sourcePath = join(embeddedPostgresPlatformRoot, source);
      const targetPath = join(embeddedPostgresPlatformRoot, target);
      await symlink(
        relative(dirname(targetPath), sourcePath),
        targetPath
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    })
  );
};
