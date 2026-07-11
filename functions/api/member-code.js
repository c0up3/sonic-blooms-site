const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_COOKIE = "sb_member";

export async function onRequestPost({ request, env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  if (!env.DB) return json({ ok: false, message: "Member codes are not connected yet." }, 503, headers);

  const payload = await readPayload(request);
  if (!payload) return json({ ok: false, message: "Invalid member-code request." }, 400, headers);

  const mode = String(payload.mode || "forgot").toLowerCase();
  const session = await readSession(request, env);
  const email =
    mode === "reset" && session.ok
      ? session.email
      : String(payload.email || "")
          .trim()
          .toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, message: "Add the email you used to join the Signal Room." }, 400, headers);
  }

  if (mode === "reset" && !session.ok) {
    return json({ ok: false, message: "Log in before resetting your confirmation code." }, 401, headers);
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
      return json({ ok: true, message: "If that email is on the members list, the code has been sent." }, 200, headers);
    }

    if (member.banned_at || member.status === "banned" || member.code_revoked_at || member.status === "revoked") {
      return json({ ok: false, message: "This member pass cannot receive a code." }, 403, headers);
    }

    const code = mode === "reset" ? makeConfirmationCode() : member.confirmation_code || makeConfirmationCode();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `UPDATE members
       SET confirmation_code = ?,
           code_created_at = ?,
           updated_at = ?
       WHERE email = ?`,
    )
      .bind(code, now, now, email)
      .run();

    const emailSent = await sendMemberCodeEmail(env, { ...member, code, mode });
    if (!emailSent) {
      return json(
        {
          ok: false,
          message: "The confirmation code could not be emailed right now. Please try again in a moment.",
        },
        502,
        headers,
      );
    }

    return json(
      {
        ok: true,
        message:
          mode === "reset"
            ? "Your new confirmation code has been emailed."
            : "If that email is on the members list, the code has been sent.",
      },
      200,
      headers,
    );
  } catch (error) {
    console.error("Member code request failed", error);
    return json({ ok: false, message: "The confirmation code could not be sent right now." }, 500, headers);
  }
}

async function sendMemberCodeEmail(env, member) {
  const membersUrl = env.MEMBERS_URL || "https://sonic-blooms.com/members.html";
  const subject =
    member.mode === "reset" ? "Your new Sonic Blooms confirmation code" : "Your Sonic Blooms confirmation code";
  const message = {
    to: member.email,
    from: env.MEMBER_WELCOME_FROM || env.SIGNUP_NOTIFY_FROM || "welcome@sonic-blooms.com",
    subject,
    text: [
      "Your Sonic Blooms confirmation code is:",
      "",
      `${member.code}`,
      "",
      "Use this code with your email address when logging in to the Signal Room.",
      "",
      `Enter the Signal Room: ${membersUrl}`,
      "",
      "Member access is for fans who respect the space. Abuse of the platform, spam, harassment, scraping, or attempts to bypass access controls may result in this confirmation code being revoked.",
      "",
      "Sonic Blooms",
    ].join("\n"),
    html: `
      <p>Your Sonic Blooms confirmation code is:</p>
      <p style="font-size: 28px; letter-spacing: 0.12em;"><strong>${escapeHtml(member.code)}</strong></p>
      <p>Use this code with your email address when logging in to the Signal Room.</p>
      <p><a href="${escapeHtml(membersUrl)}">Enter the Signal Room</a></p>
      <p>Member access is for fans who respect the space. Abuse of the platform, spam, harassment, scraping, or attempts to bypass access controls may result in this confirmation code being revoked.</p>
      <p>Sonic Blooms</p>
    `,
  };

  if (env.EMAIL && typeof env.EMAIL.send === "function") {
    await env.EMAIL.send(message);
    return true;
  }

  if (env.CLOUDFLARE_EMAIL_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_EMAIL_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      console.error("Cloudflare Email Service REST member code send failed", data.errors || data);
      return false;
    }
    return true;
  }

  return false;
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

function makeConfirmationCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const number = [...bytes].reduce((acc, byte) => (acc << 8) + byte, 0) >>> 0;
  return String(number % 1000000).padStart(6, "0");
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}
