export async function onRequestGet({ request, env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  if (!env.ADMIN_TOKEN) {
    return json({ ok: false, message: "Signup viewer is not configured yet." }, 503, headers);
  }

  if (!isAuthorized(request, env.ADMIN_TOKEN)) {
    return json({ ok: false, message: "Private signup viewer needs the admin access code." }, 401, headers);
  }

  if (!env.DB) {
    return json({ ok: false, message: "Signup database is not connected." }, 503, headers);
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 500);

  try {
    const result = await env.DB.prepare(
      `SELECT email, name, favourite, status, created_at, updated_at, verified_at
       FROM members
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
      .bind(limit)
      .all();

    return json({ ok: true, signups: result.results || [] }, 200, headers);
  } catch (error) {
    console.error("Signup viewer query failed", error);
    return json({ ok: false, message: "Could not load signups right now." }, 500, headers);
  }
}

function isAuthorized(request, token) {
  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Bearer ") && header.slice(7) === token) return true;
  return false;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}
