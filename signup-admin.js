const tokenInput = document.querySelector("#admin-token");
const loadButton = document.querySelector("#load-signups");
const clearButton = document.querySelector("#clear-code");
const exportButton = document.querySelector("#export-csv");
const message = document.querySelector("#admin-message");
const rows = document.querySelector("#signup-rows");
const tokenKey = "sonic-blooms-admin-token";
let currentSignups = [];

tokenInput.value = localStorage.getItem(tokenKey) || "";

loadButton.addEventListener("click", () => loadSignups());
clearButton.addEventListener("click", () => {
  localStorage.removeItem(tokenKey);
  tokenInput.value = "";
  currentSignups = [];
  exportButton.disabled = true;
  rows.innerHTML = `<tr><td colspan="8">Enter the admin access code to load the list.</td></tr>`;
  message.textContent = "Access code forgotten on this device.";
});
exportButton.addEventListener("click", exportCsv);

async function loadSignups() {
  const token = tokenInput.value.trim();
  if (!token) {
    message.textContent = "Paste the admin access code first.";
    tokenInput.focus();
    return;
  }

  loadButton.disabled = true;
  message.textContent = "Loading signups...";
  try {
    const response = await fetch("/api/admin/signups", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      message.textContent = data.message || "Could not load signups.";
      rows.innerHTML = `<tr><td colspan="8">Nothing loaded.</td></tr>`;
      exportButton.disabled = true;
      return;
    }

    localStorage.setItem(tokenKey, token);
    currentSignups = data.signups || [];
    renderRows(currentSignups);
    exportButton.disabled = currentSignups.length === 0;
    message.textContent = currentSignups.length
      ? `${currentSignups.length} signup${currentSignups.length === 1 ? "" : "s"} loaded.`
      : "No signups yet.";
  } catch {
    message.textContent = "Could not reach the signup viewer right now.";
  } finally {
    loadButton.disabled = false;
  }
}

function renderRows(signups) {
  if (!signups.length) {
    rows.innerHTML = `<tr><td colspan="8">No signups yet.</td></tr>`;
    return;
  }

  rows.innerHTML = signups
    .map(
      (signup) => `
        <tr>
          <td><strong>${escapeHtml(signup.email)}</strong></td>
          <td>${escapeHtml(signup.name || "")}</td>
          <td>${escapeHtml(signup.favourite || "")}</td>
          <td>${statusLabel(signup)}</td>
          <td><code>${escapeHtml(signup.confirmation_code || "")}</code></td>
          <td>${formatDate(signup.created_at)}</td>
          <td>${formatDate(signup.updated_at)}</td>
          <td>${formatDate(signup.last_login_at)}</td>
        </tr>
      `,
    )
    .join("");
}

function exportCsv() {
  if (!currentSignups.length) return;
  const header = [
    "email",
    "name",
    "favourite",
    "status",
    "confirmation_code",
    "code_created_at",
    "code_revoked_at",
    "banned_at",
    "ban_reason",
    "created_at",
    "updated_at",
    "verified_at",
    "last_login_at",
  ];
  const lines = [
    header.join(","),
    ...currentSignups.map((signup) => header.map((key) => csvCell(signup[key] || "")).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `sonic-blooms-signups-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function statusLabel(signup) {
  const parts = [signup.status || ""];
  if (signup.banned_at) parts.push("banned");
  if (signup.code_revoked_at) parts.push("revoked");
  return escapeHtml([...new Set(parts.filter(Boolean))].join(" / "));
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
