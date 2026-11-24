/* ==========================================================================
   Operations Analytics site

   Views: Home, Analytics Funnel, Reports, Notes, Fiscal Calendar, Projects.
   The URL hash (#notes, #projects, ...) picks the view, so views can be
   bookmarked and the browser back button works.

   Notes and projects are saved in this browser's localStorage under the
   "notes" and "analytics_projects" keys. Export / Import back them up to a
   .json file.
   ========================================================================== */

const NOTES_KEY = "notes";
const PROJECTS_KEY = "analytics_projects";
const NOTE_EMAIL_RECIPIENT = "jesse.hendrickson@goodwillindy.org";
const DAY_MS = 24 * 60 * 60 * 1000;

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ============================================
   SHARED HELPERS
   ============================================ */

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// "YYYY-MM-DD" is read as a local date. new Date("YYYY-MM-DD") means UTC
// midnight, which is the evening before in Indiana and made project dates
// show one day early.
function parseLocalDate(value) {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

// Today as YYYY-MM-DD in local time. toISOString() is UTC, so in the evening
// it would already be tomorrow.
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatShortDate(value) {
  const d = parseLocalDate(value);
  return d ? `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : "";
}

function formatMonthDay(value) {
  const d = parseLocalDate(value);
  return d ? `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}` : "";
}

// Whole days from today until a date; negative means it has passed
function daysFromToday(value) {
  const date = parseLocalDate(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date - today) / DAY_MS);
}

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch (err) {
    console.warn(`Could not read "${key}" from localStorage`, err);
    return [];
  }
}

/* ---------- Toasts ---------- */

// actions: [{ label, onClick }] adds buttons to the toast
function showToast(message, { icon = "fa-solid fa-check", actions = [], error = false } = {}) {
  const wrap = document.getElementById("toasts");
  const toast = document.createElement("div");
  toast.className = "toast" + (error ? " is-error" : "");
  toast.setAttribute("role", error ? "alert" : "status");
  toast.innerHTML = `<i class="${icon}"></i><span>${escapeHtml(message)}</span>`;

  if (actions.length) {
    const box = document.createElement("span");
    box.className = "toast-actions";
    actions.forEach(({ label, onClick }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => {
        toast.remove();
        onClick();
      });
      box.appendChild(button);
    });
    toast.appendChild(box);
  }

  wrap.appendChild(toast);
  setTimeout(() => toast.remove(), actions.length ? 9000 : 3500);
}

function showError(message) {
  showToast(message, { icon: "fa-solid fa-circle-exclamation", error: true });
}

/* ---------- Dialogs ---------- */

// dismissible: close on backdrop click and Escape. The note editor turns this
// off so a stray click can't throw away edits.
function openModal(innerHtml, { size = "", dismissible = true } = {}) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.dataset.dismissible = String(dismissible);
  modal.innerHTML = `<div class="card modal-card ${size}" role="dialog" aria-modal="true">${innerHtml}</div>`;
  modal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-modal]") || (dismissible && e.target === modal)) {
      closeModal(modal);
    }
  });
  document.body.appendChild(modal);
  document.body.classList.add("has-overlay");
  const first = modal.querySelector("input, textarea, select");
  if (first) first.focus();
  return modal;
}

function closeModal(modal) {
  modal.remove();
  if (!document.querySelector(".modal") && document.getElementById("more-sheet").hidden) {
    document.body.classList.remove("has-overlay");
  }
}

/* ---------- Bulleted note editing ----------
   "• " starts a bullet and "  ○ " a sub-bullet. Enter continues the list,
   Enter on an empty bullet ends it, and Tab turns a bullet into a sub-bullet. */

function insertBullet(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = textarea.value.substring(0, start) + "• " + textarea.value.substring(end);
  textarea.selectionStart = textarea.selectionEnd = start + 2;
  textarea.focus();
}

function enableBulletEditing(textarea) {
  textarea.addEventListener("keydown", function (e) {
    const value = textarea.value;
    const start = textarea.selectionStart;
    const lastNewline = value.lastIndexOf("\n", start - 1);
    const lineStart = lastNewline + 1;
    const currentLine = value.slice(lineStart, start);

    if (e.key === "Tab") {
      e.preventDefault();
      if (currentLine.startsWith("• ") && !currentLine.startsWith("  ○ ")) {
        const before = value.substring(0, lineStart);
        const after = value.substring(start);
        const lineContent = currentLine.slice(2);
        textarea.value = before + "  ○ " + lineContent + after;
        textarea.selectionStart = textarea.selectionEnd = lineStart + 4 + lineContent.length;
      } else {
        const before = value.substring(0, start);
        const after = value.substring(start);
        textarea.value = before + "  " + after;
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }
    } else if (e.key === "Enter") {
      if (currentLine.startsWith("  ○ ") && currentLine.trim() !== "○") {
        e.preventDefault();
        const before = value.substring(0, start);
        const after = value.substring(start);
        textarea.value = before + "\n  ○ " + after;
        textarea.selectionStart = textarea.selectionEnd = start + 5;
      } else if (currentLine.startsWith("• ") && currentLine.trim() !== "•") {
        e.preventDefault();
        const before = value.substring(0, start);
        const after = value.substring(start);
        textarea.value = before + "\n• " + after;
        textarea.selectionStart = textarea.selectionEnd = start + 3;
      } else if (
        currentLine.trim() === "•" ||
        currentLine.trim() === "○" ||
        currentLine.trim() === "  ○"
      ) {
        e.preventDefault();
        const before = value.substring(0, lineStart);
        const after = value.substring(start);
        textarea.value = before + "\n" + after;
        textarea.selectionStart = textarea.selectionEnd = lineStart + 1;
      }
    }
  });
}

/* ============================================
   VIEWS (hash routing)
   ============================================ */

const VIEW_TITLES = {
  home: "Home",
  funnel: "Analytics Funnel",
  reports: "Reports",
  notes: "Notes",
  fiscal: "Fiscal Calendar",
  projects: "Projects",
};
// Views reached through the phone "More" sheet rather than a bottom tab
const MORE_SHEET_VIEWS = ["funnel", "reports"];
// Set by "New note" / "Add project" shortcuts: an input to focus once its view shows
let pendingFocusId = null;

function viewFromHash() {
  const view = location.hash.slice(1);
  return Object.prototype.hasOwnProperty.call(VIEW_TITLES, view) ? view : "home";
}

function showView(view) {
  document.querySelectorAll(".view").forEach((section) => {
    section.hidden = section.dataset.view !== view;
  });

  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = link.dataset.nav === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.getElementById("more-btn").classList.toggle("is-active", MORE_SHEET_VIEWS.includes(view));
  keepActiveTabVisible();

  // Dashboards load the first time their view opens, not on every page load
  const section = document.querySelector(`.view[data-view="${view}"]`);
  section.querySelectorAll("iframe[data-src]").forEach((frame) => {
    if (!frame.getAttribute("src")) frame.src = frame.dataset.src;
  });

  if (view === "home") renderHome();
  if (view === "notes") loadNotes();
  if (view === "fiscal") renderFiscalCalendar();
  if (view === "projects") renderProjects();

  document.title = `${VIEW_TITLES[view]} · Operations Analytics`;

  if (pendingFocusId) {
    const field = document.getElementById(pendingFocusId);
    pendingFocusId = null;
    if (field) {
      const panel = field.closest("details");
      if (panel) panel.open = true;
      field.focus();
    }
  }
}

// On tablets the tab strip scrolls sideways; keep the current tab in view
function keepActiveTabVisible() {
  const strip = document.querySelector(".pills");
  const active = strip && strip.querySelector(".is-active");
  if (!active || strip.scrollWidth <= strip.clientWidth) return;
  const a = active.getBoundingClientRect();
  const s = strip.getBoundingClientRect();
  strip.scrollLeft += a.left - s.left - (s.width - a.width) / 2;
}

/* ============================================
   HEADER MENUS (Data menu, phone "More" sheet)
   ============================================ */

function setDataMenu(open) {
  document.getElementById("data-menu").hidden = !open;
  document.getElementById("data-toggle").setAttribute("aria-expanded", String(open));
}

function setMoreSheet(open) {
  document.getElementById("more-sheet").hidden = !open;
  document.body.classList.toggle("has-overlay", open || Boolean(document.querySelector(".modal")));
}

function setupMenus() {
  const dataMenu = document.getElementById("data-menu");
  document.getElementById("data-toggle").addEventListener("click", () => setDataMenu(dataMenu.hidden));
  document.getElementById("more-btn").addEventListener("click", () => setMoreSheet(true));

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-anchor")) setDataMenu(false);
    if (e.target.closest("[data-close-more]")) setMoreSheet(false);

    const shortcut = e.target.closest("[data-focus]");
    if (shortcut) pendingFocusId = shortcut.dataset.focus;

    // Clicking the tab you're already on re-shows it (e.g. back to the
    // fiscal year overview), since the hash doesn't change
    const nav = e.target.closest('a[href^="#"]');
    if (nav && nav.getAttribute("href") === location.hash) {
      setMoreSheet(false);
      showView(viewFromHash());
    }

    const action = e.target.closest("[data-action]");
    if (action) {
      setDataMenu(false);
      setMoreSheet(false);
      if (action.dataset.action === "export") exportBackup();
      if (action.dataset.action === "import") chooseImportFile();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    setDataMenu(false);
    setMoreSheet(false);
    const modals = document.querySelectorAll('.modal[data-dismissible="true"]');
    if (modals.length) closeModal(modals[modals.length - 1]);
  });
}

/* ============================================
   EMBEDDED DASHBOARDS
   ============================================ */

function setupEmbeds() {
  document.querySelectorAll(".embed").forEach((card) => {
    const frame = card.querySelector("iframe");
    const loading = card.querySelector(".embed-loading");
    frame.addEventListener("load", () => {
      if (frame.getAttribute("src")) loading.hidden = true;
    });
    const reload = card.querySelector("[data-reload]");
    reload.addEventListener("click", () => {
      loading.hidden = false;
      frame.src = frame.dataset.src;
    });
  });
}

/* ============================================
   QUICK LINKS (Home)
   To add a link, copy a tile in index.html into the right group.
   ============================================ */

function setupQuickLinks() {
  const panel = document.getElementById("quick-links");
  const search = document.getElementById("link-search");
  const total = panel.querySelectorAll(".link-tile").length;
  let group = "all";

  search.placeholder = `Search ${total} links`;
  panel.querySelector('[data-link-filter="all"]').textContent = `All ${total}`;

  function applyFilters() {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    panel.querySelectorAll(".link-group").forEach((section) => {
      const inGroup = group === "all" || section.dataset.group === group;
      let visible = 0;
      section.querySelectorAll(".link-tile").forEach((tile) => {
        const match = inGroup && (!query || tile.textContent.toLowerCase().includes(query));
        tile.hidden = !match;
        if (match) visible++;
      });
      section.hidden = visible === 0;
      shown += visible;
    });
    document.getElementById("links-empty").hidden = shown > 0;
  }

  search.addEventListener("input", applyFilters);
  panel.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-link-filter]");
    if (!chip) return;
    group = chip.dataset.linkFilter;
    panel.querySelectorAll("[data-link-filter]").forEach((c) => c.classList.toggle("is-active", c === chip));
    applyFilters();
  });
}

/* ============================================
   HOME DASHBOARD
   ============================================ */

function renderHome() {
  renderFiscalHero();
  renderHomeProjects();
  renderHomeNotes();
}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// Today's fiscal period, week and days left, from the fiscal calendar logic below
function renderFiscalHero() {
  const hero = document.getElementById("hero");
  const today = toMidnight(new Date());
  const period = isDateBetween(today);
  const dateLine = `${WEEKDAYS[today.getDay()]} · ${LONG_MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;

  let stats = "";
  if (period) {
    const periodStart = parseFiscalDate(period.start);
    const periodEnd = parseFiscalDate(period.end);
    const weekOffset = Math.floor(Math.round((today - periodStart) / DAY_MS) / 7);
    const weekStart = addDays(periodStart, weekOffset * 7);
    const weekEnd = addDays(weekStart, 6);
    const daysLeft = Math.round((periodEnd - today) / DAY_MS);
    const weekRange =
      weekStart.getMonth() === weekEnd.getMonth()
        ? `${SHORT_MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${weekEnd.getDate()}`
        : `${SHORT_MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${SHORT_MONTHS[weekEnd.getMonth()]} ${weekEnd.getDate()}`;

    stats = `
      <div class="hero-stats">
        <a class="hero-stat" href="#fiscal"><span>Fiscal period</span><strong>P${period.fiscalPeriod} · ${period.name}</strong><em>FY${period.fiscalYear} · Quarter ${period.quarter}</em></a>
        <a class="hero-stat" href="#fiscal"><span>Fiscal week</span><strong>Week ${period.startWeek + weekOffset}</strong><em>of ${fiscalYearLengthDays(period.fiscalYear) / 7} · ${weekRange}</em></a>
        <a class="hero-stat" href="#fiscal"><span>Period ends</span><strong>${SHORT_MONTHS[periodEnd.getMonth()]} ${periodEnd.getDate()}</strong><em>${
          daysLeft === 0 ? "Last day" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
        }</em></a>
      </div>`;
  }

  hero.innerHTML = `
    <div class="hero-main">
      <span class="hero-eyebrow">${dateLine}</span>
      <h1>${greetingForNow()}</h1>
      <p>Operations Analytics workspace: quick links, notes, projects and the fiscal calendar in one place.</p>
    </div>
    ${stats}`;
}

function renderHomeProjects() {
  const list = document.getElementById("home-projects");
  const active = sortActiveProjects(ProjectsManager.getActiveProjects());
  document.getElementById("home-projects-count").textContent = active.length;

  if (!active.length) {
    list.innerHTML = '<p class="mini-empty">No active projects. <a href="#projects" data-focus="project-name">Add one</a></p>';
    return;
  }

  const rows = active.slice(0, 5).map(
    (p) => `
      <a class="mini-row" href="#projects">
        <span class="mini-main">
          <strong>${escapeHtml(p.name)}</strong>
          <span>Started ${formatMonthDay(p.startDate)}${p.dueDate ? ` · due ${formatMonthDay(p.dueDate)}` : ""}</span>
        </span>
        ${duePill(p)}
      </a>`
  );
  if (active.length > 5) rows.push(`<a class="mini-more" href="#projects">+${active.length - 5} more</a>`);
  list.innerHTML = rows.join("");
}

function renderHomeNotes() {
  const list = document.getElementById("home-notes");
  const notes = sortNotes(getNotes()).slice(0, 3);

  if (!notes.length) {
    list.innerHTML = '<p class="mini-empty">No notes yet. <a href="#notes" data-focus="note-title">Write one</a></p>';
    return;
  }

  list.innerHTML = notes
    .map((note) => {
      const firstLine = (note.content.split("\n").find((l) => l.trim()) || "").replace(/^\s*[•○]\s/, "");
      return `
      <a class="mini-row" href="#notes">
        <span class="mini-main"><strong>${escapeHtml(note.title || "Untitled note")}</strong><span>${escapeHtml(firstLine)}</span></span>
        <span class="mini-date">${formatMonthDay(note.date)}</span>
      </a>`;
    })
    .join("");
}

/* ============================================
   NOTES
   ============================================ */

// Reads saved notes and upgrades older shapes (plain strings, other key
// names, missing ids) to { id, title, content, date, createdAt }. Anything
// upgraded is saved back so ids stay stable between visits.
function getNotes() {
  const raw = readStoredArray(NOTES_KEY);
  let needSave = false;

  const normalized = raw.map((item, idx) => {
    // If item is a primitive (string/number), convert to object
    if (typeof item !== "object" || item === null) {
      needSave = true;
      return {
        id: Date.now() + idx,
        title: "",
        content: String(item),
        date: "",
        createdAt: new Date().toISOString(),
      };
    }

    // Try several possible keys for content/title/date/createdAt
    const content =
      item.content ?? item.note ?? item.noteContent ?? item.body ?? item.text ?? item.note_text ?? "";

    let title = item.title ?? item.noteTitle ?? item.note_title ?? item.heading ?? "";

    // If there's no explicit title, derive first non-empty line (limited length)
    if (!title && content) {
      const firstLine = content.split("\n").find((l) => l.trim() !== "");
      if (firstLine) title = firstLine.trim().slice(0, 80);
    }

    const date = item.date ?? item.noteDate ?? item.note_date ?? item.dueDate ?? "";
    const createdAt = item.createdAt ?? item.created_at ?? item.created ?? item.timestamp ?? "";

    let id = item.id;
    if (id === undefined || id === null) {
      id = Date.now() + idx;
      needSave = true;
    }

    // If createdAt missing, set it so we can reliably sort old, undated notes
    if (!createdAt) needSave = true;

    return {
      id: Number(id),
      title: title || "",
      content: content || "",
      date: date || "",
      createdAt: createdAt || new Date().toISOString(),
    };
  });

  if (needSave) {
    try {
      saveNotes(normalized);
    } catch (e) {
      console.warn("Failed to persist normalized notes:", e);
    }
  }
  return normalized;
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

// Dated notes first (newest first), then undated notes by when they were created
function sortNotes(notes) {
  return notes.slice().sort((a, b) => {
    const aDate = parseLocalDate(a.date);
    const bDate = parseLocalDate(b.date);
    if (aDate && bDate) return bDate - aDate;
    if (aDate) return -1;
    if (bDate) return 1;
    if (a.createdAt && b.createdAt) return new Date(b.createdAt) - new Date(a.createdAt);
    return (b.id || 0) - (a.id || 0);
  });
}

function formatNoteBody(content) {
  return (content || "")
    .split("\n")
    .map((line) => {
      if (line.startsWith("  ○ ") || line.startsWith("  • ")) {
        return `<div class="ln-sb">${escapeHtml(line.slice(4))}</div>`;
      }
      if (line.startsWith("• ")) return `<div class="ln-b">${escapeHtml(line.slice(2))}</div>`;
      if (line.trim()) return `<div>${escapeHtml(line)}</div>`;
      return '<div class="ln-gap"></div>';
    })
    .join("");
}

function renderNoteCard(note) {
  return `
    <article class="card note" data-id="${note.id}">
      <header class="note-head">
        <h3 class="note-title">${escapeHtml(note.title || "Untitled note")}</h3>
        <span class="note-date"><i class="fa-regular fa-calendar"></i>${note.date ? formatShortDate(note.date) : "No date set"}</span>
      </header>
      <div class="note-body">${formatNoteBody(note.content)}</div>
      <footer class="note-foot">
        <button type="button" class="btn btn-sm btn-ghost" data-note-action="edit"><i class="fa-solid fa-pen"></i><span>Edit</span></button>
        <button type="button" class="btn btn-sm btn-ghost" data-note-action="email"><i class="fa-regular fa-paper-plane"></i><span>Email to me</span></button>
        <button type="button" class="btn btn-sm btn-ghost btn-danger" data-note-action="delete"><i class="fa-regular fa-trash-can"></i><span>Delete</span></button>
      </footer>
    </article>`;
}

function loadNotes() {
  const list = document.getElementById("notes-list");
  const notes = sortNotes(getNotes());
  document.getElementById("notes-count").textContent = notes.length;

  list.innerHTML = notes.length
    ? notes.map(renderNoteCard).join("")
    : '<div class="card empty-state"><i class="fa-regular fa-note-sticky"></i><p>No notes yet. Notes you save will show up here.</p></div>';
  applyNoteSearch();
}

function applyNoteSearch() {
  const query = document.getElementById("note-search").value.trim().toLowerCase();
  const cards = document.querySelectorAll("#notes-list .note");
  let shown = 0;
  cards.forEach((card) => {
    const match = !query || card.textContent.toLowerCase().includes(query);
    card.hidden = !match;
    if (match) shown++;
  });
  document.getElementById("notes-no-match").hidden = !cards.length || shown > 0;
}

function newNoteId(notes) {
  let id = Date.now();
  while (notes.some((n) => n.id === id)) id++;
  return id;
}

function setupNotes() {
  const form = document.getElementById("note-form");
  const title = document.getElementById("note-title");
  const date = document.getElementById("note-date");
  const content = document.getElementById("note-content");

  date.value = todayISO();
  enableBulletEditing(content);
  document.getElementById("note-bullet-btn").addEventListener("click", () => insertBullet(content));

  document.getElementById("note-clear-btn").addEventListener("click", () => {
    title.value = "";
    content.value = "";
    date.value = todayISO();
    title.focus();
  });

  document.getElementById("notes-refresh-btn").addEventListener("click", () => {
    loadNotes();
    showToast("Notes refreshed", { icon: "fa-solid fa-rotate-right" });
  });

  document.getElementById("note-search").addEventListener("input", applyNoteSearch);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const noteTitle = title.value.trim();
    const noteContent = content.value;
    if (!noteTitle || !noteContent.trim()) {
      showError("Add a title and some content first.");
      return;
    }

    const notes = getNotes();
    notes.push({
      id: newNoteId(notes),
      title: noteTitle,
      content: noteContent,
      date: date.value || todayISO(),
      createdAt: new Date().toISOString(),
    });
    saveNotes(notes);

    title.value = "";
    content.value = "";
    date.value = todayISO();
    loadNotes();
    showToast("Note saved");
  });

  document.getElementById("notes-list").addEventListener("click", (e) => {
    const button = e.target.closest("[data-note-action]");
    if (!button) return;
    const id = Number(button.closest("[data-id]").dataset.id);
    if (button.dataset.noteAction === "edit") editNoteById(id);
    if (button.dataset.noteAction === "email") emailNoteById(id);
    if (button.dataset.noteAction === "delete") deleteNoteById(id);
  });
}

