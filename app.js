"use strict";

const ROTATE_MS = 18000;
const FADE_MS = 1550;
const DEFAULT_DEATH_DATE = "07/10/2023";

const DESKTOP_POINTS = [
  { x: 16, y: 62, side: "top", size: .74 },
  { x: 28, y: 75.5, side: "bottom", size: .75 },
  { x: 40, y: 62, side: "top", size: .74 },
  { x: 52, y: 75.5, side: "bottom", size: .75 },
  { x: 64, y: 62, side: "top", size: .74 },
  { x: 76, y: 75.5, side: "bottom", size: .75 },
  { x: 88, y: 62, side: "top", size: .74 },
  { x: 8,  y: 75.5, side: "bottom", size: .75 },
];

const MOBILE_POINTS = [
  { x: 18, y: 64, side: "top", size: .54 },
  { x: 18, y: 78, side: "bottom", size: .52 },
  { x: 50, y: 64, side: "top", size: .54 },
  { x: 50, y: 78, side: "bottom", size: .52 },
  { x: 82, y: 64, side: "top", size: .54 },
  { x: 82, y: 78, side: "bottom", size: .52 },
];

const els = {
  stage: document.getElementById("memory-stage"),
  layer: document.getElementById("timeline-layer"),
  search: document.getElementById("search-input"),
  prev: document.getElementById("prev-btn"),
  next: document.getElementById("next-btn"),
  pause: document.getElementById("pause-btn"),
  storyRoot: document.getElementById("story-root"),
  announcer: document.getElementById("sr-announcer"),
  pathFill: document.getElementById("path-fill"),
};

