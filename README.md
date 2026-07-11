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
- Optional Cloudflare Email Service REST fallback variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`.
- Optional variables: `SIGNUP_NOTIFY_TO`, `SIGNUP_NOTIFY_FROM`. Signup notifications default to `band@sonic-blooms.com` and `fans@sonic-blooms.com`.
- Member code email variables: `SEND_MEMBER_WELCOME` defaults to on; set `SEND_MEMBER_WELCOME=false` only to pause member emails. Optional: `MEMBERS_URL`, `MEMBER_WELCOME_FROM`.
- Member login secret: `MEMBER_SESSION_SECRET`.
- Turnstile site key defaults to the Sonic Blooms widget key in `/api/fan-config`; keep the secret in Cloudflare as `TURNSTILE_SECRET_KEY`.
- Set `REQUIRE_TURNSTILE=true` after the Turnstile keys are configured.
- Emergency switch: set `SIGNUPS_ENABLED=false` to pause the public waitlist.
- Admin signup viewer: `/signup-admin.html`, backed by `/api/admin/signups`.
- Required secret for the signup viewer: `ADMIN_TOKEN`.

D1 setup:

- Schema: `db/schema.sql`.
- Recommended database name: `sonic_blooms_members`.
- Bind the database to Pages Functions as `DB`.
