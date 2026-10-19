/**
 * Patient lookup — instant fuzzy search over name, phone and registration number.
 * Powered by MiniSearch (prefix + fuzzy scoring) with a subsequence fallback so
 * every input yields the best possible shortlist.
 *
 * Data lives centrally on the server: the patient registry and each doctor's
 * notes are synced across all clinic devices. A localStorage mirror lets the
 * app open instantly and work read-only if the network is briefly unavailable.
 */
(function () {
  "use strict";

  var SEARCH_INPUT = document.getElementById("searchInput");
  var CLEAR_BTN = document.getElementById("clearBtn");
  var HELPER = document.getElementById("helperText");
  var RESULTS_LIST = document.getElementById("resultsList");
  var EMPTY_STATE = document.getElementById("emptyState");
  var DB_STATUS = document.getElementById("dbStatus");
  var USER_CHIP = document.getElementById("userChip");
  var OPEN_ADD_BTN = document.getElementById("openAddBtn");

  var backdrop = document.getElementById("drawerBackdrop");
  var drawer = document.getElementById("drawer");
  var drawerBody = document.getElementById("drawerBody");
  var closeDrawerBtn = document.getElementById("closeDrawer");
  var shareDrawerBtn = document.getElementById("shareDrawer");
  var saveNotesBtn = document.getElementById("saveNotes");
  var notesEl = document.getElementById("dNotes");
  var saveStateEl = document.getElementById("saveState");

  var addModal = document.getElementById("addModal");
  var addBackdrop = document.getElementById("addBackdrop");
  var closeAddBtn = document.getElementById("closeAdd");
  var addForm = document.getElementById("addForm");
  var addError = document.getElementById("addError");
  var submitPatientBtn = document.getElementById("submitPatient");

  var CACHE_KEY = "vitalis_cache_v2";
  var MAX_RESULTS = 12;

  var patients = [];
  var doctorNotes = {};   // registration number -> notes (this doctor, from server)
  var mini = null;
  var selectedId = null;
  var activeIndex = -1;

  /* ------------------------------------------------------------------ */
  /* Local cache (offline mirror)                                         */
  /* ------------------------------------------------------------------ */

  function loadCache() {
    try {
      var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (raw && Array.isArray(raw.patients)) return raw;
    } catch (err) { /* ignore */ }
    return null;
  }

  function persistCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ patients: patients, notes: doctorNotes }));
    } catch (err) { /* quota — non-fatal */ }
  }

  function doctorNoteFor(id) {
    return doctorNotes[id] || "";
  }

  /* ------------------------------------------------------------------ */
  /* Index construction                                                  */
  /* ------------------------------------------------------------------ */

  function digitsOnly(str) {
    return (str || "").replace(/\D+/g, "");
  }

  function foldAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function baseTokenize(text) {
    return foldAccents(String(text).toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  // Terms we index for a patient's searchable text.
  function processTerm(term) {
    var folded = foldAccents(String(term).toLowerCase());
    var tokens = baseTokenize(folded);
    if (tokens.length === 0) {
      tokens = [folded.trim()];
    }
    // Compact digits so "98765-43210" matches when typed as "9876543210".
    tokens.forEach(function (t) {
      var d = digitsOnly(t);
      if (d && d !== t) tokens.push(d);
    });
    return tokens;
  }

  // Field extractor: index a clean digits companion for phone/reg numbers so
  // "98765" (end or middle chunk) or partitioned numbers still match, whatever
  // the stored format.
  function extractField(doc, fieldName) {
    var value = fieldName === "registrationNumber" ? doc.id : doc[fieldName];
    value = value === undefined || value === null ? "" : String(value);
    if (fieldName === "phone" || fieldName === "registrationNumber") {
      var d = digitsOnly(value);
      if (d && d !== value) value = value + "  " + d;
    }
    return value;
  }

  function buildIndex(records) {
    mini = new MiniSearch({
      fields: ["name", "phone", "registrationNumber"],
      storeFields: ["id"],
      processTerm: processTerm,
      extractField: extractField
    });
    mini.addAll(records);
  }

  /* ------------------------------------------------------------------ */
  /* Search                                                              */
  /* ------------------------------------------------------------------ */

  function miniSearch(query) {
    try {
      return mini.search(query, {
        fuzzy: 0.4,
        maxFuzzy: 2,
        prefix: true,
        boost: { name: 3, phone: 2, registrationNumber: 2.5 },
        combineWith: "OR"
      });
    } catch (err) {
      return [];
    }
  }

  // Subsequence similarity fallback (like Fuse) for very loose input.
  function similarity(queryFolded, targetFolded) {
    var q = queryFolded.replace(/[^a-z0-9]/g, "");
    var t = targetFolded.replace(/[^a-z0-9]/g, "");
    if (!q || !t) return 0;
    if (q === t) return 1;
    var qi = 0, matched = 0;
    for (var i = 0; i < t.length && qi < q.length; i++) {
      if (t[i] === q[qi]) { matched++; qi++; }
    }
    if (qi < q.length) {
      // Query not fully contained → weak score based on first-letter match.
      if (t[0] === q[0]) return 0.08;
      return 0;
    }
    var coverage = matched / q.length;
    var compactness = q.length / Math.max(matched, t.length === q.length ? t.length : t.length);
    compactness = Math.min(1, q.length / (t.length || 1));
    return 0.5 * coverage + 0.3 * compactness + (t[0] === q[0] ? 0.2 : 0);
  }

  function fallbackSearch(query) {
    var qf = foldAccents(query.toLowerCase());
    var qDigits = digitsOnly(query);
    var scored = [];
    patients.forEach(function (p) {
      var s = similarity(qf, foldAccents(p.name.toLowerCase())) * 1.3;
      var sReg = similarity(qf, foldAccents(p.id.toLowerCase())) * 0.9;
      var sPhone = 0;
      if (qDigits) {
        var pd = digitsOnly(p.phone);
        if (pd.indexOf(qDigits) === 0) sPhone = 1.4;
        else if (pd.indexOf(qDigits) > 0) sPhone = 1.0;
      }
      var best = Math.max(s, sReg, sPhone);
      if (best >= 0.12) {
        scored.push({ id: p.id, score: best, matchedFallback: true });
      }
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored;
  }

  function search(query) {
    var raw = query.trim();
    if (!raw) return patients.slice(0, MAX_RESULTS);

    var results = miniSearch(raw);
    var seen = {};
    results.forEach(function (r) { seen[r.id] = true; });

    if (results.length < 6) {
      fallbackSearch(raw).forEach(function (f) {
        if (!seen[f.id]) {
          f.id = f.id; f.score = f.score; results.push(f);
          seen[f.id] = true;
        }
      });
    }
    results.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    return results.slice(0, MAX_RESULTS);
  }

  /* findPatient is defined in the boot section below (id -> record map). */

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Wrap all occurrences of any matcher (digits-aware, case-insensitive).
  function highlight(value, matchers) {
    var text = String(value);
    var lower = foldAccents(text.toLowerCase());
    var ranges = [];
    matchers.forEach(function (m0) {
      var m = foldAccents(String(m0).toLowerCase());
      if (!m) return;
      var idx = 0;
      while ((idx = lower.indexOf(m, idx)) !== -1) {
        ranges.push([idx, idx + m.length]);
        idx += m.length;
      }
    });
    if (!ranges.length) return escapeHtml(text);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [ranges[0]];
    for (var i = 1; i < ranges.length; i++) {
      var last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1]) {
        last[1] = Math.max(last[1], ranges[i][1]);
      } else {
        merged.push(ranges[i]);
      }
    }
    var out = "";
    var pos = 0;
    merged.forEach(function (r) {
      out += escapeHtml(text.slice(pos, r[0]));
      out += "<mark>" + escapeHtml(text.slice(r[0], r[1])) + "</mark>";
      pos = r[1];
    });
    out += escapeHtml(text.slice(pos));
    return out;
  }

  function renderResults(results, query) {
    RESULTS_LIST.innerHTML = "";
    activeIndex = -1;

    if (!query) {
      HELPER.textContent = "Start typing to shortlist patients — smart fuzzy matching handles typos and partial input.";
    } else if (results.length) {
      HELPER.textContent = results.length + (results.length === 1 ? " patient matches" : " patients shortlisted") + " for “" + query + "”";
    } else {
      HELPER.textContent = "No close matches — try a different spelling or fewer characters.";
    }

    EMPTY_STATE.hidden = results.length > 0;

    results.forEach(function (result, index) {
      var p = findPatient(result.id);
      if (!p) return;
      var notes = doctorNoteFor(p.id);
      var li = document.createElement("li");
      li.className = "result-item";
      li.setAttribute("role", "option");
      li.dataset.id = p.id;
      li.dataset.index = String(index);
      var matchers = query ? query.trim().split(/\s+/) : [];
      li.innerHTML =
        '<button type="button" class="result-btn">' +
        '<div class="r-main"><span class="r-name">' + highlight(p.name, matchers) + "</span>" +
        '<span class="r-reg" title="Registration number">' + highlight(p.id, matchers) + "</span></div>" +
        '<div class="r-sub"><a class="r-phone" href="tel:+91' + digitsOnly(p.phone) + '" tabindex="-1" onclick="event.stopPropagation()">' + highlight(p.phone, matchers) + "</a>" +
        (notes ? '<span class="r-notes-dot" title="Has saved clinical notes">&#9679;</span>' : "") +
        "</div>" +
        "</button>";
      RESULTS_LIST.appendChild(li);
    });

    if (results.length) {
      RESULTS_LIST.children[0].classList.add("active");
      activeIndex = 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Detail drawer                                                       */
  /* ------------------------------------------------------------------ */

  function openDrawer(id) {
    var p = findPatient(id);
    if (!p) return;
    selectedId = p.id;
    var notes = doctorNoteFor(p.id) || p.notes || "";

    document.getElementById("dReg").textContent = p.id;
    document.getElementById("dName").textContent = p.name;
    var phoneLink = document.getElementById("dPhone");
    var pd = digitsOnly(p.phone);
    phoneLink.textContent = p.phone;
    phoneLink.href = "tel:+91" + pd;
    document.getElementById("dAge").textContent = p.age ? p.age + " yrs" : "—";
    document.getElementById("dGender").textContent = p.gender || "—";
    document.getElementById("dCity").textContent = p.city || "—";
    document.getElementById("dVisit").textContent = p.firstVisit || "—";
    notesEl.value = notes;
    hideSaveState();

    backdrop.hidden = false;
    drawer.hidden = false;
    requestAnimationFrame(function () {
      drawer.classList.add("open");
      backdrop.classList.add("open");
    });
    document.body.classList.add("no-scroll");
    saveNotesBtn.disabled = false;
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
    document.body.classList.remove("no-scroll");
    setTimeout(function () {
      drawer.hidden = true;
      backdrop.hidden = true;
    }, 220);
    selectedId = null;
    SEARCH_INPUT.focus();
  }

  function showSaveState(kind, msg) {
    saveStateEl.hidden = false;
    saveStateEl.textContent = msg;
    saveStateEl.className = "save-state " + kind;
  }

  function hideSaveState() {
    saveStateEl.hidden = true;
  }

  function saveNotes() {
    if (!selectedId) return;
    var reg = selectedId;
    var value = notesEl.value.trim();
    doctorNotes[reg] = value;
    showSaveState("saving", "Saving…");
    fetch("/api/notes/" + encodeURIComponent(reg), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-vitalis-client": "app" },
      body: JSON.stringify({ notes: value })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        persistCache();
        showSaveState("ok", "Saved — synced to all devices");
        setTimeout(hideSaveState, 2200);
        refreshCurrentResults();
      })
      .catch(function () {
        showSaveState("err", "Offline — note saved on this device, will not sync");
      });
  }

  function refreshCurrentResults() {
    var old = new Set();
    Array.prototype.forEach.call(RESULTS_LIST.children, function (li) {
      if (li.classList.contains("marked-open")) old.add(li.dataset.id);
    });
    runSearch(GET_LAST_QUERY ? GET_LAST_QUERY : SEARCH_INPUT.value);
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  var GET_LAST_QUERY = "";

  var renderTimer = 0;
  function runSearch(value) {
    GET_LAST_QUERY = value;
    CLEAR_BTN.hidden = value.length === 0;
    clearTimeout(renderTimer);
    // MiniSearch is millisecond-fast; a tiny debounce keeps typing smooth.
    renderTimer = setTimeout(function () {
      var query = value.trim();
      var results = search(query);
      renderResults(results, query);
    }, 60);
  }

  SEARCH_INPUT.addEventListener("input", function (e) {
    runSearch(e.target.value);
  });

  CLEAR_BTN.addEventListener("click", function () {
    SEARCH_INPUT.value = "";
    runSearch("");
    SEARCH_INPUT.focus();
  });

  RESULTS_LIST.addEventListener("click", function (e) {
    if (e.target.closest(".r-phone")) return; // let tel: links work
    var btn = e.target.closest(".result-item");
    if (!btn) return;
    openDrawer(btn.dataset.id);
  });

  SEARCH_INPUT.addEventListener("keydown", function (e) {
    var count = RESULTS_LIST.children.length;
    if (!count) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % count;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + count) % count;
    } else if (e.key === "Enter") {
      e.preventDefault();
      var target = RESULTS_LIST.children[activeIndex];
      if (target) openDrawer(target.dataset.id);
      return;
    } else {
      return;
    }
    Array.prototype.forEach.call(RESULTS_LIST.children, function (li, i) {
      li.classList.toggle("active", i === activeIndex);
    });
  });

  closeDrawerBtn.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
  saveNotesBtn.addEventListener("click", saveNotes);
  shareDrawerBtn.addEventListener("click", function () {
    if (!selectedId) return;
    var p = findPatient(selectedId);
    var notes = doctorNoteFor(selectedId);
    var text = "Patient — " + p.name + "\nRegistration no: " + p.id + "\nPhone: " + p.phone + (notes ? "\n\nNotes: " + notes : "");
    if (navigator.share) {
      navigator.share({ title: "Patient file", text: text }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showSaveState("ok", "Copied to clipboard");
      setTimeout(hideSaveState, 1800);
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !drawer.hidden) closeDrawer();
    if (e.key === "Escape" && !addModal.hidden) closeAddModal();
  });

  /* ------------------------------------------------------------------ */
  /* Register new patient                                                 */
  /* ------------------------------------------------------------------ */

  function openAddModal(markError) {
    addError.hidden = true;
    addForm.reset();
    backdrop.hidden = false;
    addModal.hidden = false;
    requestAnimationFrame(function () {
      addModal.classList.add("open");
      addBackdrop.classList.add("open");
    });
    document.body.classList.add("no-scroll");
    if (markError) {
      addError.hidden = false;
      addError.textContent = "Sign in with Freebuff first — then you can register patients.";
    }
    setTimeout(function () { document.getElementById("aName").focus(); }, 250);
  }

  function closeAddModal() {
    addModal.classList.remove("open");
    addBackdrop.classList.remove("open");
    document.body.classList.remove("no-scroll");
    setTimeout(function () {
      addModal.hidden = true;
      addBackdrop.hidden = true;
    }, 220);
  }

  var signedInState = false; // set true when /api/me returns a user

  OPEN_ADD_BTN.addEventListener("click", function () {
    openAddModal(!signedInState);
  });
  closeAddBtn.addEventListener("click", closeAddModal);
  addBackdrop.addEventListener("click", closeAddModal);

  addForm.addEventListener("submit", function (e) {
    e.preventDefault();
    addError.hidden = true;
    var name = document.getElementById("aName").value.trim();
    if (!name) {
      addError.hidden = false;
      addError.textContent = "Please enter the patient's name.";
      return;
    }
    var incomingPhone = digitsOnly(document.getElementById("aPhone").value);
    var existing = search(name).some(function (r) {
      var p = findPatient(r.id);
      if (!p) return false;
      var same = digitsOnly(p.phone);
      return foldAccents(p.name.toLowerCase()) === foldAccents(name.toLowerCase()) &&
             (!incomingPhone || !same || same === incomingPhone);
    });
    if (existing && !window.confirm("A patient with this name and phone may already exist. Register anyway?")) {
      return;
    }
    var payload = {
      name: name,
      phone: document.getElementById("aPhone").value.trim(),
      age: document.getElementById("aAge").value.trim(),
      gender: document.getElementById("aGender").value,
      city: document.getElementById("aCity").value.trim()
    };
    submitPatientBtn.disabled = true;
    submitPatientBtn.textContent = "Registering…";
    fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-vitalis-client": "app" },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      })
      .then(function (out) {
        submitPatientBtn.disabled = false;
        submitPatientBtn.textContent = "Register patient";
        if (!out.ok) {
          addError.hidden = false;
          addError.textContent = (out.body && out.body.error) || "Could not register.";
          return;
        }
        var reg = out.body.registrationNumber;
        var newPatient = {
          id: reg,
          name: payload.name,
          phone: payload.phone,
          age: payload.age ? parseInt(payload.age, 10) : null,
          gender: payload.gender || null,
          city: payload.city || null,
          firstVisit: new Date().toISOString().slice(0, 10),
          notes: ""
        };
        patients.push(newPatient);
        patientById[reg] = newPatient;
        buildIndex(patients);
        persistCache();
        DB_STATUS.textContent = patients.length + " patient records";
        addForm.reset();
        var success = document.createElement("div");
        success.className = "add-success";
        success.innerHTML =
          "Patient registered! Registration number:" +
          '<span class="reg-big">' + escapeHtml(reg) + "</span>" +
          '<span style="display:block;font-size:0.78rem;font-weight:500;margin-top:4px">Writes to every clinic device — you can close the form and search for ' +
          escapeHtml(payload.name) + " now.</span>";
        addForm.parentNode.insertBefore(success, addForm);
        addForm.hidden = true;
        setTimeout(function () {
          success.remove();
          addForm.hidden = false;
          closeAddModal();
          runSearch(reg);
        }, 4000);
        runSearch(reg);
      })
      .catch(function () {
        submitPatientBtn.disabled = false;
        submitPatientBtn.textContent = "Register patient";
        addError.hidden = false;
        addError.textContent = "Network error — check your connection and try again.";
      });
  });

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  function applyData(list, notes) {
    patients = list;
    if (notes) doctorNotes = notes;
    persistCache();
    patientById = {};
    patients.forEach(function (p) { patientById[p.id] = p; });
    buildIndex(patients);
    DB_STATUS.textContent = patients.length + " patient records";
    runSearch(SEARCH_INPUT.value);
  }

  var patientById = {};
  function findPatient(id) {
    return patientById[id] || null;
  }

  function boot() {
    // 1. Paint instantly from the cache mirror if present.
    var cached = loadCache();
    if (cached && cached.patients.length) {
      patients = cached.patients;
      doctorNotes = cached.notes || {};
      patientById = {};
      patients.forEach(function (p) { patientById[p.id] = p; });
      buildIndex(patients);
      DB_STATUS.textContent = patients.length + " patient records";
      runSearch(SEARCH_INPUT.value);
    }

    // 2. Show the signed-in user.
    fetch("/api/me", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : { user: null }; })
      .then(function (data) {
        if (data.user) {
          USER_CHIP.hidden = false;
          USER_CHIP.textContent = data.user.name || data.user.email || "Signed in";
          signedInState = true;
        } else {
          USER_CHIP.hidden = true;
          signedInState = false;
        }
      })
      .catch(function () {});

    // 3. Sync the central registry + this doctor's notes.
    Promise.all([
      fetch("/api/patients", { cache: "no-store" }).then(function (r) {
        if (r.status === 401) throw new Error("signin");
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch("/api/notes", { cache: "no-store" }).then(function (r) {
        return r.ok ? r.json() : { notes: {} };
      })
    ])
      .then(function (outs) {
        applyData(outs[0].patients || [], outs[1].notes || {});
      })
      .catch(function (err) {
        if (!cached) {
          DB_STATUS.textContent = err.message === "signin" ? "Sign in to load records" : "Could not load records";
          if (err.message === "signin") {
            HELPER.innerHTML =
              'This clinic workspace keeps patient data private. <a class="signin-link" href="/auth/freebuff/signin?returnTo=%2F">Sign in with Freebuff</a> to load the registry.';
          } else {
            HELPER.textContent = "Error loading patient data: " + err.message;
          }
        }
      });
  }

  boot();
})();
