/* Admin hub: personnel roll and organization compartments. */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`);
    return data;
  }
  const toastEl = $("#toast");
  function toast(msg, ms = 3000) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastEl._h); toastEl._h = setTimeout(() => { toastEl.hidden = true; }, ms); }

  const tierSel = (name, v) => `<select data-f="${name}">${[0, 1, 2, 3].map((t) => `<option value="${t}" ${t === Number(v) ? "selected" : ""}>${t === 0 ? "none" : "Tier " + t}</option>`).join("")}</select>`;
  const DIVS = ["public", "secret", "government"];
  const divBoxes = (v) => {
    const set = String(v || "").split(",");
    return `<div class="adm__divs">${DIVS.map((d) => `<label><input type="checkbox" data-div="${d}" ${set.includes(d) ? "checked" : ""}> ${d[0].toUpperCase() + d.slice(1)}</label>`).join("")}</div>`;
  };

  /* ---------- users ---------- */
  const usersBody = $("#usersTable tbody");
  async function loadUsers() {
    const d = await api("GET", "/api/admin/users");
    usersBody.innerHTML = d.users.map((u) => `
      <tr data-id="${u.id}" class="${u.active ? "" : "is-inactive"}">
        <td class="mono">${esc(u.username)}</td>
        <td><input type="text" data-f="name" value="${esc(u.name)}" maxlength="80"></td>
        <td><select data-f="role"><option value="member" ${u.role === "member" ? "selected" : ""}>Curator</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option></select></td>
        <td>${divBoxes(u.division)}</td>
        <td>${tierSel("tier_public", u.tier_public)}</td>
        <td>${tierSel("tier_secret", u.tier_secret)}</td>
        <td>${tierSel("tier_government", u.tier_government)}</td>
        <td><input type="checkbox" data-f="tier4" ${u.tier4 ? "checked" : ""}></td>
        <td><input type="checkbox" data-f="active" ${u.active ? "checked" : ""}></td>
        <td class="actions">
          <button class="btn btn--red btn--sm" type="button" data-save disabled>Save</button>
          <button class="btn btn--ghost btn--sm" type="button" data-pass>Password</button>
        </td>
      </tr>`).join("");
    usersBody.querySelectorAll("tr").forEach(wireUserRow);
  }

  function rowValues(tr) {
    const v = {};
    tr.querySelectorAll("[data-f]").forEach((i) => { v[i.dataset.f] = i.type === "checkbox" ? (i.checked ? 1 : 0) : i.value; });
    const divs = [...tr.querySelectorAll("[data-div]")];
    if (divs.length) v.division = divs.filter((c) => c.checked).map((c) => c.dataset.div);
    return v;
  }

  function wireUserRow(tr) {
    const save = $("[data-save]", tr);
    tr.querySelectorAll("[data-f],[data-div]").forEach((i) => i.addEventListener("input", () => { tr.classList.add("is-dirty"); save.disabled = false; }));
    tr.querySelectorAll("[data-f],[data-div]").forEach((i) => i.addEventListener("change", () => { tr.classList.add("is-dirty"); save.disabled = false; }));
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await api("PUT", `/api/admin/users/${tr.dataset.id}`, rowValues(tr));
        tr.classList.remove("is-dirty");
        tr.classList.toggle("is-inactive", !$("[data-f=active]", tr).checked);
        toast("Saved");
      } catch (e) { toast(e.message, 5000); save.disabled = false; }
    });
    $("[data-pass]", tr).addEventListener("click", async () => {
      const pw = prompt(`New password for ${$(".mono", tr).textContent} (at least 6 characters):`);
      if (pw === null) return;
      try { await api("PUT", `/api/admin/users/${tr.dataset.id}`, { password: pw }); toast("Password set"); } catch (e) { toast(e.message, 5000); }
    });
  }

  const userDialog = $("#userDialog"), userForm = $("#userForm"), userError = $("#userError");
  $("#addUser").addEventListener("click", () => { userForm.reset(); userError.hidden = true; userDialog.showModal(); });
  $("#userCancel").addEventListener("click", () => userDialog.close());
  userForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = userForm;
    const body = {
      username: f.username.value, name: f.name.value, password: f.password.value, role: f.role.value,
      division: [...f.querySelectorAll("[name=division]:checked")].map((c) => c.value),
      tier4: Number(f.tier4.value), tier_public: Number(f.tier_public.value), tier_secret: Number(f.tier_secret.value), tier_government: Number(f.tier_government.value),
    };
    try { await api("POST", "/api/admin/users", body); userDialog.close(); await loadUsers(); toast("Added to the roll"); }
    catch (err) { userError.textContent = err.message; userError.hidden = false; }
  });

  /* ---------- organizations ---------- */
  const orgsBody = $("#orgsTable tbody");
  async function loadOrgs() {
    const d = await api("GET", "/api/admin/orgs");
    orgsBody.innerHTML = d.orgs.map((o) => `
      <tr data-id="${o.id}">
        <td><input type="text" data-f="name" value="${esc(o.name)}" maxlength="60"></td>
        <td><input type="text" data-f="long_name" value="${esc(o.long_name || "")}" maxlength="120" style="max-width:260px"></td>
        <td><select data-f="compartment">${["public", "secret", "government"].map((v) => `<option value="${v}" ${o.compartment === v ? "selected" : ""}>${v[0].toUpperCase() + v.slice(1)}</option>`).join("")}</select></td>
        <td><select data-f="min_tier">${[1, 2, 3, 4].map((t) => `<option value="${t}" ${t === o.min_tier ? "selected" : ""}>Tier ${t}${t === 4 ? " only" : "+"}</option>`).join("")}</select></td>
        <td>${o.people}</td>
        <td class="actions"><button class="btn btn--red btn--sm" type="button" data-save disabled>Save</button></td>
      </tr>`).join("");
    orgsBody.querySelectorAll("tr").forEach((tr) => {
      const save = $("[data-save]", tr);
      tr.querySelectorAll("[data-f]").forEach((i) => ["input", "change"].forEach((ev) => i.addEventListener(ev, () => { tr.classList.add("is-dirty"); save.disabled = false; })));
      save.addEventListener("click", async () => {
        save.disabled = true;
        try { await api("PUT", `/api/admin/orgs/${tr.dataset.id}`, rowValues(tr)); tr.classList.remove("is-dirty"); toast("Saved"); }
        catch (e) { toast(e.message, 5000); save.disabled = false; }
      });
    });
  }

  Promise.all([loadUsers(), loadOrgs()]).catch((e) => toast(e.message, 6000));
})();
