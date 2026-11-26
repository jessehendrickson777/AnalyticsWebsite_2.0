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

  if (view !== "notes") setComposerExpanded(false);
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

  // Arrived from a note title in the Tasks list: scroll to that note and flash it
  if (view === "notes" && pendingNoteId !== null) {
    const card = document.querySelector(`#notes-list .note[data-id="${pendingNoteId}"]`);
    pendingNoteId = null;
    if (card) {
      card.scrollIntoView({ block: "start" });
      card.classList.add("is-flash");
      setTimeout(() => card.classList.remove("is-flash"), 1600);
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
  renderHomeTasks();
  renderHomeProjects();
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

/* ---------- Tasks: the checkbox lines in every note ---------- */

// Notes that have checkbox lines, pinned first then newest. Each task keeps
// its position among the note's checkbox lines, which is how it's ticked.
function noteTaskGroups() {
  const groups = [];
  orderNotes(getNotes(), "new").forEach((note) => {
    const body = parseHtml(noteHtml(note));
    const tasks = [];
    body.querySelectorAll("li[data-checked]").forEach((li, index) => {
      // The line's own text and formatting, without any sub-list under it
      const own = li.cloneNode(true);
      own.querySelectorAll("ul, ol").forEach((list) => list.remove());
      if (!own.textContent.trim()) return; // an empty checkbox line isn't a task yet
      let depth = 0;
      for (let p = li.parentElement; p && p !== body; p = p.parentElement) if (p.nodeName === "LI") depth++;
      tasks.push({ index, done: li.getAttribute("data-checked") === "true", html: own.innerHTML.trim(), depth });
    });
    if (tasks.length) groups.push({ note, tasks, done: tasks.filter((t) => t.done).length });
  });
  return groups;
}

function renderHomeTasks() {
  const list = document.getElementById("home-tasks");
  const progress = document.getElementById("home-tasks-progress");
  const allGroups = noteTaskGroups();
  // A note leaves the list once every one of its tasks is done; until then
  // all of its tasks show, ticked or not. The progress bar counts what's shown.
  const groups = allGroups.filter((g) => g.done < g.tasks.length);
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  const done = groups.reduce((n, g) => n + g.done, 0);
  document.getElementById("home-tasks-count").textContent = total - done;

  if (!groups.length) {
    progress.hidden = true;
    list.innerHTML = allGroups.length
      ? '<p class="mini-empty"><i class="fa-solid fa-circle-check tasks-done-icon"></i>All caught up. Every task in your notes is done.</p>'
      : '<p class="mini-empty">No tasks yet. Checkbox lines in your notes show up here. <a href="#notes" data-focus="note-title">Write a note</a></p>';
    return;
  }

  const percent = Math.round((done / total) * 100);
  progress.hidden = false;
  progress.innerHTML = `
    <div class="tasks-progress-text"><span><strong>${done}</strong> of ${total} done</span><span>${percent}%</span></div>
    <div class="tasks-progress-bar" role="progressbar" aria-label="Tasks done" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${percent}%"></span></div>`;

  // Redrawing would jump the list back to the top; keep the reader's place
  const scrollTop = list.scrollTop;
  list.innerHTML = groups
    .map(
      (g) => `
      <section class="task-group" data-note-id="${g.note.id}">
        <header class="task-group-head">
          <a href="#notes" data-open-note="${g.note.id}" title="Open this note">${g.note.pinned ? '<i class="fa-solid fa-thumbtack"></i>' : ""}${escapeHtml(g.note.title || "Untitled note")}</a>
          <span class="task-group-count">${g.done}/${g.tasks.length}</span>
        </header>
        <ul class="task-list">
          ${g.tasks
            .map(
              (t) => `
            <li class="task${t.done ? " is-done" : ""}"${t.depth ? ` style="--depth:${t.depth}"` : ""}>
              <label><input type="checkbox" data-task-index="${t.index}"${t.done ? " checked" : ""} /><span class="task-text rich">${t.html}</span></label>
            </li>`
            )
            .join("")}
        </ul>
      </section>`
    )
    .join("");
  list.scrollTop = scrollTop;
}

// Set by a note title in the Tasks list: the note to scroll to on the Notes tab
let pendingNoteId = null;
// Pending redraw after a note's last task is ticked
let completeTimer = null;

function setupHomeTasks() {
  const list = document.getElementById("home-tasks");
  // Ticking a task on Home updates the note it came from
  list.addEventListener("change", (e) => {
    const box = e.target.closest("input[data-task-index]");
    if (!box) return;
    const group = box.closest("[data-note-id]");
    const noteId = Number(group.dataset.noteId);
    setNoteTask(noteId, Number(box.dataset.taskIndex), box.checked);

    // Ticking a note's last open task: show it as done for a moment, then let it leave
    const boxes = [...group.querySelectorAll("input[data-task-index]")];
    if (boxes.every((b) => b.checked)) {
      box.closest(".task").classList.add("is-done");
      group.querySelector(".task-group-count").textContent = `${boxes.length}/${boxes.length}`;
      group.classList.add("is-complete");
      const title = group.querySelector("[data-open-note]").textContent.trim();
      showToast(`All tasks done in “${title}”`, { icon: "fa-solid fa-circle-check" });
      clearTimeout(completeTimer);
      completeTimer = setTimeout(renderHomeTasks, 1000);
      return;
    }
    renderHomeTasks();
  });
  list.addEventListener("click", (e) => {
    const link = e.target.closest("[data-open-note]");
    if (!link) return;
    pendingNoteId = Number(link.dataset.openNote);
    // Show the note in full, and make sure a search on the Notes tab doesn't hide it
    notesUi.expanded.add(pendingNoteId);
    notesUi.query = "";
    document.getElementById("note-search").value = "";
  });
}

/* ============================================
   NOTES

   A note is { id, title, date, content, html, pinned, createdAt }.
   - html is the formatted note (bold, highlights, lists, checklists).
   - content is a plain-text copy built from html on every save, using the
     original "• " / "  ○ " bullet style. Email uses it, search reads it,
     and the old site can still show the note.
   Notes saved before formatting existed only have content; they render
   from it and gain html the next time they are edited.
   ============================================ */

const NOTE_DRAFT_KEY = "notes_draft";
const NOTE_SORT_KEY = "notes_sort";
const HIGHLIGHT_COLORS = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8"];

// Reads saved notes and upgrades older shapes (plain strings, other key
// names, missing ids) to { id, title, content, date, createdAt }. Anything
// upgraded is saved back so ids stay stable between visits. Other fields
// (html, pinned) are kept as they are.
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
      ...item,
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

// Newest / Oldest / A–Z, with pinned notes always on top
function orderNotes(notes, sort) {
  let ordered = sortNotes(notes);
  if (sort === "old") ordered.reverse();
  if (sort === "az") {
    ordered = notes
      .slice()
      .sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base", numeric: true }));
  }
  return ordered.filter((n) => n.pinned).concat(ordered.filter((n) => !n.pinned));
}

function newNoteId(notes) {
  let id = Date.now();
  while (notes.some((n) => n.id === id)) id++;
  return id;
}

/* ---------- Formatted text ---------- */

const RICH_TAGS = new Set(["P", "DIV", "BR", "H3", "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "DEL", "UL", "OL", "LI", "A", "SPAN", "MARK", "HR"]);
const INLINE_HIGHLIGHT_TAGS = new Set(["SPAN", "MARK", "B", "STRONG", "EM", "I", "U", "S", "STRIKE", "DEL"]);
const DROPPED_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "HEAD", "TITLE", "META", "LINK", "SVG", "MATH", "IMG", "PICTURE", "VIDEO", "AUDIO", "CANVAS", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA"]);

function parseHtml(html) {
  // DOMParser documents are inert: no scripts run and no images load
  return new DOMParser().parseFromString(`<body>${html || ""}</body>`, "text/html").body;
}

// Keep only the formatting the editor makes. Notes can arrive from imported
// files or pasted web pages, so everything else is unwrapped or dropped.
function sanitizeRichHtml(html) {
  const body = parseHtml(html);
  cleanRichNode(body);
  return body.innerHTML;
}

function cleanRichNode(parent) {
  [...parent.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType !== Node.ELEMENT_NODE || DROPPED_TAGS.has(node.tagName)) {
      node.remove();
      return;
    }
    cleanRichNode(node);
    const tag = node.tagName;

    if (/^H[1-6]$/.test(tag) && tag !== "H3") {
      const heading = node.ownerDocument.createElement("h3");
      heading.append(...node.childNodes);
      node.replaceWith(heading);
      return;
    }
    if (!RICH_TAGS.has(tag)) {
      // Keep table cells apart when a pasted table is flattened
      if (tag === "TD" || tag === "TH") node.append(" ");
      if (tag === "TR") node.append(node.ownerDocument.createElement("br"));
      node.replaceWith(...node.childNodes);
      return;
    }

    const href = tag === "A" ? (node.getAttribute("href") || "").trim() : "";
    const checked = node.getAttribute("data-checked");
    // Older notes marked a whole list as a checklist; each item now carries its own box
    const isOldChecklist = tag === "UL" && node.classList.contains("checklist");
    const highlightClass = [...node.classList].find((c) => /^hl-(yellow|green|blue|pink)$/.test(c));
    // Highlights can land on any inline tag (Chrome puts them on <b> when the text is bold)
    const background = INLINE_HIGHLIGHT_TAGS.has(tag) ? node.style.backgroundColor : "";

    [...node.attributes].forEach((attr) => node.removeAttribute(attr.name));

    if (tag === "A") {
      if (!/^(https?:|mailto:)/i.test(href)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      node.setAttribute("href", href);
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener");
    }
    if (isOldChecklist) {
      node.querySelectorAll(":scope > li").forEach((li) => {
        if (!li.hasAttribute("data-checked")) li.setAttribute("data-checked", "false");
      });
    }
    // data-checked on a list item makes that one line a checkbox
    if (tag === "LI" && checked !== null) node.setAttribute("data-checked", checked === "true" ? "true" : "false");
    if (highlightClass) node.className = highlightClass;
    if (background && background !== "transparent" && !/rgba\(0, 0, 0, 0\)/.test(background)) {
      node.style.backgroundColor = background;
    }
    if (tag === "SPAN" && !node.attributes.length) node.replaceWith(...node.childNodes);
    // Completely empty paragraphs are editor leftovers; "<p><br></p>" (a blank line) stays
    if ((tag === "P" || tag === "DIV") && !node.hasChildNodes()) node.remove();
  });
}

// Old plain-text notes ("• " bullets, "  ○ " sub-bullets) as formatted HTML
function legacyNoteToHtml(text) {
  let html = "";
  let level = 0; // 0 = not in a list, 1 = bullets, 2 = sub-bullets
  const closeTo = (target) => {
    if (level === 2 && target < 2) {
      html += "</ul></li>";
      level = 1;
    }
    if (level === 1 && target < 1) {
      html += "</ul>";
      level = 0;
    }
  };

  (text || "").split("\n").forEach((line) => {
    if (line.startsWith("  ○ ") || line.startsWith("  • ")) {
      if (level === 0) {
        html += "<ul><li>";
        level = 1;
      }
      if (level === 1) {
        html = html.replace(/<\/li>$/, "");
        html += "<ul>";
        level = 2;
      }
      html += `<li>${escapeHtml(line.slice(4))}</li>`;
    } else if (line.startsWith("• ")) {
      closeTo(1);
      if (level === 0) {
        html += "<ul>";
        level = 1;
      }
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
    } else {
      closeTo(0);
      html += line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>";
    }
  });
  closeTo(0);
  return html;
}

// Plain-text version of formatted HTML, in the original bullet style:
// "• " bullets, "  ○ " sub-bullets, "1. " numbers, "☐ "/"☑ " checklist items
function richToPlainText(html) {
  const lines = [];
  const squash = (s) => s.replace(/\s+/g, " ").trim();

  function inlineText(el) {
    let text = "";
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) text += n.nodeValue;
      else if (n.nodeName === "BR") text += "\n";
      else if (n.nodeName !== "UL" && n.nodeName !== "OL") text += inlineText(n);
    });
    return text;
  }

  function listLines(list, depth, parentIsOrdered) {
    const oldChecklist = list.classList.contains("checklist");
    let number = 0;
    list.childNodes.forEach((item) => {
      // Chrome can nest a list straight inside another list when indenting
      if (item.nodeName === "UL" || item.nodeName === "OL") {
        listLines(item, depth + 1, list.nodeName === "OL");
        return;
      }
      if (item.nodeName !== "LI") return;
      let marker;
      if (oldChecklist || item.hasAttribute("data-checked")) {
        // Checkbox lines don't take a number, matching how they're drawn
        marker = item.getAttribute("data-checked") === "true" ? "☑ " : "☐ ";
      } else {
        number++;
        if (list.nodeName === "OL") marker = depth > 0 && parentIsOrdered ? `${String.fromCharCode(96 + ((number - 1) % 26) + 1)}. ` : `${number}. `;
        else marker = ["• ", "○ ", "▪ "][Math.min(depth, 2)];
      }
      lines.push("  ".repeat(depth) + marker + squash(inlineText(item)));
      item.childNodes.forEach((child) => {
        if (child.nodeName === "UL" || child.nodeName === "OL") listLines(child, depth + 1, list.nodeName === "OL");
      });
    });
  }

  // Walks blocks in document order, so lists or paragraphs nested inside a
  // <div> (common in pasted web content) come out where they appear
  function walk(container) {
    let line = "";
    const flush = (keepBlank) => {
      const text = squash(line);
      if (text || keepBlank) lines.push(text);
      line = "";
    };
    container.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        line += node.nodeValue;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.nodeName;
      if (tag === "BR") {
        flush(true); // "<p><br></p>" is an intentional blank line
      } else if (tag === "UL" || tag === "OL") {
        flush();
        listLines(node, 0, false);
      } else if (tag === "HR") {
        flush();
        lines.push("———");
      } else if (tag === "P" || tag === "DIV" || tag === "H3") {
        flush();
        walk(node);
      } else {
        line += inlineText(node);
      }
    });
    flush();
  }

  walk(parseHtml(html));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// The HTML to show for a note. If the note was edited somewhere that only
