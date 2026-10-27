/* The People's Notes: reading room for Box 70. */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (s) => { try { return new Date(s.replace(" ", "T") + "Z").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return s; } };

  async function api(method, url) {
    const r = await fetch(url, { method, credentials: "same-origin" });
    let data = null; try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`);
    return data;
  }
  const toastEl = $("#toast");
  function toast(msg, ms = 3000) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastEl._h); toastEl._h = setTimeout(() => { toastEl.hidden = true; }, ms); }

  const list = $("#notesList"), count = $("#notesCount"), rules = $("#notesRules");

  function field(label, value) {
    return value ? `<div class="note__field"><dt>${label}</dt><dd>${esc(value)}</dd></div>` : "";
  }

  function render(d) {
    const notes = d.notes;
    count.textContent = `${notes.length} ${notes.length === 1 ? "note" : "notes"} · your clearance: Tier ${d.tier}`;
    rules.innerHTML = `<span class="chip ${d.can.delete ? "" : "chip--muted"}">Delete: Tier 3 in any compartment${d.can.delete ? " · yours" : ""}</span>
      <span class="chip ${d.can.restrict ? "chip--red" : "chip--muted"}">Restrict: Tier 4 only${d.can.restrict ? " · yours" : ""}</span>`;
    if (!notes.length) { list.innerHTML = '<p class="muted">The box is empty.</p>'; return; }
    list.innerHTML = notes.map((n) => n.restricted && !n.body ? `
      <article class="note note--restricted" data-id="${n.id}">
        <div class="note__head"><span class="label label--red">Note No. ${n.id}</span><span class="typewriter">${fmtDate(n.created_at)}</span></div>
        <div class="note__confidential">CONFIDENTIAL</div>
        <div class="note__sub typewriter">Restricted by the Office · Tier 4 clearance required</div>
      </article>` : `
      <article class="note ${n.restricted ? "note--marked" : ""}" data-id="${n.id}">
        <div class="note__head">
          <span class="label label--red">Note No. ${n.id}</span>
          <span class="typewriter">${fmtDate(n.created_at)}</span>
        </div>
        ${n.restricted ? `<div class="note__banner">RESTRICTED · hidden below Tier 4 · by ${esc(n.restricted_by_name || "the Office")} ${n.restricted_at ? "· " + fmtDate(n.restricted_at) : ""}</div>` : ""}
        <div class="note__body">${esc(n.body)}</div>
        <dl class="note__dl">
          ${field("Who", n.subject)}${field("When", n.when_text)}${field("Where", n.where_text)}${field("Who else saw or heard", n.witnesses)}
          ${field("Reporter", n.reporter_name)}${field("Reach them", n.reporter_contact)}
        </dl>
        <div class="note__actions">
          ${d.can.restrict ? (n.restricted
            ? `<button class="btn btn--ghost btn--sm" type="button" data-unrestrict>Lift restriction</button>`
            : `<button class="btn btn--red btn--sm" type="button" data-restrict>Restrict</button>`) : ""}
          ${d.can.delete ? `<button class="btn btn--ghost btn--sm" type="button" data-delete style="border-color:var(--red);color:var(--red)">Delete</button>` : ""}
        </div>
      </article>`).join("");

    list.querySelectorAll("[data-restrict]").forEach((b) => b.addEventListener("click", () => act(b, "POST", "restrict", "Restricted. Everyone below Tier 4 now sees CONFIDENTIAL.")));
    list.querySelectorAll("[data-unrestrict]").forEach((b) => b.addEventListener("click", () => act(b, "POST", "unrestrict", "Restriction lifted.")));
    list.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => {
      if (!confirm("Delete this note for good? It cannot be recovered.")) return;
      act(b, "DELETE", "", "Note deleted.");
    }));
  }

  async function act(btn, method, verb, msg) {
    const id = btn.closest(".note").dataset.id;
    btn.disabled = true;
    try {
      await api(method, `/api/notes/${id}${verb ? "/" + verb : ""}`);
      toast(msg);
      await load();
    } catch (e) { toast(e.message, 5000); btn.disabled = false; }
  }

  async function load() {
    try { render(await api("GET", "/api/notes")); }
    catch (e) { list.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  load();
})();
