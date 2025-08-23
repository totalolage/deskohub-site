#!/usr/bin/env bun

/**
 * Quick script to test the reservation page with webhook panel
 * This uses a test reservation ID to demonstrate the webhook test panel
 */

console.log("\n📋 Reservation Page Test Links\n");
console.log("================================\n");

console.log("Since we need a real reservation ID from Dotypos to test,");
console.log(
  "you'll need to create a reservation first through the normal flow.\n"
);

console.log("Once you have a reservation ID, you can access it at:");
console.log("  http://localhost:3000/cs-CZ/reservation/[ID]");
console.log("  http://localhost:3000/en-US/reservation/[ID]\n");

console.log("The page will show:");
console.log("  1. Reservation confirmation details");
console.log("  2. Dev-only webhook testing panel (orange box at bottom)");
console.log("     - Click to expand the panel");
console.log("     - Test each webhook status (Created, Confirmed, Declined)");
console.log("     - View email output in server console\n");

console.log("Example test reservation IDs (if they exist in your Dotypos):");
console.log("  - http://localhost:3000/cs-CZ/reservation/1");
console.log("  - http://localhost:3000/cs-CZ/reservation/2");
console.log("  - http://localhost:3000/cs-CZ/reservation/3\n");

console.log(
  "⚠️  Note: The webhook test panel only appears in development mode!"
);
console.log("It will NOT be visible in production.\n");
