/**
 * Minutes between email automation engine ticks. The Workspace cron runs the
 * engine on this cadence (its `vercel.json`, held to it by `vercel.test.ts`),
 * and a schedule fires only on the minutes it runs. Every tick wakes the
 * production database, which suspends after five idle minutes, so a shorter
 * interval keeps it awake around the clock.
 */
export const emailAutomationTickMinutes = 15;

/**
 * The minutes past the hour on which the engine ticks and a schedule may
 * fire: :00, :15, :30 and :45. Like the cron's step, they restart each hour.
 * Prague is a whole number of hours from UTC, so they are the same minutes in
 * Prague time and in the cron's UTC.
 */
export const emailAutomationScheduleMinutes = Array.from(
  { length: Math.ceil(60 / emailAutomationTickMinutes) },
  (_, index) => index * emailAutomationTickMinutes
);
