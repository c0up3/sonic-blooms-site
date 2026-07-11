export async function onRequestGet({ env }) {
  const turnstileReady = Boolean(env.TURNSTILE_SECRET_KEY);
  return new Response(
    JSON.stringify({
      ok: true,
      signupsEnabled: env.SIGNUPS_ENABLED !== "false",
      turnstileSiteKey: turnstileReady ? env.TURNSTILE_SITE_KEY || "0x4AAAAAADzy9yspchdWmkzS" : "",
      turnstileReady,
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
