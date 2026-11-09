import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { legalEvidenceEvents } from "@/db/schema";
import {
  type LegalEvidenceEventId,
  paymentSubmitLegalEvidenceSource,
} from "@/features/checkout/legal-evidence";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { LegalEvidenceEventRepository } from "./legal-evidence-event.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "LegalEvidenceEventRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const eventIds: LegalEvidenceEventId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from legal_evidence_events where id = any($1)",
        [eventIds]
      );
    });

    const run = <A, E>(
      operation: (
        repository: typeof LegalEvidenceEventRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* LegalEvidenceEventRepository);
        }).pipe(
          Effect.provide(LegalEvidenceEventRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );

    const makeEvidence = (
      documentKey: "termsAndConditions" | "operatingRules"
    ) => {
      const hash = `${documentKey}-${crypto.randomUUID()}`;
      return {
        documentKey,
        documentHash: hash,
        accepted: true,
        acceptedAt: "2026-10-17T08:30:00Z",
        locale: "en-US",
        source: paymentSubmitLegalEvidenceSource,
        document: {
          path: `/legal/${documentKey}`,
          hash,
          hashAlgorithm: "sha256",
        },
      } as const;
    };

    const readAcknowledgements = async (id: LegalEvidenceEventId) => {
      const [event] = await Effect.runPromise(
        testDatabase.db
          .select({ acknowledgements: legalEvidenceEvents.acknowledgements })
          .from(legalEvidenceEvents)
          .where(eq(legalEvidenceEvents.id, id))
      );
      return event?.acknowledgements;
    };

    test("persists early-performance consent with the accepted terms", async () => {
      const [terms, operatingRules] = await run((repository) =>
        repository.recordMany([
          {
            evidence: {
              ...makeEvidence("termsAndConditions"),
              acknowledgements: { earlyPerformanceConsent: true },
            },
          },
          { evidence: makeEvidence("operatingRules") },
        ])
      );
      if (!terms || !operatingRules) throw new Error("Events not recorded.");
      eventIds.push(terms.id, operatingRules.id);

      expect(terms.acknowledgements).toEqual({ earlyPerformanceConsent: true });
      expect(await readAcknowledgements(terms.id)).toEqual({
        earlyPerformanceConsent: true,
      });
      expect(operatingRules.acknowledgements).toEqual({});
      expect(await readAcknowledgements(operatingRules.id)).toEqual({});
    });

    test("records accepted terms without early-performance consent as no acknowledgements", async () => {
      const terms = await run((repository) =>
        repository.record({ evidence: makeEvidence("termsAndConditions") })
      );
      eventIds.push(terms.id);

      expect(await readAcknowledgements(terms.id)).toEqual({});
    });

    test("rejects acknowledgements outside the early-performance consent fact", async () => {
      const failure = await run((repository) =>
        Effect.flip(
          repository.record({
            evidence: {
              ...makeEvidence("termsAndConditions"),
              acknowledgements: { earlyPerformanceConsent: false } as never,
            },
          })
        )
      );

      expect(failure).toMatchObject({ _tag: "LegalEvidenceEventInputError" });
    });

    test("keeps events recorded before acknowledgements were persisted unknown", async () => {
      const evidence = makeEvidence("termsAndConditions");
      const {
        rows: [event],
      } = await testDatabase.pool.query<{ id: LegalEvidenceEventId }>(
        `insert into legal_evidence_events
          (document_key, document_path, document_hash, hash_algorithm, accepted, accepted_at, locale, source)
        values ($1, $2, $3, 'sha256', true, now(), $4, $5)
        returning id`,
        [
          evidence.documentKey,
          evidence.document.path,
          evidence.documentHash,
          evidence.locale,
          evidence.source,
        ]
      );
      if (!event) throw new Error("Pre-fix event not inserted.");
      eventIds.push(event.id);

      expect(await readAcknowledgements(event.id)).toBeNull();
    });

    test("rejects stored acknowledgements that are not an object", async () => {
      const evidence = makeEvidence("operatingRules");

      await expect(
        testDatabase.pool.query(
          `insert into legal_evidence_events
            (document_key, document_path, document_hash, hash_algorithm, accepted, accepted_at, locale, source, acknowledgements)
          values ($1, $2, $3, 'sha256', true, now(), $4, $5, 'true'::jsonb)`,
          [
            evidence.documentKey,
            evidence.document.path,
            evidence.documentHash,
            evidence.locale,
            evidence.source,
          ]
        )
      ).rejects.toThrow("legal_evidence_events_acknowledgements_check");
    });
  }
);
