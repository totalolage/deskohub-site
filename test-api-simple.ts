#!/usr/bin/env bun

/**
 * Simple test to check if API is working
 */

import { Effect } from "effect";
import { DotyposServiceLive } from "./features/dotypos/backend/service";
import { DotyposClient } from "./features/dotypos/backend/service";

async function testSimple() {
  console.log("Testing API with simplified calls...\n");

  const program = Effect.gen(function* () {
    const client = yield* DotyposClient;
    console.log("Got client:", { 
      cloudId: client.cloudId,
      branchId: client.branchId 
    });
    
    // Try to get tables
    console.log("\nFetching tables...");
    const tables = yield* client.getTables();
    console.log(`Found ${tables.length} tables`);
    
    return tables;
  });

  try {
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(DotyposServiceLive))
    );
    console.log("✅ Test completed successfully");
    console.log(`Tables: ${result.map(t => t.name).join(", ")}`);
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testSimple().catch(console.error);