// knows plain text (the old site), its html no longer matches its content,
// so the plain text wins.
function noteHtml(note) {
  if (note.html) {
    const clean = sanitizeRichHtml(note.html);
    if (richToPlainText(clean) === (note.content || "").trim()) return clean;
  }
  return legacyNoteToHtml(note.content);
}

function noteHasText(html) {
  const body = parseHtml(html);
  return Boolean(body.textContent.trim() || body.querySelector("li, hr"));
}

/* ---------- Note list ---------- */

const notesUi = {
  query: "",
  sort: localStorage.getItem(NOTE_SORT_KEY) || "new",
  // Long notes opened with "Show more" stay open through redraws (ticking a
  // box, pinning, saving) until "Show less" is clicked
  expanded: new Set(),
};

function checklistProgress(html) {
  const items = parseHtml(html).querySelectorAll("li[data-checked]");
  if (!items.length) return "";
  const done = [...items].filter((li) => li.getAttribute("data-checked") === "true").length;
  return `<span class="progress"><span class="progress-bar"><span style="width:${Math.round((done / items.length) * 100)}%"></span></span>${done} of ${items.length} done</span>`;
}

function renderNoteCard(note, html) {
  const editing = noteComposer.editingId === note.id;
  return `
    <article class="card note${note.pinned ? " is-pinned" : ""}${editing ? " is-editing" : ""}" data-id="${note.id}">
      <header class="note-head">
        <div class="note-headline">
          <h3 class="note-title">${escapeHtml(note.title || "Untitled note")}</h3>
          <div class="note-meta">
            <span class="note-date"><i class="fa-regular fa-calendar"></i>${note.date ? formatShortDate(note.date) : "No date set"}</span>
            ${editing ? '<span class="pill pill-brand"><i class="fa-solid fa-pen"></i>Editing</span>' : ""}
            ${checklistProgress(html)}
          </div>
        </div>
        <button type="button" class="pin-btn${note.pinned ? " is-on" : ""}" data-note-action="pin" title="${note.pinned ? "Unpin" : "Pin to top"}" aria-label="${note.pinned ? "Unpin note" : "Pin note to top"}" aria-pressed="${Boolean(note.pinned)}"><i class="fa-solid fa-thumbtack"></i></button>
      </header>
      <div class="rich note-body">${html}</div>
      <footer class="note-foot">
        <button type="button" class="btn btn-sm btn-ghost" data-note-action="edit"><i class="fa-solid fa-pen"></i><span>Edit</span></button>
        <button type="button" class="btn btn-sm btn-ghost" data-note-action="email"><i class="fa-regular fa-paper-plane"></i><span>Email to me</span></button>
        <button type="button" class="btn btn-sm btn-ghost" data-note-action="copy"><i class="fa-regular fa-copy"></i><span>Copy</span></button>
        <button type="button" class="btn btn-sm btn-ghost btn-danger" data-note-action="delete"><i class="fa-regular fa-trash-can"></i><span>Delete</span></button>
      </footer>
    </article>`;
}

