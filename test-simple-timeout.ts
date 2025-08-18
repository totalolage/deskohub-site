#!/usr/bin/env bun

/**
 * Simple test to verify AbortSignal.timeout
 */

console.log("Testing AbortSignal.timeout with httpbin...\n");

// Test 1: Request that should complete
console.log("Test 1: 1-second delay with 2-second timeout (should succeed)");
try {
  const response1 = await fetch("https://httpbin.org/delay/1", {
    signal: AbortSignal.timeout(2000),
  });
  console.log("✅ Request completed successfully:", response1.status);
} catch (error: any) {
  console.error("❌ Request failed:", error.message);
}

console.log("\n---\n");

// Test 2: Request that should timeout
console.log("Test 2: 3-second delay with 1-second timeout (should timeout)");
try {
  const response2 = await fetch("https://httpbin.org/delay/3", {
    signal: AbortSignal.timeout(1000),
  });
  console.log("❌ Request completed (should have timed out):", response2.status);
} catch (error: any) {
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    console.log("✅ Request timed out as expected:", error.message);
  } else {
    console.error("❌ Unexpected error:", error.name, error.message);
  }
}

console.log("\n✅ AbortSignal.timeout tests completed!");