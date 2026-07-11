const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_IP_ATTEMPTS = 20;
const MAX_EMAIL_ATTEMPTS = 5;
const MEMBER_STATUS_PENDING = "pending";

export async function onRequestPost({ request, env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  if (env.SIGNUPS_ENABLED === "false") {
    return json({ ok: false, message: "The members list is paused for a moment." }, 503, headers);
  }

  const payload = await readPayload(request);
  if (!payload) {
    return json({ ok: false, message: "Invalid signup payload." }, 400, headers);
  }

  if (String(payload.website || "").trim()) {
    return json({ ok: true, message: "You are on the members list. The Signal Room is open." }, 200, headers);
  }

  const email = String(payload.email || "").trim().toLowerCase();
  const name = String(payload.name || "").trim().slice(0, 120);
  const favourite = String(payload.favourite || "").trim().slice(0, 160);
  const turnstileToken = String(payload.turnstileToken || payload["cf-turnstile-response"] || "").trim();

  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, message: "Add a valid email to join the members list." }, 400, headers);
  }

  const turnstile = await verifyTurnstile(env, request, turnstileToken);
  if (!turnstile.ok) {
    return json({ ok: false, message: turnstile.message }, 403, headers);
  }

  const rateLimit = await checkRateLimit(env, request, email);
  if (!rateLimit.ok) {
    return json({ ok: false, message: rateLimit.message }, 429, headers);
  }

  const signup = {
    email,
    name,
    favourite,
    createdAt: new Date().toISOString(),
    userAgent: request.headers.get("user-agent") || "",
  };

  const storage = await storeSignup(env, signup);
  const shouldNotify = storage.isNew || env.NOTIFY_REPEAT_SIGNUPS === "true";
  if (storage.blocked) {
    return json({ ok: false, message: storage.message }, storage.status || 403, headers);
  }

  const emailSent = shouldNotify ? await sendSignupEmail(env, { ...signup, code: storage.code }) : false;
  const memberEmailSent =
    storage.stored && env.SEND_MEMBER_WELCOME !== "false"
      ? await sendMemberWelcomeEmail(env, { ...signup, code: storage.code })
      : false;

  return json(
    {
      ok: true,
      stored: storage.stored,
      emailSent,
      memberEmailSent,
      message: memberEmailSent
        ? "Check your email for your Signal Room confirmation code."
        : "You are on the members list. Your confirmation code will be sent soon.",
    },
    200,
    headers,
  );
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, message: "Sonic Blooms members signup endpoint." }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readPayload(request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await request.json();
    }
    return Object.fromEntries(await request.formData());
  } catch {
    return null;
  }
}

async function verifyTurnstile(env, request, token) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return env.REQUIRE_TURNSTILE === "true"
      ? { ok: false, message: "Bot protection is being set up. Please try again soon." }
      : { ok: true };
  }

  if (!token) {
    return { ok: false, message: "Complete the bot check before joining the members list." };
  }

  const formData = new FormData();
  formData.append("secret", env.TURNSTILE_SECRET_KEY);
  formData.append("response", token);
  formData.append("remoteip", request.headers.get("cf-connecting-ip") || "");

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  return data.success ? { ok: true } : { ok: false, message: "The bot check did not pass. Please try again." };
}

async function checkRateLimit(env, request, email) {
  if (!env.DB) return { ok: true };

  try {
    const now = Date.now();
    const cutoff = new Date(now - RATE_WINDOW_MS).toISOString();
    const ipHash = await sha256(request.headers.get("cf-connecting-ip") || "unknown");

    const [ipRow, emailRow] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM signup_attempts WHERE ip_hash = ? AND created_at >= ?",
      )
        .bind(ipHash, cutoff)
        .first(),
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM signup_attempts WHERE email = ? AND created_at >= ?",
      )
        .bind(email, cutoff)
        .first(),
    ]);

    if ((ipRow?.count || 0) >= MAX_IP_ATTEMPTS) {
      await recordAttempt(env, ipHash, email, false);
      return { ok: false, message: "Too many attempts from this connection. Try again later." };
    }

    if ((emailRow?.count || 0) >= MAX_EMAIL_ATTEMPTS) {
      await recordAttempt(env, ipHash, email, false);
      return { ok: false, message: "Too many attempts for this email. Try again later." };
    }

    await recordAttempt(env, ipHash, email, true);
    return { ok: true };
  } catch (error) {
    console.error("Signup rate limit unavailable", error);
    return { ok: true };
  }
}

