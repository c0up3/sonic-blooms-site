# Sonic Blooms

Interactive public site for `sonic-blooms.com`, designed for Cloudflare Pages.

Cloudflare Pages settings:

- Framework preset: None
- Build command: leave blank
- Output directory: `/`

Fan signup:

- Frontend posts to `/api/fan-signup`.
- Optional KV binding: `FAN_SIGNUPS`.
- Optional Cloudflare Email Service send binding: `EMAIL`.
- Optional variables: `SIGNUP_NOTIFY_TO`, `SIGNUP_NOTIFY_FROM`.
