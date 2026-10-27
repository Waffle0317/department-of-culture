/* The Wire: rooms, messages, polling. */
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

  const el = { rooms: $("#roomList"), log: $("#log"), name: $("#roomName"), kind: $("#roomKind"), compose: $("#compose"), body: $("#body"), send: $("#send"), closed: $("#closed"), older: $("#older") };
  const state = { rooms: [], room: null, lastId: 0, firstId: 0, pollTimer: null, roomsTimer: null };
  const KIND = { announcements: "The Office to the Department", everyone: "Every member", division: "Division room" };

  /* ---------- rooms ---------- */
  function renderRooms() {
    el.rooms.innerHTML = state.rooms.map((r) => `
      <button class="wire__room ${state.room && state.room.id === r.id ? "is-current" : ""}" type="button" data-room="${r.id}">
        <span>${esc(r.name)}</span>${r.unread ? `<b class="wire__badge">${r.unread}</b>` : ""}
      </button>`).join("");
    el.rooms.querySelectorAll("[data-room]").forEach((b) => b.addEventListener("click", () => openRoom(b.dataset.room)));
    const total = state.rooms.reduce((s, r) => s + r.unread, 0);
    document.title = (total ? `(${total}) ` : "") + "The Wire · Department of Culture";
  }
  async function refreshRooms() {
    try { const d = await api("GET", "/api/chat/rooms"); state.rooms = d.rooms; renderRooms(); } catch {}
  }

  /* ---------- messages ---------- */
  function messageHtml(m) {
    if (m.deleted) return `<div class="msg msg--deleted" data-id="${m.id}"><span class="typewriter">message removed</span></div>`;
    return `<div class="msg ${m.mine ? "msg--mine" : ""}" data-id="${m.id}">
      <div class="msg__meta"><b>${esc(m.author_rank || "")}${m.author_rank ? " · " : ""}${esc(m.author_name)}</b><span>${fmtTime(m.created_at)}</span>${m.canDelete ? `<button class="msg__del" type="button" data-del="${m.id}" title="Remove">×</button>` : ""}</div>
      <div class="msg__body">${esc(m.body)}</div>
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
    el.compose.hidden = !r.canPost; el.closed.hidden = r.canPost;
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

  /* ---------- compose ---------- */
  el.compose.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = el.body.value.trim();
    if (!text || !state.room) return;
    el.send.disabled = true;
    try { await api("POST", `/api/chat/rooms/${state.room.id}`, { body: text }); el.body.value = ""; clearTimeout(state.pollTimer); await poll(); }
    catch (err) { toast(err.message); }
    finally { el.send.disabled = false; el.body.focus(); }
  });
  el.body.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.compose.requestSubmit(); } });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { clearTimeout(state.pollTimer); poll(); markRead(); } });

  /* ---------- boot ---------- */
  (async function boot() {
    try {
      const d = await api("GET", "/api/chat/rooms");
      state.rooms = d.rooms;
      const want = (location.hash || "").slice(1);
      await openRoom(state.rooms.some((r) => r.id === want) ? want : "everyone");
      state.roomsTimer = setInterval(refreshRooms, 15000);
    } catch (e) { el.log.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  })();
})();