const state = {
  people: [],
  filtered: [],
  pages: [],
  pageIndex: 0,
  paused: false,
  timer: null,
  modalPersonId: null,
  lastFocusedElement: null,
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") Object.entries(value).forEach(([k, v]) => node.style.setProperty(k, v));
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  });
  children.flat().forEach((child) => {
    if (child === undefined || child === null || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

function announce(message) {
  if (!els.announcer) return;
  els.announcer.textContent = "";
  window.setTimeout(() => { els.announcer.textContent = message; }, 30);
}

function points() {
  return window.matchMedia("(max-width: 900px)").matches ? MOBILE_POINTS : DESKTOP_POINTS;
}

function pageSize() {
  return points().length;
}

function stripMemorialSuffix(value) {
  return String(value || "").replace(/\s*ז["״']?ל\s*$/u, "").trim();
}

function cleanKey(value) {
  return stripMemorialSuffix(value)
    .replace(/["״׳']/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function displayName(personOrName) {
  if (typeof personOrName === "object" && personOrName) {
    if (personOrName.excelDisplayName) return stripMemorialSuffix(personOrName.excelDisplayName);
    return displayName(personOrName.name);
  }
  const clean = stripMemorialSuffix(personOrName);
  const parts = clean.split(/\s+/u).filter(Boolean);
  if (parts.length <= 1) return clean;

  const compound = [
    ["ערבה", "אליעז"],
    ["גולדשטיין", "אלמוג"],
  ];

  for (const surname of compound) {
    if (surname.every((part, i) => parts[i] === part) && parts.length > surname.length) {
      return [...parts.slice(surname.length), ...surname].join(" ");
    }
  }

  return [...parts.slice(1), parts[0]].join(" ");
}

function displayNameParts(person) {
  return displayName(person).split(/\s+/u).filter(Boolean);
}

function initials(person) {
  return displayNameParts(person).slice(0, 2).map((part) => part[0]).join("") || "✦";
}

function parseNumericDate(value) {
  const match = String(value || "").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/u);
  if (!match) return "";
  let [, day, month, year] = match;
  if (year.length === 2) year = `20${year}`;
  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
}

function formatBirthDate(person) {
  return parseNumericDate(person.birthDate) || "—";
}

function formatDeathDate(person) {
  if (person.deathDate) return parseNumericDate(person.deathDate) || person.deathDate;
  const text = `${person.storySummaryClean || ""} ${person.storySummary || ""} ${person.candleDatesLine || ""}`;
  if (/7\s+באוקטובר\s+2023/u.test(text) || /כ["״']?ב\s+בתשרי\s+תשפ["״']?ד/u.test(text)) return DEFAULT_DEATH_DATE;
  return DEFAULT_DEATH_DATE;
}

function getPhotoSources(person) {
  const photo = String(person.photo || "").trim();
  if (!photo) return { src: "", fallback: "" };
  const fallback = photo.replace("images/people-original/", "images/people/").replace(/\.jpg$/i, ".webp");
  return { src: photo, fallback: fallback !== photo ? fallback : "" };
}

function createPortrait(person, eager = false) {
  const sources = getPhotoSources(person);
  if (!sources.src) return el("span", { class: "portrait-placeholder", text: initials(person), "aria-hidden": "true" });
  const img = el("img", {
    class: "portrait-img",
    src: sources.src,
    alt: displayName(person),
    loading: eager ? "eager" : "lazy",
    decoding: "async",
  });
  let triedFallback = false;
  img.onerror = () => {
    if (!triedFallback && sources.fallback) {
      triedFallback = true;
      img.src = sources.fallback;
      return;
    }
    img.onerror = null;
    img.replaceWith(el("span", { class: "portrait-placeholder", text: initials(person), "aria-hidden": "true" }));
  };
  return img;
}

function normalizePerson(person, index) {
  return {
    ...person,
    id: person.id || `person-${String(index + 1).padStart(3, "0")}`,
  };
}

function buildNameIndex(people) {
  const map = new Map();
  people.forEach((person) => {
    [person.name, person.excelDisplayName, person.updatedExcelName, displayName(person)].filter(Boolean).forEach((name) => {
      map.set(cleanKey(name), person);
    });
  });
  return map;
}

let nameIndex = new Map();

function findPersonByName(name) {
  return nameIndex.get(cleanKey(name)) || null;
}


function familyPhotoSection(person) {
  const src = String(person.familyGroupPhoto || "").trim();
  if (!src) return null;
  const title = person.familyGroupTitle || "תמונה משפחתית";
  const img = el("img", {
    class: "family-photo-img",
    src,
    alt: title,
    loading: "lazy",
    decoding: "async",
  });
  img.onerror = () => {
    const card = img.closest(".family-photo-card");
    if (card) card.remove();
  };
  return el("section", { class: "family-photo-card", "aria-label": title },
    el("div", { class: "family-photo-frame" }, img),
    el("p", { class: "family-photo-caption", text: title })
  );
}

function familyMembersWhoDiedWith(person) {
  const found = [];
  const ids = new Set([person.id]);

  if (person.familyGroupId) {
    state.people.forEach((candidate) => {
      if (candidate.familyGroupId === person.familyGroupId && !ids.has(candidate.id)) {
        ids.add(candidate.id);
        found.push(candidate);
      }
    });
  }

  if (Array.isArray(person.familyGroupMembers)) {
    person.familyGroupMembers.forEach((memberName) => {
      const member = findPersonByName(memberName);
      if (member && !ids.has(member.id)) {
        ids.add(member.id);
        found.push(member);
      }
    });
  }

  return found;
}

function searchText(person) {
  return cleanKey([
    person.name,
    person.excelDisplayName,
    displayName(person),
    person.community,
    person.familyGroupTitle,
    Array.isArray(person.familyGroupMembers) ? person.familyGroupMembers.join(" ") : "",
  ].filter(Boolean).join(" "));
}

function buildPages(list) {
  const size = pageSize();
  const pages = [];
  const visited = new Set();
  const groups = [];

  list.forEach((person) => {
    if (visited.has(person.id)) return;
    if (person.familyGroupId) {
      const group = list.filter((candidate) => candidate.familyGroupId === person.familyGroupId);
      group.forEach((member) => visited.add(member.id));
      groups.push(group);
    } else {
      visited.add(person.id);
      groups.push([person]);
    }
  });

  let page = [];
  groups.forEach((group) => {
    if (group.length > size) {
      if (page.length) pages.push(page);
      for (let i = 0; i < group.length; i += size) pages.push(group.slice(i, i + size));
      page = [];
      return;
    }
    if (page.length && page.length + group.length > size) {
      pages.push(page);
      page = [];
    }
    page.push(...group);
  });
  if (page.length) pages.push(page);
  return pages;
}

function updatePathProgress() {
  if (!els.pathFill) return;
  const total = Math.max(state.pages.length, 1);
  const progress = state.pages.length ? (state.pageIndex + 1) / total : 0;
  els.pathFill.style.strokeDashoffset = String(1 - progress);
}

function updatePauseButton() {
  if (!els.pause) return;
  els.pause.setAttribute("aria-pressed", String(state.paused));
  els.pause.replaceChildren(
    el("span", { class: "icon", "aria-hidden": "true", text: state.paused ? "▶" : "Ⅱ" }),
    state.paused ? "הפעלה" : "השהיה"
  );
}

function stopTimer() {
  clearTimeout(state.timer);
  state.timer = null;
}

function startTimer() {
  stopTimer();
  if (state.paused || state.modalPersonId || state.pages.length <= 1 || els.search.value.trim()) return;
  state.timer = window.setTimeout(() => showPage(state.pageIndex + 1), ROTATE_MS);
}

function showEmptyState() {
  els.layer.replaceChildren(
    el("div", { class: "empty-state" },
      el("div", {},
        el("h2", { text: "לא נמצאו תוצאות" }),
        el("p", { text: "אפשר לחפש שם פרטי, שם משפחה או יישוב." })
      )
    )
  );
}

function renderPersonNode(person, index) {
  const point = points()[index % points().length];
  const isTop = point.side === "top";
  const scale = point.size || .9;
  const node = el("article", {
    class: `person-node ${isTop ? "is-top" : "is-bottom"}`,
    dataset: { personId: person.id },
    style: {
      right: `${point.x}%`,
      left: "auto",
      top: `${point.y}%`,
      "--node-w": `${7.7 * scale}rem`,
      "--photo-w": `${6.25 * scale}rem`,
      "--from-y": isTop ? "1rem" : "-1rem",
      "--to-y": isTop ? "1.1rem" : "-1.1rem",
      "--stem": `${2.15 * scale}rem`,
      "--stem-dir": isTop ? "to bottom" : "to top",
    },
  });

  const button = el("button", {
    class: "person-button",
    type: "button",
    "aria-label": `פתיחת העמוד של ${displayName(person)}`,
    onClick: () => openStory(person),
    onPointerEnter: stopTimer,
    onPointerLeave: startTimer,
    onFocus: stopTimer,
    onBlur: startTimer,
  },
    el("div", { class: "portrait-frame" }, createPortrait(person, index < 3)),
    el("span", { class: "person-name" }, displayNameParts(person).map((part) => el("span", { text: part })))
  );

  node.append(button);
  return node;
}

function renderCurrentPage({ instant = false } = {}) {
  stopTimer();
  const page = state.pages[state.pageIndex] || [];
  if (!state.filtered.length || !page.length) {
    showEmptyState();
    updatePathProgress();
    return;
  }

  const oldNodes = Array.from(els.layer.querySelectorAll(".person-node"));
  oldNodes.forEach((node) => node.classList.add("is-leaving"));

  window.setTimeout(() => {
    els.layer.replaceChildren();
    page.forEach((person, index) => {
      const node = renderPersonNode(person, index);
      els.layer.append(node);
      const delay = instant ? 0 : 90 + index * 75;
      requestAnimationFrame(() => window.setTimeout(() => node.classList.add("is-visible"), delay));
    });
    updatePathProgress();
    startTimer();
  }, instant || !oldNodes.length ? 0 : FADE_MS);
}

function showPage(index, options = {}) {
  if (!state.pages.length) return;
  state.pageIndex = (index + state.pages.length) % state.pages.length;
  renderCurrentPage(options);
}

function applySearch() {
  const query = cleanKey(els.search.value || "");
  const tokens = query.split(/\s+/u).filter(Boolean);
  state.filtered = tokens.length
    ? state.people.filter((person) => tokens.every((token) => searchText(person).includes(token)))
    : [...state.people];
  state.pages = buildPages(state.filtered);
  state.pageIndex = 0;
  renderCurrentPage({ instant: true });
}

function closeStory() {
  state.modalPersonId = null;
  els.storyRoot.replaceChildren();
  document.documentElement.classList.remove("story-is-open");
  document.body.classList.remove("story-is-open");
  document.removeEventListener("keydown", handleModalKeydown, true);
  if (state.lastFocusedElement?.isConnected) state.lastFocusedElement.focus({ preventScroll: true });
  startTimer();
}

function handleModalKeydown(event) {
  if (event.key === "Escape") closeStory();
}

function openStory(person) {
  stopTimer();
  state.modalPersonId = person.id;
  state.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const family = familyMembersWhoDiedWith(person);
  const closeBtn = el("button", { class: "close-story", type: "button", "aria-label": "סגירה", onClick: closeStory }, "×");
  const panel = el("article", { class: "story-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "story-title", tabindex: "-1" },
    closeBtn,
    el("div", { class: "story-content" },
      el("div", { class: "portrait-frame" }, createPortrait(person, true)),
      el("h2", { class: "story-title", id: "story-title", text: displayName(person) }),
      el("div", { class: "story-dates" },
        el("div", { class: "date-card" }, el("span", { text: "תאריך לידה" }), el("strong", { text: formatBirthDate(person) })),
        el("div", { class: "date-card" }, el("span", { text: "תאריך פטירה" }), el("strong", { text: formatDeathDate(person) }))
      ),
      familyPhotoSection(person),
      family.length ? el("section", { class: "family-links", "aria-label": "בני משפחה שנפלו או נרצחו יחד" },
        el("h3", { text: "בני משפחה שנפלו / נרצחו יחד" }),
        el("div", { class: "family-buttons" },
          family.map((member) => el("button", {
            class: "family-link",
            type: "button",
            onClick: () => openStory(member),
          }, displayName(member)))
        )
      ) : null,
      el("p", { class: "construction-note", text: "התוכן בבנייה ויופיע בהקדם" })
    )
  );

  const overlay = el("div", { class: "story-overlay", onClick: (event) => { if (event.target === overlay) closeStory(); } }, panel);
  els.storyRoot.replaceChildren(overlay);
  document.documentElement.classList.add("story-is-open");
  document.body.classList.add("story-is-open");
  document.addEventListener("keydown", handleModalKeydown, true);
  requestAnimationFrame(() => panel.focus({ preventScroll: true }));
  announce(`${displayName(person)} נפתח`);
}

function init() {
  state.people = (window.MEMORIAL_DATA || []).map(normalizePerson);
  nameIndex = buildNameIndex(state.people);
  state.filtered = [...state.people];
  state.pages = buildPages(state.filtered);
  updatePauseButton();
  renderCurrentPage({ instant: true });

  els.next?.addEventListener("click", () => showPage(state.pageIndex + 1));
  els.prev?.addEventListener("click", () => showPage(state.pageIndex - 1));
  els.pause?.addEventListener("click", () => {
    state.paused = !state.paused;
    updatePauseButton();
    state.paused ? stopTimer() : startTimer();
  });
  els.search?.addEventListener("input", () => {
    window.clearTimeout(els.search._timer);
    els.search._timer = window.setTimeout(applySearch, 180);
  });
  window.addEventListener("resize", () => {
    const previousId = (state.pages[state.pageIndex] || [])[0]?.id;
    state.pages = buildPages(state.filtered);
    const nextIndex = Math.max(0, state.pages.findIndex((page) => page.some((person) => person.id === previousId)));
    state.pageIndex = nextIndex;
    renderCurrentPage({ instant: true });
  });
}

init();
