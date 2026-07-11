const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_IP_ATTEMPTS = 20;
const MAX_EMAIL_ATTEMPTS = 5;

export async function onRequestPost({ request, env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  if (env.SIGNUPS_ENABLED === "false") {
    return json({ ok: false, message: "The members waitlist is paused for a moment." }, 503, headers);
  }

  const payload = await readPayload(request);
  if (!payload) {
    return json({ ok: false, message: "Invalid signup payload." }, 400, headers);
  }

  if (String(payload.website || "").trim()) {
    return json({ ok: true, message: "You are on the list. Members access opens soon." }, 200, headers);
  }

  const email = String(payload.email || "").trim().toLowerCase();
  const name = String(payload.name || "").trim().slice(0, 120);
  const favourite = String(payload.favourite || "").trim().slice(0, 160);
  const turnstileToken = String(payload.turnstileToken || payload["cf-turnstile-response"] || "").trim();

  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, message: "Add a valid email to join the members waitlist." }, 400, headers);
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
  const emailSent = storage.isNew || env.NOTIFY_REPEAT_SIGNUPS === "true" ? await sendSignupEmail(env, signup) : false;

  return json(
    {
      ok: true,
      stored: storage.stored,
      emailSent,
      message: "You are on the list. Members access opens soon.",
    },
    200,
    headers,
  );
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, message: "Sonic Blooms members waitlist endpoint." }), {
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
    return { ok: false, message: "Complete the bot check before joining the waitlist." };
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
      const existing = await env.DB.prepare("SELECT email FROM members WHERE email = ?").bind(signup.email).first();
      await env.DB.prepare(
        `INSERT INTO members (email, name, favourite, status, created_at, updated_at)
         VALUES (?, ?, ?, 'waitlist', ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           name = excluded.name,
           favourite = excluded.favourite,
           updated_at = excluded.updated_at`,
      )
        .bind(signup.email, signup.name, signup.favourite, signup.createdAt, signup.createdAt)
        .run();
      return { stored: true, isNew: !existing };
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
    subject: "New Sonic Blooms members waitlist signup",
    text: [
      "New Sonic Blooms members waitlist signup",
      "",
      `Name: ${signup.name || "(not provided)"}`,
      `Email: ${signup.email}`,
      `Favourite signal: ${signup.favourite || "(not provided)"}`,
      `Created: ${signup.createdAt}`,
    ].join("\n"),
    html: `
      <h1>New Sonic Blooms members waitlist signup</h1>
      <p><strong>Name:</strong> ${escapeHtml(signup.name || "(not provided)")}</p>
      <p><strong>Email:</strong> ${escapeHtml(signup.email)}</p>
      <p><strong>Favourite signal:</strong> ${escapeHtml(signup.favourite || "(not provided)")}</p>
      <p><strong>Created:</strong> ${escapeHtml(signup.createdAt)}</p>
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
