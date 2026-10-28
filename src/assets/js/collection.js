/* The Collection: draggable hierarchy chart with dossier files. */
(function () {
  "use strict";

  const $ = (s, el) => (el || document).querySelector(s);
  const svgNS = "http://www.w3.org/2000/svg";
  const W = 224, H = 86, GAP_X = 36, GAP_Y = 90;
  const STATUS = { watched: "Kept and watched", referred: "Referred", cleared: "Cleared", closed: "Closed", serving: "Serving", probation: "On probation", leave: "On leave", retired: "Retired" };
  const STATUS_CASE = ["watched", "referred", "cleared", "closed"];
  const DIV_LABEL = { government: "Abt. I Regierung", secret: "Abt. II Schatten", public: "Abt. III Öffentlichkeit" };
  const DIV_SHORT = { government: "Abt. I", secret: "Abt. II", public: "Abt. III" };
  const STATUS_STAFF = ["serving", "probation", "leave", "retired"];
  const TIER_LABEL = { 1: "Tier 1 · Enlisted / NCO", 2: "Tier 2 · Officers", 3: "Tier 3 · General / Government", 4: "Tier 4 · Office only" };
  const BAND = { head: "Heads of State", general: "General ranks", officer: "Commissioned officers", nco: "Non-commissioned officers", enlisted: "Enlisted and civil" };
  const INC_TAB = { slug: "incidents", name: "Incidents", id: 0 };
  const SEV_RANK = { severe: 0, moderate: 1, minor: 2 };
  const SEV_LABEL = { severe: "Severe", moderate: "Moderate", minor: "Minor" };
  const INC_STATUS = { open: "Open", active: "Under investigation", referred: "Referred", closed: "Closed" };
  const INC_STATUS_ORDER = ["open", "active", "referred", "closed"];
  const ROLE_LABEL = { subject: "Subject", witness: "Witness", informant: "Informant", complainant: "Complainant", officer: "Officer present", other: "Other" };

  const el = {
    tabs: $("#tabs"), search: $("#search"), fit: $("#fit"), arrange: $("#arrange"), newBtn: $("#new"),
    stage: $("#stage"), chart: $("#chart"), view: $("#view"), links: $("#links"), nodes: $("#nodes"),
    empty: $("#empty"), file: $("#file"), body: $(".col__body"),
    dialog: $("#dialog"), form: $("#personForm"), pfOrg: $("#pfOrg"), pfRank: $("#pfRank"), pfTier: $("#pfTier"), pfStatus: $("#pfStatus"),
    pfSupId: $("#pfSupId"), pfSupChip: $("#pfSupChip"), pfSupName: $("#pfSupName"), pfSupClear: $("#pfSupClear"),
    pfSupSearch: $("#pfSupSearch"), pfSupResults: $("#pfSupResults"), pfError: $("#pfError"), pfCancel: $("#pfCancel"),
    pfKicker: $("#pfKicker"), pfTitle: $("#pfTitle"), pfSave: $("#pfSave"),
    pfPortraitFile: $("#pfPortraitFile"), pfPortraitPreview: $("#pfPortraitPreview"), pfPortraitClear: $("#pfPortraitClear"),
  };

  const state = {
    orgs: [], all: [], org: null, people: [], externals: [], byId: new Map(),
    view: { x: 60, y: 40, k: 1 }, selected: null, editing: null, portrait: undefined,
    incidents: [], incOpen: null, incEditing: null, members: null,
  };
  const isIncTab = () => !!state.org && state.org.slug === "incidents";

  /* ---------- api ---------- */
  async function api(method, url, body) {
    const r = await fetch(url, {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`);
    return data;
  }

  function toast(msg, ms = 3200) {
    let t = $(".col__toast");
    if (!t) { t = document.createElement("div"); t.className = "col__toast"; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, ms);
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (s) => { try { return new Date(s.replace(" ", "T") + "Z").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return s; } };

  /* ---------- tabs ---------- */
  function renderTabs() {
    el.tabs.innerHTML = "";
    for (const o of state.orgs) {
      const b = document.createElement("button");
      b.className = "col__tab"; b.type = "button"; b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", state.org && state.org.slug === o.slug ? "true" : "false");
      const sub = o.mode === "full" && o.access === "open" ? "open to all" : o.mode === "bare" ? `${esc(o.compartment)} · tree only` : `${esc(o.compartment)} · T${o.tier}`;
      b.innerHTML = `${esc(o.name)}<small>${sub}</small>`;
      b.addEventListener("click", () => selectOrg(o.slug));
      el.tabs.appendChild(b);
    }
    // The sidebar carries the choice between dossiers and incidents.
    const dossiers = document.querySelector('.dept__nav a[href="/department/collection/"]');
    const incidents = document.querySelector('.dept__nav a[href="/department/collection/#incidents"]');
    if (dossiers) { if (isIncTab()) dossiers.removeAttribute("aria-current"); else dossiers.setAttribute("aria-current", "page"); }
    if (incidents) { if (isIncTab()) incidents.setAttribute("aria-current", "page"); else incidents.removeAttribute("aria-current"); }
  }

  async function selectOrg(slug, keepFile) {
    const o = slug === "incidents" ? INC_TAB : (state.orgs.find((x) => x.slug === slug) || state.orgs[0]);
    if (!o) return;
    state.org = o;
    if (!keepFile) closeFile();
    location.hash = o.slug;
    renderTabs();
    const incTab = isIncTab();
    ie.wrap.hidden = !incTab;
    el.fit.hidden = incTab; el.arrange.hidden = incTab;
    el.newBtn.textContent = incTab ? "+ New incident" : "+ New file";
    el.search.placeholder = incTab ? "Find an incident…" : "Find a name…";
    if (incTab) { el.newBtn.hidden = false; el.empty.hidden = true; await loadIncidents(); }
    else await load();
  }

  /* ---------- data ---------- */
  async function load() {
    if (isIncTab()) return loadIncidents();
    const d = await api("GET", `/api/collection/people?org=${encodeURIComponent(state.org.slug)}`);
    state.people = d.people; state.externals = d.externals;
    state.byId = new Map(d.people.map((p) => [p.id, p]));
    layout();
    render();
    el.empty.hidden = d.people.length > 0;
    el.newBtn.hidden = d.org.mode === "bare";
    if (!d.people.some((p) => p.x !== null)) fit();
  }

  /* ---------- layout ---------- */
  function treeLayout(people) {
    const kids = new Map();
    const inOrg = new Set(people.map((p) => p.id));
    const roots = [];
    for (const p of people) {
      if (p.reports_to && inOrg.has(p.reports_to)) {
        if (!kids.has(p.reports_to)) kids.set(p.reports_to, []);
        kids.get(p.reports_to).push(p);
      } else roots.push(p);
    }
    const order = (a, b) => (a.rank_sort ?? 999) - (b.rank_sort ?? 999) || (a.name || "").localeCompare(b.name || "");
    roots.sort(order);
    for (const arr of kids.values()) arr.sort(order);
    const width = new Map();
    const measure = (p) => {
      const c = kids.get(p.id) || [];
      const w = c.length ? c.reduce((s, k) => s + measure(k), 0) : 1;
      width.set(p.id, w);
      return w;
    };
    roots.forEach(measure);
    const pos = new Map();
    const place = (p, x0, depth) => {
      const w = width.get(p.id);
      pos.set(p.id, { x: x0 + ((w - 1) * (W + GAP_X)) / 2, y: depth * (H + GAP_Y) });
      let x = x0;
      for (const k of kids.get(p.id) || []) { place(k, x, depth + 1); x += width.get(k.id) * (W + GAP_X); }
    };
    let x = 0;
    for (const r of roots) { place(r, x, 0); x += width.get(r.id) * (W + GAP_X); }
    return pos;
  }

  function layout() {
    const people = state.people;
    const unplaced = people.filter((p) => p.x === null || p.y === null);
    if (!people.length) return;
    if (unplaced.length === people.length) {
      const pos = treeLayout(people);
      for (const p of people) { const q = pos.get(p.id); p._x = q.x; p._y = q.y; }
    } else {
      let maxY = -Infinity, minX = Infinity;
      for (const p of people) if (p.x !== null) { maxY = Math.max(maxY, p.y); minX = Math.min(minX, p.x); p._x = p.x; p._y = p.y; }
      unplaced.forEach((p, i) => { p._x = minX + i * (W + GAP_X); p._y = maxY + H + GAP_Y; });
    }
    // external superiors: hover above the first subordinate that points at them
    for (const e of state.externals) {
      const subs = people.filter((p) => p.reports_to === e.id);
      e._x = subs.reduce((s, p) => s + p._x, 0) / subs.length;
      e._y = Math.min(...subs.map((p) => p._y)) - H - 50;
    }
  }

  /* ---------- render ---------- */
  function applyView() {
    const v = state.view;
    el.view.setAttribute("transform", `translate(${v.x} ${v.y}) scale(${v.k})`);
  }

  function mk(tag, attrs, text) {
    const n = document.createElementNS(svgNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

  function render() {
    el.links.innerHTML = ""; el.nodes.innerHTML = "";
    if (!$("#t4stripe")) {
      const pat = mk("pattern", { id: "t4stripe", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
      pat.appendChild(mk("rect", { width: 3, height: 6, fill: "#161310" }));
      pat.appendChild(mk("rect", { x: 3, width: 3, height: 6, fill: "#c9372c" }));
      $("defs", el.chart).appendChild(pat);
    }
    const q = el.search.value.trim().toLowerCase();

    for (const p of state.people) {
      const sup = p.reports_to && (state.byId.get(p.reports_to) || state.externals.find((e) => e.id === p.reports_to));
      if (!sup) continue;
      const ext = !state.byId.has(p.reports_to);
      const d = linkPath(sup, p);
      const lg = mk("g", { class: "linkg", "data-from": sup.id, "data-to": p.id });
      const hit = mk("path", { class: "link__hit", d, "data-from": sup.id, "data-to": p.id });
      hit.appendChild(mk("title", {}, `${sup.name || "Confidential"} commands ${p.name || "a file"} · click to detach`));
      lg.appendChild(hit);
      lg.appendChild(mk("path", { class: "link" + (ext ? " link--ext" : ""), d, "data-from": sup.id, "data-to": p.id }));
      el.links.appendChild(lg);
    }
    for (const e of state.externals) el.nodes.appendChild(nodeEl(e, true, q));
    for (const p of state.people) el.nodes.appendChild(nodeEl(p, false, q));
    applyView();
  }

  function linkPath(a, b) {
    const sx = a._x + W / 2, sy = a._y + H, tx = b._x + W / 2, ty = b._y;
    const my = sy + (ty - sy) / 2;
    return `M${sx} ${sy} V${my} H${tx} V${ty}`;
  }

  function nodeEl(p, ext, q) {
    const g = mk("g", { class: `node node--t${p.tier || 1}${ext ? " node--ext" : ""}${p.redacted ? " node--redacted" : ""}${state.selected === p.id ? " is-selected" : ""}`, transform: `translate(${p._x} ${p._y})`, "data-id": p.id });
    if (q && !(p.name || "").toLowerCase().includes(q)) g.classList.add("node--dim");
    g.appendChild(mk("rect", { class: "node__box", width: W, height: ext ? 56 : H, rx: 2 }));
    if (p.bare) {
      // Seen through Schatten's broad scope: a file exists here, and nothing more is told.
      const h = ext ? 56 : H;
      g.classList.add("node--bare");
      g.appendChild(mk("rect", { class: "node__hatch", x: 2, y: 2, width: W - 4, height: h - 4 }));
      g.appendChild(mk("text", { class: "node__confidential", x: W / 2, y: h / 2 + 6 }, "CONFIDENTIAL"));
      g.appendChild(mk("title", {}, "Confidential. Outside your compartments."));
      return g;
    }
    if (p.redacted) {
      // A file exists here, but the viewer's clearance does not reach it.
      const h = ext ? 56 : H;
      g.appendChild(mk("rect", { class: "node__hatch", x: 2, y: 2, width: W - 4, height: h - 4 }));
      g.appendChild(mk("text", { class: "node__name node__name--c", x: W / 2, y: ext ? 22 : 24 }, trunc(p.name, 24)));
      g.appendChild(mk("text", { class: "node__rank node__rank--c", x: W / 2, y: ext ? 37 : 39 }, trunc(p.rank_name || "Rank unknown", 30)));
      g.appendChild(mk("text", { class: "node__confidential", x: W / 2, y: ext ? 52 : 58 }, "CONFIDENTIAL"));
      if (!ext) g.appendChild(mk("text", { class: "node__foot node__foot--c", x: W / 2, y: h - 9 }, `Tier ${p.tier} clearance required`));
      g.appendChild(mk("title", {}, `${p.name}: confidential. Your clearance does not reach this file.`));
      return g;
    }
    if (!ext) {
      g.appendChild(mk("rect", { class: "node__stripe", x: 2, y: 2, width: 7, height: H - 4 }));
      g.appendChild(mk("circle", { class: "node__avatar", cx: 34, cy: 30, r: 17 }));
      g.appendChild(mk("text", { class: "node__initial", x: 34, y: 36 }, (p.name || "?").trim()[0].toUpperCase()));
      g.appendChild(mk("text", { class: "node__name", x: 60, y: 24 }, trunc(p.name, 20)));
      g.appendChild(mk("text", { class: "node__rank", x: 60, y: 40 }, trunc(p.rank_name || p.rank_text || "Rank unknown", 30)));
      g.appendChild(mk("text", { class: "node__title", x: 60, y: 56 }, trunc(p.title || "", 34)));
      const divs = String(p.division || "").split(",").filter(Boolean).map((d) => DIV_SHORT[d] || d).join("/");
      const foot = divs
        ? `${divs} · ${STATUS[p.status] || p.status} · ${p.report_count} ${p.report_count === 1 ? "report" : "reports"}`
        : `T${p.tier} · ${STATUS[p.status] || p.status} · ${p.report_count} ${p.report_count === 1 ? "report" : "reports"}${p.party_member === 1 ? " · Party" : ""}`;
      g.appendChild(mk("text", { class: "node__foot", x: 14, y: H - 9 }, foot));
      if (state.selected === p.id) {
        // Nibs: drag one onto another card to attach the two.
        for (const [cx, cy] of [[W / 2, 0], [W, H / 2], [W / 2, H], [0, H / 2]]) {
          const n = mk("circle", { class: "nib", cx, cy, r: 7 });
          n.appendChild(mk("title", {}, "Drag onto another card to attach"));
          g.appendChild(n);
        }
      }
    } else {
      g.appendChild(mk("text", { class: "node__name", x: 14, y: 24 }, trunc(p.name, 24)));
      g.appendChild(mk("text", { class: "node__rank", x: 14, y: 42 }, trunc(`${p.rank_name || ""} · ${p.org_name}`, 34)));
    }
    return g;
  }

  /* ---------- pan, zoom, drag ---------- */
  let drag = null;
  const chartPoint = (e) => { const r = el.chart.getBoundingClientRect(); return { x: (e.clientX - r.left - state.view.x) / state.view.k, y: (e.clientY - r.top - state.view.y) / state.view.k }; };
  const cardById = (id) => state.byId.get(id) || state.externals.find((x) => x.id === id);
  el.chart.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    closePop();
    const nib = e.target.closest(".nib");
    if (nib) {
      const from = state.byId.get(Number(nib.closest(".node").dataset.id));
      if (!from) return;
      try { el.chart.setPointerCapture(e.pointerId); } catch {}
      const sx = from._x + Number(nib.getAttribute("cx")), sy = from._y + Number(nib.getAttribute("cy"));
      const draft = mk("path", { class: "link link--draft", d: `M${sx} ${sy} L${sx} ${sy}` });
      el.links.appendChild(draft);
      drag = { kind: "link", from, draft, sx, sy, target: null };
      return;
    }
    const lg = e.target.closest(".linkg");
    if (lg && !e.target.closest(".node")) {
      try { el.chart.setPointerCapture(e.pointerId); } catch {}
      drag = { kind: "linkhit", lg, sx: e.clientX, sy: e.clientY, moved: false };
      return;
    }
    const node = e.target.closest(".node");
    try { el.chart.setPointerCapture(e.pointerId); } catch {}
    if (node && node.classList.contains("node--redacted")) {
      toast(node.classList.contains("node--bare") ? "Confidential. Outside your compartments." : "Confidential. Your clearance does not reach this file.");
      drag = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: state.view.x, oy: state.view.y, moved: false };
      return;
    }
    if (node) {
      const id = Number(node.dataset.id);
      const p = state.byId.get(id) || state.externals.find((x) => x.id === id);
      drag = { kind: "node", id, p, node, ext: !state.byId.has(id), sx: e.clientX, sy: e.clientY, ox: p._x, oy: p._y, moved: false };
    } else {
      drag = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: state.view.x, oy: state.view.y, moved: false };
      el.chart.classList.add("panning");
    }
  });
  el.chart.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.kind === "link") {
      const pt = chartPoint(e);
      drag.draft.setAttribute("d", `M${drag.sx} ${drag.sy} L${pt.x} ${pt.y}`);
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const node = over && over.closest(".node");
      const ok = node && Number(node.dataset.id) !== drag.from.id && !node.classList.contains("node--redacted");
      if (drag.target && drag.target !== node) drag.target.classList.remove("node--target");
      drag.target = ok ? node : null;
      if (drag.target) drag.target.classList.add("node--target");
      return;
    }
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.kind === "linkhit") return;
    if (drag.kind === "pan") { state.view.x = drag.ox + dx; state.view.y = drag.oy + dy; applyView(); }
    else if (!drag.ext) {
      drag.p._x = drag.ox + dx / state.view.k; drag.p._y = drag.oy + dy / state.view.k;
      drag.node.setAttribute("transform", `translate(${drag.p._x} ${drag.p._y})`);
      el.links.querySelectorAll(`[data-from="${drag.id}"],[data-to="${drag.id}"]`).forEach((path) => {
        const a = state.byId.get(Number(path.dataset.from)) || state.externals.find((x) => x.id === Number(path.dataset.from));
        const b = state.byId.get(Number(path.dataset.to));
        if (a && b) path.setAttribute("d", linkPath(a, b));
      });
    }
  });
  el.chart.addEventListener("pointerup", async (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    el.chart.classList.remove("panning");
    if (d.kind === "link") {
      d.draft.remove();
      if (d.target) {
        d.target.classList.remove("node--target");
        const to = cardById(Number(d.target.dataset.id));
        if (to) askAttach(d.from, to, e.clientX, e.clientY);
      }
      return;
    }
    if (d.kind === "linkhit") {
      if (d.moved) return;
      const sub = state.byId.get(Number(d.lg.dataset.to)), sup = cardById(Number(d.lg.dataset.from));
      if (sub && confirm(`Detach ${sub.name} from ${sup && sup.name ? sup.name : "their superior"}?`)) attachTo(sub.id, null);
      return;
    }
    if (d.kind === "node") {
      if (!d.moved) { if (d.ext) { await openPerson(d.id, true); } else openFile(d.id); }
      else if (!d.ext) {
        d.p.x = Math.round(d.p._x); d.p.y = Math.round(d.p._y);
        api("PUT", `/api/collection/people/${d.id}/position`, { x: d.p.x, y: d.p.y }).catch((err) => toast(err.message));
      }
    }
  });
  el.chart.addEventListener("pointercancel", () => { drag = null; el.chart.classList.remove("panning"); });
  el.chart.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = el.chart.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k0 = state.view.k, k1 = Math.min(2.5, Math.max(.25, k0 * (e.deltaY < 0 ? 1.12 : 0.89)));
    state.view.x = mx - (mx - state.view.x) * (k1 / k0);
    state.view.y = my - (my - state.view.y) * (k1 / k0);
    state.view.k = k1;
    applyView();
  }, { passive: false });

  /* ---------- attaching cards ---------- */
  function closePop() { const p = $(".col__pop", el.stage); if (p) p.remove(); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
  // The dropped line could run either way: ask which.
  function askAttach(a, b, cx, cy) {
    closePop();
    const pop = document.createElement("div"); pop.className = "col__pop";
    const r = el.stage.getBoundingClientRect();
    // The file panel may overlay the stage: keep the popover in the part still visible.
    const visibleRight = el.file.hidden ? r.width : Math.min(r.width, el.file.getBoundingClientRect().left - r.left);
    pop.style.left = Math.max(8, Math.min(cx - r.left, visibleRight - 330)) + "px";
    const visibleBottom = Math.min(r.height, window.innerHeight - r.top);
    pop.style.top = Math.max(8, Math.min(cy - r.top, visibleBottom - 200)) + "px";
    pop.innerHTML = `<div class="label label--red">Attach</div>
      <button type="button" data-dir="ab"><b>${esc(a.name)}</b> reports to <b>${esc(b.name)}</b></button>
      <button type="button" data-dir="ba"><b>${esc(b.name)}</b> reports to <b>${esc(a.name)}</b></button>
      <button type="button" class="col__pop-cancel" data-cancel>Cancel</button>`;
    el.stage.appendChild(pop);
    $("[data-cancel]", pop).addEventListener("click", closePop);
    pop.querySelectorAll("[data-dir]").forEach((btn) => btn.addEventListener("click", () => {
      const [sub, sup] = btn.dataset.dir === "ab" ? [a, b] : [b, a];
      closePop();
      attachTo(sub.id, sup.id);
    }));
  }
  async function attachTo(id, supId) {
    try {
      await api("PUT", `/api/collection/people/${id}/superior`, { reports_to: supId });
      await load();
      if (state.selected) openFile(state.selected);
      toast(supId ? "Attached" : "Detached");
    } catch (e) { toast(e.message); }
  }

  function fit() {
    const all = [...state.people, ...state.externals];
    if (!all.length) { state.view = { x: 60, y: 40, k: 1 }; applyView(); return; }
    const minX = Math.min(...all.map((p) => p._x)), maxX = Math.max(...all.map((p) => p._x + W));
    const minY = Math.min(...all.map((p) => p._y)), maxY = Math.max(...all.map((p) => p._y + H));
    const r = el.stage.getBoundingClientRect();
    const k = Math.min(1.2, Math.max(.25, Math.min((r.width - 80) / (maxX - minX), (r.height - 120) / (maxY - minY))));
    state.view = { x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: 50 - minY * k, k };
    applyView();
  }
  el.fit.addEventListener("click", fit);

  el.arrange.addEventListener("click", async () => {
    if (!state.people.length) return;
    const pos = treeLayout(state.people);
    for (const p of state.people) { const q = pos.get(p.id); p._x = p.x = Math.round(q.x); p._y = p.y = Math.round(q.y); }
    layout(); render(); fit();
    try {
      await Promise.all(state.people.map((p) => api("PUT", `/api/collection/people/${p.id}/position`, { x: p.x, y: p.y })));
      toast("Arranged and saved for everyone");
    } catch (e) { toast(e.message); }
  });

  el.search.addEventListener("input", () => (isIncTab() ? renderIncidents() : render()));

  /* ---------- file panel ---------- */
  function closeFile() {
    state.selected = null; el.file.hidden = true; el.file.innerHTML = ""; el.body.classList.remove("has-file");
    if (!isIncTab() && state.people.length) render();
    if (state.incOpen !== null) { state.incOpen = null; if (isIncTab()) renderIncidents(); }
  }

  async function openPerson(id, mayBeElsewhere) {
    // A person in another organization: switch tab, then open.
    let d;
    try { d = await api("GET", `/api/collection/people/${id}`); } catch (e) { toast(e.message); return; }
    if (d.person.org_slug !== state.org.slug) {
      state.selected = id;
      await selectOrg(d.person.org_slug, true);
    }
    openFile(id, d);
  }

  async function openFile(id, pre) {
    let d = pre;
    if (!d) { try { d = await api("GET", `/api/collection/people/${id}`); } catch (e) { toast(e.message); return; } }
    state.selected = id;
    if (!isIncTab()) render();
    const p = d.person;
    const tierOpts = []; for (let t = p.tier; t <= 4; t++) tierOpts.push(`<option value="${t}">${TIER_LABEL[t]}</option>`);
    const stubHtml = (s, withTier) => s.bare
      ? `<span class="chip chip--red">Confidential</span>`
      : s.redacted
        ? `${esc(s.name)}${s.rank_name ? ` <span class="muted">· ${esc(s.rank_name)}</span>` : ""} <span class="chip chip--red">Confidential${withTier ? ` · Tier ${s.tier}` : ""}</span>`
        : `<a href="#" data-open="${s.id}">${esc(s.name)}</a>${withTier ? ` <span class="muted">· ${esc(s.rank_name || "")} ${esc(s.org_name)}</span>` : ""}`;
    el.file.innerHTML = `
      <div class="file">
        <div class="file__top">
          <div class="label label--red">Collection file · No. ${p.id}</div>
          <button class="file__close" type="button" aria-label="Close file" data-close>×</button>
        </div>
        <div class="file__id">
          ${p.portrait ? `<img class="file__portrait" src="${p.portrait}" alt="">` : `<div class="file__portrait file__portrait--empty">${esc((p.name || "?").trim()[0].toUpperCase())}</div>`}
          <div>
            <div class="file__name">${esc(p.name)}</div>
            <div class="file__rank">${esc(p.rank_name || p.rank_text || "Rank unknown")} · ${esc(p.org_name)}</div>
            ${p.title ? `<div class="file__title">${esc(p.title)}</div>` : ""}
          </div>
        </div>
        <div class="file__stamps">
          <span class="chip chip--ink">${esc(TIER_LABEL[p.tier] || "Tier " + p.tier)}</span>
          <span class="chip">${esc(p.compartment)}</span>
          <span class="chip ${p.status === "referred" ? "chip--red" : ""}">${esc(STATUS[p.status] || p.status)}</span>
          ${p.access === "open" ? `<span class="chip">Personnel record</span>${String(p.division || "").split(",").filter(Boolean).map((d) => `<span class="chip chip--red">${DIV_LABEL[d] || esc(d)}</span>`).join("") || `<span class="chip chip--muted">No division</span>`}` : `<span class="chip ${p.party_member === 1 ? "chip--red" : "chip--muted"}">${p.party_member === 1 ? "Party member" : p.party_member === 0 ? "Not in the Party" : "Party: unknown"}</span>`}
        </div>
        <dl class="file__dl">
          <dt>Reports to</dt><dd>${d.superior ? stubHtml(d.superior, true) + ` <button class="report__del" type="button" data-unsup>detach</button>` : "—"}</dd>
          <dt>Subordinates</dt><dd>${d.subordinates.length ? d.subordinates.map((s) => stubHtml(s, false) + (s.redacted ? "" : ` <button class="report__del" type="button" data-unsub="${s.id}">detach</button>`)).join(", ") : "—"}</dd>
          <dt>Opened</dt><dd>${fmtDate(p.created_at)}${p.created_by_name ? ` by ${esc(p.created_by_name)}` : ""}</dd>
          <dt>Last entry</dt><dd>${fmtDate(p.updated_at)}</dd>
        </dl>
        ${d.incidents && d.incidents.length ? `<h3>Incidents (${d.incidents.length})</h3><ul class="inc__links">${d.incidents.map((r) => `<li>${incLineHtml(r)}${r.role ? ` <span class="chip">${ROLE_LABEL[r.role] || esc(r.role)}</span>` : ""}</li>`).join("")}</ul>` : ""}
        <h3>${p.access === "open" ? "Service record" : "General information"}</h3>
        <div class="file__info">${p.info ? esc(p.info) : '<span class="muted">Nothing recorded yet.</span>'}</div>
        <div class="file__actions">
          <button class="btn btn--ghost btn--sm" type="button" data-edit>Edit file</button>
          ${d.can.delete ? `<button class="btn btn--ghost btn--sm" type="button" data-delete style="border-color:var(--red);color:var(--red)">Destroy file</button>` : ""}
        </div>
        <h3>Reports (${d.reports.length})</h3>
        ${d.withheld ? `<div class="file__hidden">${d.withheld} ${d.withheld === 1 ? "report" : "reports"} withheld · higher clearance required</div>` : ""}
        <form class="file__newreport" data-report>
          <input name="title" type="text" required maxlength="120" placeholder="Title of the report" class="file__reptitle">
          <textarea name="body" rows="3" required placeholder="What was seen or heard, when, where, and by whom."></textarea>
          <div class="row">
            <select name="severity" title="Severity">
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
            <select name="tier" title="Who may read this report">${tierOpts.join("")}</select>
            <button class="btn btn--red btn--sm" type="submit">File report</button>
          </div>
        </form>
        ${d.reports.length ? `<div class="file__sort"><span class="label">Sort</span>
          <select data-sort>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="severity">By severity</option>
          </select></div>` : ""}
        <div data-reports style="margin-top:10px">${d.reports.length ? "" : '<p class="muted" style="font-size:.95rem">No reports at your clearance.</p>'}</div>
      </div>`;
    el.file.hidden = false; el.body.classList.add("has-file");
    el.file.scrollTop = 0;

    $("[data-close]", el.file).addEventListener("click", closeFile);
    $("[data-edit]", el.file).addEventListener("click", () => openDialog(p));
    const del = $("[data-delete]", el.file);
    if (del) del.addEventListener("click", async () => {
      if (!confirm(`Destroy the file on ${p.name} and every report in it? This cannot be undone.`)) return;
      try { await api("DELETE", `/api/collection/people/${p.id}`); closeFile(); await load(); toast("File destroyed"); } catch (e) { toast(e.message); }
    });
    el.file.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openPerson(Number(a.dataset.open), true); }));
    el.file.querySelectorAll("[data-openinc]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openIncident(Number(a.dataset.openinc)); }));
    const unsup = $("[data-unsup]", el.file);
    if (unsup) unsup.addEventListener("click", () => { if (confirm(`Detach ${p.name} from their superior?`)) attachTo(p.id, null); });
    el.file.querySelectorAll("[data-unsub]").forEach((b) => b.addEventListener("click", () => { if (confirm("Detach this subordinate?")) attachTo(Number(b.dataset.unsub), null); }));
    $("[data-report]", el.file).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const r = await api("POST", `/api/collection/people/${p.id}/reports`, { title: f.title.value, severity: f.severity.value, body: f.body.value, tier: Number(f.tier.value) });
        if (!r.visible) toast("Filed above your clearance; you will not see it again");
        await openFile(p.id); await load();
      } catch (err) { toast(err.message); }
    });

    // Reports: collapsed to their title line, opened on click, sorted by the box above.
    const SEV_RANK = { severe: 0, moderate: 1, minor: 2 };
    const SEV_LABEL = { severe: "Severe", moderate: "Moderate", minor: "Minor" };
    const listEl = $("[data-reports]", el.file);
    const open = new Set();
    function renderReports(mode) {
      const list = [...d.reports];
      if (mode === "oldest") list.reverse();
      if (mode === "severity") list.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || b.id - a.id);
      listEl.innerHTML = list.map((r) => `
        <article class="report report--${r.severity || "minor"} ${open.has(r.id) ? "is-open" : ""}" data-rid="${r.id}">
          <button class="report__head" type="button" data-toggle="${r.id}" aria-expanded="${open.has(r.id)}">
            <span class="report__sev">${SEV_LABEL[r.severity] || "Minor"}</span>
            <span class="report__title">${esc(r.title || "Untitled report")}</span>
            <span class="report__when">${fmtDate(r.created_at)}</span>
            <span class="report__caret" aria-hidden="true">▾</span>
          </button>
          <div class="report__panel">
            <div class="report__meta"><span>${esc(r.author_name || "Unknown")} · ${fmtDate(r.created_at)}</span><span>T${r.tier}${(d.can.admin || r.author_id === d.can.me) ? ` · <button class="report__del" type="button" data-delreport="${r.id}">remove</button>` : ""}</span></div>
            <div class="report__body">${esc(r.body)}</div>
          </div>
        </article>`).join("");
      listEl.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
        const id = Number(b.dataset.toggle);
        const art = b.closest(".report");
        if (open.has(id)) { open.delete(id); art.classList.remove("is-open"); b.setAttribute("aria-expanded", "false"); }
        else { open.add(id); art.classList.add("is-open"); b.setAttribute("aria-expanded", "true"); }
      }));
      listEl.querySelectorAll("[data-delreport]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm("Remove this report?")) return;
        try { await api("DELETE", `/api/collection/reports/${b.dataset.delreport}`); await openFile(p.id); await load(); } catch (err) { toast(err.message); }
      }));
    }
    const sortSel = $("[data-sort]", el.file);
    if (d.reports.length) {
      const remembered = (() => { try { return localStorage.getItem("doc_report_sort") || "newest"; } catch { return "newest"; } })();
      sortSel.value = remembered;
      renderReports(remembered);
      sortSel.addEventListener("change", () => { try { localStorage.setItem("doc_report_sort", sortSel.value); } catch {} renderReports(sortSel.value); });
    }
    el.nodes.querySelectorAll(".node").forEach((n) => n.classList.toggle("is-selected", Number(n.dataset.id) === id));
  }

  /* ---------- new / edit dialog ---------- */
  function fillOrgSelect(selectedId) {
    el.pfOrg.innerHTML = state.all.map((o) => `<option value="${o.id}" ${o.id === selectedId ? "selected" : ""}>${esc(o.name)} · ${o.access === "open" ? "open to all" : esc(o.compartment)}${o.min_tier > 1 ? ` · T${o.min_tier}+` : ""}</option>`).join("");
  }
  function fillRankSelect(orgId, selectedId) {
    const o = state.all.find((x) => x.id === Number(orgId));
    let html = '<option value="">— none / unknown —</option>';
    if (o) {
      const groups = {};
      for (const r of o.ranks) (groups[r.band] = groups[r.band] || []).push(r);
      for (const band of ["head", "general", "officer", "nco", "enlisted"]) {
        if (!groups[band]) continue;
        html += `<optgroup label="${BAND[band]} · Tier ${groups[band][0].tier}">` + groups[band].map((r) => `<option value="${r.id}" ${r.id === selectedId ? "selected" : ""}>${esc(r.name)}</option>`).join("") + "</optgroup>";
      }
    }
    el.pfRank.innerHTML = html;
  }
  function fillTierSelect(current) {
    const o = state.all.find((x) => x.id === Number(el.pfOrg.value));
    const r = o && o.ranks.find((x) => x.id === Number(el.pfRank.value));
    const floor = r ? r.tier : 1;
    const want = Math.max(floor, current || floor);
    let html = "";
    for (let t = floor; t <= 4; t++) html += `<option value="${t}" ${t === want ? "selected" : ""}>${TIER_LABEL[t]}${t === floor ? " (from rank)" : ""}</option>`;
    el.pfTier.innerHTML = html;
  }
  // An open tab (the Party) holds the Department's own personnel: the form
  // reads like a service record rather than a case file.
  function applyFormMode(orgId, current) {
    const o = state.all.find((x) => x.id === Number(orgId));
    const staff = !!(o && o.access === "open");
    const list = staff ? STATUS_STAFF : STATUS_CASE;
    const want = list.includes(current) ? current : list[0];
    el.pfStatus.innerHTML = list.map((s) => `<option value="${s}" ${s === want ? "selected" : ""}>${STATUS[s]}</option>`).join("");
    $("#pfParty").hidden = staff;
    $("#pfTitleField").hidden = staff;
    $("#pfDivisionField").hidden = !staff;
    $("#pfInfoLabel").textContent = staff ? "Service record" : "General information";
    $("#pfInfo").placeholder = staff ? "Date sworn, postings, training, commendations, faults and lessons." : "Where seen, with whom, what said, what read. Entries record; they never accuse.";
    el.pfKicker.textContent = state.editing ? `Collection file · No. ${state.editing.id}` : (staff ? "Personnel record · the Party" : "New file");
    el.pfTitle.textContent = state.editing ? (staff ? "Amend the record" : "Amend the file") : (staff ? "Enter a member of the Department" : "Open a file");
    el.pfSave.textContent = state.editing ? "Save amendments" : (staff ? "Enter on the roll" : "Enter in the Collection");
  }
  el.pfOrg.addEventListener("change", () => { fillRankSelect(el.pfOrg.value, null); fillTierSelect(null); applyFormMode(el.pfOrg.value, el.form.status.value); });
  el.pfRank.addEventListener("change", () => fillTierSelect(null));

  function setSuperior(s) {
    if (s) { el.pfSupId.value = s.id; el.pfSupName.textContent = `${s.name} · ${s.rank_name || ""} ${s.org_name}`; el.pfSupChip.hidden = false; el.pfSupSearch.hidden = true; }
    else { el.pfSupId.value = ""; el.pfSupChip.hidden = true; el.pfSupSearch.hidden = false; }
    el.pfSupResults.hidden = true;
  }
  el.pfSupClear.addEventListener("click", () => setSuperior(null));
  let supTimer = null;
  el.pfSupSearch.addEventListener("input", () => {
    clearTimeout(supTimer);
    const q = el.pfSupSearch.value.trim();
    if (q.length < 2) { el.pfSupResults.hidden = true; return; }
    supTimer = setTimeout(async () => {
      try {
        const d = await api("GET", `/api/collection/search?q=${encodeURIComponent(q)}`);
        const results = d.results.filter((r) => !state.editing || r.id !== state.editing.id);
        el.pfSupResults.innerHTML = results.length ? results.map((r) => `<button type="button" data-id="${r.id}"><b>${esc(r.name)}</b><small>${esc(r.rank_name || "")} · ${esc(r.org_name)}</small></button>`).join("") : '<button type="button" disabled>No one by that name at your clearance</button>';
        el.pfSupResults.hidden = false;
        el.pfSupResults.querySelectorAll("button[data-id]").forEach((b) => b.addEventListener("click", () => setSuperior(results.find((r) => r.id === Number(b.dataset.id)))));
      } catch (e) { toast(e.message); }
    }, 250);
  });

  el.pfPortraitFile.addEventListener("change", async () => {
    const f = el.pfPortraitFile.files[0];
    if (!f) return;
    try {
      state.portrait = await shrinkImage(f, 360);
      el.pfPortraitPreview.src = state.portrait; el.pfPortraitPreview.hidden = false; el.pfPortraitClear.hidden = false;
    } catch { toast("Could not read that image"); }
  });
  el.pfPortraitClear.addEventListener("click", () => { state.portrait = null; el.pfPortraitPreview.hidden = true; el.pfPortraitClear.hidden = true; el.pfPortraitFile.value = ""; });

  function shrinkImage(file, max, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function openDialog(person) {
    state.editing = person || null; state.portrait = undefined;
    el.form.reset(); el.pfError.hidden = true;
    const orgId = person ? person.org_id : state.org.id;
    fillOrgSelect(orgId);
    fillRankSelect(orgId, person ? person.rank_id : null);
    fillTierSelect(person ? person.tier : null);
    applyFormMode(orgId, person ? person.status : null);
    if (person) {
      el.form.name.value = person.name || "";
      el.form.rank_text.value = person.rank_text || "";
      el.form.title.value = person.title || "";
      if (STATUS[person.status]) el.form.status.value = person.status;
      const divs = String(person.division || "").split(",").filter(Boolean);
      $("#pfDivision").value = divs.length >= 3 ? "all" : (divs[0] || "");
      el.form.info.value = person.info || "";
      el.form.party_member.value = person.party_member === 1 ? "1" : person.party_member === 0 ? "0" : "";
      el.pfPortraitPreview.hidden = !person.portrait; el.pfPortraitClear.hidden = !person.portrait;
      if (person.portrait) el.pfPortraitPreview.src = person.portrait;
    } else {
      el.pfPortraitPreview.hidden = true; el.pfPortraitClear.hidden = true;
      $("#pfDivision").value = "";
    }
    setSuperior(null);
    if (person && person.reports_to) {
      api("GET", `/api/collection/people/${person.id}`).then((d) => { if (d.superior) setSuperior(d.superior); }).catch(() => {});
    }
    el.dialog.showModal();
    setTimeout(() => el.form.name.focus(), 50);
  }
  el.newBtn.addEventListener("click", () => (isIncTab() ? openIncDialog(null) : openDialog(null)));
  el.pfCancel.addEventListener("click", () => el.dialog.close());

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = el.form;
    const staff = !$("#pfDivisionField").hidden;
    const divSel = $("#pfDivision").value;
    const body = {
      name: f.name.value, org_id: Number(f.org_id.value), rank_id: f.rank_id.value ? Number(f.rank_id.value) : null,
      rank_text: f.rank_text.value, title: staff ? "" : f.title.value, party_member: f.party_member.value === "" ? null : Number(f.party_member.value),
      status: f.status.value, tier: Number(f.tier.value), reports_to: f.reports_to.value ? Number(f.reports_to.value) : null, info: f.info.value,
      division: !staff ? [] : divSel === "all" ? ["government", "secret", "public"] : divSel ? [divSel] : [],
    };
    if (state.portrait !== undefined) body.portrait = state.portrait;
    el.pfSave.disabled = true;
    try {
      const r = state.editing ? await api("PUT", `/api/collection/people/${state.editing.id}`, body) : await api("POST", "/api/collection/people", body);
      el.dialog.close();
      const orgSlug = (state.all.find((o) => o.id === body.org_id) || {}).slug;
      if (!r.visible) { toast("Filed above your clearance; it is now hidden from you", 4500); closeFile(); await load(); }
      else if (orgSlug && orgSlug !== state.org.slug) { state.selected = r.id; await selectOrg(orgSlug, true); openFile(r.id); }
      else { await load(); openFile(r.id); }
    } catch (err) { el.pfError.textContent = err.message; el.pfError.hidden = false; }
    finally { el.pfSave.disabled = false; }
  });

  window.addEventListener("hashchange", () => {
    const parts = (location.hash || "").slice(1).split("/");
    const want = parts[0];
    if (want === "incidents") { if (!isIncTab()) selectOrg("incidents"); if (parts[1] && Number(parts[1]) !== state.incOpen) openIncident(Number(parts[1])); return; }
    if (want === "person" && parts[1]) { if (Number(parts[1]) !== state.selected) openPerson(Number(parts[1]), true); return; }
    if (want && state.org && want !== state.org.slug && state.orgs.some((o) => o.slug === want)) selectOrg(want);
  });

  /* ---------- incidents ---------- */
  const ie = {
    wrap: $("#incidents"), list: $("#incList"), sort: $("#incSort"),
    dialog: $("#incDialog"), form: $("#incForm"), tier: $("#ifTier"), officer: $("#ifOfficer"),
    error: $("#ifError"), cancel: $("#ifCancel"), save: $("#ifSave"), kicker: $("#ifKicker"), title: $("#ifTitle"),
  };
  const fmtDay = (s) => { if (!s) return "Date not given"; try { return new Date(s + "T12:00:00Z").toLocaleDateString(undefined, { dateStyle: "long" }); } catch { return s; } };

  async function members() {
    if (!state.members) { try { state.members = (await api("GET", "/api/members")).members; } catch { state.members = []; } }
    return state.members;
  }

  async function loadIncidents() {
    const d = await api("GET", "/api/collection/incidents");
    state.incidents = d.incidents;
    renderIncidents();
  }

  function sortedIncidents() {
    const q = el.search.value.trim().toLowerCase();
    const list = state.incidents.filter((i) => !q || (i.title || "").toLowerCase().includes(q) || (i.where_text || "").toLowerCase().includes(q));
    const mode = ie.sort.value;
    const newest = (a, b) => b.id - a.id;
    if (mode === "oldest") list.sort((a, b) => a.id - b.id);
    else if (mode === "occurred") list.sort((a, b) => String(b.occurred_on || "").localeCompare(String(a.occurred_on || "")) || newest(a, b));
    else if (mode === "severity") list.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || newest(a, b));
    else if (mode === "status") list.sort((a, b) => INC_STATUS_ORDER.indexOf(a.status) - INC_STATUS_ORDER.indexOf(b.status) || newest(a, b));
    else if (mode === "title") list.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    else list.sort(newest);
    return list;
  }

  function statusChip(i) {
    return `<span class="chip ${i.status === "closed" ? "chip--muted" : i.status === "referred" ? "chip--red" : ""}">${INC_STATUS[i.status] || esc(i.status)}</span>`;
  }

  function incCardHtml(i) {
    if (i.bare) return `<div class="inc inc--bare"><div class="inc__confidential">Confidential</div><div class="inc__sub">Outside your compartments</div></div>`;
    if (i.redacted) return `<div class="inc inc--redacted inc--${i.severity}">
      <div class="inc__head"><span class="report__sev">${SEV_LABEL[i.severity] || "Minor"}</span><span class="inc__title">${esc(i.title)}</span></div>
      <div class="inc__confidential">Confidential</div><div class="inc__sub">Tier ${i.tier} clearance required · ${esc(i.compartment)}</div></div>`;
    return `<button class="inc inc--${i.severity} ${state.incOpen === i.id ? "is-selected" : ""}" type="button" data-inc="${i.id}">
      <div class="inc__head"><span class="report__sev">${SEV_LABEL[i.severity] || "Minor"}</span><span class="inc__title">${esc(i.title)}</span>${statusChip(i)}</div>
      <div class="inc__meta">${esc(fmtDay(i.occurred_on))}${i.where_text ? ` · ${esc(i.where_text)}` : ""} · ${esc(i.compartment)} · T${i.tier}</div>
      ${i.summary ? `<p class="inc__summary">${esc(i.summary)}</p>` : ""}
      <div class="inc__foot"><span>${i.officer_name ? `Case officer · ${esc(i.officer_name)}` : "No case officer"}</span><span>${i.people_count} ${i.people_count === 1 ? "person" : "people"} · ${i.attachment_count} attached · ${i.link_count} linked</span></div>
    </button>`;
  }

  function renderIncidents() {
    const list = sortedIncidents();
    ie.list.innerHTML = list.length ? list.map(incCardHtml).join("") : `<div class="inc__none"><div class="label label--red">Nothing on file</div><p>No incident at your clearance. Open one to begin.</p></div>`;
    ie.list.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", () => openIncident(Number(b.dataset.inc))));
  }
  ie.sort.addEventListener("change", () => { try { localStorage.setItem("doc_inc_sort", ie.sort.value); } catch {} renderIncidents(); });
  try { ie.sort.value = localStorage.getItem("doc_inc_sort") || "newest"; } catch {}

  // One line about an incident, as shown on a person's card or as a related case.
  function incLineHtml(r) {
    if (r.bare) return `<span class="chip chip--red">Confidential</span>`;
    if (r.redacted) return `${esc(r.title)} <span class="chip chip--red">Confidential · Tier ${r.tier}</span>`;
    return `<a href="#" data-openinc="${r.id}">${esc(r.title)}</a> <span class="muted">· ${SEV_LABEL[r.severity] || "Minor"} · ${INC_STATUS[r.status] || esc(r.status)}</span>`;
  }

  function videoEmbed(url) {
    try {
      const u = new URL(url);
      let id = null, src = null;
      if (/(^|\.)youtube\.com$/.test(u.hostname)) id = u.searchParams.get("v") || (u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1];
      else if (u.hostname === "youtu.be") id = u.pathname.slice(1).split("/")[0];
      if (id && /^[\w-]{6,}$/.test(id)) src = `https://www.youtube-nocookie.com/embed/${id}`;
      else if (/(^|\.)vimeo\.com$/.test(u.hostname)) { const m = u.pathname.match(/\/(\d+)/); if (m) src = `https://player.vimeo.com/video/${m[1]}`; }
      return src ? `<div class="att__video"><iframe src="${src}" loading="lazy" allowfullscreen allow="encrypted-media; picture-in-picture" referrerpolicy="no-referrer"></iframe></div>` : "";
    } catch { return ""; }
  }

  // A search box that fills a results list: `fetcher(q)` returns items, `line(item)` renders one, `pick(item)` acts.
  function searchBox(input, results, fetcher, line, pick) {
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { results.hidden = true; return; }
      timer = setTimeout(async () => {
        try {
          const items = await fetcher(q);
          results.innerHTML = items.length ? items.map((it, n) => `<button type="button" data-n="${n}">${line(it)}</button>`).join("") : '<button type="button" disabled>Nothing by that name at your clearance</button>';
          results.hidden = false;
          results.querySelectorAll("button[data-n]").forEach((b) => b.addEventListener("click", () => { results.hidden = true; input.value = ""; pick(items[Number(b.dataset.n)]); }));
        } catch (e) { toast(e.message); }
      }, 250);
    });
  }

  async function openIncident(id) {
    let d;
    try { d = await api("GET", `/api/collection/incidents/${id}`); } catch (e) { toast(e.message); return; }
    if (!isIncTab()) { state.incOpen = id; await selectOrg("incidents", true); }
    state.incOpen = id;
    location.hash = `incidents/${id}`;
    renderIncidents();
    const i = d.incident;
    const mine = i.officer_id === d.can.me;
    const personHtml = (s) => s.bare ? `<span class="chip chip--red">Confidential</span>`
      : s.redacted ? `${esc(s.name)}${s.rank_name ? ` <span class="muted">· ${esc(s.rank_name)}</span>` : ""} <span class="chip chip--red">Confidential · Tier ${s.tier}</span>`
      : `<a href="#" class="mention" data-open="${s.id}">@${esc(s.name)}</a> <span class="muted">· ${esc(s.rank_name || "")} ${esc(s.org_name)}</span>`;
    const officerHtml = !i.officer_id ? "—"
      : (i.officer_person_id ? `<a href="#" class="mention" data-open="${i.officer_person_id}">@${esc(i.officer_name)}</a>` : esc(i.officer_name)) + (i.officer_rank ? ` <span class="muted">· ${esc(i.officer_rank)}</span>` : "");
    const attHtml = (a) => {
      const del = (d.can.admin || a.added_by === d.can.me || mine) ? `<button class="report__del" type="button" data-delatt="${a.id}">remove</button>` : "";
      if (a.kind === "image") return `<figure class="att att--image"><a href="/api/collection/attachments/${a.id}/image" target="_blank" rel="noopener"><img src="/api/collection/attachments/${a.id}/image" alt="${esc(a.title || "")}" loading="lazy"></a><figcaption>${esc(a.title || "Image")} <span class="muted">· ${esc(a.added_by_name || "")}</span> ${del}</figcaption></figure>`;
      return `<div class="att att--${a.kind}">${a.kind === "video" ? videoEmbed(a.url) : ""}<div class="att__line"><span class="chip">${a.kind === "video" ? "Video" : "Link"}</span><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title || a.url)}</a><span class="muted">· ${esc(a.added_by_name || "")}</span> ${del}</div></div>`;
    };
    el.file.innerHTML = `
      <div class="file">
        <div class="file__top">
          <div class="label label--red">Incident · No. ${i.id}</div>
          <button class="file__close" type="button" aria-label="Close incident" data-close>×</button>
        </div>
        <div class="file__name" style="margin-top:10px">${esc(i.title)}</div>
        <div class="file__stamps">
          <span class="chip ${i.severity === "severe" ? "chip--red" : i.severity === "moderate" ? "chip--ink" : ""}">${SEV_LABEL[i.severity] || "Minor"}</span>
          ${statusChip(i)}
          <span class="chip">${esc(i.compartment)}</span>
          <span class="chip chip--ink">${esc(TIER_LABEL[i.tier] || "Tier " + i.tier)}</span>
        </div>
        <dl class="file__dl">
          <dt>When</dt><dd>${esc(fmtDay(i.occurred_on))}</dd>
          <dt>Where</dt><dd>${i.where_text ? esc(i.where_text) : "—"}</dd>
          <dt>Case officer</dt><dd>${officerHtml}</dd>
          <dt>Opened</dt><dd>${fmtDate(i.created_at)}${i.created_by_name ? ` by ${esc(i.created_by_name)}` : ""}</dd>
          <dt>Last entry</dt><dd>${fmtDate(i.updated_at)}</dd>
        </dl>
        ${i.summary ? `<p class="file__summary">${esc(i.summary)}</p>` : ""}
        <h3>Account</h3>
        <div class="file__info">${i.body ? esc(i.body) : '<span class="muted">Nothing recorded yet.</span>'}</div>
        <div class="file__actions">
          <button class="btn btn--ghost btn--sm" type="button" data-edit>Amend</button>
          ${d.can.delete ? `<button class="btn btn--ghost btn--sm" type="button" data-delete style="border-color:var(--red);color:var(--red)">Destroy incident</button>` : ""}
        </div>
        <h3>People (${d.people.length})</h3>
        <ul class="inc__people">${d.people.map((s) => `<li>${personHtml(s)} <span class="chip">${ROLE_LABEL[s.role] || esc(s.role)}</span>${s.note ? ` <span class="muted">${esc(s.note)}</span>` : ""}<button class="report__del" type="button" data-detach="${s.id}">remove</button></li>`).join("") || '<li class="muted">No one attached yet.</li>'}</ul>
        <form class="inc__attach" data-attach>
          <div class="row">
            <div class="pf__sup"><input type="search" data-psearch placeholder="Attach a person: search by name…" autocomplete="off"><div class="pf__results" data-presults hidden></div></div>
            <select name="role">${Object.entries(ROLE_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
          </div>
          <div class="row"><input type="text" name="note" class="grow" maxlength="300" placeholder="Note on their part (optional)"><span class="muted" style="font-size:.85rem">Pick a name from the search to attach.</span></div>
        </form>
        <h3>Linked incidents (${d.related.length})</h3>
        <ul class="inc__links">${d.related.map((r) => `<li>${incLineHtml(r)}${!r.redacted ? `<button class="report__del" type="button" data-unlink="${r.id}">unlink</button>` : ""}</li>`).join("") || '<li class="muted">None linked.</li>'}</ul>
        <div class="inc__attach"><div class="pf__sup"><input type="search" data-isearch placeholder="Link an incident: search by title…" autocomplete="off"><div class="pf__results" data-iresults hidden></div></div></div>
        <h3>Attachments (${d.attachments.length})</h3>
        <div class="inc__atts">${d.attachments.map(attHtml).join("") || '<p class="muted" style="font-size:.95rem">Nothing attached yet.</p>'}</div>
        <form class="inc__attach" data-newatt>
          <div class="row">
            <select name="kind"><option value="image">Image</option><option value="video">Video link</option><option value="link">Link or paper</option></select>
            <input type="text" name="title" class="grow" maxlength="140" placeholder="Caption or title">
          </div>
          <div class="row">
            <input type="file" name="file" accept="image/*" data-attfile>
            <input type="url" name="url" class="grow" placeholder="https://…" data-atturl hidden>
            <button class="btn btn--red btn--sm" type="submit">Add</button>
          </div>
        </form>
      </div>`;
    el.file.hidden = false; el.body.classList.add("has-file");
    el.file.scrollTop = 0;

    const reopen = async () => { await openIncident(i.id); await loadIncidents(); };
    $("[data-close]", el.file).addEventListener("click", closeFile);
    $("[data-edit]", el.file).addEventListener("click", () => openIncDialog(i));
    const del = $("[data-delete]", el.file);
    if (del) del.addEventListener("click", async () => {
      if (!confirm(`Destroy the incident "${i.title}" with everything attached to it? This cannot be undone.`)) return;
      try { await api("DELETE", `/api/collection/incidents/${i.id}`); closeFile(); await loadIncidents(); toast("Incident destroyed"); } catch (e) { toast(e.message); }
    });
    el.file.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openPerson(Number(a.dataset.open), true); }));
    el.file.querySelectorAll("[data-openinc]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openIncident(Number(a.dataset.openinc)); }));
    el.file.querySelectorAll("[data-detach]").forEach((b) => b.addEventListener("click", async () => {
      try { await api("DELETE", `/api/collection/incidents/${i.id}/people/${b.dataset.detach}`); await reopen(); } catch (e) { toast(e.message); }
    }));
    el.file.querySelectorAll("[data-unlink]").forEach((b) => b.addEventListener("click", async () => {
      try { await api("DELETE", `/api/collection/incidents/${i.id}/links/${b.dataset.unlink}`); await reopen(); } catch (e) { toast(e.message); }
    }));
    el.file.querySelectorAll("[data-delatt]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Remove this attachment?")) return;
      try { await api("DELETE", `/api/collection/attachments/${b.dataset.delatt}`); await reopen(); } catch (e) { toast(e.message); }
    }));

    const attach = $("[data-attach]", el.file);
    attach.addEventListener("submit", (e) => e.preventDefault());
    searchBox($("[data-psearch]", el.file), $("[data-presults]", el.file),
      async (q) => (await api("GET", `/api/collection/search?q=${encodeURIComponent(q)}`)).results,
      (r) => `<b>${esc(r.name)}</b><small>${esc(r.rank_name || "")} · ${esc(r.org_name)}</small>`,
      async (r) => { try { await api("POST", `/api/collection/incidents/${i.id}/people`, { person_id: r.id, role: attach.role.value, note: attach.note.value }); await reopen(); } catch (e) { toast(e.message); } });
    searchBox($("[data-isearch]", el.file), $("[data-iresults]", el.file),
      async (q) => (await api("GET", `/api/collection/incidents?q=${encodeURIComponent(q)}`)).incidents.filter((x) => !x.redacted && x.id !== i.id),
      (r) => `<b>${esc(r.title)}</b><small>${SEV_LABEL[r.severity] || "Minor"} · ${esc(fmtDay(r.occurred_on))}</small>`,
      async (r) => { try { await api("POST", `/api/collection/incidents/${i.id}/links`, { incident_id: r.id }); await reopen(); } catch (e) { toast(e.message); } });

    const na = $("[data-newatt]", el.file);
    const syncKind = () => { const img = na.kind.value === "image"; $("[data-attfile]", na).hidden = !img; $("[data-atturl]", na).hidden = img; };
    na.kind.addEventListener("change", syncKind); syncKind();
    na.addEventListener("submit", async (e) => {
      e.preventDefault();
      const kind = na.kind.value;
      const body = { kind, title: na.title.value };
      try {
        if (kind === "image") {
          const f = na.file.files[0];
          if (!f) { toast("Choose an image first"); return; }
          body.data = await shrinkImage(f, 1600, 0.85);
        } else body.url = na.url.value;
        await api("POST", `/api/collection/incidents/${i.id}/attachments`, body);
        await reopen();
      } catch (err) { toast(err.message); }
    });
  }

  /* ---------- incident dialog ---------- */
  async function openIncDialog(incident) {
    state.incEditing = incident || null;
    ie.form.reset(); ie.error.hidden = true;
    ie.tier.innerHTML = [1, 2, 3, 4].map((t) => `<option value="${t}">${TIER_LABEL[t]}</option>`).join("");
    const list = await members();
    ie.officer.innerHTML = '<option value="">— none assigned —</option>' + list.map((m) => `<option value="${m.id}">${esc(m.name)}${m.rank ? ` · ${esc(m.rank)}` : ""}</option>`).join("");
    ie.kicker.textContent = incident ? `Incident · No. ${incident.id}` : "New incident";
    ie.title.textContent = incident ? "Amend the incident" : "Open an incident";
    ie.save.textContent = incident ? "Save amendments" : "Open the incident";
    const f = ie.form;
    if (incident) {
      f.title.value = incident.title || ""; f.severity.value = incident.severity || "minor"; f.status.value = incident.status || "open";
      f.occurred_on.value = incident.occurred_on || ""; f.where_text.value = incident.where_text || "";
      f.compartment.value = incident.compartment || "public"; f.tier.value = String(incident.tier || 1);
      f.officer_id.value = incident.officer_id ? String(incident.officer_id) : "";
      f.summary.value = incident.summary || ""; f.body.value = incident.body || "";
    } else if (window.DOC_ME && window.DOC_ME.id) f.officer_id.value = String(window.DOC_ME.id);
    ie.dialog.showModal();
    setTimeout(() => f.title.focus(), 50);
  }
  ie.cancel.addEventListener("click", () => ie.dialog.close());
  ie.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = ie.form;
    const body = {
      title: f.title.value, severity: f.severity.value, status: f.status.value, occurred_on: f.occurred_on.value || null, where_text: f.where_text.value,
      compartment: f.compartment.value, tier: Number(f.tier.value), officer_id: f.officer_id.value ? Number(f.officer_id.value) : null,
      summary: f.summary.value, body: f.body.value,
    };
    ie.save.disabled = true;
    try {
      const r = state.incEditing ? await api("PUT", `/api/collection/incidents/${state.incEditing.id}`, body) : await api("POST", "/api/collection/incidents", body);
      ie.dialog.close();
      if (!r.visible) { toast("Filed above your clearance; it is now hidden from you", 4500); closeFile(); await loadIncidents(); }
      else { await loadIncidents(); await openIncident(r.id); }
    } catch (err) { ie.error.textContent = err.message; ie.error.hidden = false; }
    finally { ie.save.disabled = false; }
  });

  /* ---------- boot ---------- */
  (async function boot() {
    try {
      const d = await api("GET", "/api/collection/orgs");
      state.orgs = d.orgs; state.all = d.all;
      if (!state.orgs.length) { el.empty.hidden = false; $("p", el.empty).textContent = "You hold no clearance in any compartment. Ask an admin."; return; }
      const parts = (location.hash || "").slice(1).split("/");
      const want = parts[0];
      if (want === "incidents") { await selectOrg("incidents"); if (parts[1]) openIncident(Number(parts[1])); }
      else if (want === "person" && parts[1]) { await selectOrg(state.orgs[0].slug); openPerson(Number(parts[1]), true); }
      else {
        await selectOrg(state.orgs.some((o) => o.slug === want) ? want : state.orgs[0].slug);
        if (parts[1] && /^\d+$/.test(parts[1])) openPerson(Number(parts[1]), true);
      }
    } catch (e) { toast(e.message, 6000); }
  })();
})();
