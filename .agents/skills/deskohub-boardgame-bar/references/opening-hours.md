# Opening hours

Business rules: `apps/deskohub-boardgame-bar/docs/opening-hours.md`. Code: `features/opening-hours`, `app/api/cron/opening-hours/route.ts`, and `app/api/webhooks/google-calendar/opening-hours/route.ts`.

## Calendar markers

The homepage publishes exceptions from a dedicated Google Calendar. Events without a marker stay private.

- `[bar:hours]` in a timed event's description publishes replacement hours.
- `[bar:closed]` in an all-day event's description publishes a closure.

## Configuration

Share the calendar with the service account and let it see all event details. Set these in Vercel Production and Preview:

- `GOOGLE_CALENDAR_OPENING_HOURS_ID`
- `GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_CALENDAR_PRIVATE_KEY`

`CRON_SECRET` (Vercel Production) authenticates the cron as a bearer token. The webhook channel token is an HMAC derived from it, so the secret itself never goes to Google.

## Freshness

- The exceptions component caches indefinitely under the `opening-hours:exceptions` tag (`openingHoursTags.exceptions()`).
- The webhook verifies the channel token and expires that tag. It acknowledges `sync` messages from channel renewal without expiring anything.
- Time passing sends no notification. `vercel.json` schedules the cron at 22:00 and 23:00 UTC, and the handler runs only when it's midnight in Prague, covering CET and CEST. It expires the tag for the new date and renews the watch.
- Each watch channel lasts three days, so a missed cron doesn't leave the calendar unwatched. Overlapping channels can deliver duplicate notifications; keep invalidation idempotent.

After the first production deployment, wait for the cron or bootstrap the channel without printing the secret:

```bash
curl --fail --header "Authorization: Bearer $CRON_SECRET" \
  'https://bar.deskohub.cz/api/cron/opening-hours?force=1'
```
