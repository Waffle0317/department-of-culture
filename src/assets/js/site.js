(function () {
  // Login page: show an error passed back by the login function, and switch
  // to the founding form while the roll is still empty.
  var err = document.querySelector("[data-login-error]");
  if (err) {
    var p = new URLSearchParams(location.search);
    var code = p.get("error");
    if (code) {
      err.hidden = false;
      err.textContent =
        code === "config"
          ? "This site cannot reach its database. Contact the Director."
          : code === "empty"
          ? "The roll is empty: no one has been issued credentials yet."
          : code === "found"
          ? "Check the founding form: username of 2–40 letters or digits, a name, and the same password twice (6+ characters)."
          : "Credentials not recognised. The attempt has been recorded.";
    }
    var next = document.querySelector("[data-login-next]");
    if (next && p.get("next")) next.value = p.get("next");

    fetch("/api/status", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !s.needsFounding) return;
        document.querySelector("[data-login-form]").hidden = true;
        document.querySelector("[data-found-form]").hidden = false;
        document.querySelector("[data-login-title]").textContent = "Found the roll";
        document.querySelector("[data-login-sub]").textContent = "First run · the Director takes office";
        if (code === "empty") err.hidden = true;
      })
      .catch(function () {});
  }

  // Department shell: name the signed-in Curator, show clearance, reveal admin links.
  var who = document.querySelector("[data-user]");
  if (who) {
    fetch("/api/me", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.name) return;
        who.textContent = d.role ? d.role + " · " + d.name : d.name;
        window.DOC_ME = d;
        var cl = document.querySelector("[data-clearance]");
        if (cl) {
          cl.textContent = d.tier4
            ? "Clearance: Tier 4 · all compartments"
            : "Clearance: P" + d.tiers.public + " · S" + d.tiers.secret + " · G" + d.tiers.government;
        }
        if (d.admin) {
          document.querySelectorAll("[data-admin-only]").forEach(function (el) { el.hidden = false; });
        }
      })
      .catch(function () {});
  }

  // Reveal-on-scroll for public sections. Fail-safe: everything is shown
  // after a short delay regardless, so nothing can stay hidden.
  var reveals = document.querySelectorAll(".reveal");
  function showAll() { reveals.forEach(function (el) { el.classList.add("is-in"); }); }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -5% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
    setTimeout(showAll, 2500);
  } else {
    showAll();
  }
})();
