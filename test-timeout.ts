#!/usr/bin/env bun

/**
 * Test script to verify that AbortSignal.timeout is working correctly
 * in the Dotypos service
 */

import { Effect } from "effect";
import { DotyposServiceLive, getReservation } from "./features/dotypos";

// Test timeout by trying to get a reservation
// The timeout should be triggered if the API is slow or unresponsive
async function testTimeout() {
  console.log("Testing timeout implementation with AbortSignal...\n");

  // Test with a valid reservation ID (should work if API is responsive)
  console.log("Test 1: Getting reservation with normal timeout");
  const result1 = await Effect.runPromise(
    getReservation("6988").pipe(
      Effect.provide(DotyposServiceLive),
      Effect.match({
        onFailure: (error) => {
          console.error("❌ Failed:", error);
          // Check if it's a timeout error
          if (error.message?.includes("aborted") || error.message?.includes("timeout")) {
            console.log("⏱️ Request was properly aborted due to timeout");
          }
          return null;
        },
        onSuccess: (reservation) => {
          console.log("✅ Success: Retrieved reservation", reservation.id);
          return reservation;
        },
      })
    )
  );

  console.log("\n---\n");

  // Test with a non-existent reservation (should fail with 404, not timeout)
  console.log("Test 2: Getting non-existent reservation (should fail with 404)");
  const result2 = await Effect.runPromise(
    getReservation("99999999").pipe(
      Effect.provide(DotyposServiceLive),
      Effect.match({
        onFailure: (error) => {
          if (error.message?.includes("not found")) {
            console.log("✅ Correctly failed with 404 Not Found");
          } else if (error.message?.includes("timeout") || error.message?.includes("aborted")) {
            console.log("⏱️ Request timed out");
          } else {
            console.error("❌ Unexpected error:", error);
          }
          return null;
        },
        onSuccess: (reservation) => {
          console.log("✅ Unexpectedly found reservation:", reservation.id);
          return reservation;
        },
      })
    )
  );

  console.log("\n---\n");

  // Test abort signal manually to verify it's working
  console.log("Test 3: Manual AbortSignal test");
  const controller = new AbortController();
  const timeoutMs = 1000;
  
  const timeoutId = setTimeout(() => {
    controller.abort();
    console.log(`⏱️ Manually aborted after ${timeoutMs}ms`);
  }, timeoutMs);

  try {
    const response = await fetch("https://httpbin.org/delay/5", {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    console.log("❌ Request completed (should have been aborted)");
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      console.log("✅ AbortSignal is working correctly:", error.message);
    } else {
      console.error("❌ Unexpected error:", error);
    }
  }

  console.log("\n---\n");

  // Test with AbortSignal.timeout directly
  console.log("Test 4: AbortSignal.timeout() test");
  try {
    const response = await fetch("https://httpbin.org/delay/5", {
      signal: AbortSignal.timeout(1000),
    });
    console.log("❌ Request completed (should have timed out)");
  } catch (error: any) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      console.log("✅ AbortSignal.timeout() is working correctly:", error.message);
    } else {
      console.error("❌ Unexpected error:", error);
    }
  }

  console.log("\n✅ All timeout tests completed!");
}

// Run the test
testTimeout().catch(console.error);