const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_COOKIE = "sb_member";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function onRequestPost({ request, env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  if (!env.DB) {
    return json({ ok: false, message: "Member login is not connected yet." }, 503, headers);
  }

  const payload = await readPayload(request);
  if (!payload) return json({ ok: false, message: "Invalid login payload." }, 400, headers);

  const email = String(payload.email || "").trim().toLowerCase();
  const code = String(payload.code || "").trim().replace(/\s+/g, "");

  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return json({ ok: false, message: "Use your email and six-digit confirmation code." }, 400, headers);
  }

  try {
    await ensureMemberSchema(env);
    const member = await env.DB.prepare(
      `SELECT email, name, favourite, status, confirmation_code, code_revoked_at, banned_at
       FROM members
       WHERE email = ?`,
    )
      .bind(email)
      .first();

    if (!member) {
      return json({ ok: false, message: "No member pass was found for that email." }, 404, headers);
    }

    if (member.banned_at || member.status === "banned") {
      return json({ ok: false, message: "This member pass cannot access the Signal Room." }, 403, headers);
    }

    if (member.code_revoked_at || member.status === "revoked") {
      return json({ ok: false, message: "This confirmation code has been revoked." }, 403, headers);
    }

    if (member.confirmation_code !== code) {
      return json({ ok: false, message: "That confirmation code does not match this email." }, 401, headers);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE members
       SET status = 'active',
           verified_at = COALESCE(verified_at, ?),
           last_login_at = ?,
           updated_at = ?
       WHERE email = ?`,
    )
      .bind(now, now, now, email)
      .run();

    const cookie = await makeSessionCookie(env, request, email);
    return json(
      {
        ok: true,
        email,
        message: "Welcome back to the Signal Room.",
      },
      200,
      {
        ...headers,
        "Set-Cookie": cookie,
      },
    );
  } catch (error) {
    console.error("Member login failed", error);
    return json({ ok: false, message: "Member login could not be checked right now." }, 500, headers);
  }
}

async function readPayload(request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return await request.json();
    return Object.fromEntries(await request.formData());
  } catch {
    return null;
  }
}

async function makeSessionCookie(env, request, email) {
  const secret = env.MEMBER_SESSION_SECRET || env.ADMIN_TOKEN || "local-dev-only";
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = b64url(JSON.stringify({ email, exp: expires }));
  const signature = await hmac(secret, payload);
  const value = `${payload}.${signature}`;
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly${secure}; SameSite=Lax`;
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return b64url(new Uint8Array(signature));
}

function b64url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
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

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}