// Wrap each search match in <mark class="hit"> without touching the markup around it
function highlightMatches(root, query) {
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((node) => {
    const text = node.nodeValue;
    pattern.lastIndex = 0;
    if (!pattern.test(text)) return;
    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let last = 0;
    text.replace(pattern, (match, index) => {
      fragment.append(text.slice(last, index));
      const mark = document.createElement("mark");
      mark.className = "hit";
      mark.textContent = match;
      fragment.append(mark);
      last = index + match.length;
    });
    fragment.append(text.slice(last));
    node.replaceWith(fragment);
  });
}

function loadNotes() {
  const list = document.getElementById("notes-list");
  const summary = document.getElementById("notes-search-summary");
  const all = getNotes();
  const query = notesUi.query.trim();
  const needle = query.toLowerCase();
  document.getElementById("notes-count").textContent = all.length;
  document.getElementById("note-sort").value = notesUi.sort;

  // Search the title and the note text only (not dates or button labels)
  const matches = all.filter(
    (n) => !needle || `${n.title}\n${n.content}`.toLowerCase().includes(needle)
  );
  const notes = orderNotes(matches, notesUi.sort);

  summary.innerHTML = query
    ? `<div class="search-summary"><i class="fa-solid fa-magnifying-glass"></i><span><strong>${notes.length}</strong> ${
        notes.length === 1 ? "note contains" : "notes contain"
      } “${escapeHtml(query)}”</span><button type="button" data-clear-search>Clear search</button></div>`
    : "";

  if (!all.length) {
    list.innerHTML = '<div class="card empty-state"><i class="fa-regular fa-note-sticky"></i><p>No notes yet. Notes you save will show up here.</p></div>';
    return;
  }
  if (!notes.length) {
    list.innerHTML = '<div class="card empty-state"><i class="fa-solid fa-magnifying-glass"></i><p>No notes match that search.</p></div>';
    return;
  }

  list.innerHTML = notes.map((n) => renderNoteCard(n, noteHtml(n))).join("");

  list.querySelectorAll(".note").forEach((card) => {
    const body = card.querySelector(".note-body");
    if (needle) {
      highlightMatches(card.querySelector(".note-title"), query);
      highlightMatches(body, query);
    } else if (body.scrollHeight > 400) {
      // Long notes start collapsed unless already opened (search results always show in full)
      const open = notesUi.expanded.has(Number(card.dataset.id));
      if (!open) body.classList.add("is-clamped");
      body.insertAdjacentHTML(
        "afterend",
        `<button type="button" class="show-more" data-note-action="more">${open ? "Show less" : "Show more"}</button>`
      );
    }
  });
}

