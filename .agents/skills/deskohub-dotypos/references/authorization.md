# Dotypos refresh token

Use Connector v2. The `GET /client/connect` flow is deprecated. See the [authorization](https://docs.api.dotypos.com/authorization/) and [Connector migration](https://docs.api.dotypos.com/connector-ep-migration/) docs.

1. Build a browser-submitted form that posts to `https://admin.dotykacka.cz/client/connect/v2` as `application/x-www-form-urlencoded` with these fields:

   ```txt
   client_id=<DOTYPOS_CLIENT_ID>
   timestamp=<current Unix time in seconds>
   signature=<HMAC_SHA256_HEX(timestamp, DOTYPOS_CLIENT_SECRET)>
   scope=*
   redirect_uri=<callback URL>
   state=<random CSRF value>
   ```

2. Submit the form in a browser and approve access.
3. Read `token`, `cloudid`, and `state` from the callback query. Check that `state` matches.
4. Store `token` as `DOTYPOS_REFRESH_TOKEN` and `cloudid` as `DOTYPOS_CLOUD_ID`. Never print either value.
