/* The Wire: rooms, private rooms, @-names, polling. */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtTime = (s) => { try { const d = new Date(s.replace(" ", "T") + "Z"); const today = new Date().toDateString() === d.toDateString(); return today ? d.toLocaleTimeString(undefined, { timeStyle: "short" }) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return s; } };

  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`);
    return data;
  }
  const toastEl = $("#toast");
  function toast(msg, ms = 3000) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastEl._h); toastEl._h = setTimeout(() => { toastEl.hidden = true; }, ms); }

  const el = {
    rooms: $("#roomList"), dms: $("#dmList"), log: $("#log"), name: $("#roomName"), kind: $("#roomKind"), with: $("#roomWith"),
    compose: $("#compose"), body: $("#body"), send: $("#send"), closed: $("#closed"), older: $("#older"), mentions: $("#mentions"),
    newDm: $("#newDm"), dmDialog: $("#dmDialog"), dmSearch: $("#dmSearch"), dmMembers: $("#dmMembers"), dmCancel: $("#dmCancel"),
  };
  const state = { me: null, members: [], rooms: [], room: null, lastId: 0, firstId: 0, pollTimer: null, roomsTimer: null, picked: new Map(), menu: null };
  const KIND = { announcements: "The Office to the Department", everyone: "Every member", division: "Division room", dm: "Private room" };

  /* ---------- @-names ---------- */
  // A message stores a name as @[Name](u:<user id>) or @[Name](p:<person id>).
  const TOKEN = /@\[([^\]\n]{1,80})\]\((u|p):(\d+)\)/g;
  function cardLink(kind, id) {
    if (kind === "p") return `/department/collection/#person/${id}`;
    const m = state.members.find((x) => x.id === Number(id));
    return m && m.person_id ? `/department/collection/#person/${m.person_id}` : null;
  }
  function bodyHtml(body) {
    let out = "", last = 0;
    for (const m of body.matchAll(TOKEN)) {
      out += esc(body.slice(last, m.index));
      const [, name, kind, id] = m;
      const href = cardLink(kind, id);
      out += href ? `<a class="mention" href="${href}">@${esc(name)}</a>` : `<span class="mention mention--plain">@${esc(name)}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(body.slice(last));
  }
  const mentionsMe = (body) => !!state.me && body.includes(`(u:${state.me.id})`);

  /* ---------- rooms ---------- */
  function roomButton(r) {
    const sub = r.kind === "dm" && r.other && r.other.rank ? `<small>${esc(r.other.rank)}</small>` : "";
    return `<button class="wire__room ${state.room && state.room.id === r.id ? "is-current" : ""}" type="button" data-room="${r.id}">
      <span>${esc(r.name)}${sub}</span>${r.unread ? `<b class="wire__badge">${r.unread}</b>` : ""}
    </button>`;
  }
  function renderRooms() {
    const shared = state.rooms.filter((r) => r.kind !== "dm"), dms = state.rooms.filter((r) => r.kind === "dm");
    el.rooms.innerHTML = shared.map(roomButton).join("");
    el.dms.innerHTML = dms.length ? dms.map(roomButton).join("") : '<p class="wire__none typewriter">No private rooms yet.</p>';
    document.querySelectorAll("[data-room]").forEach((b) => b.addEventListener("click", () => openRoom(b.dataset.room)));
    const total = state.rooms.reduce((s, r) => s + r.unread, 0);
    document.title = (total ? `(${total}) ` : "") + "The Wire · Department of Culture";
  }
  async function refreshRooms() {
    try { const d = await api("GET", "/api/chat/rooms"); state.rooms = d.rooms; renderRooms(); } catch {}
  }

  /* ---------- messages ---------- */
  function messageHtml(m) {
    if (m.deleted) return `<div class="msg msg--deleted" data-id="${m.id}"><span class="typewriter">message removed</span></div>`;
    return `<div class="msg ${m.mine ? "msg--mine" : ""} ${mentionsMe(m.body) ? "msg--named" : ""}" data-id="${m.id}">
      <div class="msg__meta"><b>${esc(m.author_rank || "")}${m.author_rank ? " · " : ""}${esc(m.author_name)}</b><span>${fmtTime(m.created_at)}</span>${m.canDelete ? `<button class="msg__del" type="button" data-del="${m.id}" title="Remove">×</button>` : ""}</div>
      <div class="msg__body">${bodyHtml(m.body)}</div>
    </div>`;
  }
  function wireDeletes(scope) {
    scope.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Remove this message?")) return;
      try { await api("DELETE", `/api/chat/messages/${b.dataset.del}`); const node = b.closest(".msg"); node.outerHTML = `<div class="msg msg--deleted"><span class="typewriter">message removed</span></div>`; } catch (e) { toast(e.message); }
    }));
  }
  function atBottom() { return el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 60; }

  async function openRoom(id) {
    const r = state.rooms.find((x) => x.id === id) || state.rooms[0];
    if (!r) return;
    state.room = r; state.lastId = 0; state.firstId = 0;
    location.hash = r.id;
    renderRooms();
    el.name.textContent = r.name; el.kind.textContent = KIND[r.kind] || "Room";
    if (r.kind === "dm" && r.other) {
      const href = r.other.person_id ? `/department/collection/#person/${r.other.person_id}` : null;
      el.with.innerHTML = `Between you and ${href ? `<a class="mention" href="${href}">@${esc(r.other.name)}</a>` : esc(r.other.name)}${r.other.rank ? ` · ${esc(r.other.rank)}` : ""} · read by no one else`;
      el.with.hidden = false;
    } else el.with.hidden = true;
    el.compose.hidden = !r.canPost; el.closed.hidden = r.canPost;
    el.body.placeholder = r.kind === "dm" ? `Write privately to ${r.name}…` : "Write to the room… (@ to name someone)";
    el.log.innerHTML = '<p class="muted">Opening…</p>';
    try {
      const d = await api("GET", `/api/chat/rooms/${r.id}`);
      el.log.innerHTML = d.messages.length ? d.messages.map(messageHtml).join("") : '<p class="muted wire__empty">Nothing on the Wire here yet.</p>';
      wireDeletes(el.log);
      if (d.messages.length) { state.lastId = d.messages[d.messages.length - 1].id; state.firstId = d.messages[0].id; }
      el.older.hidden = d.messages.length < 100;
      el.log.scrollTop = el.log.scrollHeight;
      await markRead();
    } catch (e) { el.log.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
    schedulePoll();
  }

  async function markRead() {
    if (!state.room || !state.lastId) return;
    try { await api("POST", `/api/chat/rooms/${state.room.id}/read`, { last: state.lastId }); } catch {}
    const r = state.rooms.find((x) => x.id === state.room.id); if (r) { r.unread = 0; renderRooms(); }
  }

  async function poll() {
    if (!state.room) return;
    try {
      const d = await api("GET", `/api/chat/rooms/${state.room.id}?after=${state.lastId}`);
      if (d.messages.length) {
        const stick = atBottom();
        const empty = $(".wire__empty", el.log); if (empty) empty.remove();
        const frag = document.createElement("div"); frag.innerHTML = d.messages.map(messageHtml).join("");
        wireDeletes(frag);
        while (frag.firstChild) el.log.appendChild(frag.firstChild);
        state.lastId = d.messages[d.messages.length - 1].id;
        if (stick) el.log.scrollTop = el.log.scrollHeight;
        if (document.visibilityState === "visible") await markRead();
      }
    } catch {}
    schedulePoll();
  }
  function schedulePoll() { clearTimeout(state.pollTimer); state.pollTimer = setTimeout(poll, document.visibilityState === "visible" ? 4000 : 20000); }

  el.older.addEventListener("click", async () => {
    if (!state.room || !state.firstId) return;
    try {
      const d = await api("GET", `/api/chat/rooms/${state.room.id}/older?before=${state.firstId}`);
      if (!d.messages.length) { el.older.hidden = true; return; }
      const h = el.log.scrollHeight;
      el.log.insertAdjacentHTML("afterbegin", d.messages.map(messageHtml).join(""));
      wireDeletes(el.log);
      state.firstId = d.messages[0].id;
      el.log.scrollTop = el.log.scrollHeight - h;
      el.older.hidden = d.messages.length < 100;
    } catch (e) { toast(e.message); }
  });

  /* ---------- compose, with @-name completion ---------- */
  // The word being typed after an @, if the caret sits in one. Names may hold one space.
  function mentionAt() {
    const v = el.body.value, c = el.body.selectionStart;
    const m = v.slice(0, c).match(/(?:^|\s)@([^\s@]{0,40}(?: [^\s@]{0,40})?)$/);
    return m ? { q: m[1], start: c - m[1].length - 1, end: c } : null;
  }
  let menuTimer = null, menuSeq = 0;
  async function updateMenu() {
    const at = mentionAt();
    if (!at) { hideMenu(); return; }
    const q = at.q.toLowerCase();
    const items = state.members.filter((m) => !q || m.name.toLowerCase().includes(q)).slice(0, 8)
      .map((m) => ({ name: m.name, sub: m.rank || "Member of the Department", token: `@[${m.name}](u:${m.id})` }));
    const seq = ++menuSeq;
    showMenu(items, at);
    if (q.length >= 2) {
      clearTimeout(menuTimer);
      menuTimer = setTimeout(async () => {
        try {
          const d = await api("GET", `/api/collection/search?q=${encodeURIComponent(at.q)}`);
          if (seq !== menuSeq) return;
          const files = d.results.slice(0, 6).map((p) => ({ name: p.name, sub: `${p.rank_name || ""} · ${p.org_name} · file`, token: `@[${p.name}](p:${p.id})` }));
          showMenu([...items, ...files.filter((f) => !items.some((i) => i.token === f.token))], at);
        } catch {}
      }, 200);
    }
  }
  function showMenu(items, at) {
    if (!items.length) { hideMenu(); return; }
    state.menu = { items, at, index: 0 };
    el.mentions.innerHTML = items.map((it, n) => `<button type="button" data-n="${n}" class="${n === 0 ? "is-active" : ""}"><b>@${esc(it.name)}</b><small>${esc(it.sub)}</small></button>`).join("");
    el.mentions.hidden = false;
    el.mentions.querySelectorAll("[data-n]").forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); pickMention(Number(b.dataset.n)); }));
  }
  function hideMenu() { state.menu = null; el.mentions.hidden = true; el.mentions.innerHTML = ""; }
  function pickMention(n) {
    const menu = state.menu; if (!menu) return;
    const it = menu.items[n]; if (!it) return;
    const v = el.body.value;
    const before = v.slice(0, menu.at.start), after = v.slice(menu.at.end);
    el.body.value = `${before}@${it.name} ${after}`;
    const pos = before.length + it.name.length + 2;
    el.body.setSelectionRange(pos, pos);
    state.picked.set(it.name, it.token);
    hideMenu();
    el.body.focus();
  }
  // Names picked from the menu become tokens; anything typed by hand stays plain text.
  function withTokens(text) {
    const names = [...state.picked.keys()].sort((a, b) => b.length - a.length);
    for (const name of names) text = text.split(`@${name}`).join(state.picked.get(name));
    return text;
  }
  el.body.addEventListener("input", updateMenu);
  el.body.addEventListener("click", updateMenu);
  el.body.addEventListener("blur", () => setTimeout(hideMenu, 150));
  el.body.addEventListener("keydown", (e) => {
    const menu = state.menu;
    if (menu) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        menu.index = (menu.index + (e.key === "ArrowDown" ? 1 : menu.items.length - 1)) % menu.items.length;
        el.mentions.querySelectorAll("[data-n]").forEach((b, n) => b.classList.toggle("is-active", n === menu.index));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(menu.index); return; }
      if (e.key === "Escape") { e.preventDefault(); hideMenu(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.compose.requestSubmit(); }
  });

  el.compose.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = el.body.value.trim();
    if (!text || !state.room) return;
    el.send.disabled = true;
    try {
      await api("POST", `/api/chat/rooms/${state.room.id}`, { body: withTokens(text) });
      el.body.value = ""; state.picked.clear(); hideMenu();
      clearTimeout(state.pollTimer); await poll();
      if (state.room.kind === "dm") refreshRooms();
    }
    catch (err) { toast(err.message); }
    finally { el.send.disabled = false; el.body.focus(); }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { clearTimeout(state.pollTimer); poll(); markRead(); } });

  /* ---------- private rooms ---------- */
  function renderMembers() {
    const q = el.dmSearch.value.trim().toLowerCase();
    const list = state.members.filter((m) => state.me && m.id !== state.me.id && (!q || m.name.toLowerCase().includes(q) || (m.rank || "").toLowerCase().includes(q)));
    el.dmMembers.innerHTML = list.length ? list.map((m) => `<button type="button" data-user="${m.id}"><b>${esc(m.name)}</b><small>${esc(m.rank || "Member of the Department")}</small></button>`).join("") : '<p class="muted">No one by that name on the roll.</p>';
    el.dmMembers.querySelectorAll("[data-user]").forEach((b) => b.addEventListener("click", async () => {
      try {
        const d = await api("POST", "/api/chat/dm", { user_id: Number(b.dataset.user) });
        el.dmDialog.close();
        await refreshRooms();
        await openRoom(d.room);
      } catch (e) { toast(e.message); }
    }));
  }
  el.newDm.addEventListener("click", () => { el.dmSearch.value = ""; renderMembers(); el.dmDialog.showModal(); setTimeout(() => el.dmSearch.focus(), 50); });
  el.dmSearch.addEventListener("input", renderMembers);
  el.dmCancel.addEventListener("click", () => el.dmDialog.close());

  /* ---------- boot ---------- */
  (async function boot() {
    try {
      const [me, mem, d] = await Promise.all([api("GET", "/api/me"), api("GET", "/api/members"), api("GET", "/api/chat/rooms")]);
      state.me = me; state.members = mem.members; state.rooms = d.rooms;
      const want = (location.hash || "").slice(1);
      await openRoom(state.rooms.some((r) => r.id === want) ? want : "everyone");
      state.roomsTimer = setInterval(refreshRooms, 15000);
    } catch (e) { el.log.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  })();
})();
