# Sonic Blooms

Interactive public site for `sonic-blooms.com`, designed for Cloudflare Pages.

Cloudflare Pages settings:

- Framework preset: None
- Build command: leave blank
- Output directory: `/`

Fan signup:

- Frontend posts to `/api/fan-signup`.
- Preferred D1 binding: `DB`.
- Optional legacy KV binding: `FAN_SIGNUPS`.
- Optional Cloudflare Email Service send binding: `EMAIL`.
- Optional variables: `SIGNUP_NOTIFY_TO`, `SIGNUP_NOTIFY_FROM`. Signup notifications default to `band@sonic-blooms.com`.
- Optional variables: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
- Set `REQUIRE_TURNSTILE=true` after the Turnstile keys are configured.
- Emergency switch: set `SIGNUPS_ENABLED=false` to pause the public waitlist.

D1 setup:

- Schema: `db/schema.sql`.
- Recommended database name: `sonic_blooms_members`.
- Bind the database to Pages Functions as `DB`.
