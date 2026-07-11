export async function onRequestPost({ request, env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, message: "Invalid signup payload." }), {
      status: 400,
      headers,
    });
  }

  const email = String(payload.email || "").trim().toLowerCase();
  const name = String(payload.name || "").trim().slice(0, 120);
  const favourite = String(payload.favourite || "").trim().slice(0, 160);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ ok: false, message: "Add a valid email to enter the Signal Room." }), {
      status: 400,
      headers,
    });
  }

  const signup = {
    email,
    name,
    favourite,
    createdAt: new Date().toISOString(),
    userAgent: request.headers.get("user-agent") || "",
  };

  let stored = false;
  if (env.FAN_SIGNUPS && typeof env.FAN_SIGNUPS.put === "function") {
    await env.FAN_SIGNUPS.put(`signup:${signup.createdAt}:${email}`, JSON.stringify(signup));
    stored = true;
  }

  let emailSent = false;
  let emailError = "";
  if (env.EMAIL && typeof env.EMAIL.send === "function") {
    try {
      await env.EMAIL.send({
        to: env.SIGNUP_NOTIFY_TO || "band@sonic-blooms.com",
        from: env.SIGNUP_NOTIFY_FROM || "fans@sonic-blooms.com",
        subject: "New Sonic Blooms fan signup",
        text: [
          "New Sonic Blooms fan signup",
          "",
          `Name: ${name || "(not provided)"}`,
          `Email: ${email}`,
          `Favourite signal: ${favourite || "(not provided)"}`,
          `Created: ${signup.createdAt}`,
        ].join("\n"),
        html: `
          <h1>New Sonic Blooms fan signup</h1>
          <p><strong>Name:</strong> ${escapeHtml(name || "(not provided)")}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>Favourite signal:</strong> ${escapeHtml(favourite || "(not provided)")}</p>
          <p><strong>Created:</strong> ${escapeHtml(signup.createdAt)}</p>
        `,
      });
      emailSent = true;
    } catch (error) {
      emailError = error?.message || "Email send failed.";
      console.error("Signup email failed", error);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      stored,
      emailSent,
      message: emailSent
        ? "Signal Room unlocked. Welcome in."
        : stored
          ? "Signal Room unlocked. New drops will appear here first."
          : "Signal Room unlocked on this device. New drops will appear here first.",
      emailError,
    }),
    { headers },
  );
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, message: "Sonic Blooms fan signup endpoint." }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
