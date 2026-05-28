# Dotypos Refresh Token

Use Connector v2. The old `GET /client/connect` flow is deprecated.

1. Prepare a browser-submitted form:

```txt
POST https://admin.dotykacka.cz/client/connect/v2
Content-Type: application/x-www-form-urlencoded
```

2. Include fields:

```txt
client_id=<DOTYPOS_CLIENT_ID>
timestamp=<current unix timestamp seconds>
signature=<HMAC_SHA256_HEX(timestamp, DOTYPOS_CLIENT_SECRET)>
scope=*
redirect_uri=<callback URL>
state=<random CSRF value>
```

3. Open/submit the form in a browser and approve access.

4. Read the callback query params:

```txt
token=<DOTYPOS_REFRESH_TOKEN>
cloudid=<DOTYPOS_CLOUD_ID>
state=<same state>
```

5. Store `token` as `DOTYPOS_REFRESH_TOKEN`.

Docs:

```txt
https://docs.api.dotypos.com/authorization/
https://docs.api.dotypos.com/connector-ep-migration/
```