async function recordAttempt(env, ipHash, email, accepted) {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT INTO signup_attempts (ip_hash, email, action, accepted, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(ipHash, email, "waitlist", accepted ? 1 : 0, new Date().toISOString())
    .run();
}

async function storeSignup(env, signup) {
  if (env.DB) {
    try {
      await ensureMemberSchema(env);
      const existing = await env.DB.prepare(
        `SELECT email, status, confirmation_code, code_revoked_at, banned_at
         FROM members
         WHERE email = ?`,
      )
        .bind(signup.email)
        .first();

      if (existing?.banned_at || existing?.status === "banned") {
        return {
          stored: false,
          isNew: false,
          blocked: true,
          status: 403,
          message: "This email cannot be used for Sonic Blooms member access.",
        };
      }

      if (existing?.code_revoked_at || existing?.status === "revoked") {
        return {
          stored: false,
          isNew: false,
          blocked: true,
          status: 403,
          message: "This confirmation code has been revoked. Contact the band if this seems wrong.",
        };
      }

      const code = existing?.confirmation_code || makeConfirmationCode();
      await env.DB.prepare(
        `INSERT INTO members (
           email, name, favourite, status, confirmation_code, code_created_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           name = excluded.name,
           favourite = excluded.favourite,
           confirmation_code = COALESCE(members.confirmation_code, excluded.confirmation_code),
           code_created_at = COALESCE(members.code_created_at, excluded.code_created_at),
           updated_at = excluded.updated_at`,
      )
        .bind(
          signup.email,
          signup.name,
          signup.favourite,
          MEMBER_STATUS_PENDING,
          code,
          signup.createdAt,
          signup.createdAt,
          signup.createdAt,
        )
        .run();
      return { stored: true, isNew: !existing, code };
    } catch (error) {
      console.error("D1 signup storage failed", error);
    }
  }

  if (env.FAN_SIGNUPS && typeof env.FAN_SIGNUPS.put === "function") {
    await env.FAN_SIGNUPS.put(`signup:${signup.createdAt}:${signup.email}`, JSON.stringify(signup));
    return { stored: true, isNew: true };
  }

  return { stored: false, isNew: false };
}

async function sendSignupEmail(env, signup) {
  const message = buildSignupEmail(env, signup);
  return await sendEmail(env, message);
}

async function sendMemberWelcomeEmail(env, signup) {
  const message = buildMemberWelcomeEmail(env, signup);
  return await sendEmail(env, message);
}

async function sendEmail(env, message) {
  try {
    if (env.EMAIL && typeof env.EMAIL.send === "function") {
      await env.EMAIL.send(message);
      return true;
    }

    if (env.CLOUDFLARE_EMAIL_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
      return await sendViaEmailServiceRest(env, message);
    }
  } catch (error) {
    console.error("Signup email failed", error);
  }

  return false;
}

function buildSignupEmail(env, signup) {
  return {
    to: env.SIGNUP_NOTIFY_TO || "band@sonic-blooms.com",
    from: env.SIGNUP_NOTIFY_FROM || "fans@sonic-blooms.com",
    subject: "New Sonic Blooms member signup",
    text: [
      "New Sonic Blooms member signup",
      "",
      `Name: ${signup.name || "(not provided)"}`,
      `Email: ${signup.email}`,
      `Favourite signal: ${signup.favourite || "(not provided)"}`,
      `Confirmation code: ${signup.code || "(not generated)"}`,
      `Created: ${signup.createdAt}`,
    ].join("\n"),
    html: `
      <h1>New Sonic Blooms member signup</h1>
      <p><strong>Name:</strong> ${escapeHtml(signup.name || "(not provided)")}</p>
      <p><strong>Email:</strong> ${escapeHtml(signup.email)}</p>
      <p><strong>Favourite signal:</strong> ${escapeHtml(signup.favourite || "(not provided)")}</p>
      <p><strong>Confirmation code:</strong> ${escapeHtml(signup.code || "(not generated)")}</p>
      <p><strong>Created:</strong> ${escapeHtml(signup.createdAt)}</p>
    `,
  };
}

function buildMemberWelcomeEmail(env, signup) {
  const membersUrl = env.MEMBERS_URL || "https://sonic-blooms.com/members.html";
  const firstName = (signup.name || "").split(/\s+/).filter(Boolean)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  return {
    to: signup.email,
    from: env.MEMBER_WELCOME_FROM || env.SIGNUP_NOTIFY_FROM || "welcome@sonic-blooms.com",
    subject: "Your Sonic Blooms confirmation code",
    text: [
      greeting,
      "",
      "Your Sonic Blooms confirmation code is:",
      "",
      `${signup.code}`,
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
      <p>${escapeHtml(greeting)}</p>
      <p>Your Sonic Blooms confirmation code is:</p>
      <p style="font-size: 28px; letter-spacing: 0.12em;"><strong>${escapeHtml(signup.code || "")}</strong></p>
      <p>Use this code with your email address when logging in to the Signal Room.</p>
      <p><a href="${escapeHtml(membersUrl)}">Enter the Signal Room</a></p>
      <p>Member access is for fans who respect the space. Abuse of the platform, spam, harassment, scraping, or attempts to bypass access controls may result in this confirmation code being revoked.</p>
      <p>Sonic Blooms</p>
    `,
  };
}

async function sendViaEmailServiceRest(env, message) {
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
    console.error("Cloudflare Email Service REST send failed", data.errors || data);
    return false;
  }
  return true;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeConfirmationCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const number = [...bytes].reduce((acc, byte) => (acc << 8) + byte, 0) >>> 0;
  return String(number % 1000000).padStart(6, "0");
}

async function ensureMemberSchema(env) {
  if (!env.DB) return;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
