export async function onRequestGet({ env }) {
  return new Response(
    JSON.stringify({
      ok: true,
      signupsEnabled: env.SIGNUPS_ENABLED !== "false",
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "0x4AAAAAADzy9yspchdWmkzS",
      membersAccess: "email-code",
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