function deleteNoteById(noteId) {
  if (!confirm("Are you sure you want to delete this note? This cannot be undone.")) return;
  saveNotes(getNotes().filter((note) => note.id !== noteId));
  loadNotes();
  showToast("Note deleted", { icon: "fa-regular fa-trash-can" });
}

function editNoteById(noteId) {
  const note = getNotes().find((n) => n.id === noteId);
  if (!note) {
    showError("That note couldn't be found.");
    return;
  }

  const modal = openModal(
    `
    <form id="edit-note-form">
      <header class="card-head">
        <h2><i class="fa-solid fa-pen"></i> Edit note</h2>
        <button type="button" class="btn btn-icon btn-ghost" data-close-modal aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <div class="card-body stack">
        <div class="field-row">
          <label class="field"><span>Title</span><input class="input" id="edit-note-title" value="${escapeHtml(note.title)}" required /></label>
          <label class="field"><span>Date</span><input class="input" type="date" id="edit-note-date" value="${escapeHtml(note.date)}" required /></label>
        </div>
        <div class="field">
          <span>Content</span>
          <div class="editor">
            <div class="editor-bar">
              <button type="button" class="btn btn-sm btn-ghost" id="edit-note-bullet"><i class="fa-solid fa-list-ul"></i> Bullet</button>
              <span class="editor-hint"><kbd>Tab</kbd> on a bullet adds a sub-bullet</span>
            </div>
            <textarea class="editor-text" id="edit-note-content" rows="10" required>${escapeHtml(note.content)}</textarea>
          </div>
        </div>
      </div>
      <footer class="card-foot">
        <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Save changes</button>
      </footer>
    </form>`,
    { dismissible: false }
  );

  const editContent = modal.querySelector("#edit-note-content");
  enableBulletEditing(editContent);
  modal.querySelector("#edit-note-bullet").addEventListener("click", () => insertBullet(editContent));

  modal.querySelector("#edit-note-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const updated = {
      title: modal.querySelector("#edit-note-title").value.trim(),
      content: editContent.value,
      date: modal.querySelector("#edit-note-date").value,
    };
    if (!updated.title || !updated.content.trim() || !updated.date) {
      showError("Please fill in the title, date and content.");
      return;
    }

    const notes = getNotes();
    const index = notes.findIndex((n) => n.id === noteId);
    if (index !== -1) {
      notes[index] = { ...notes[index], ...updated };
      saveNotes(notes);
    }
    closeModal(modal);
    loadNotes();
    showToast("Note updated");
  });
}

