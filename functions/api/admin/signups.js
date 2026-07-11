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
    await ensureMemberSchema(env);
    const result = await env.DB.prepare(
      `SELECT email, name, favourite, status, confirmation_code, code_created_at,
              code_revoked_at, banned_at, ban_reason, created_at, updated_at,
              verified_at, last_login_at
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

async function ensureMemberSchema(env) {
  const result = await env.DB.prepare("PRAGMA table_info(members)").all();
  const columns = new Set((result.results || []).map((column) => column.name));
  const missing = [
    ["confirmation_code", "ALTER TABLE members ADD COLUMN confirmation_code TEXT"],
    ["code_created_at", "ALTER TABLE members ADD COLUMN code_created_at TEXT"],
    ["code_revoked_at", "ALTER TABLE members ADD COLUMN code_revoked_at TEXT"],
    ["banned_at", "ALTER TABLE members ADD COLUMN banned_at TEXT"],
    ["ban_reason", "ALTER TABLE members ADD COLUMN ban_reason TEXT"],
    ["last_login_at", "ALTER TABLE members ADD COLUMN last_login_at TEXT"],
  ].filter(([name]) => !columns.has(name));

  for (const [, sql] of missing) {
    await env.DB.prepare(sql).run();
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
