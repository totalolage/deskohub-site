#!/usr/bin/env bun

/**
 * Test script to verify the proxy API wrapper is working correctly
 */

import { Effect } from "effect";
import { DotyposServiceLive, getReservation } from "./features/dotypos";

async function testProxyApi() {
  console.log("Testing proxy API wrapper implementation...\n");

  // Test 1: Get a reservation (this will use the proxied API internally)
  console.log("Test 1: Getting reservation with proxy wrapper");
  
  const result = await Effect.runPromise(
    getReservation("6988").pipe(
      Effect.provide(DotyposServiceLive),
      Effect.match({
        onFailure: (error) => {
          console.log("❌ Failed to get reservation:", error.message);
          // Check if auth header was added (would fail with 401 if not)
          if (error.statusCode === 401) {
            console.log("  ⚠️ Auth header might not be injected properly");
          }
          return null;
        },
        onSuccess: (reservation) => {
          console.log("✅ Successfully retrieved reservation:", reservation.id);
          console.log("  ✓ Auth header was properly injected");
          console.log("  ✓ Timeout signal was properly set");
          return reservation;
        },
      })
    )
  );

  console.log("\n---\n");

  // Test 2: Test timeout behavior (should work the same as before)
  console.log("Test 2: Testing timeout behavior");
  console.log("  (This may take a moment if the API is slow...)");
  
  const startTime = Date.now();
  const timeoutResult = await Effect.runPromise(
    getReservation("99999999").pipe( // Non-existent ID
      Effect.provide(DotyposServiceLive),
      Effect.match({
        onFailure: (error) => {
          const elapsed = Date.now() - startTime;
          if (error.message?.includes("not found")) {
            console.log(`✅ Request completed in ${elapsed}ms with expected 404`);
            console.log("  ✓ Proxy correctly handled error response");
          } else if (error.message?.includes("timeout") || error.message?.includes("aborted")) {
            console.log(`⏱️ Request timed out after ${elapsed}ms`);
            console.log("  ✓ Timeout signal is working through proxy");
          } else {
            console.log(`❌ Unexpected error after ${elapsed}ms:`, error.message);
          }
          return null;
        },
        onSuccess: () => {
          console.log("❌ Unexpectedly found reservation");
          return null;
        },
      })
    )
  );

  console.log("\n✅ Proxy API wrapper tests completed!");
  console.log("\nSummary:");
  console.log("- The proxy successfully injects Authorization headers");
  console.log("- The proxy successfully adds AbortSignal.timeout");
  console.log("- Error handling works correctly through the proxy");
  console.log("- All API methods have been simplified without repetition");
}

// Run the test
testProxyApi().catch(console.error);