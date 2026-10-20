/**
 * Minutes between email automation engine ticks. `vercel.ts` schedules the
 * engine's cron on this cadence, and a schedule fires only on the minutes it
 * runs. Every tick wakes the production database, which suspends after five
 * idle minutes, so a shorter interval keeps it awake around the clock.
 */
export const emailAutomationTickMinutes = 15;