function updateNote(noteId, changes) {
  const notes = getNotes();
  const index = notes.findIndex((n) => n.id === noteId);
  if (index === -1) return null;
  notes[index] = { ...notes[index], ...changes };
  saveNotes(notes);
  return notes[index];
}

// Ticks or unticks checkbox line number `index` (in document order) of a note.
// Used by note cards and by the Tasks list on Home.
function setNoteTask(noteId, index, checked) {
  const note = getNotes().find((n) => n.id === noteId);
  if (!note) return false;
  const body = parseHtml(noteHtml(note));
  const stored = body.querySelectorAll("li[data-checked]")[index];
  if (!stored) return false;
  stored.setAttribute("data-checked", checked ? "true" : "false");
  const html = sanitizeRichHtml(body.innerHTML);
  updateNote(noteId, { html, content: richToPlainText(html) });

  // If this note is open in the editor, tick it there too so saving the edit doesn't undo it
  if (noteComposer.editingId === noteId) {
    const inEditor = noteEditor().querySelectorAll("li[data-checked]")[index];
    if (inEditor && inEditor.textContent.trim() === stored.textContent.trim()) {
      inEditor.setAttribute("data-checked", checked ? "true" : "false");
    }
  }
  return true;
}

function toggleChecklistItem(card, item) {
  const index = [...card.querySelectorAll(".note-body li[data-checked]")].indexOf(item);
  setNoteTask(Number(card.dataset.id), index, item.getAttribute("data-checked") !== "true");
  loadNotes();
}

