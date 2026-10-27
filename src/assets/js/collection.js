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
  };

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
  }

  async function selectOrg(slug, keepFile) {
    const o = state.orgs.find((x) => x.slug === slug) || state.orgs[0];
    if (!o) return;
    state.org = o;
    if (!keepFile) closeFile();
    location.hash = o.slug;
    renderTabs();
    await load();
  }

  /* ---------- data ---------- */
  async function load() {
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
      const path = mk("path", { class: "link" + (ext ? " link--ext" : ""), d: linkPath(sup, p), "data-from": sup.id, "data-to": p.id });
      el.links.appendChild(path);
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
    } else {
      g.appendChild(mk("text", { class: "node__name", x: 14, y: 24 }, trunc(p.name, 24)));
      g.appendChild(mk("text", { class: "node__rank", x: 14, y: 42 }, trunc(`${p.rank_name || ""} · ${p.org_name}`, 34)));
    }
    return g;
  }

  /* ---------- pan, zoom, drag ---------- */
  let drag = null;
  el.chart.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const node = e.target.closest(".node");
    el.chart.setPointerCapture(e.pointerId);
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
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
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

  el.search.addEventListener("input", render);

  /* ---------- file panel ---------- */
  function closeFile() {
    state.selected = null; el.file.hidden = true; el.file.innerHTML = ""; el.body.classList.remove("has-file");
    el.nodes.querySelectorAll(".is-selected").forEach((n) => n.classList.remove("is-selected"));
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
    el.nodes.querySelectorAll(".node").forEach((n) => n.classList.toggle("is-selected", Number(n.dataset.id) === id));
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
          <dt>Reports to</dt><dd>${d.superior ? stubHtml(d.superior, true) : "—"}</dd>
          <dt>Subordinates</dt><dd>${d.subordinates.length ? d.subordinates.map((s) => stubHtml(s, false)).join(", ") : "—"}</dd>
          <dt>Opened</dt><dd>${fmtDate(p.created_at)}${p.created_by_name ? ` by ${esc(p.created_by_name)}` : ""}</dd>
          <dt>Last entry</dt><dd>${fmtDate(p.updated_at)}</dd>
        </dl>
        <h3>${p.access === "open" ? "Service record" : "General information"}</h3>
        <div class="file__info">${p.info ? esc(p.info) : '<span class="muted">Nothing recorded yet.</span>'}</div>
        <div class="file__actions">
          <button class="btn btn--ghost btn--sm" type="button" data-edit>Edit file</button>
          ${d.can.delete ? `<button class="btn btn--ghost btn--sm" type="button" data-delete style="border-color:var(--red);color:var(--red)">Destroy file</button>` : ""}
        </div>
        <h3>Reports (${d.reports.length})</h3>
        ${d.withheld ? `<div class="file__hidden">${d.withheld} ${d.withheld === 1 ? "report" : "reports"} withheld · higher clearance required</div>` : ""}
        <form class="file__newreport" data-report>
          <textarea name="body" rows="3" required placeholder="What was seen or heard, when, where, and by whom."></textarea>
          <div class="row">
            <select name="tier" title="Who may read this report">${tierOpts.join("")}</select>
            <button class="btn btn--red btn--sm" type="submit">File report</button>
          </div>
        </form>
        <div style="margin-top:14px">
          ${d.reports.map((r) => `
            <article class="report">
              <div class="report__meta"><span>${esc(r.author_name || "Unknown")} · ${fmtDate(r.created_at)}</span><span>T${r.tier}${(d.can.admin || r.author_id === d.can.me) ? ` · <button class="report__del" type="button" data-delreport="${r.id}">remove</button>` : ""}</span></div>
              <div class="report__body">${esc(r.body)}</div>
            </article>`).join("") || '<p class="muted" style="font-size:.95rem">No reports at your clearance.</p>'}
        </div>
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
    $("[data-report]", el.file).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const r = await api("POST", `/api/collection/people/${p.id}/reports`, { body: f.body.value, tier: Number(f.tier.value) });
        if (!r.visible) toast("Filed above your clearance; you will not see it again");
        await openFile(p.id); await load();
      } catch (err) { toast(err.message); }
    });
    el.file.querySelectorAll("[data-delreport]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Remove this report?")) return;
      try { await api("DELETE", `/api/collection/reports/${b.dataset.delreport}`); await openFile(p.id); await load(); } catch (err) { toast(err.message); }
    }));
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

  function shrinkImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
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
  el.newBtn.addEventListener("click", () => openDialog(null));
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
    const want = (location.hash || "").slice(1).split("/")[0];
    if (want && state.org && want !== state.org.slug && state.orgs.some((o) => o.slug === want)) selectOrg(want);
  });

  /* ---------- boot ---------- */
  (async function boot() {
    try {
      const d = await api("GET", "/api/collection/orgs");
      state.orgs = d.orgs; state.all = d.all;
      if (!state.orgs.length) { el.empty.hidden = false; $("p", el.empty).textContent = "You hold no clearance in any compartment. Ask an admin."; return; }
      const want = (location.hash || "").slice(1).split("/")[0];
      await selectOrg(state.orgs.some((o) => o.slug === want) ? want : state.orgs[0].slug);
    } catch (e) { toast(e.message, 6000); }
  })();
})();