function emailNoteById(noteId) {
  const note = getNotes().find((n) => n.id === noteId);
  if (!note) {
    showError("That note couldn't be found.");
    return;
  }

  const subject = `Note: ${note.title}`;
  const body = `${note.title}\n\n${note.content}`;
  const mailto = `mailto:${encodeURIComponent(NOTE_EMAIL_RECIPIENT)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    NOTE_EMAIL_RECIPIENT
  )}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  // A real anchor click opens mail apps more reliably than window.open
  const link = document.createElement("a");
  link.href = mailto;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // There's no way to tell whether a mail app opened, so offer the fallbacks
  // in a toast instead of a blocking dialog
  showToast("Opening your mail app…", {
    icon: "fa-regular fa-paper-plane",
    actions: [
      { label: "Open in Gmail", onClick: () => window.open(gmailUrl, "_blank", "noopener") },
      {
        label: "Copy text",
        onClick: () => copyText(`To: ${NOTE_EMAIL_RECIPIENT}\nSubject: ${subject}\n\n${body}`),
      },
    ],
  });
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast("Copied. Paste it into an email to send.", { icon: "fa-regular fa-copy" }))
      .catch(() => fallbackCopyPrompt(text));
  } else {
    fallbackCopyPrompt(text);
  }
}

function fallbackCopyPrompt(text) {
  // Older browsers fallback: show text in a prompt (user can Ctrl+C)
  prompt("Copy the message below (Ctrl+C / Cmd+C) and paste into your email:", text);
}

/* ============================================
   FISCAL CALENDAR (4-4-5 with a 53rd week every 6th year)
   Carried over unchanged from the previous version of this file.
   ============================================ */

// Anchor date the whole fiscal calendar is derived from (a known fiscal year start)
const FISCAL_YEAR_ANCHOR = "06/29/2025";
// Fiscal year that starts on FISCAL_YEAR_ANCHOR. Fiscal years are named for the
// calendar year they end in, so 06/29/2025 - 06/27/2026 is FY2026.
const FISCAL_ANCHOR_YEAR = 2026;
// How many fiscal years back/forward the year selector offers
const FISCAL_YEAR_RANGE = 10;
// Fiscal year currently being viewed; null means "use the current fiscal year"
let selectedFiscalYear = null;

const FISCAL_MONTH_NAMES = [
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
];

// A 4-4-5 fiscal year is 52 weeks / 364 days, which runs about 1.25 days short
// of a calendar year. Every 6th year a 53rd week is added to pull the fiscal
// year end back in line with late June. That extra week lands in May, so in
// those years May and June are both 5-week months and the year is 371 days.
// FY2027 (06/28/2026 - 07/03/2027) is such a year.
const FISCAL_53_WEEK_ANCHOR_YEAR = 2027;
const FISCAL_53_WEEK_CYCLE = 6;
const FISCAL_53_WEEK_PERIOD = 11; // May

function isFiftyThreeWeekFiscalYear(fiscalYear) {
  const offset = fiscalYear - FISCAL_53_WEEK_ANCHOR_YEAR;
  // Modulo that also behaves for fiscal years before the anchor
  return (
    ((offset % FISCAL_53_WEEK_CYCLE) + FISCAL_53_WEEK_CYCLE) %
      FISCAL_53_WEEK_CYCLE ===
    0
  );
}

function fiscalYearLengthDays(fiscalYear) {
  return (isFiftyThreeWeekFiscalYear(fiscalYear) ? 53 : 52) * 7;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Date parses "YYYY-MM-DD" as UTC midnight, which is the previous day in any
// negative-offset time zone and would shift a date into the wrong fiscal month.
// Parse date-only strings as local dates instead.
function parseFiscalDate(value) {
  if (value instanceof Date) {
    return toMidnight(value);
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return toMidnight(new Date(value));
}

// Start date of any fiscal year. Years are no longer a fixed length, so we walk
// out from the anchor one year at a time using each year's own length.
function getFiscalYearStart(fiscalYear) {
  let start = toMidnight(new Date(FISCAL_YEAR_ANCHOR));
  let year = FISCAL_ANCHOR_YEAR;

  while (year < fiscalYear) {
    start = addDays(start, fiscalYearLengthDays(year));
    year++;
  }
  while (year > fiscalYear) {
    year--;
    start = addDays(start, -fiscalYearLengthDays(year));
  }
  return start;
}

// Fiscal year that contains a given date
function getFiscalYearOf(date) {
  const target = parseFiscalDate(date);

  if (isNaN(target.getTime())) {
    throw new Error("Invalid date passed to getFiscalYearOf");
  }

  let year = FISCAL_ANCHOR_YEAR;
  let start = toMidnight(new Date(FISCAL_YEAR_ANCHOR));

  while (target < start) {
    year--;
    start = addDays(start, -fiscalYearLengthDays(year));
  }
  while (target > addDays(start, fiscalYearLengthDays(year) - 1)) {
    start = addDays(start, fiscalYearLengthDays(year));
    year++;
  }
  return year;
}

// The 12 fiscal months of a fiscal year, keyed by month name
function buildFiscalMonths(fiscalYear) {
  const months = {};
  const hasExtraWeek = isFiftyThreeWeekFiscalYear(fiscalYear);
  let startDate = getFiscalYearStart(fiscalYear);
  // Running week number within the fiscal year, so each month can report the
  // span of fiscal weeks it covers
  let weekCursor = 1;

  for (let i = 0; i < 12; i++) {
    const fiscalPeriod = i + 1;
    // 4-4-5 base pattern, plus the 53rd week in May on the 6-year cycle
    const weeks =
      (i % 3 === 2 ? 5 : 4) +
      (hasExtraWeek && fiscalPeriod === FISCAL_53_WEEK_PERIOD ? 1 : 0);
    const endDate = addDays(startDate, weeks * 7 - 1);

    months[FISCAL_MONTH_NAMES[i]] = {
      name: FISCAL_MONTH_NAMES[i],
      start: formatDate(startDate),
      end: formatDate(endDate),
      weeks,
      days: weeks * 7,
      fiscalPeriod,
      fiscalYear,
      quarter: Math.floor(i / 3) + 1,
      startWeek: weekCursor,
      endWeek: weekCursor + weeks - 1,
    };

    weekCursor += weeks;
    startDate = addDays(endDate, 1);
  }
  return months;
}

// Fiscal months of the year containing targetDateStr (today by default)
function getFiscalMonthsDynamic(targetDateStr = null) {
  return buildFiscalMonths(getFiscalYearOf(targetDateStr || new Date()));
}

// Fiscal year that contains today
function getCurrentFiscalYear() {
  return getFiscalYearOf(new Date());
}

// Fiscal months for any fiscal year
function getFiscalMonthsForYear(fiscalYear) {
  return buildFiscalMonths(fiscalYear);
}

function formatDate(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function isDateBetween(dateStr) {
  // Look the date up in its own fiscal year, not whichever one contains today
  const fiscalMonths = getFiscalMonthsDynamic(dateStr);

  const [mm, dd, yyyy] = formatDate(parseFiscalDate(dateStr)).split("/");

  let currentFiscalMonth = null;

  Object.entries(fiscalMonths).forEach(([month, range]) => {
    const [smm, sdd, syyyy] = range.start.split("/");
    const [emm, edd, eyyyy] = range.end.split("/");

    const date = new Date(`${yyyy}-${mm}-${dd}`);
    const start = new Date(`${syyyy}-${smm}-${sdd}`);
    const end = new Date(`${eyyyy}-${emm}-${edd}`);

    if (date >= start && date <= end) {
      currentFiscalMonth = { month, ...fiscalMonths[month] };
    }
  });

  return currentFiscalMonth;
}

/* ============================================
   FISCAL CALENDAR RENDERING

   Both views draw into #fiscal-calendar-container: the year overview (12 month
   cards grouped by quarter) and the day-by-day detail for one fiscal month.
   selectedFiscalPeriod decides which one.
   ============================================ */

// null shows the year overview; 1-12 shows that period's day grid.
let selectedFiscalPeriod = null;

const FC_WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const FC_CALENDAR_MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const FC_CALENDAR_MONTHS_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Icons are inline SVG rather than Font Awesome classes so the calendar looks
// the same even if the icon stylesheet is slow or blocked.
const FC_ICON_LEFT = "M15 5l-7 7 7 7";
const FC_ICON_RIGHT = "M9 5l7 7-7 7";
const FC_ICON_BACK = "M10 5l-7 7 7 7M3 12h18";
const FC_ICON_CALENDAR =
  "M7 3v3m10-3v3M3.5 9.5h17M5 6h14a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0119 20H5a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 015 6z";

function fcIcon(path, strokeWidth) {
  return (
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="' +
    path +
    '" stroke="currentColor" stroke-width="' +
    (strokeWidth || 2) +
    '" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  );
}

function fcLongDate(date) {
  return `${FC_CALENDAR_MONTHS_FULL[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function fcShortDate(date) {
  return `${FC_CALENDAR_MONTHS_ABBR[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function fcWeeksLabel(count) {
  return `${count} ${count === 1 ? "week" : "weeks"}`;
}

// The fiscal year as a whole: its span, its length, and its 12 months in order
function fcYearSummary(fiscalYear) {
  const months = Object.values(getFiscalMonthsForYear(fiscalYear));
  const isLong = isFiftyThreeWeekFiscalYear(fiscalYear);

  return {
    fiscalYear,
    months,
    start: months[0].start,
    end: months[months.length - 1].end,
    weeks: isLong ? 53 : 52,
    isFiftyThreeWeek: isLong,
  };
}

// The window of fiscal years the picker offers
function fcYearBounds() {
  const current = getCurrentFiscalYear();
  return {
    current,
    min: current - FISCAL_YEAR_RANGE,
    max: current + FISCAL_YEAR_RANGE,
  };
}

/* ---------- Entry points ---------- */

// Called by the tab switcher and by the year controls. Always lands on the
// year overview, so re-opening the tab never leaves a stale month showing.
function renderFiscalCalendar(fiscalYear) {
  const bounds = fcYearBounds();

  selectedFiscalYear =
    typeof fiscalYear === "number"
      ? fiscalYear
      : selectedFiscalYear || bounds.current;
  selectedFiscalPeriod = null;

  drawFiscalCalendar();
}

function showFiscalMonth(fiscalYear, fiscalPeriod) {
  selectedFiscalYear = fiscalYear;
  selectedFiscalPeriod = fiscalPeriod;
  drawFiscalCalendar();
}

function drawFiscalCalendar() {
  const container = document.getElementById("fiscal-calendar-container");
  if (!container) return;

  container.innerHTML =
    fcMasthead() +
    fcToolbar() +
    (selectedFiscalPeriod === null ? fcYearView() : fcMonthView());

  fcWireEvents(container);
}

/* ---------- Masthead and toolbar ---------- */

function fcMasthead() {
  const year = fcYearSummary(selectedFiscalYear);
  const today = new Date();
  const currentMonth = isDateBetween(today);

  return `
    <header class="fc-masthead">
      <div>
        <span class="fc-eyebrow">Fiscal Calendar</span>
        <div class="fc-titlerow">
          <h2 class="fc-title">FY${year.fiscalYear}</h2>
          ${
            year.isFiftyThreeWeek
              ? '<span class="fc-badge53">53-week year</span>'
              : ""
          }
        </div>
        <p class="fc-span">${fcLongDate(parseFiscalDate(year.start))} &ndash; ${fcLongDate(
          parseFiscalDate(year.end)
        )} &middot; ${fcWeeksLabel(year.weeks)}</p>
      </div>
      <div class="fc-todaycard">
        <span class="fc-todaycard__label">Today</span>
        <span class="fc-todaycard__date">${fcLongDate(today)}</span>
        <span class="fc-todaycard__period">${
          currentMonth
            ? `Period ${currentMonth.fiscalPeriod} &middot; FY${currentMonth.fiscalYear}`
            : ""
        }</span>
      </div>
    </header>`;
}

function fcToolbar() {
  const bounds = fcYearBounds();
  const atYearView = selectedFiscalPeriod === null;

  let options = "";
  for (let year = bounds.min; year <= bounds.max; year++) {
    options +=
      `<option value="${year}"${year === selectedFiscalYear ? " selected" : ""}>` +
      `FY${year}${year === bounds.current ? " (current)" : ""}</option>`;
  }

  return `
    <nav class="fc-toolbar" aria-label="Fiscal year navigation">
      <button type="button" class="fc-btn fc-btn--icon" data-fc="prev-year"
              title="Previous fiscal year" aria-label="Previous fiscal year"
              ${selectedFiscalYear <= bounds.min ? "disabled" : ""}>
        ${fcIcon(FC_ICON_LEFT)}
      </button>
      <div class="fc-select">
        <select data-fc="year-select" aria-label="Fiscal year">${options}</select>
      </div>
      <button type="button" class="fc-btn fc-btn--icon" data-fc="next-year"
              title="Next fiscal year" aria-label="Next fiscal year"
              ${selectedFiscalYear >= bounds.max ? "disabled" : ""}>
        ${fcIcon(FC_ICON_RIGHT)}
      </button>
      <button type="button" class="fc-btn" data-fc="current-year"
              ${
                selectedFiscalYear === bounds.current && atYearView
                  ? "disabled"
                  : ""
              }>
        ${fcIcon(FC_ICON_CALENDAR, 1.7)} Current FY
      </button>
      <span class="fc-toolbar__spacer"></span>
      ${
        atYearView
          ? ""
          : `<button type="button" class="fc-btn" data-fc="back">${fcIcon(
              FC_ICON_BACK
            )} Back to FY${selectedFiscalYear}</button>`
      }
    </nav>`;
}

/* ---------- Year overview ---------- */

function fcYearView() {
  const year = fcYearSummary(selectedFiscalYear);
  const currentMonth = isDateBetween(new Date());
  let html = '<div class="fc-content">';

  for (let quarter = 1; quarter <= 4; quarter++) {
    const months = year.months.filter((month) => month.quarter === quarter);
    const weeks = months.reduce((total, month) => total + month.weeks, 0);

    html += `
      <section class="fc-quarter">
        <div class="fc-quarter__head">
          <h3>Quarter ${quarter}</h3>
          <span class="fc-quarter__meta">${fcShortDate(
            parseFiscalDate(months[0].start)
          )} &ndash; ${fcShortDate(
            parseFiscalDate(months[months.length - 1].end)
          )} &middot; ${fcWeeksLabel(weeks)}</span>
        </div>
        <div class="fc-months">
          ${months
            .map((month) => fcMonthCard(month, currentMonth))
            .join("")}
        </div>
      </section>`;
  }

  return html + "</div>";
}

function fcMonthCard(month, currentMonth) {
  const isCurrent =
    currentMonth &&
    currentMonth.fiscalPeriod === month.fiscalPeriod &&
    currentMonth.fiscalYear === month.fiscalYear;

  return `
    <article class="fc-month${isCurrent ? " fc-is-current" : ""}"
             role="button" tabindex="0"
             data-fc="month" data-fc-period="${month.fiscalPeriod}"
             aria-label="${month.name}, period ${month.fiscalPeriod}, ${month.start} to ${month.end}">
      <div class="fc-month__head">
        <h3 class="fc-month__name">${month.name}</h3>
        <span class="fc-month__chips">
          ${
            isCurrent
              ? '<span class="fc-chip fc-chip--current">Current</span>'
              : ""
          }
          <span class="fc-chip fc-chip--period">P${month.fiscalPeriod}</span>
        </span>
      </div>
      <p class="fc-month__range">${month.start} &ndash; ${month.end}</p>
      <dl class="fc-month__stats">
        <div><dt>Weeks</dt><dd>${month.weeks}</dd></div>
        <div><dt>Days</dt><dd>${month.days}</dd></div>
        <div><dt>FY weeks</dt><dd>${month.startWeek}&ndash;${month.endWeek}</dd></div>
      </dl>
    </article>`;
}

/* ---------- Month detail ---------- */

// The period `step` months away, or null if it falls outside the picker range
function fcStepPeriod(fiscalYear, fiscalPeriod, step) {
  let period = fiscalPeriod + step;
  let year = fiscalYear;

  if (period < 1) {
    year -= 1;
    period = 12;
  } else if (period > 12) {
    year += 1;
    period = 1;
  }

  const bounds = fcYearBounds();
  if (year < bounds.min || year > bounds.max) return null;

  return { fiscalYear: year, fiscalPeriod: period };
}

function fcStepButton(target, step) {
  const label = step < 0 ? "Previous fiscal month" : "Next fiscal month";

  return `<button type="button" class="fc-btn fc-btn--icon" data-fc="step"
                  data-fc-step="${step}" title="${label}" aria-label="${label}"
                  ${target ? "" : "disabled"}>
            ${fcIcon(step < 0 ? FC_ICON_LEFT : FC_ICON_RIGHT)}
          </button>`;
}

function fcMonthView() {
  const year = fcYearSummary(selectedFiscalYear);
  const month = year.months[selectedFiscalPeriod - 1];
  const prev = fcStepPeriod(selectedFiscalYear, selectedFiscalPeriod, -1);
  const next = fcStepPeriod(selectedFiscalYear, selectedFiscalPeriod, 1);

  return `
    <div class="fc-content">
      <div class="fc-detail__bar">
        <div class="fc-detail__title">
          <h3>${month.name} &middot; FY${month.fiscalYear}</h3>
          <p>Period ${month.fiscalPeriod} &middot; Quarter ${
    month.quarter
  } &middot; ${fcWeeksLabel(month.weeks)} &middot; ${fcLongDate(
    parseFiscalDate(month.start)
  )} &ndash; ${fcLongDate(parseFiscalDate(month.end))}</p>
        </div>
        <div class="fc-detail__nav">
          ${fcStepButton(prev, -1)}
          ${fcStepButton(next, 1)}
        </div>
      </div>
      ${fcWeekGrid(month)}
      <p class="fc-footnote">Fiscal weeks run Sunday through Saturday. Week
        numbers are counted from the start of FY${month.fiscalYear}.</p>
    </div>`;
}

function fcWeekGrid(month) {
  const start = parseFiscalDate(month.start);
  const todayStamp = formatDate(new Date());

  let html = '<div class="fc-weeks"><div class="fc-weeks__corner">Week</div>';
  FC_WEEKDAY_NAMES.forEach((name) => {
    html += `<div class="fc-weeks__dow">${name}</div>`;
  });

  for (let week = 0; week < month.weeks; week++) {
    const weekStart = addDays(start, week * 7);

    html += `
      <div class="fc-wk">
        <span class="fc-wk__n">Wk ${month.startWeek + week}</span>
        <span class="fc-wk__d">${weekStart.getMonth() + 1}/${weekStart.getDate()}</span>
      </div>`;

    for (let offset = 0; offset < 7; offset++) {
      const day = addDays(start, week * 7 + offset);
      const isToday = formatDate(day) === todayStamp;
      const isWeekend = offset === 0 || offset === 6;

      // Label the first cell of the grid and the 1st of each calendar month,
      // so the calendar months stay readable inside the fiscal month.
      let label = "";
      if (day.getDate() === 1) {
        label = FC_CALENDAR_MONTHS_ABBR[day.getMonth()];
        if (day.getMonth() === 0) {
          label += " &rsquo;" + String(day.getFullYear()).slice(-2);
        }
      } else if (week === 0 && offset === 0) {
        label = FC_CALENDAR_MONTHS_ABBR[day.getMonth()];
      }

      html += `
        <div class="fc-day${isWeekend ? " fc-is-weekend" : ""}${
        isToday ? " fc-is-today" : ""
      }">
          <span class="fc-day__mon">${label}</span>
          <span class="fc-day__num">${day.getDate()}</span>
          ${isToday ? '<span class="fc-day__today">Today</span>' : ""}
        </div>`;
    }
  }

  return html + "</div>";
}

/* ---------- Events ---------- */

// Delegated once on the container, so redrawing its contents cannot stack up
// duplicate handlers.
let fcEventsWired = false;

function fcWireEvents(container) {
  if (fcEventsWired) return;
  fcEventsWired = true;

  container.addEventListener("click", (event) => {
    const action = event.target.closest("[data-fc]");
    if (!action || action.disabled) return;

    switch (action.dataset.fc) {
      case "prev-year":
        renderFiscalCalendar(selectedFiscalYear - 1);
        break;
      case "next-year":
        renderFiscalCalendar(selectedFiscalYear + 1);
        break;
      case "current-year":
        renderFiscalCalendar(fcYearBounds().current);
        break;
      case "back":
        renderFiscalCalendar(selectedFiscalYear);
        break;
      case "month":
        showFiscalMonth(selectedFiscalYear, Number(action.dataset.fcPeriod));
        break;
      case "step": {
        const target = fcStepPeriod(
          selectedFiscalYear,
          selectedFiscalPeriod,
          Number(action.dataset.fcStep)
        );
        if (target) showFiscalMonth(target.fiscalYear, target.fiscalPeriod);
        break;
      }
    }
  });

  container.addEventListener("change", (event) => {
    if (event.target.matches('[data-fc="year-select"]')) {
      renderFiscalCalendar(Number(event.target.value));
    }
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    const card = event.target.closest('[data-fc="month"]');
    if (!card) return;

    event.preventDefault();
    showFiscalMonth(selectedFiscalYear, Number(card.dataset.fcPeriod));
  });
}

/* ============================================
   PROJECTS
   ============================================ */

const ProjectsManager = {
  storageKey: PROJECTS_KEY,

  // Get all projects from localStorage
  getProjects() {
    return readStoredArray(this.storageKey);
  },

  // Save projects to localStorage
  saveProjects(projects) {
    localStorage.setItem(this.storageKey, JSON.stringify(projects));
  },

  // Add a new project
  addProject(projectData) {
    const projects = this.getProjects();
    const newProject = {
      id: Date.now(),
      name: projectData.name,
      description: projectData.description || "",
      startDate: projectData.startDate,
      dueDate: projectData.dueDate || "",
      status: "active",
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    projects.push(newProject);
    this.saveProjects(projects);
    return newProject;
  },

  // Mark project as completed
  completeProject(projectId) {
    const projects = this.getProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      project.status = "completed";
      project.completedAt = new Date().toISOString();
      this.saveProjects(projects);
    }
    return project;
  },

  // Delete a project
  deleteProject(projectId) {
    this.saveProjects(this.getProjects().filter((p) => p.id !== projectId));
  },

  // Update an existing project
  updateProject(projectId, updatedData) {
    const projects = this.getProjects();
    const index = projects.findIndex((p) => p.id === projectId);
    if (index === -1) return null;
    projects[index] = { ...projects[index], ...updatedData };
    this.saveProjects(projects);
    return projects[index];
  },

  getActiveProjects() {
    return this.getProjects().filter((p) => p.status === "active");
  },

  getCompletedProjects() {
    return this.getProjects().filter((p) => p.status === "completed");
  },
};

// Soonest due date first; projects without a due date go last
function sortActiveProjects(projects) {
  return projects.slice().sort((a, b) => {
    const aDue = parseLocalDate(a.dueDate);
    const bDue = parseLocalDate(b.dueDate);
    if (aDue && bDue && aDue - bDue !== 0) return aDue - bDue;
    if (aDue && !bDue) return -1;
    if (!aDue && bDue) return 1;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

function duePill(project) {
  if (!project.dueDate) return '<span class="pill pill-muted">No due date</span>';
  const days = daysFromToday(project.dueDate);
  if (days === null) return "";
  if (days < 0) {
    return `<span class="pill pill-danger"><i class="fa-solid fa-circle-exclamation"></i>${-days} day${days === -1 ? "" : "s"} overdue</span>`;
  }
  if (days === 0) return '<span class="pill pill-warn"><i class="fa-regular fa-clock"></i>Due today</span>';
  const tone = days <= 7 ? "pill-warn" : "pill-brand";
  return `<span class="pill ${tone}"><i class="fa-regular fa-clock"></i>Due in ${days} day${days === 1 ? "" : "s"}</span>`;
}

function renderProjectCard(project) {
  return `
    <article class="card project" data-id="${project.id}">
      <header class="project-head">
        <h3>${escapeHtml(project.name)}</h3>
        ${duePill(project)}
      </header>
      ${project.description ? `<p class="project-desc">${escapeHtml(project.description)}</p>` : ""}
      <dl class="project-dates">
        <div><dt>Start</dt><dd>${formatShortDate(project.startDate) || "Not set"}</dd></div>
        <div><dt>Due</dt><dd>${formatShortDate(project.dueDate) || "—"}</dd></div>
      </dl>
      <footer class="project-foot">
        <button type="button" class="btn btn-sm" data-project-action="complete"><i class="fa-solid fa-check"></i> Mark complete</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm btn-ghost btn-icon" data-project-action="edit" title="Edit" aria-label="Edit project"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="btn btn-sm btn-ghost btn-icon btn-danger" data-project-action="delete" title="Delete" aria-label="Delete project"><i class="fa-regular fa-trash-can"></i></button>
      </footer>
    </article>`;
}

function renderCompletedRow(project) {
  const started = formatShortDate(project.startDate);
  return `
    <div class="done-row" data-id="${project.id}">
      <span class="done-check"><i class="fa-solid fa-check"></i></span>
      <div class="done-main">
        <strong>${escapeHtml(project.name)}</strong>
        <span>Completed ${formatShortDate(project.completedAt) || "—"}${started ? ` · started ${started}` : ""}</span>
      </div>
      <button type="button" class="btn btn-sm btn-ghost btn-icon btn-danger" data-project-action="delete" title="Delete" aria-label="Delete project"><i class="fa-regular fa-trash-can"></i></button>
    </div>`;
}

function renderProjects() {
  const active = sortActiveProjects(ProjectsManager.getActiveProjects());
  const completed = ProjectsManager.getCompletedProjects().sort(
    (a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0)
  );

  document.getElementById("projects-summary").textContent = `${active.length} active · ${completed.length} completed`;
  document.getElementById("active-count").textContent = active.length;
  document.getElementById("completed-count").textContent = completed.length;

  document.getElementById("active-projects-list").innerHTML = active.length
    ? active.map(renderProjectCard).join("")
    : '<div class="card empty-state"><i class="fa-solid fa-list-check"></i><p>No active projects</p></div>';

  document.getElementById("completed-projects-list").innerHTML = completed.length
    ? `<div class="card done-list">${completed.map(renderCompletedRow).join("")}</div>`
    : '<div class="card empty-state"><i class="fa-regular fa-circle-check"></i><p>No completed projects</p></div>';
}

// Kept for anything that still calls the old name
function loadProjects() {
  renderProjects();
}

function completeProject(projectId) {
  if (!confirm("Mark this project as completed?")) return;
  ProjectsManager.completeProject(projectId);
  renderProjects();
  showToast("Project marked complete");
}

function deleteProject(projectId) {
  if (!confirm("Are you sure you want to delete this project? This cannot be undone.")) return;
  ProjectsManager.deleteProject(projectId);
  renderProjects();
  showToast("Project deleted", { icon: "fa-regular fa-trash-can" });
}

function editProject(projectId) {
  const project = ProjectsManager.getProjects().find((p) => p.id === projectId);
  if (!project) return;

  const modal = openModal(`
    <form id="edit-project-form">
      <header class="card-head">
        <h2><i class="fa-solid fa-pen"></i> Edit project</h2>
        <button type="button" class="btn btn-icon btn-ghost" data-close-modal aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <div class="card-body stack">
        <label class="field"><span>Project name</span><input class="input" id="edit-project-name" value="${escapeHtml(project.name)}" required /></label>
        <div class="field-row even">
          <label class="field"><span>Start date</span><input class="input" type="date" id="edit-project-start-date" value="${escapeHtml(project.startDate)}" required /></label>
          <label class="field"><span>Due date <em>optional</em></span><input class="input" type="date" id="edit-project-due-date" value="${escapeHtml(project.dueDate || "")}" /></label>
        </div>
        <label class="field"><span>Description <em>optional</em></span><textarea class="textarea" id="edit-project-description" rows="3">${escapeHtml(project.description || "")}</textarea></label>
      </div>
      <footer class="card-foot">
        <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Save changes</button>
      </footer>
    </form>`);

  modal.querySelector("#edit-project-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const updated = {
      name: modal.querySelector("#edit-project-name").value.trim(),
      description: modal.querySelector("#edit-project-description").value.trim(),
      startDate: modal.querySelector("#edit-project-start-date").value,
      dueDate: modal.querySelector("#edit-project-due-date").value,
    };
    if (!updated.name || !updated.startDate) {
      showError("Please fill in the project name and start date.");
      return;
    }
    ProjectsManager.updateProject(projectId, updated);
    closeModal(modal);
    renderProjects();
    showToast("Project updated");
  });
}

function setupProjects() {
  const form = document.getElementById("project-form");
  const startDate = document.getElementById("project-start-date");
  startDate.value = todayISO();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const projectData = {
      name: document.getElementById("project-name").value.trim(),
      description: document.getElementById("project-description").value.trim(),
      startDate: startDate.value,
      dueDate: document.getElementById("project-due-date").value,
    };
    if (!projectData.name || !projectData.startDate) {
      showError("Please fill in the project name and start date.");
      return;
    }

    ProjectsManager.addProject(projectData);
    form.reset();
    startDate.value = todayISO();
    renderProjects();
    showToast("Project added");
  });

  document.getElementById("clear-project-form").addEventListener("click", () => {
    form.reset();
    startDate.value = todayISO();
  });

  document.getElementById("view-projects").addEventListener("click", (e) => {
    const button = e.target.closest("[data-project-action]");
    if (!button) return;
    const id = Number(button.closest("[data-id]").dataset.id);
    if (button.dataset.projectAction === "complete") completeProject(id);
    if (button.dataset.projectAction === "edit") editProject(id);
    if (button.dataset.projectAction === "delete") deleteProject(id);
  });
}

/* ============================================
   BACKUP: EXPORT / IMPORT
   ============================================ */

/* ===== Export localStorage to a JSON file ===== */
function exportLocalStorage(keys = []) {
  // If no keys provided, export entire localStorage
  if (!keys || keys.length === 0) {
    keys = Object.keys(localStorage);
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    origin: window.location.href,
    data: {},
  };

  keys.forEach((k) => {
    try {
      const raw = localStorage.getItem(k);
      // Try to parse JSON values, otherwise keep as string
      let parsed = raw;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // leave as string
      }
      payload.data[k] = parsed;
    } catch (err) {
      console.warn("Failed to read localStorage key", k, err);
    }
  });

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const filename = `notes-data-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  // Append -> click -> remove to trigger download
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Release memory after a short delay
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ===== Import JSON file =====
   strategy: 'merge' | 'replace' | 'ask' (default 'ask' uses confirm prompts)
   Throws if the file isn't valid JSON; the caller reports success or failure.
*/
async function importLocalStorageFile(file, options = {}) {
  const { strategy = "ask", keysToImport = null } = options;
  if (!file) throw new Error("No file provided");

  const parsed = JSON.parse(await file.text());

  // Support both { data: { key: value } } (our export shape) and raw key:value object
  const incomingData = parsed && parsed.data ? parsed.data : parsed;

  // Filter keys if caller asked for a subset
  const keys = keysToImport ? keysToImport : Object.keys(incomingData);

  for (const k of keys) {
    const incomingValue = incomingData[k];
    if (incomingValue === undefined) continue;

    const existingRaw = localStorage.getItem(k);
    let existingValue = null;
    try {
      existingValue = existingRaw ? JSON.parse(existingRaw) : null;
    } catch (e) {
      existingValue = existingRaw;
    }

    // Resolve strategy
    let chosenStrategy = strategy;
    if (strategy === "ask") {
      const doReplace = confirm(
        `Import key "${k}": replace existing value? [OK=Replace, Cancel=Merge if possible]`
      );
      chosenStrategy = doReplace ? "replace" : "merge";
    }

    if (chosenStrategy === "merge") {
      // Attempt safe merges for arrays or objects; otherwise replace
      if (Array.isArray(existingValue) && Array.isArray(incomingValue)) {
        localStorage.setItem(k, JSON.stringify(mergeArraysById(existingValue, incomingValue)));
      } else if (isPlainObject(existingValue) && isPlainObject(incomingValue)) {
        localStorage.setItem(k, JSON.stringify({ ...existingValue, ...incomingValue }));
      } else {
        localStorage.setItem(k, JSON.stringify(incomingValue));
      }
    } else {
      // "replace" (or anything unexpected) overwrites
      localStorage.setItem(k, JSON.stringify(incomingValue));
    }
  }
}

/* ===== Helpers ===== */
function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

// Merge two arrays of objects by 'id' where possible.
// Keeps existing items and adds new items from incoming; updates items with same id by shallow-merge.
function mergeArraysById(existing = [], incoming = []) {
  const out = [];
  const existingById = new Map();
  existing.forEach((it) => {
    const id = it && (it.id ?? it.ID ?? it.key ?? null);
    if (id != null) existingById.set(String(id), it);
    else out.push(it); // items without id - keep
  });

  // incorporate incoming: if id exists, shallow-merge; otherwise push
  incoming.forEach((incomingItem) => {
    const id = incomingItem && (incomingItem.id ?? incomingItem.ID ?? incomingItem.key ?? null);
    if (id != null) {
      const key = String(id);
      if (existingById.has(key)) {
        // merge (incoming wins for conflicts)
        existingById.set(key, { ...existingById.get(key), ...incomingItem });
      } else {
        existingById.set(key, incomingItem);
      }
    } else {
      // no id - just push (may produce duplicates)
      out.push(incomingItem);
    }
  });

  // build final array: items without id (kept earlier) + items from map
  return out.concat(Array.from(existingById.values()));
}

function exportBackup() {
  exportLocalStorage([NOTES_KEY, PROJECTS_KEY]);
  showToast("Backup downloaded (notes + projects)", { icon: "fa-solid fa-file-export" });
}

function chooseImportFile() {
  const input = document.getElementById("import-file");
  input.value = "";
  input.click();
}

function setupBackup() {
  document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      showError("That file isn't a valid backup (.json).");
      return;
    }
    const data = parsed && parsed.data ? parsed.data : parsed;
    confirmImport(file, {
      notes: Array.isArray(data && data[NOTES_KEY]) ? data[NOTES_KEY].length : 0,
      projects: Array.isArray(data && data[PROJECTS_KEY]) ? data[PROJECTS_KEY].length : 0,
      exportedAt: parsed && parsed.exportedAt,
    });
  });
}

