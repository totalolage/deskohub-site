#!/usr/bin/env bun

/**
 * Test script to verify email provider configuration
 * Usage: bun run scripts/test-email-provider.ts
 */

import { env } from "@/env";

console.log("=".repeat(60));
console.log("Email Provider Configuration Test");
console.log("=".repeat(60));

// Check if Resend is configured
if (env.RESEND_API_KEY) {
  console.log("✅ RESEND_API_KEY is configured");
  console.log(`   Key starts with: ${env.RESEND_API_KEY.substring(0, 10)}...`);
  console.log("   Provider: Resend (Production email service)");
  console.log("   Emails will be sent to real recipients");
} else {
  console.log("ℹ️  RESEND_API_KEY is NOT configured");
  console.log("   Provider: Console (Development mode)");
  console.log("   Emails will be logged to console only");
}

console.log("\n" + "=".repeat(60));
console.log("Email Configuration:");
console.log("=".repeat(60));

console.log("\nFrom Addresses:");
console.log("  Czech (cs-CZ):   rezervace@deskohub.cz");
console.log("  English (en-US): reservations@deskohub.cz");

console.log("\nBusiness Notification Email:");
console.log("  reservations@deskohub.cz");

console.log("\nReply-To Address:");
console.log("  contact@deskohub.cz");

console.log("\n" + "=".repeat(60));
console.log("Webhook Configuration:");
console.log("=".repeat(60));

if (env.DOTYPOS_WEBHOOK_SECRET) {
  console.log("✅ DOTYPOS_WEBHOOK_SECRET is configured");
  console.log("   Webhooks are secured in production");
  console.log("   Secret validation is skipped in development");
} else {
  console.log("⚠️  DOTYPOS_WEBHOOK_SECRET is NOT configured");
  console.log("   Webhooks may not work properly");
}

console.log("\n" + "=".repeat(60));
console.log("Environment:");
console.log("=".repeat(60));
console.log(`NODE_ENV: ${env.NODE_ENV}`);
console.log(`Development mode: ${env.NODE_ENV === "development"}`);

console.log("\n" + "=".repeat(60));
console.log("\nTo configure Resend:");
console.log("1. Sign up at https://resend.com");
console.log("2. Get your API key");
console.log("3. Add to .env.local:");
console.log("   RESEND_API_KEY=re_YOUR_KEY_HERE");
console.log("\nSee docs/RESEND_SETUP.md for detailed instructions");
console.log("=".repeat(60));