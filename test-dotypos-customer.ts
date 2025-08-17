/**
 * Test script for Dotypos customer integration
 */

import { Effect, Console, Config, Layer } from "effect";
import { DotyposServiceLive, createReservation } from "./features/dotypos/backend/service";

// Test input
const testReservation = {
  datetime: new Date("2025-08-20T19:00:00"),
  duration: 2,
  guestCount: 4,
  customerName: "Jan Novák",
  customerEmail: "jan.novak@example.com",
  customerPhone: "+420 777 123 456",
  tablePreference: "window",
  specialRequests: "Vegetarian menu needed",
};

// Create the test program
const program = Effect.gen(function* () {
  yield* Console.log("Starting Dotypos customer integration test...");
  yield* Console.log("Test input:", testReservation);
  
  // Create reservation (will find/create customer automatically)
  const reservation = yield* createReservation(testReservation);
  
  yield* Console.log("Reservation created successfully!");
  yield* Console.log("Reservation details:", reservation);
  
  return reservation;
});

// Run the test
const runTest = program.pipe(
  Effect.provide(DotyposServiceLive),
  Effect.tapError((error) => 
    Console.error("Test failed with error:", error)
  )
);

// Execute
Effect.runPromise(runTest)
  .then((result) => {
    console.log("✅ Test completed successfully!");
    console.log("Result:", result);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });