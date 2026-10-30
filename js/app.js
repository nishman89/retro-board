import { createStore, genId } from "./store.js";

/* ---------- formats ---------- */
const THEMES = [
  { id: "wwi", name: "Went well, to improve, actions", cols: [
    { id: "well", title: "Went well", prompt: "What helped us this sprint?", tone: "green" },
    { id: "improve", title: "To improve", prompt: "What slowed us down or got in the way?", tone: "pink" },
    { id: "actions", title: "Actions", prompt: "What will we try next, and who owns it?", tone: "blue" }] },
  { id: "ssc", name: "Start, stop, continue", cols: [
    { id: "start", title: "Start", prompt: "What should we begin doing?", tone: "blue" },
    { id: "stop", title: "Stop", prompt: "What isn’t working and should end?", tone: "pink" },
    { id: "continue", title: "Continue", prompt: "What’s working that we should keep?", tone: "green" }] },
  { id: "msg", name: "Mad, sad, glad", cols: [
    { id: "mad", title: "Mad", prompt: "What frustrated you?", tone: "pink" },
    { id: "sad", title: "Sad", prompt: "What disappointed you?", tone: "blue" },
    { id: "glad", title: "Glad", prompt: "What made you happy?", tone: "green" }] },
  { id: "4ls", name: "The 4 Ls", cols: [
    { id: "liked", title: "Liked", prompt: "What did you enjoy?", tone: "green" },
    { id: "learned", title: "Learned", prompt: "What did you discover?", tone: "blue" },
    { id: "lacked", title: "Lacked", prompt: "What was missing?", tone: "pink" },
    { id: "longed", title: "Longed for", prompt: "What do you wish we’d had?", tone: "purple" }] },
  { id: "sail", name: "Sailboat", cols: [
    { id: "wind", title: "Wind", prompt: "What pushed us forward?", tone: "green" },
    { id: "anchors", title: "Anchors", prompt: "What held us back?", tone: "charcoal" },
    { id: "rocks", title: "Rocks", prompt: "What risks lie ahead?", tone: "pink" },
    { id: "island", title: "Island", prompt: "Where are we heading?", tone: "blue" }] },
  { id: "star", name: "Starfish", cols: [
    { id: "keep", title: "Keep doing", prompt: "What’s adding value?", tone: "green" },
    { id: "more", title: "More of", prompt: "What should we do more?", tone: "blue" },
    { id: "less", title: "Less of", prompt: "What should we scale back?", tone: "amber" },
    { id: "startdoing", title: "Start", prompt: "What new thing should we try?", tone: "purple" },
    { id: "stopdoing", title: "Stop", prompt: "What should we drop?", tone: "pink" }] },
];
const OTHER = { id: "__other", title: "Unsorted", prompt: "Cards from a column this format doesn’t have.", tone: "charcoal" };
const MAX_LEN = 500;
const DAY_OPTIONS = [5, 10, 15, 20];
const themeOf = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

/* ---------- identity (no accounts on GitHub Pages) ---------- */
const ID_KEY = "retro-board-identity";
function loadMe() {
  try {
    const v = JSON.parse(localStorage.getItem(ID_KEY));
    if (v && /^[a-z0-9]{10}$/.test(v.id)) return { id: v.id, name: String(v.name || "").slice(0, 40) };
  } catch {}
  const me = { id: genId(), name: "" };
  saveMe(me);
  return me;
}
function saveMe(me) { try { localStorage.setItem(ID_KEY, JSON.stringify(me)); } catch {} }
const ME = loadMe();

/* ---------- state ---------- */
const S = {
  store: null, boards: [], boardsLoaded: false,
  boardId: null, board: null, boardLoaded: false, cards: [], moods: [],
  sortByVotes: false, drafts: {}, pending: null,
};
let subs = [], unsubBoards = null, currentKey = "";

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const tone = (t) => `--tone:var(--t-${t})`;
const isCreator = () => S.board && S.board.createdBy === ME.id;
const boardPath = () => "boards/" + S.boardId;
const signed = (v) => (v > 0 ? "+" + v : v < 0 ? "−" + Math.abs(v) : "0");

let toastTimer;
function toast(msg, actionLabel, action) {
  const box = document.getElementById("toast"), btn = document.getElementById("toast-action");
  document.getElementById("toast-msg").textContent = msg;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || "";
  btn.onclick = () => { box.hidden = true; action && action(); };
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), actionLabel ? 6000 : 4000);
}
async function write(fn) {
  try { await fn(); return true; }
  catch (e) {
    console.error(e);
    const code = e && e.code;
    if (code === "permission-denied") toast("The database refused that change. Check the Firestore rules in the README.");
    else if (code === "resource-exhausted") toast("The database is over its free quota for today.");
    else toast("That change didn’t save. Check your connection and try again.");
    return false;
  }
}
function onErr(e) { console.error(e); toast("Lost connection to the board. Reload the page to reconnect."); }

/* ---------- data ---------- */
function closeBoard() { subs.forEach((u) => u && u()); subs = []; }
function openBoard(id) {
  closeBoard();
  Object.assign(S, { boardId: id, board: null, boardLoaded: false, cards: [], moods: [], drafts: {}, pending: null });
  if (!S.store) return;
  subs.push(S.store.watchDoc("boards/" + id, (d) => { S.board = d; S.boardLoaded = true; render(); }, onErr));
  subs.push(S.store.watchCollection(`boards/${id}/cards`, (list) => { S.cards = list; render(); }, onErr));
  subs.push(S.store.watchCollection(`boards/${id}/moods`, (list) => { S.moods = list; render(); }, onErr));
}
function route() {
  const m = /^#board-([a-z0-9]{6,20})$/.exec(location.hash);
  if (m) { if (m[1] !== S.boardId) { openBoard(m[1]); window.scrollTo(0, 0); } }
  else if (S.boardId) { closeBoard(); S.boardId = null; S.board = null; window.scrollTo(0, 0); }
  render();
}

/* ---------- shared bits ---------- */
function pageHead(title, lede) {
  return [
    h("h1", { class: "page-title", id: "page-title" }, title, h("span", { class: "dot", "aria-hidden": "true", text: "." })),
    h("div", { class: "rule", "aria-hidden": "true" }),
    lede ? h("p", { class: "lede", text: lede }) : null,
  ].filter(Boolean);
}
function localNote() {
  if (!S.store || S.store.mode !== "local") return null;
  return h("p", { class: "note", "data-testid": "local-mode-note",
    text: "Boards are only saved in this browser for now, so other people won’t see your cards. To share boards with your team, add a Firebase config to js/config.js (see the README)." });
}
function daysSelect(id, value, onchange) {
  return h("select", { id, name: id, "data-testid": id, onchange },
    DAY_OPTIONS.map((n) => h("option", { value: String(n), selected: n === value, text: n + " days" })));
}

/* ---------- home ---------- */
function buildHome() {
  const wrap = h("div", { class: "container" },
    pageHead("Retro boards", "Pick a format, share the board’s link with your team, and everyone can add cards and plot how the sprint felt."),
    localNote(), buildCreateForm(),
    h("h2", { class: "section-title", text: "Boards" }),
    h("div", { id: "board-list", class: "board-list" }));
  return wrap;
}
function buildCreateForm() {
  const nameInput = h("input", { class: "text-input", id: "new-board-name", name: "board-name", maxlength: "80", placeholder: "e.g. Sprint 14 retro", autocomplete: "off", "data-testid": "new-board-name" });
  const seismo = h("input", { type: "checkbox", id: "new-board-seismo", name: "new-board-seismo", checked: true, "data-testid": "new-board-seismo" });
  const days = daysSelect("new-board-days", 10);
  const daysWrap = h("div", { class: "inline-field" }, h("label", { for: "new-board-days", text: "Sprint length" }), days);
  seismo.addEventListener("change", () => (daysWrap.hidden = !seismo.checked));
  const formats = h("div", { class: "formats" }, THEMES.map((t, i) =>
    h("label", { class: "format", "data-testid": "format-" + t.id },
      h("input", { type: "radio", name: "format", value: t.id, checked: i === 0 }),
      h("span", { class: "format-name", text: t.name }),
      h("span", { class: "chips" }, t.cols.map((c) => h("span", { class: "chip", style: tone(c.tone), text: c.title }))))));
  const btn = h("button", { class: "btn", type: "submit", "data-testid": "create-board", text: "Create board" });
  const form = h("form", { class: "panel", onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); toast("Give the board a name first."); return; }
      const id = genId();
      btn.disabled = true;
      const ok = await write(() => S.store.set("boards/" + id, {
        name, theme: form.querySelector("input[name=format]:checked").value,
        seismo: seismo.checked, days: Number(days.value),
        createdAt: Date.now(), createdBy: ME.id,
      }));
      btn.disabled = false;
      if (ok) { nameInput.value = ""; location.hash = "board-" + id; }
    } },
    h("label", { class: "field-label", for: "new-board-name", text: "New board" }), nameInput,
    h("fieldset", {}, h("legend", { text: "Format" }), formats),
    h("div", { class: "option-row" },
      h("label", { class: "check", for: "new-board-seismo" }, seismo, "Include an emotional seismograph"),
      daysWrap),
    h("div", { class: "form-actions" }, btn));
  return form;
}
function updateHome() {
  const list = document.getElementById("board-list");
  if (!list) return;
  if (!S.boardsLoaded) { list.replaceChildren(h("p", { class: "empty", text: "Loading boards…" })); return; }
  if (!S.boards.length) { list.replaceChildren(h("p", { class: "empty", text: "No boards yet. Create the first one above." })); return; }
  const sorted = [...S.boards].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  list.replaceChildren(...sorted.map((b) => h("a", { class: "board-link", href: "#board-" + b.id, "data-testid": "board-" + b.id },
    h("strong", { text: b.name || "Untitled board" }),
    h("span", { text: themeOf(b.theme).name + (b.seismo ? ", with seismograph" : "") +
      (b.createdAt ? ", " + new Date(b.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "") }))));
}

/* ---------- board ---------- */
function boardColumns() {
  const t = themeOf(S.board && S.board.theme);
  const ids = new Set(t.cols.map((c) => c.id));
  return S.cards.some((c) => !ids.has(c.column)) ? [...t.cols, OTHER] : t.cols;
}
function buildBoard() {
  const wrap = h("div", { class: "container" }, h("a", { class: "back", href: "#", "data-testid": "back-to-boards", text: "‹ All boards" }));
  if (!S.boardLoaded) { wrap.append(h("p", { class: "empty", text: "Loading board…" })); return wrap; }
  if (!S.board) { wrap.append(...pageHead("Board not found"), h("p", { class: "lede", text: "This board doesn’t exist or has been deleted." })); return wrap; }

  const t = themeOf(S.board.theme), cols = boardColumns();
  wrap.append(...pageHead(S.board.name || "Untitled board"));
  const note = localNote();
  if (note) wrap.append(note);

  const nameInput = h("input", { class: "small-input", id: "my-name", name: "my-name", maxlength: "40", placeholder: "Anonymous", value: ME.name, "data-testid": "my-name", autocomplete: "name" });
  nameInput.addEventListener("change", () => {
    ME.name = nameInput.value.trim().slice(0, 40); saveMe(ME);
    if (S.moods.some((m) => m.id === ME.id)) write(() => S.store.update(`${boardPath()}/moods/${ME.id}`, { name: ME.name }));
    render();
  });
  const seismoToggle = h("input", { type: "checkbox", id: "seismo-toggle", name: "seismo-toggle", checked: !!S.board.seismo, "data-testid": "seismo-toggle",
    onchange: (e) => write(() => S.store.update(boardPath(), { seismo: e.target.checked })) });

  const toolbar = h("div", { class: "toolbar" },
    h("div", { class: "inline-field" }, h("label", { for: "format-select", text: "Format" }),
      h("select", { id: "format-select", name: "format-select", "data-testid": "format-select",
        onchange: (e) => write(() => S.store.update(boardPath(), { theme: e.target.value })) },
        THEMES.map((x) => h("option", { value: x.id, selected: x.id === t.id, text: x.name })))),
    h("label", { class: "check", for: "seismo-toggle" }, seismoToggle, "Emotional seismograph"),
    h("button", { class: "btn btn-ghost", type: "button", id: "sort-toggle", "data-testid": "sort-toggle", onclick: () => { S.sortByVotes = !S.sortByVotes; render(); } }),
    h("span", { class: "spacer" }),
    h("div", { class: "inline-field" }, h("label", { for: "my-name", text: "Your name" }), nameInput),
    isCreator() ? deleteBoardButton() : null);
  wrap.append(toolbar,
    h("p", { class: "hint", text: "To invite people, send them this page’s link. Leave your name blank to post anonymously." }));

  if (S.board.seismo) wrap.append(buildSeismo());

  const grid = h("div", { class: "columns" + (cols.length >= 5 ? " many" : ""), style: "--n:" + cols.length });
  cols.forEach((c) => grid.append(buildColumn(c)));
  wrap.append(grid);
  return wrap;
}
function deleteBoardButton() {
  let armed = false, timer;
  const btn = h("button", { class: "btn btn-ghost", type: "button", "data-testid": "delete-board", text: "Delete board", onclick: async () => {
    if (!armed) {
      armed = true; btn.textContent = "Click again to delete"; btn.classList.add("btn-danger-armed");
      timer = setTimeout(() => { armed = false; btn.textContent = "Delete board"; btn.classList.remove("btn-danger-armed"); }, 4000);
      return;
    }
    clearTimeout(timer); btn.disabled = true;
    const base = boardPath();
    for (const c of [...S.cards]) await write(() => S.store.remove(`${base}/cards/${c.id}`));
    for (const m of [...S.moods]) await write(() => S.store.remove(`${base}/moods/${m.id}`));
    if (await write(() => S.store.remove(base))) { location.hash = ""; toast("Board deleted."); }
    else btn.disabled = false;
  } });
  return btn;
}
function buildColumn(c) {
  const isOther = c.id === OTHER.id;
  const section = h("section", { class: "col", style: tone(c.tone), "aria-labelledby": "col-" + c.id, "data-testid": "column-" + c.id },
    h("div", { class: "col-head" },
      h("h2", { class: "col-title", id: "col-" + c.id, text: c.title }),
      h("span", { class: "count", "data-count": c.id })),
    h("p", { class: "prompt", text: c.prompt }));
  if (!isOther) {
    const ta = h("textarea", { name: "card-" + c.id, id: "card-input-" + c.id, maxlength: String(MAX_LEN), placeholder: "Add a card…", "aria-label": "New card for " + c.title, "data-testid": "card-input-" + c.id });
    ta.value = S.drafts[c.id] || "";
    const left = h("small", {});
    const setLeft = () => { const n = ta.value.length; left.textContent = n > MAX_LEN - 80 ? MAX_LEN - n + " left" : "Enter to add, Shift+Enter for a new line"; };
    setLeft();
    const submit = async () => {
      const text = ta.value.trim();
      if (!text) return;
      const ok = await write(() => S.store.add(`${boardPath()}/cards`, {
        column: c.id, text: text.slice(0, MAX_LEN), authorId: ME.id, authorName: ME.name, votes: [], createdAt: Date.now() }));
      if (ok) { ta.value = ""; S.drafts[c.id] = ""; setLeft(); ta.focus(); }
    };
    ta.addEventListener("input", () => { S.drafts[c.id] = ta.value; setLeft(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
    section.append(h("form", { class: "add-form", onsubmit: (e) => { e.preventDefault(); submit(); } },
      ta, h("div", { class: "add-row" }, left, h("button", { class: "btn", type: "submit", "data-testid": "add-card-" + c.id, text: "Add card" }))));
  }
  section.append(h("ul", { class: "cards", "data-col": c.id }));
  return section;
}
function cardsFor(colId, validIds) {
  const votes = (c) => (Array.isArray(c.votes) ? c.votes.length : 0);
  return S.cards
    .filter((c) => (colId === OTHER.id ? !validIds.has(c.column) : c.column === colId))
    .sort((a, b) => S.sortByVotes ? votes(b) - votes(a) || (a.createdAt || 0) - (b.createdAt || 0) : (a.createdAt || 0) - (b.createdAt || 0));
}
function buildCard(card) {
  const votes = Array.isArray(card.votes) ? card.votes : [];
  const mine = votes.includes(ME.id);
  const path = `${boardPath()}/cards/${card.id}`;
  const actions = h("div", { class: "actions" });
  if (card.authorId === ME.id || isCreator()) actions.append(h("button", { class: "icon-btn", type: "button", "data-focus": "del-" + card.id, "data-testid": "delete-card-" + card.id, text: "Delete",
    onclick: async () => {
      const { id, ...data } = card;
      if (await write(() => S.store.remove(path))) toast("Card deleted.", "Undo", () => write(() => S.store.set(path, data)));
    } }));
  actions.append(h("button", { class: "icon-btn vote", type: "button", "data-focus": "vote-" + card.id, "data-testid": "vote-card-" + card.id,
    "aria-pressed": String(mine),
    "aria-label": `${mine ? "Remove your vote" : "Vote for this card"}, ${votes.length} vote${votes.length === 1 ? "" : "s"}`,
    text: "▲ " + votes.length,
    onclick: () => write(() => S.store.arrayToggle(path, "votes", ME.id, !mine)) }));
  const author = card.authorId === ME.id ? "You" : card.authorName || "Anonymous";
  return h("li", { class: "card", "data-testid": "card-" + card.id },
    h("p", { class: "card-text", text: card.text || "" }),
    h("div", { class: "card-foot" }, h("span", { class: "author", text: author }), actions));
}

/* ---------- emotional seismograph ---------- */
const CH = { W: 800, H: 340, L: 64, R: 36, T: 18, B: 40 };
const plotW = CH.W - CH.L - CH.R, plotH = CH.H - CH.T - CH.B;
const boardDays = () => Math.max(2, Number(S.board && S.board.days) || 10);
const xFor = (i, days) => CH.L + (i * plotW) / (days - 1);
const yFor = (v) => CH.T + ((5 - v) / 10) * plotH;
let dragging = false;

function myValues() {
  const days = boardDays();
  const src = S.pending || (S.moods.find((m) => m.id === ME.id) || {}).values || [];
  return Array.from({ length: days }, (_, i) => (typeof src[i] === "number" ? src[i] : null));
}
function commitMood() {
  const values = myValues();
  write(() => S.store.set(`${boardPath()}/moods/${ME.id}`, { name: ME.name, values, updatedAt: Date.now() }))
    .then(() => { if (!dragging) S.pending = null; });
}
function buildSeismo() {
  const days = boardDays();
  const svg = s("svg", { class: "chart", id: "seismo-svg", viewBox: `0 0 ${CH.W} ${CH.H}`, role: "img", "aria-labelledby": "seismo-title", "data-testid": "seismo-chart" },
    s("g", { id: "seismo-axes" }), s("g", { id: "seismo-plot" }));
  const plotAt = (e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const day = Math.min(days - 1, Math.max(0, Math.round(((p.x - CH.L) / plotW) * (days - 1))));
    const v = Math.min(5, Math.max(-5, Math.round(5 - ((p.y - CH.T) / plotH) * 10)));
    const vals = myValues(); vals[day] = v; S.pending = vals; updateSeismo();
  };
  svg.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; dragging = true; svg.setPointerCapture(e.pointerId); plotAt(e); });
  svg.addEventListener("pointermove", (e) => { if (dragging) plotAt(e); });
  const end = () => { if (!dragging) return; dragging = false; commitMood(); };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);

  const sliders = h("div", { class: "sliders" });
  for (let i = 0; i < days; i++) {
    const out = h("output", { for: "mood-day-" + (i + 1), "data-out": i });
    const range = h("input", { type: "range", min: "-5", max: "5", step: "1", id: "mood-day-" + (i + 1), name: "mood-day-" + (i + 1), "data-day": i, "data-testid": "mood-day-" + (i + 1) });
    range.addEventListener("input", () => { const vals = myValues(); vals[i] = Number(range.value); S.pending = vals; updateSeismo(); });
    range.addEventListener("change", commitMood);
    const clear = h("button", { class: "icon-btn", type: "button", "aria-label": `Clear day ${i + 1}`, "data-testid": "mood-clear-" + (i + 1), text: "Clear",
      onclick: () => { const vals = myValues(); vals[i] = null; S.pending = vals; updateSeismo(); commitMood(); } });
    sliders.append(h("div", { class: "slider-row" }, h("label", { for: "mood-day-" + (i + 1), text: "Day " + (i + 1) }), range, out, clear));
  }
  const daysControl = daysSelect("seismo-days", days, (e) => write(() => S.store.update(boardPath(), { days: Number(e.target.value) })));

  return h("section", { class: "panel seismo", "aria-labelledby": "seismo-title", "data-testid": "seismograph" },
    h("h2", { class: "section-title", id: "seismo-title", text: "Emotional seismograph" }),
    h("p", { class: "prompt", text: "Plot how you felt on each day of the sprint, from a rough day at the bottom to a great one at the top. Click or drag on the chart, or use the sliders below." }),
    h("div", { class: "chart-wrap" }, svg),
    h("ul", { class: "legend", id: "seismo-legend", "data-testid": "seismo-legend" }),
    h("details", { class: "my-line", open: true },
      h("summary", { text: "Your line" }),
      sliders,
      h("div", { class: "row-end option-row" },
        h("div", { class: "inline-field" }, h("label", { for: "seismo-days", text: "Sprint length" }), daysControl),
        h("button", { class: "btn btn-ghost", type: "button", "data-testid": "mood-clear-all", text: "Clear my line",
          onclick: () => { S.pending = null; write(() => S.store.remove(`${boardPath()}/moods/${ME.id}`)); } }))));
}
function linePath(values, days) {
  // Joins the days that have a value, skipping over days left blank.
  let d = "";
  values.slice(0, days).forEach((v, i) => {
    if (typeof v !== "number") return;
    d += `${d ? "L" : "M"}${xFor(i, days).toFixed(1)} ${yFor(v).toFixed(1)} `;
  });
  return d.trim();
}
function updateSeismo() {
  const svg = document.getElementById("seismo-svg");
  if (!svg) return;
  const days = boardDays();

  // axes
  const axes = svg.querySelector("#seismo-axes");
  const ax = [];
  for (let v = -5; v <= 5; v++) ax.push(s("line", { class: v === 0 ? "zero" : "gridline", x1: CH.L, x2: CH.W - CH.R, y1: yFor(v), y2: yFor(v) }));
  [[5, "😄"], [0, "😐"], [-5, "😞"]].forEach(([v, e]) => {
    ax.push(s("text", { class: "emoji", x: 6, y: yFor(v) + 6 }, e));
    ax.push(s("text", { x: CH.L - 10, y: yFor(v) + 5, "text-anchor": "end" }, signed(v)));
  });
  const every = days > 12 ? 2 : 1;
  for (let i = 0; i < days; i++) {
    ax.push(s("line", { class: "gridline", x1: xFor(i, days), x2: xFor(i, days), y1: CH.T, y2: CH.H - CH.B }));
    if (i % every === 0 || i === days - 1) ax.push(s("text", { x: xFor(i, days), y: CH.H - CH.B + 22, "text-anchor": "middle" }, "Day " + (i + 1)));
  }
  axes.replaceChildren(...ax);

  // people (me replaced by pending values)
  const people = S.moods.filter((m) => m.id !== ME.id).sort((a, b) => a.id.localeCompare(b.id))
    .map((m, i) => ({ id: m.id, name: m.name || "Anonymous", values: Array.isArray(m.values) ? m.values : [], color: `var(--p${i % 8})`, me: false }));
  const mine = myValues();
  if (mine.some((v) => typeof v === "number")) people.push({ id: ME.id, name: "You", values: mine, color: "var(--pink)", me: true });

  const plot = svg.querySelector("#seismo-plot");
  const g = [];
  if (!people.length) {
    g.push(s("text", { class: "empty-msg", x: CH.L + plotW / 2, y: CH.T + plotH / 2 - 12, "text-anchor": "middle" }, "No lines yet. Click the chart to plot your first day."));
  }
  // team average
  const avg = Array.from({ length: days }, (_, i) => {
    const vals = people.map((p) => p.values[i]).filter((v) => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  for (const p of people) {
    const d = linePath(p.values, days);
    if (d) g.push(s("path", { class: "line" + (p.me ? " me" : ""), d, style: `stroke:${p.color}` }));
    p.values.slice(0, days).forEach((v, i) => {
      if (typeof v !== "number") return;
      g.push(s("circle", { cx: xFor(i, days), cy: yFor(v), r: p.me ? 6 : 4.5, style: `fill:${p.color}` },
        s("title", {}, `${p.name}, day ${i + 1}: ${signed(v)}`)));
    });
  }
  if (people.length > 1) {
    const d = linePath(avg, days);
    if (d) g.push(s("path", { class: "avg", d }, s("title", {}, "Team average")));
  }
  plot.replaceChildren(...g);

  // legend
  const legend = document.getElementById("seismo-legend");
  const items = people.map((p) => h("li", {}, h("span", { class: "swatch", style: `--c:${p.color}` }), p.name));
  if (people.length > 1) items.push(h("li", {}, h("span", { class: "swatch dashed" }), "Team average"));
  legend.replaceChildren(...items);

  // sliders and outputs
  document.querySelectorAll("input[data-day]").forEach((r) => {
    const i = Number(r.dataset.day), v = mine[i];
    if (document.activeElement !== r) r.value = typeof v === "number" ? v : 0;
    r.classList.toggle("unset", typeof v !== "number");
    const out = document.querySelector(`output[data-out="${i}"]`);
    if (out) out.textContent = typeof v === "number" ? signed(v) : "–";
  });
  svg.setAttribute("aria-label", `Emotional seismograph with ${people.length} line${people.length === 1 ? "" : "s"}` +
    (people.length > 1 ? ". Team average by day: " + avg.map((v, i) => `day ${i + 1} ${v == null ? "no data" : signed(Math.round(v * 10) / 10)}`).join(", ") : ""));
}

function updateBoard() {
  const title = document.getElementById("page-title");
  if (title && S.board) title.firstChild.textContent = S.board.name || "Untitled board";
  const sort = document.getElementById("sort-toggle");
  if (sort) { sort.textContent = S.sortByVotes ? "Sorted by votes" : "Sort by votes"; sort.setAttribute("aria-pressed", String(S.sortByVotes)); }
  const valid = new Set(themeOf(S.board && S.board.theme).cols.map((c) => c.id));
  const focusKey = document.activeElement && document.activeElement.getAttribute("data-focus");
  document.querySelectorAll("ul.cards[data-col]").forEach((ul) => {
    const col = ul.getAttribute("data-col"), list = cardsFor(col, valid);
    ul.replaceChildren(...list.map(buildCard));
    const count = document.querySelector(`[data-count="${col}"]`);
    if (count) { count.textContent = list.length; count.setAttribute("aria-label", list.length + (list.length === 1 ? " card" : " cards")); }
    const section = ul.closest(".col"), empty = section.querySelector(".col-empty");
    if (!list.length && !empty) section.append(h("p", { class: "col-empty", text: "No cards yet." }));
    if (list.length && empty) empty.remove();
  });
  if (focusKey) { const el = document.querySelector(`[data-focus="${focusKey}"]`); el && el.focus(); }
  if (S.board && S.board.seismo) updateSeismo();
}

/* ---------- render ---------- */
function render() {
  let key;
  if (S.boardId) {
    const b = S.board;
    key = ["b", S.boardId, S.boardLoaded, !!b, b ? boardColumns().map((c) => c.id).join(",") : "", b && b.theme, b && !!b.seismo, b && b.days, isCreator()].join("|");
  } else key = "home";
  if (key !== currentKey) {
    currentKey = key;
    document.getElementById("app").replaceChildren(S.boardId ? buildBoard() : buildHome());
  }
  if (S.boardId) updateBoard(); else updateHome();
}

/* ---------- start ---------- */
(async function init() {
  S.store = await createStore();
  unsubBoards = S.store.watchCollection("boards", (list) => { S.boards = list; S.boardsLoaded = true; render(); }, onErr);
  window.addEventListener("hashchange", route);
  const m = /^#board-([a-z0-9]{6,20})$/.exec(location.hash);
  if (m) openBoard(m[1]);
  render();
})();
