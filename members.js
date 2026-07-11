const comics = [
  {
    id: "blue-light-hunger-chapter",
    era: "Act 1",
    title: "Blue Light Hunger",
    subtitle: "Chapter sequence",
    cover: "/assets/covers/normal-people-scare-me.jpg",
    noteTitle: "The phone glows before the room wakes.",
    note:
      "A clean 12-page reading cut: Luca alone with the screen, the ache, and the room closing in around him.",
    pages: Array.from({ length: 12 }, (_, index) => {
      const page = String(index + 1).padStart(2, "0");
      return {
        label: `Page ${page}`,
        src: `/assets/members/comics/blue-light-hunger/chapter-pages/Chapter_2_Blue_Light_Hunger_Page_${page}.jpg`,
      };
    }),
  },
  {
    id: "blue-light-hunger-archive",
    era: "Archive cut",
    title: "Blue Light Hunger",
    subtitle: "All pages and alternates",
    cover: "/assets/covers/normal-people-scare-me-art.jpg",
    noteTitle: "The archive keeps the alternate signal.",
    note:
      "A wider local cut with the core sequence plus alternate page-three variants, useful for deciding what belongs in the final members chapter.",
    pages: ["1", "2", "3", "3.2", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12"].map((page) => ({
      label: `Page ${page}`,
      src: `/assets/members/comics/blue-light-hunger/archive-pages/${page}.jpg`,
    })),
  },
];

const state = {
  comicIndex: 0,
  pageIndex: 0,
};

const comicList = document.querySelector("#comic-list");
const comicEra = document.querySelector("#comic-era");
const comicTitle = document.querySelector("#comic-title");
const pageCount = document.querySelector("#page-count");
const pageImage = document.querySelector("#comic-page");
const pageCaption = document.querySelector("#page-caption");
const prevPage = document.querySelector("#prev-page");
const nextPage = document.querySelector("#next-page");
const pageSlider = document.querySelector("#page-slider");
const thumbStrip = document.querySelector("#thumb-strip");
const noteTitle = document.querySelector("#note-title");
const noteCopy = document.querySelector("#note-copy");
const fullscreenButton = document.querySelector("#fullscreen-button");
const dialog = document.querySelector("#reader-dialog");
const closeDialog = document.querySelector("#close-dialog");
const dialogTitle = document.querySelector("#dialog-title");
const dialogCount = document.querySelector("#dialog-count");
const dialogPage = document.querySelector("#dialog-page");
const dialogPrev = document.querySelector("#dialog-prev");
const dialogNext = document.querySelector("#dialog-next");
const memberLoginForm = document.querySelector("#member-login-form");
const memberLoginMessage = document.querySelector("#member-login-message");
const memberSessionMessage = document.querySelector("#member-session-message");
const forgotCodeButton = document.querySelector("#forgot-code");
const resetCodeButton = document.querySelector("#reset-code");
const signOutButton = document.querySelector("#sign-out");
const sessionPanel = document.querySelector("#member-session-panel");

function currentComic() {
  return comics[state.comicIndex];
}

function currentPage() {
  return currentComic().pages[state.pageIndex];
}

function renderComicList() {
  comicList.innerHTML = comics
    .map(
      (comic, index) => `
        <button class="comic-card ${index === state.comicIndex ? "is-active" : ""}" type="button" data-comic="${index}">
          <img src="${comic.cover}" alt="" />
          <span>${comic.era}</span>
          <div>
            <strong>${comic.title}</strong>
            <small>${comic.subtitle} - ${comic.pages.length} pages</small>
          </div>
        </button>
      `,
    )
    .join("");
}

function renderThumbs() {
  const comic = currentComic();
  thumbStrip.innerHTML = comic.pages
    .map(
      (page, index) => `
        <button class="thumb-button ${index === state.pageIndex ? "is-active" : ""}" type="button" data-page="${index}" aria-label="${page.label}">
          <img src="${page.src}" alt="" loading="lazy" />
        </button>
      `,
    )
    .join("");
}

