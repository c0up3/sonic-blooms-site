const SESSION_COOKIE = "sb_member";

export async function onRequestGet({ request, env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  const session = await readSession(request, env);
  if (!session.ok) return json({ ok: false, message: "Member login required." }, 401, headers);

  if (env.DB) {
    const member = await env.DB.prepare(
      `SELECT email, status, code_revoked_at, banned_at
       FROM members
       WHERE email = ?`,
    )
      .bind(session.email)
      .first()
      .catch(() => null);

    if (!member || member.banned_at || member.status === "banned" || member.code_revoked_at || member.status === "revoked") {
      return json({ ok: false, message: "Member access is not active." }, 403, headers);
    }
  }

  return json({ ok: true, email: session.email }, 200, headers);
}

export async function onRequestDelete({ request }) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return json(
    { ok: true, message: "Signed out." },
    200,
    {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly${secure}; SameSite=Lax`,
    },
  );
}

async function readSession(request, env) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));

  if (!cookie) return { ok: false };

  const value = cookie.slice(`${SESSION_COOKIE}=`.length);
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return { ok: false };

  const secret = env.MEMBER_SESSION_SECRET || env.ADMIN_TOKEN || "local-dev-only";
  const expected = await hmac(secret, payload);
  if (signature !== expected) return { ok: false };

  const data = JSON.parse(new TextDecoder().decode(unb64url(payload)));
  if (!data.email || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return { ok: false };
  return { ok: true, email: data.email };
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

function b64url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function unb64url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}