// Ask Merge or Replace before touching saved data
function confirmImport(file, summary) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const exported = summary.exportedAt ? ` · exported ${formatShortDate(summary.exportedAt)}` : "";

  const modal = openModal(
    `
    <header class="card-head">
      <h2><i class="fa-solid fa-file-import"></i> Import backup</h2>
      <button type="button" class="btn btn-icon btn-ghost" data-close-modal aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
    </header>
    <div class="card-body stack">
      <div class="import-file">
        <span class="link-ico"><i class="fa-regular fa-file-lines"></i></span>
        <div><strong>${escapeHtml(file.name)}</strong><span>${plural(summary.notes, "note")} · ${plural(summary.projects, "project")}${exported}</span></div>
      </div>
      <p class="modal-text"><strong>Merge</strong> keeps what's already here and adds or updates items from the file.
        <strong>Replace</strong> overwrites what's here with the file's contents.</p>
    </div>
    <footer class="card-foot">
      <button type="button" class="btn btn-ghost" data-close-modal>Cancel</button>
      <button type="button" class="btn btn-danger-outline" data-import="replace">Replace</button>
      <button type="button" class="btn btn-primary" data-import="merge">Merge</button>
    </footer>`,
    { size: "is-small" }
  );

  modal.addEventListener("click", async (e) => {
    const choice = e.target.closest("[data-import]");
    if (!choice) return;
    const strategy = choice.dataset.import;
    closeModal(modal);
    try {
      await importLocalStorageFile(file, { strategy });
      showView(viewFromHash());
      showToast(strategy === "replace" ? "Backup imported. Existing data replaced." : "Backup imported and merged.", {
        icon: "fa-solid fa-file-import",
      });
    } catch (err) {
      console.error("Import failed", err);
      showError("Import failed. Check the console for details.");
    }
  });
}

/* ============================================
   STARTUP
   ============================================ */

// Form panels start collapsed on narrow screens so the list shows first, and
// always reopen on wide screens (where they can't be collapsed)
function setupComposers() {
  const narrow = window.matchMedia("(max-width: 960px)");
  const composers = document.querySelectorAll("details.composer");
  composers.forEach((panel) => {
    if (narrow.matches) panel.open = false;
    panel.querySelector("summary").addEventListener("click", (e) => {
      if (!narrow.matches) e.preventDefault();
    });
  });
  narrow.addEventListener("change", () => {
    if (!narrow.matches) composers.forEach((panel) => (panel.open = true));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupMenus();
  setupEmbeds();
  setupQuickLinks();
  setupNotes();
  setupProjects();
  setupBackup();
  setupComposers();
  showView(viewFromHash());
});

window.addEventListener("hashchange", () => {
  setMoreSheet(false);
  showView(viewFromHash());
  window.scrollTo(0, 0);
});