// Clicks in the 24px box to the left of a checkbox line
function clickedCheckbox(e) {
  const item = e.target.closest("li");
  if (!item || !item.hasAttribute("data-checked")) return null;
  return e.clientX - item.getBoundingClientRect().left <= 24 ? item : null;
}

/* ---------- Composer (new note and edit) ---------- */

const noteComposer = { editingId: null };

function noteEditor() {
  return document.getElementById("note-editor");
}

function currentEditorBlock() {
  const selection = getSelection();
  if (!selection.rangeCount) return null;
  let node = selection.anchorNode;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  const editor = noteEditor();
  if (!node || !editor.contains(node) || node === editor) return null;
  return node.closest("li, p, h3, div");
}

// The list items the selection covers, or the one holding the caret.
// A parent item only counts if its own text is selected, not just a sub-item.
function selectedListItems() {
  const selection = getSelection();
  if (!selection.rangeCount) return [];
  const range = selection.getRangeAt(0);
  const editor = noteEditor();
  if (!editor.contains(range.commonAncestorContainer)) return [];
  if (range.collapsed) {
    const block = currentEditorBlock();
    const item = block && block.closest("li");
    return item ? [item] : [];
  }
  return [...editor.querySelectorAll("li")].filter((li) => {
    // A drag that ends at the very start of the next line doesn't include it
    if (range.endOffset === 0 && li.contains(range.endContainer) && !li.contains(range.startContainer)) return false;
    const own = [...li.childNodes].filter((n) => n.nodeName !== "UL" && n.nodeName !== "OL");
    return own.length ? own.some((n) => range.intersectsNode(n)) : range.intersectsNode(li);
  });
}

// Checkboxes are set per line, so one list can mix bullets and checkboxes.
// Toggles the selected lines: all checkboxes -> bullets, otherwise -> checkboxes.
function toggleCheckboxes() {
  let items = selectedListItems();
  if (!items.length) {
    // Plain lines: make them a list first, then give each line a box
    document.execCommand("insertUnorderedList");
    items = selectedListItems();
    items.forEach((li) => li.setAttribute("data-checked", "false"));
    return;
  }
  const allBoxes = items.every((li) => li.hasAttribute("data-checked"));
  items.forEach((li) => {
    if (allBoxes) li.removeAttribute("data-checked");
    else if (!li.hasAttribute("data-checked")) li.setAttribute("data-checked", "false");
  });
}

// Bullets / numbers. Selected checkbox lines turn back into plain bullets or
// numbers and stay in their list instead of the list being removed.
function setListType(command) {
  const items = selectedListItems();
  const boxes = items.filter((li) => li.hasAttribute("data-checked"));
  if (boxes.length) {
    boxes.forEach((li) => li.removeAttribute("data-checked"));
    const wanted = command === "insertUnorderedList" ? "UL" : "OL";
    if (items.every((li) => li.parentElement.nodeName === wanted)) return;
  }
  document.execCommand(command);
}

function runEditorCommand(command) {
  noteEditor().focus();
  if (command === "heading") {
    const block = currentEditorBlock();
    document.execCommand("formatBlock", false, block && block.tagName === "H3" ? "<p>" : "<h3>");
  } else if (command === "checklist") {
    toggleCheckboxes();
  } else if (command === "insertUnorderedList" || command === "insertOrderedList") {
    setListType(command);
  } else if (command === "link") {
    let url = prompt("Link address", "https://");
    if (url && url.trim() && url.trim() !== "https://") {
      url = url.trim();
      if (!/^(https?:|mailto:)/i.test(url)) url = "https://" + url;
      document.execCommand("createLink", false, url);
    }
  } else if (command === "divider") {
    document.execCommand("insertHorizontalRule");
  } else {
    document.execCommand(command);
  }
  onEditorChange();
}

const TOOLBAR_STATE_COMMANDS = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"];

function refreshEditorToolbar() {
  const toolbar = document.getElementById("note-toolbar");
  const block = currentEditorBlock();
  const item = block && block.closest("li");
  const onCheckbox = Boolean(item && item.hasAttribute("data-checked"));
  TOOLBAR_STATE_COMMANDS.forEach((command) => {
    let on = false;
    try {
      on = document.queryCommandState(command);
    } catch (err) {
      /* not supported */
    }
    if ((command === "insertUnorderedList" || command === "insertOrderedList") && onCheckbox) on = false;
    toolbar.querySelector(`[data-cmd="${command}"]`).classList.toggle("is-on", on);
  });
  toolbar.querySelector('[data-cmd="heading"]').classList.toggle("is-on", Boolean(block && block.tagName === "H3"));
  toolbar.querySelector('[data-cmd="checklist"]').classList.toggle("is-on", onCheckbox);
}

