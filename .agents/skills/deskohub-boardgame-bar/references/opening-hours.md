# Google Calendar opening hours

The homepage reads opening-hours exceptions from a dedicated Google Calendar.
The Google data is cached indefinitely and refreshed after an authenticated
Google Calendar push notification or the Prague-midnight date rollover.

## Calendar access

Share the calendar with the configured service-account email and grant it
permission to see all event details. Configure these Vercel variables for
Production and Preview:

- `GOOGLE_CALENDAR_OPENING_HOURS_ID`
- `GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_CALENDAR_PRIVATE_KEY`

Unmarked calendar events remain private planning entries. Put `[bar:hours]` in
a timed event description to publish replacement hours. Put `[bar:closed]` in
an all-day event description to publish a closure.

## Webhook authentication and renewal

Create a random secret and save it as `CRON_SECRET` in the Vercel Production
environment. Vercel sends it as the bearer token for the watch-renewal cron.
The app derives a separate Google webhook channel token from it; the secret
itself is never sent to Google.

The production cron calls `/api/cron/opening-hours` at 22:00 and 23:00 UTC. The
handler runs only when that instant is midnight in Prague, covering both CET
and CEST. It expires the static opening-hours data for the new local date and
renews the Google watch. Each channel lasts three days, so a short scheduling
outage does not leave the calendar unwatched. Overlapping channels can deliver
duplicate notifications; cache invalidation is intentionally idempotent.

After the first production deployment, either wait for the next cron execution
or bootstrap the first channel manually:

```bash
curl --fail \
  --header "Authorization: Bearer $CRON_SECRET" \
  'https://bar.deskohub.cz/api/cron/opening-hours?force=1'
```

Google sends event-change notifications to
`/api/webhooks/google-calendar/opening-hours`. The callback verifies the
derived channel token and immediately expires the `opening-hours:exceptions`
cache tag. Google synchronization messages created during channel renewal are
acknowledged without refreshing the calendar data.

Google does not send notifications when time merely passes. The midnight cron
therefore expires the static opening-hours data once per Prague calendar day.
The next homepage request regenerates it; there is no periodic polling between
those date rollovers.
