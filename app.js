/**
 * Patient lookup — instant fuzzy search over name, phone and registration number.
 * Powered by MiniSearch (prefix + fuzzy scoring) with a subsequence fallback so
 * every input yields the best possible shortlist.
 */
(function () {
  "use strict";

  var SEARCH_INPUT = document.getElementById("searchInput");
  var CLEAR_BTN = document.getElementById("clearBtn");
  var HELPER = document.getElementById("helperText");
  var RESULTS_LIST = document.getElementById("resultsList");
  var EMPTY_STATE = document.getElementById("emptyState");
  var DB_STATUS = document.getElementById("dbStatus");

  var backdrop = document.getElementById("drawerBackdrop");
  var drawer = document.getElementById("drawer");
  var drawerBody = document.getElementById("drawerBody");
  var closeDrawerBtn = document.getElementById("closeDrawer");
  var shareDrawerBtn = document.getElementById("shareDrawer");
  var saveNotesBtn = document.getElementById("saveNotes");
  var notesEl = document.getElementById("dNotes");
  var saveStateEl = document.getElementById("saveState");

  var NOTES_KEY = "vitalis_notes_v1";
  var MAX_RESULTS = 12;

  var patients = [];
  var mini = null;
  var selectedId = null;
  var activeIndex = -1;

  /* ------------------------------------------------------------------ */
  /* Storage helpers                                                     */
  /* ------------------------------------------------------------------ */

  function loadNotes() {
    try {
      return JSON.parse(localStorage.getItem(NOTES_KEY) || "{}");
    } catch (err) {
      return {};
    }
  }

  function persistNotes(notes) {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
      return true;
    } catch (err) {
      return false;
    }
  }

  function notesMap() {
    return loadNotes();
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

  function findPatient(id) {
    for (var i = 0; i < patients.length; i++) {
      if (patients[i].id === id) return patients[i];
    }
    return null;
  }

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
      var notes = notesMap()[p.id];
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
    var notes = notesMap()[p.id] || p.notes || "";

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
    var value = notesEl.value.trim();
    var notes = notesMap();
    notes[selectedId] = value;
    var ok = persistNotes(notes);
    if (ok) {
      var p = findPatient(selectedId);
      showSaveState("ok", "Saved");
      setTimeout(hideSaveState, 1800);
      refreshCurrentResults();
    } else {
      showSaveState("err", "Could not save (storage full?)");
    }
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
    var notes = notesMap()[selectedId];
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
  });

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  function migrateNotes(patientList) {
    // keep only notes whose patient still exists
    var notes = notesMap();
    var next = {};
    patientList.forEach(function (p) {
      if (notes[p.id] !== undefined) next[p.id] = notes[p.id];
    });
    persistNotes(next);
  }

  fetch("data/patients.json", { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      patients = data;
      migrateNotes(patients);
      buildIndex(patients);
      DB_STATUS.textContent = patients.length + " patient records";
      runSearch(SEARCH_INPUT.value);
    })
    .catch(function (err) {
      DB_STATUS.textContent = "Could not load patient data";
      HELPER.textContent = "Error loading patient data: " + err.message;
    });
})();