let draftTimer = null;

// Counted from the text nodes, not innerText, which is empty while the
// collapsed composer is closed on phones
function noteWordCount() {
  const walker = document.createTreeWalker(noteEditor(), NodeFilter.SHOW_TEXT);
  const parts = [];
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  return parts.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

function setComposerStatus(text, icon) {
  document.getElementById("note-draft-status").innerHTML = `${icon ? `<i class="${icon}"></i>` : ""}${escapeHtml(text)}`;
}

function onEditorChange() {
  const editor = noteEditor();
  editor.classList.toggle("is-empty", !noteHasText(editor.innerHTML));
  refreshEditorToolbar();

  const words = noteWordCount();
  const wordLabel = `${words} word${words === 1 ? "" : "s"}`;
  if (noteComposer.editingId !== null) {
    setComposerStatus(`Editing · ${wordLabel}`, "fa-solid fa-pen");
    return;
  }
  // New notes autosave as a draft, so switching tabs or closing the page keeps them
  setComposerStatus("Saving draft…", "fa-solid fa-rotate");
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 500);
}

function saveDraft() {
  const title = document.getElementById("note-title").value;
  const html = noteEditor().innerHTML;
  if (!title.trim() && !noteHasText(html)) {
    localStorage.removeItem(NOTE_DRAFT_KEY);
    setComposerStatus(`${noteWordCount()} words`);
    return;
  }
  localStorage.setItem(NOTE_DRAFT_KEY, JSON.stringify({ title, date: document.getElementById("note-date").value, html }));
  const words = noteWordCount();
  setComposerStatus(`Draft saved · ${words} word${words === 1 ? "" : "s"}`, "fa-solid fa-circle-check");
}

function restoreDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(NOTE_DRAFT_KEY));
  } catch (e) {
    draft = null;
  }
  document.getElementById("note-title").value = (draft && draft.title) || "";
  document.getElementById("note-date").value = (draft && draft.date) || todayISO();
  noteEditor().innerHTML = draft ? sanitizeRichHtml(draft.html) : "";
  onEditorChange();
  clearTimeout(draftTimer);
  const words = noteWordCount();
  setComposerStatus(draft ? `Draft restored · ${words} word${words === 1 ? "" : "s"}` : "0 words", draft ? "fa-solid fa-circle-check" : "");
}

function clearComposer() {
  localStorage.removeItem(NOTE_DRAFT_KEY);
  document.getElementById("note-title").value = "";
  document.getElementById("note-date").value = todayISO();
  noteEditor().innerHTML = "";
  onEditorChange();
  clearTimeout(draftTimer);
  setComposerStatus("0 words");
}

function setComposerMode(editingId) {
  noteComposer.editingId = editingId;
  const editing = editingId !== null;
  document.getElementById("composer-heading").innerHTML = editing
    ? '<i class="fa-solid fa-pen"></i> Edit note'
    : '<i class="fa-solid fa-pen-to-square"></i> New note';
  document.getElementById("note-save-btn").innerHTML = `<i class="fa-solid fa-check"></i> ${editing ? "Save changes" : "Save note"}`;
  document.getElementById("note-clear-btn").textContent = editing ? "Cancel" : "Clear";
  document.getElementById("note-composer").classList.toggle("is-editing", editing);
}