function updateReader() {
  const comic = currentComic();
  const page = currentPage();
  const countText = `${page.label} / ${comic.pages.length}`;

  document.body.style.setProperty("--room-bg", `url("${page.src}")`);
  comicEra.textContent = comic.era;
  comicTitle.textContent = comic.title;
  pageCount.textContent = countText;
  pageImage.src = page.src;
  pageImage.alt = `${comic.title} ${page.label}`;
  pageCaption.textContent = `${comic.subtitle} - ${countText}`;
  pageSlider.max = String(comic.pages.length);
  pageSlider.value = String(state.pageIndex + 1);
  noteTitle.textContent = comic.noteTitle;
  noteCopy.textContent = comic.note;
  prevPage.disabled = state.pageIndex === 0;
  nextPage.disabled = state.pageIndex === comic.pages.length - 1;
  dialogTitle.textContent = comic.title;
  dialogCount.textContent = countText;
  dialogPage.src = page.src;
  dialogPage.alt = `${comic.title} ${page.label}`;
  dialogPrev.disabled = prevPage.disabled;
  dialogNext.disabled = nextPage.disabled;

  renderComicList();
  renderThumbs();
}

function setComic(index) {
  state.comicIndex = index;
  state.pageIndex = 0;
  updateReader();
}

function setPage(index) {
  const comic = currentComic();
  state.pageIndex = Math.min(comic.pages.length - 1, Math.max(0, index));
  updateReader();
}

function next() {
  setPage(state.pageIndex + 1);
}

function previous() {
  setPage(state.pageIndex - 1);
}

function setMemberMessage(text) {
  if (memberLoginMessage) memberLoginMessage.textContent = text;
  if (memberSessionMessage) memberSessionMessage.textContent = text;
}

async function checkSession() {
  try {
    const response = await fetch("/api/member-session", { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    const active = response.ok && data.ok;
    document.body.classList.toggle("has-member-session", active);
    setSessionView(active, data.email);
  } catch {
    document.body.classList.remove("has-member-session");
    setSessionView(false);
  }
}

function setSessionView(active, email = "") {
  if (sessionPanel) sessionPanel.hidden = !active;
  if (memberLoginForm) memberLoginForm.hidden = active;
  if (active) {
    setMemberMessage(`Logged in as ${email}.`);
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || "Request failed.");
  return data;
}

comicList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-comic]");
  if (!button) return;
  setComic(Number(button.dataset.comic));
});

thumbStrip.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-page]");
  if (!button) return;
  setPage(Number(button.dataset.page));
});

pageSlider.addEventListener("input", () => {
  setPage(Number(pageSlider.value) - 1);
});

prevPage.addEventListener("click", previous);
nextPage.addEventListener("click", next);
dialogPrev.addEventListener("click", previous);
dialogNext.addEventListener("click", next);

fullscreenButton.addEventListener("click", () => {
  dialog.showModal();
  updateReader();
});

closeDialog.addEventListener("click", () => {
  dialog.close();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") next();
  if (event.key === "ArrowLeft") previous();
  if (event.key === "Escape" && dialog.open) dialog.close();
});

memberLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(memberLoginForm));
  const button = memberLoginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  setMemberMessage("Checking member pass...");
  try {
    const data = await postJson("/api/member-login", payload);
    setMemberMessage(data.message || "Welcome back to the Signal Room.");
    await checkSession();
  } catch (error) {
    setMemberMessage(error.message);
  } finally {
    button.disabled = false;
  }
});

forgotCodeButton?.addEventListener("click", async () => {
  const email = memberLoginForm?.querySelector('[name="email"]')?.value || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    setMemberMessage("Add the email you used to join the Signal Room first.");
    memberLoginForm?.querySelector('[name="email"]')?.focus();
    return;
  }
  forgotCodeButton.disabled = true;
  setMemberMessage("Sending confirmation code...");
  try {
    const data = await postJson("/api/member-code", { mode: "forgot", email });
    setMemberMessage(data.message);
  } catch (error) {
    setMemberMessage(error.message);
  } finally {
    forgotCodeButton.disabled = false;
  }
});

resetCodeButton?.addEventListener("click", async () => {
  resetCodeButton.disabled = true;
  setMemberMessage("Resetting confirmation code...");
  try {
    const data = await postJson("/api/member-code", { mode: "reset" });
    setMemberMessage(data.message);
  } catch (error) {
    setMemberMessage(error.message);
  } finally {
    resetCodeButton.disabled = false;
  }
});

signOutButton?.addEventListener("click", async () => {
  await fetch("/api/member-session", { method: "DELETE" });
  document.body.classList.remove("has-member-session");
  setSessionView(false);
  setMemberMessage("Signed out on this device.");
});

updateReader();
checkSession();
