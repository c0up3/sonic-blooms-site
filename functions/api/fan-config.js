export async function onRequestGet({ env }) {
  return new Response(
    JSON.stringify({
      ok: true,
      signupsEnabled: env.SIGNUPS_ENABLED !== "false",
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      membersAccess: "coming-soon",
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