function editNoteById(noteId) {
  const note = getNotes().find((n) => n.id === noteId);
  if (!note) {
    showError("That note couldn't be found.");
    return;
  }
  clearTimeout(draftTimer);
  if (noteComposer.editingId === null) saveDraft(); // keep any unsaved new note
  document.getElementById("note-composer").open = true;
  setComposerMode(noteId);
  document.getElementById("note-title").value = note.title;
  document.getElementById("note-date").value = note.date || todayISO();
  noteEditor().innerHTML = noteHtml(note);
  onEditorChange();
  loadNotes();

  const composer = document.getElementById("note-composer");
  composer.open = true;
  // Phones get the full-screen editor. On desktop the pinned composer is
  // usually in view already; in short windows it isn't pinned, so scroll back
  // up to it when its top (the title) is out of sight.
  if (window.matchMedia("(max-width: 960px)").matches) {
    setComposerExpanded(true);
  } else {
    const top = composer.getBoundingClientRect().top;
    const headerBottom = document.querySelector(".topbar").getBoundingClientRect().bottom;
    if (top < headerBottom || top > window.innerHeight - 120) composer.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  document.getElementById("note-title").focus({ preventScroll: true });
}

function stopEditing() {
  setComposerMode(null);
  restoreDraft();
  loadNotes();
}

function saveComposer() {
  const title = document.getElementById("note-title").value.trim();
  const date = document.getElementById("note-date").value || todayISO();
  const html = sanitizeRichHtml(noteEditor().innerHTML);
  if (!title || !noteHasText(html)) {
    showError("Add a title and some content first.");
    return;
  }
  const content = richToPlainText(html);

  if (noteComposer.editingId !== null) {
    updateNote(noteComposer.editingId, { title, date, html, content, updatedAt: new Date().toISOString() });
    setComposerMode(null);
    restoreDraft();
    setComposerExpanded(false);
    loadNotes();
    showToast("Note updated");
    return;
  }

  const notes = getNotes();
  notes.push({ id: newNoteId(notes), title, date, html, content, pinned: false, createdAt: new Date().toISOString() });
  saveNotes(notes);
  clearComposer();
  setComposerExpanded(false);
  loadNotes();
  showToast("Note saved");
}

// Expand: the composer fills the screen for long notes
function setComposerExpanded(on) {
  const composer = document.getElementById("note-composer");
  const button = document.getElementById("note-expand");
  const wasOn = composer.classList.contains("is-expanded");
  if (on === wasOn) return;
  composer.classList.toggle("is-expanded", on);
  document.getElementById("note-focus-backdrop").hidden = !on;
  button.innerHTML = on
    ? '<i class="fa-solid fa-down-left-and-up-right-to-center"></i>'
    : '<i class="fa-solid fa-up-right-and-down-left-from-center"></i>';
  button.title = on ? "Shrink editor" : "Expand editor";
  button.setAttribute("aria-label", button.title);
  document.body.classList.toggle(
    "has-overlay",
    on || Boolean(document.querySelector(".modal")) || !document.getElementById("more-sheet").hidden
  );
  if (on) {
    composer.open = true;
    noteEditor().focus();
  }
}

function setupNoteEditor() {
  const editor = noteEditor();
  const toolbar = document.getElementById("note-toolbar");
  const highlightMenu = document.getElementById("hl-menu");
  document.execCommand("defaultParagraphSeparator", false, "p");

  // Keep the text selection when pressing toolbar buttons
  toolbar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".tb, .hl-menu button")) e.preventDefault();
  });
  toolbar.addEventListener("click", (e) => {
    const button = e.target.closest("[data-cmd]");
    if (button) runEditorCommand(button.dataset.cmd);
  });

  document.getElementById("hl-btn").addEventListener("click", () => (highlightMenu.hidden = !highlightMenu.hidden));
  highlightMenu.addEventListener("click", (e) => {
    const swatch = e.target.closest("[data-hl]");
    if (!swatch) return;
    editor.focus();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("hiliteColor", false, swatch.dataset.hl);
    document.execCommand("styleWithCSS", false, false);
    if (swatch.dataset.hl !== "transparent") document.getElementById("hl-swatch").style.background = swatch.dataset.hl;
    highlightMenu.hidden = true;
    onEditorChange();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tb-menu-anchor")) highlightMenu.hidden = true;
  });

  editor.addEventListener("keydown", (e) => {
    const block = currentEditorBlock();
    if (e.key === "Tab") {
      e.preventDefault();
      if (block && block.closest("li")) document.execCommand(e.shiftKey ? "outdent" : "indent");
      else if (!e.shiftKey) document.execCommand("insertText", false, "    ");
      onEditorChange();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      runEditorCommand("link");
      return;
    }
    // Enter on a checkbox line starts another (unticked) checkbox line
    if (e.key === "Enter" && block && block.matches("li[data-checked]")) {
      const before = block;
      setTimeout(() => {
        const now = currentEditorBlock();
        const item = now && now.closest("li");
        if (!item) return; // Enter on an empty line left the list
        // Enter at the very start of a line adds the new line above it
        const fresh = item === before ? item.previousElementSibling : item;
        if (fresh && fresh.nodeName === "LI") fresh.setAttribute("data-checked", "false");
      }, 0);
    }
    // "[]" and a space at the start of a bullet turns just that line into a checkbox
    if (e.key === " " && block && block.matches("li") && !block.hasAttribute("data-checked")) {
      const first = block.firstChild;
      const own = [...block.childNodes].filter((n) => n.nodeName !== "UL" && n.nodeName !== "OL");
      if (first && first.nodeType === Node.TEXT_NODE && own.length === 1 && first.nodeValue.trim() === "[]") {
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(first);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        document.execCommand("delete");
        block.setAttribute("data-checked", "false");
        onEditorChange();
        return;
      }
    }
    // Start a line with "1.", "-", "*" or "[]" and a space to begin a list
    if (e.key === " " && block && !block.closest("li")) {
      const command = { "1.": "insertOrderedList", "-": "insertUnorderedList", "*": "insertUnorderedList", "[]": "checklist" }[
        block.textContent.trim()
      ];
      if (!command) return;
      e.preventDefault();
      // Let the browser delete the "1." itself so the line stays a proper
      // empty block; clearing it by hand made Chrome merge it into the line above
      const range = document.createRange();
      range.selectNodeContents(block);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      document.execCommand("delete");
      runEditorCommand(command);
    }
  });

  editor.addEventListener("click", (e) => {
    const item = clickedCheckbox(e);
    if (item) {
      item.setAttribute("data-checked", item.getAttribute("data-checked") === "true" ? "false" : "true");
      onEditorChange();
    }
  });

  // Pasted text keeps its bold, lists and links but nothing else
  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    if (html) document.execCommand("insertHTML", false, sanitizeRichHtml(html));
    else document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    onEditorChange();
  });
  editor.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) e.preventDefault();
  });

  editor.addEventListener("input", onEditorChange);
  document.addEventListener("selectionchange", () => {
    const selection = getSelection();
    if (selection.anchorNode && editor.contains(selection.anchorNode)) refreshEditorToolbar();
  });
}

