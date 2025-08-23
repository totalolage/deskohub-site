#!/usr/bin/env bun

/**
 * Test script for manually invoking reservation webhooks
 * Usage: bun run scripts/test-webhook.ts [created|confirmed|declined]
 */

import { env } from "@/env";

const webhookUrl = `http://localhost:3000/api/webhooks/reservation?secret=${env.DOTYPOS_WEBHOOK_SECRET}`;

// Sample webhook payloads for different reservation statuses
const payloads = {
  created: [
    {
      branchid: 1,
      created: Date.now(),
      customerid: 12345,
      employeeid: 1,
      flags: 0,
      deleted: 0,
      note:
        "Special requests: Window seat please\n---\nlocale: cs-CZ\nsource: web\ntimestamp: " +
        new Date().toISOString(),
      seats: 4,
      status: 0, // NEW
      tableid: 5,
      taglist: null,
      versiondate: Date.now(),
      reservationid: 99999,
      startdate: Date.now() + 86400000, // Tomorrow
      enddate: Date.now() + 90000000, // Tomorrow + 1 hour
      cloudid: "test-cloud-id",
    },
  ],
  confirmed: [
    {
      branchid: 1,
      created: Date.now() - 3600000,
      customerid: 12345,
      employeeid: 1,
      flags: 0,
      deleted: 0,
      note:
        "Special requests: Vegetarian menu\n---\nlocale: en-US\nsource: web\ntimestamp: " +
        new Date().toISOString(),
      seats: 2,
      status: 5, // CONFIRMED
      tableid: 3,
      taglist: null,
      versiondate: Date.now(),
      reservationid: 99998,
      startdate: Date.now() + 172800000, // Day after tomorrow
      enddate: Date.now() + 176400000, // Day after tomorrow + 1 hour
      cloudid: "test-cloud-id-2",
    },
  ],
  declined: [
    {
      branchid: 1,
      created: Date.now() - 7200000,
      customerid: 12345,
      employeeid: 1,
      flags: 0,
      deleted: 0,
      note:
        "Special requests: Birthday celebration\n---\nlocale: cs-CZ\nsource: web\ntimestamp: " +
        new Date().toISOString(),
      seats: 6,
      status: 10, // DECLINED
      tableid: 7,
      taglist: null,
      versiondate: Date.now(),
      reservationid: 99997,
      startdate: Date.now() + 259200000, // 3 days from now
      enddate: Date.now() + 266400000, // 3 days from now + 2 hours
      cloudid: "test-cloud-id-3",
    },
  ],
};

async function testWebhook(type: "created" | "confirmed" | "declined") {
  const payload = payloads[type];

  console.log(`\n🚀 Testing ${type.toUpperCase()} reservation webhook...`);
  console.log(`URL: ${webhookUrl}`);
  console.log(`Payload:`, JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`✅ Webhook successful (${response.status})`);
      console.log("Response:", JSON.stringify(data, null, 2));
    } else {
      console.error(`❌ Webhook failed (${response.status})`);
      console.error("Error:", data);
    }
  } catch (error) {
    console.error("❌ Failed to send webhook:", error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const type = args[0] as "created" | "confirmed" | "declined";

if (!type || !["created", "confirmed", "declined"].includes(type)) {
  console.log(
    "Usage: bun run scripts/test-webhook.ts [created|confirmed|declined]"
  );
  console.log("\nExamples:");
  console.log(
    "  bun run scripts/test-webhook.ts created    # Test new reservation"
  );
  console.log(
    "  bun run scripts/test-webhook.ts confirmed  # Test confirmed reservation"
  );
  console.log(
    "  bun run scripts/test-webhook.ts declined   # Test declined reservation"
  );
  process.exit(1);
}

// Run the test
testWebhook(type);