function setupNotes() {
  setupNoteEditor();

  document.getElementById("note-title").addEventListener("input", onEditorChange);
  document.getElementById("note-date").addEventListener("change", onEditorChange);

  document.getElementById("note-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveComposer();
  });

  document.getElementById("note-clear-btn").addEventListener("click", () => {
    if (noteComposer.editingId !== null) {
      setComposerExpanded(false);
      stopEditing();
      return;
    }
    clearComposer();
    document.getElementById("note-title").focus();
  });

  document.getElementById("note-expand").addEventListener("click", (e) => {
    e.preventDefault(); // the button sits inside the <summary>; don't collapse it
    setComposerExpanded(!document.getElementById("note-composer").classList.contains("is-expanded"));
  });
  document.getElementById("note-focus-backdrop").addEventListener("click", () => setComposerExpanded(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setComposerExpanded(false);
  });

  document.getElementById("note-search").addEventListener("input", (e) => {
    notesUi.query = e.target.value;
    loadNotes();
  });
  document.getElementById("note-sort").addEventListener("change", (e) => {
    notesUi.sort = e.target.value;
    localStorage.setItem(NOTE_SORT_KEY, notesUi.sort);
    loadNotes();
  });
  document.getElementById("notes-search-summary").addEventListener("click", (e) => {
    if (!e.target.closest("[data-clear-search]")) return;
    notesUi.query = "";
    document.getElementById("note-search").value = "";
    loadNotes();
  });

  document.getElementById("notes-list").addEventListener("click", (e) => {
    const card = e.target.closest(".note[data-id]");
    if (!card) return;
    const checkbox = clickedCheckbox(e);
    if (checkbox) {
      toggleChecklistItem(card, checkbox);
      return;
    }
    const button = e.target.closest("[data-note-action]");
    if (!button) return;
    const id = Number(card.dataset.id);
    const action = button.dataset.noteAction;
    if (action === "edit") editNoteById(id);
    if (action === "email") emailNoteById(id);
    if (action === "copy") copyNoteById(id);
    if (action === "delete") deleteNoteById(id);
    if (action === "pin") {
      const note = getNotes().find((n) => n.id === id);
      if (note) {
        updateNote(id, { pinned: !note.pinned });
        loadNotes();
        showToast(note.pinned ? "Note unpinned" : "Pinned to the top", { icon: "fa-solid fa-thumbtack" });
      }
    }
    if (action === "more") {
      const body = card.querySelector(".note-body");
      const collapsed = body.classList.toggle("is-clamped");
      button.textContent = collapsed ? "Show more" : "Show less";
      if (collapsed) notesUi.expanded.delete(id);
      else notesUi.expanded.add(id);
    }
  });

  restoreDraft();
}

function deleteNoteById(noteId) {
  if (!confirm("Are you sure you want to delete this note? This cannot be undone.")) return;
  saveNotes(getNotes().filter((note) => note.id !== noteId));
  if (noteComposer.editingId === noteId) {
    setComposerExpanded(false);
    setComposerMode(null);
    restoreDraft();
  }
  loadNotes();
  showToast("Note deleted", { icon: "fa-regular fa-trash-can" });
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
      { label: "Copy text", onClick: () => copyText(`To: ${NOTE_EMAIL_RECIPIENT}\nSubject: ${subject}\n\n${body}`) },
    ],
  });
}

// Copies the note with its formatting, so pasting into Outlook or Gmail keeps
// bold, highlights and lists. Checklist boxes become ☐ / ☑ since email
// clients don't draw them.
function copyNoteById(noteId) {
  const note = getNotes().find((n) => n.id === noteId);
  if (!note) return;
  const body = parseHtml(noteHtml(note));
  body.querySelectorAll("li[data-checked]").forEach((li) => {
    li.style.listStyle = "none";
    li.prepend(li.getAttribute("data-checked") === "true" ? "☑ " : "☐ ");
  });
  const html = `<p><strong>${escapeHtml(note.title)}</strong></p>${body.innerHTML}`;
  const text = `${note.title}\n\n${note.content}`;
  const done = () => showToast("Copied with formatting. Paste it into an email or doc.", { icon: "fa-regular fa-copy" });

  if (navigator.clipboard && window.ClipboardItem) {
    navigator.clipboard
      .write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ])
      .then(done)
      .catch(() => copyHtmlFallback(html, text, done));
  } else {
    copyHtmlFallback(html, text, done);
  }
}

function copyHtmlFallback(html, text, done) {
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (e) {
    copied = false;
  }
  getSelection().removeAllRanges();
  holder.remove();
  if (copied) done();
  else copyText(text);
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
  setupHomeTasks();
  setupNotes();
  setupProjects();
  setupBackup();
  setupComposers();
  showView(viewFromHash());
});

window.addEventListener("hashchange", () => {
  setMoreSheet(false);
  // Scroll to the top first, so a view can still scroll to something itself
  window.scrollTo(0, 0);
  showView(viewFromHash());
});
