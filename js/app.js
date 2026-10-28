/* ============================================================
   Quiz Duo — логика приложения (vanilla JS, без зависимостей)
   ============================================================ */
(() => {
  "use strict";

  /* ---------- Утилиты ---------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  /* ---------- Хранилище (localStorage с фолбэком) ---------- */
  const memStore = {};
  const storage = {
    get(key, def) {
      try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); }
      catch { return memStore[key] !== undefined ? memStore[key] : def; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); }
      catch { memStore[key] = val; }
    },
  };

  /* ---------- Звук (WebAudio, без файлов) ---------- */
  const SoundFX = (() => {
    let ctx = null;
    let enabled = storage.get("qd_sound", true);
    const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } } return ctx; };
    const tone = (freq, dur = 0.12, type = "sine", gain = 0.16, when = 0) => {
      if (!enabled) return; const c = ensure(); if (!c) return;
      const t = c.currentTime + when;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    };
    return {
      get enabled() { return enabled; },
      toggle() { enabled = !enabled; storage.set("qd_sound", enabled); if (enabled) this.click(); return enabled; },
      click() { tone(520, 0.07, "triangle", 0.1); },
      good() { tone(660, 0.12, "sine", 0.18); tone(880, 0.16, "sine", 0.16, 0.09); },
      bad() { tone(220, 0.22, "sawtooth", 0.12); tone(160, 0.25, "sawtooth", 0.1, 0.08); },
      tick() { tone(980, 0.05, "square", 0.05); },
      win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, "sine", 0.16, i * 0.13)); },
      joker() { tone(760, 0.08, "triangle", 0.12); tone(1010, 0.1, "triangle", 0.12, 0.07); },
    };
  })();

  /* ---------- Тосты ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg; el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove("show"); setTimeout(() => (el.hidden = true), 320); }, 2200);
  }

  /* ---------- Навигация между экранами ---------- */
  const SCREENS = ["home", "topics", "cats", "settings", "quiz", "result"];
  function showScreen(name) {
    SCREENS.forEach((s) => $("#screen-" + s).classList.toggle("active", s === name));
    state.screen = name;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- Состояние ---------- */
  const state = {
    screen: "home",
    selectedTopics: new Set(),          // ключи тем
    selectedCats: new Set(),            // "topicKey:catKey"
    settings: storage.get("qd_settings", {
      count: 15, timePerQ: 0, lives: 3,
      hardcore: false, combo: true, facts: true, confetti: true,
    }),
    quiz: null,                          // активный раунд
    lastSetup: null,                     // для «того же набора»
  };

  function saveSettings() { storage.set("qd_settings", state.settings); }

  /* ---------- Подсчёт пула вопросов ---------- */
  function activeCatKeys() {
    // если подкатегории не выбраны вручную — все подкатегории выбранных тем
    if (state.selectedCats.size > 0) return new Set(state.selectedCats);
    const all = new Set();
    state.selectedTopics.forEach((tk) => Object.keys(QUESTIONS_DB[tk].categories).forEach((ck) => all.add(tk + ":" + ck)));
    return all;
  }

  function poolSize() {
    let n = 0;
    activeCatKeys().forEach((key) => {
      const [tk, ck] = key.split(":");
      const cat = QUESTIONS_DB[tk] && QUESTIONS_DB[tk].categories[ck];
      if (cat) n += cat.questions.length;
    });
    return n;
  }

  function buildPool() {
    const pool = [];
    activeCatKeys().forEach((key) => {
      const [tk, ck] = key.split(":");
      const topic = QUESTIONS_DB[tk], cat = topic && topic.categories[ck];
      if (!cat) return;
      cat.questions.forEach((q) => pool.push({ ...q, topicName: topic.name, catName: cat.name, icon: cat.icon }));
    });
    return shuffle(pool);
  }

  /* ============================================================
     ЭКРАН: ГЛАВНАЯ
     ============================================================ */
  function renderHome() {
    let total = 0, cats = 0;
    Object.values(QUESTIONS_DB).forEach((t) => { cats += Object.keys(t.categories).length; Object.values(t.categories).forEach((c) => (total += c.questions.length)); });
    $("#statQuestions").textContent = total;
    $("#statTopics").textContent = Object.keys(QUESTIONS_DB).length;

    const history = storage.get("qd_history", []);
    const best = storage.get("qd_best", null);
    const played = history.length;
    const statsHtml = `
      <div class="stat-card"><b>${played}</b><span>сыграно игр</span></div>
      <div class="stat-card"><b>${best ? best.score : 0}</b><span>рекорд очков ⭐</span></div>
      <div class="stat-card"><b>${best ? best.percent + "%" : "—"}</b><span>лучшая точность 🎯</span></div>`;
    $("#homeStats").innerHTML = statsHtml;

    const listEl = $("#recentList");
    if (!played) {
      listEl.innerHTML = `<div class="recent-empty">Пока пусто — сыграйте первый раунд! 🚀</div>`;
    } else {
      listEl.innerHTML = history.slice(0, 6).map((h) => `
        <div class="recent-item">
          <span class="r-icon">${h.medal}</span>
          <span class="r-topics">${esc(h.topics)}</span>
          <span>${h.correct}/${h.total} · ${h.percent}%</span>
          <span class="r-score">⭐ ${h.score}</span>
          <span class="muted" style="font-size:.78rem">${esc(h.date)}</span>
        </div>`).join("");
    }
  }

  /* ============================================================
     ЭКРАН: ТЕМЫ
     ============================================================ */
  function renderTopics(filter = "") {
    const grid = $("#topicsGrid");
    const f = filter.trim().toLowerCase();
    grid.innerHTML = Object.entries(QUESTIONS_DB)
      .filter(([key, t]) => !f || t.name.toLowerCase().includes(f) || t.desc.toLowerCase().includes(f) ||
        Object.values(t.categories).some((c) => c.name.toLowerCase().includes(f)))
      .map(([key, t]) => {
        const qCount = Object.values(t.categories).reduce((s, c) => s + c.questions.length, 0);
        const sel = state.selectedTopics.has(key) ? "selected" : "";
        return `<button class="topic-card ${sel}" data-topic="${key}">
          <div class="topic-icon">${t.icon}</div>
          <div class="topic-name">${esc(t.name)}</div>
          <div class="topic-desc">${esc(t.desc)}</div>
          <div class="topic-meta">${Object.keys(t.categories).length} подкатегорий · ${qCount} вопросов</div>
        </button>`;
      }).join("");

    grid.querySelectorAll(".topic-card").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.topic;
        if (state.selectedTopics.has(key)) {
          state.selectedTopics.delete(key);
          // убрать подкатегории этой темы
          [...state.selectedCats].forEach((ck) => ck.startsWith(key + ":") && state.selectedCats.delete(ck));
        } else state.selectedTopics.add(key);
        SoundFX.click();
        card.classList.toggle("selected");
        updateTopicsSummary();
      });
    });
    updateTopicsSummary();
  }

  function updateTopicsSummary() {
    const nCats = activeCatKeys().size;
    const pool = poolSize();
    $("#topicsSummary").textContent = `Выбрано тем: ${state.selectedTopics.size} · подкатегорий: ${nCats} · доступно вопросов: ${pool}`;
    $("#btnToCats").disabled = state.selectedTopics.size === 0;
  }

  const QUICK_PICKS = [
    { label: "🎯 Микс всего", topics: null, random: true },
    { label: "⚽ Только футбол", topics: [["sports", ["football"]]] },
    { label: "🏎️ Всё про авто", topics: [["cars", null]] },
    { label: "🕹️ Видеоигры", topics: [["games", null]] },
    { label: "🧠 Интеллект-микс", topics: [["science", null], ["geography", null], ["history", null]] },
    { label: "🍿 Кино и музыка", topics: [["movies", null], ["music", null]] },
  ];

  function renderQuickPicks() {
    const row = $("#quickPicks");
    row.innerHTML = QUICK_PICKS.map((p, i) => `<button class="chip" data-i="${i}">${p.label}</button>`).join("");
    row.querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", () => applyQuickPick(QUICK_PICKS[+chip.dataset.i])));
  }

  function applyQuickPick(pick) {
    state.selectedTopics.clear(); state.selectedCats.clear();
    if (pick.random) { startRandomQuiz(); return; }
    pick.topics.forEach(([tk, cats]) => {
      state.selectedTopics.add(tk);
      if (cats) cats.forEach((ck) => state.selectedCats.add(tk + ":" + ck));
    });
    SoundFX.click();
    renderTopics($("#topicSearch").value);
    goCats();
  }

  /* ============================================================
     ЭКРАН: ПОДКАТЕГОРИИ
     ============================================================ */
  function goCats() {
    // если у выбранных тем только по одной категории или пользователь хочет сразу — всё равно даём выбрать
    renderCats();
    showScreen("cats");
  }

  function renderCats() {
    const grid = $("#catsGrid");
    const items = [];
    [...state.selectedTopics].sort().forEach((tk) => {
      const t = QUESTIONS_DB[tk];
      Object.entries(t.categories).forEach(([ck, c]) => {
        items.push({ tk, ck, key: tk + ":" + ck, name: c.name, icon: c.icon, topic: t.name, topicIcon: t.icon, count: c.questions.length });
      });
    });
    grid.innerHTML = items.map((it) => {
      const sel = state.selectedCats.has(it.key) ? "selected" : "";
      return `<button class="cat-card ${sel}" data-key="${it.key}">
        <div class="cat-topic-label">${it.topicIcon} ${esc(it.topic)}</div>
        <div class="cat-name">${it.icon} ${esc(it.name)}</div>
        <div class="cat-count">${it.count} вопросов</div>
      </button>`;
    }).join("");
    grid.querySelectorAll(".cat-card").forEach((card) => {
      card.addEventListener("click", () => {
        const key = card.dataset.key;
        if (state.selectedCats.has(key)) state.selectedCats.delete(key); else state.selectedCats.add(key);
        SoundFX.click();
        card.classList.toggle("selected");
        updateCatsSummary();
      });
    });
    updateCatsSummary();
  }

  function updateCatsSummary() {
    const manual = state.selectedCats.size;
    const pool = poolSize();
    $("#catsSummary").textContent = manual
      ? `Отмечено подкатегорий: ${manual} · вопросов в пуле: ${pool}`
      : `Подкатегории не отмечены — возьмём ВСЕ вопросы выбранных тем (${pool} шт.)`;
  }

  /* ============================================================
     ЭКРАН: НАСТРОЙКИ
     ============================================================ */
  function renderSettings() {
    const s = state.settings;
    $$("#levelGrid .level-card").forEach((b) => b.classList.toggle("selected", +b.dataset.count === s.count));
    $$("#timerSeg .seg-btn").forEach((b) => b.classList.toggle("selected", +b.dataset.time === s.timePerQ));
    $$("#livesSeg .seg-btn").forEach((b) => b.classList.toggle("selected", +b.dataset.lives === s.lives));
    $("#optHardcore").checked = s.hardcore;
    $("#optCombo").checked = s.combo;
    $("#optFacts").checked = s.facts;
    $("#optConfetti").checked = s.confetti;
    updatePoolHint();
    updateRecap();
  }

  function updatePoolHint() {
    const pool = poolSize();
    const need = state.settings.count;
    const hint = $("#poolHint");
    if (pool === 0) { hint.textContent = "⚠️ Пул пуст — вернитесь и выберите темы."; hint.className = "hint hins-warn"; }
    else if (pool < need) { hint.textContent = `ℹ️ В выбранном наборе только ${pool} вопросов — игра будет на ${pool}.`; hint.className = "hint hins-warn"; }
    else { hint.textContent = `✅ В пуле ${pool} вопросов — хватит с запасом.`; hint.className = "hint"; }
    $("#btnStartQuiz").disabled = pool === 0;
  }

  function topicNamesJoined() {
    const names = [...state.selectedTopics].map((k) => QUESTIONS_DB[k].icon + " " + QUESTIONS_DB[k].name);
    return names.join(", ") || "—";
  }

  function updateRecap() {
    const actual = Math.min(state.settings.count, poolSize());
    const parts = [
      `Темы: <b>${topicNamesJoined()}</b>`,
      `Вопросов: <b>${actual}</b>`,
      state.settings.timePerQ ? `Таймер: <b>${state.settings.timePerQ} с</b>` : `Таймер: <b>выключен</b>`,
      state.settings.lives ? `Жизни: <b>${"❤️".repeat(state.settings.lives)}</b>` : `Жизни: <b>∞</b>`,
      state.settings.hardcore ? `Режим: <b>🥶 хардкор</b>` : "",
    ].filter(Boolean);
    $("#roundRecap").innerHTML = parts.join(" &nbsp;·&nbsp; ");
  }

  /* ============================================================
     ИГРА
     ============================================================ */
  function startQuiz(setupOverride) {
    const setup = setupOverride || {};
    const pool = setup.pool ? shuffle(setup.pool) : buildPool();
    if (!pool.length) { toast("Нет доступных вопросов 😅"); return; }
    const total = Math.min(state.settings.count, pool.length);

    state.quiz = {
      questions: pool.slice(0, total),
      idx: 0,
      score: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
      lives: state.settings.lives,
      answered: false,
      locked: false,
      jokers: { fifty: !state.settings.hardcore, time: !state.settings.hardcore && state.settings.timePerQ > 0, audience: !state.settings.hardcore },
      history: [],
      totalTimeLeft: 0,
      startedAt: Date.now(),
      timers: {},
    };

    $$(".joker-btn").forEach((b) => { b.disabled = !state.quiz.jokers[b.dataset.joker]; });
    $("#modeTag").textContent = state.settings.hardcore ? "🥶 Хардкор" : "";
    $("#streakPill").classList.remove("hot");
    updateHud();
    showScreen("quiz");
    renderQuestion();
  }

  function startRandomQuiz() {
    // случайный микс: все темы, настройки из сохранённых
    state.selectedTopics = new Set(Object.keys(QUESTIONS_DB));
    state.selectedCats = new Set();
    const pool = buildPool();
    startQuiz({ pool });
  }

  function updateHud() {
    const qz = state.quiz;
    $("#scoreVal").textContent = qz.score;
    $("#streakVal").textContent = qz.streak;
    $("#streakPill").classList.toggle("hot", qz.streak >= 3);
    $("#qCounter").textContent = `${Math.min(qz.idx + 1, qz.questions.length)} / ${qz.questions.length}`;
    $("#progressFill").style.width = ((qz.idx) / qz.questions.length) * 100 + "%";

    const livesRow = $("#livesRow");
    if (state.settings.lives) {
      livesRow.innerHTML = Array.from({ length: state.settings.lives }, (_, i) =>
        `<span class="${i < qz.lives ? "" : "lost"}">❤️</span>`).join("");
    } else livesRow.innerHTML = "";
  }

  function renderQuestion() {
    const qz = state.quiz;
    if (qz.idx >= qz.questions.length) return finishQuiz();
    const item = qz.questions[qz.idx];
    qz.answered = false; qz.locked = false;

    $("#qCat").textContent = `${item.icon} ${item.catName}`;
    $("#qText").textContent = item.q;
    $("#factBox").hidden = true;
    $("#btnNext").hidden = true;

    // перемешиваем варианты; запоминаем индекс верного
    const opts = shuffle(item.a.map((text, i) => ({ text, ok: i === 0 })));
    qz.options = opts;

    const ansWrap = $("#answers");
    ansWrap.innerHTML = "";
    opts.forEach((o, i) => {
      const b = document.createElement("button");
      b.className = "answer-btn";
      b.innerHTML = `<span class="answer-key">${i + 1}</span><span>${esc(o.text)}</span>`;
      b.addEventListener("click", () => answer(i));
      ansWrap.appendChild(b);
    });

    // карточка «входит» заново
    const card = $("#questionCard");
    card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";

    startTimer();
  }

  /* ---------- Таймер ---------- */
  function stopTimers() {
    const t = state.quiz && state.quiz.timers;
    if (t) { clearInterval(t.iv); clearTimeout(t.to); t.iv = t.to = null; }
  }

  function startTimer(extraSeconds = 0) {
    stopTimers();
    const zone = $("#timerZone");
    const base = state.settings.timePerQ;
    if (!base) { zone.hidden = true; return; }
    const total = base + extraSeconds;
    let left = total;
    zone.hidden = false;
    zone.classList.remove("danger");
    const circle = $("#timerCircle");
    const CIRC = 2 * Math.PI * 19; // r=19
    circle.style.strokeDashoffset = 0;
    $("#timerNum").textContent = left;

    const iv = setInterval(() => {
      if (state.quiz.answered) return; // замораживаем после ответа
      left--;
      $("#timerNum").textContent = Math.max(left, 0);
      circle.style.strokeDashoffset = CIRC * (1 - Math.max(left, 0) / total);
      zone.classList.toggle("danger", left <= 5);
      if (left <= 5 && left > 0) SoundFX.tick();
      if (left <= 0) { clearInterval(iv); answer(null, true); }
    }, 1000);
    state.quiz.timers.iv = iv;
    state.quiz.timerTotal = total;
    state.quiz.timerLeft = () => left;
  }

  /* ---------- Ответ ---------- */
  function answer(i, viaTimeout = false) {
    const qz = state.quiz;
    if (qz.answered || qz.locked) return;
    qz.answered = true;
    stopTimers();

    const optsBtns = $$("#answers .answer-btn");
    optsBtns.forEach((b) => (b.disabled = true));

    const chosen = i != null ? qz.options[i] : null;
    const isCorrect = !!chosen && chosen.ok;
    const correctIdx = qz.options.findIndex((o) => o.ok);

    optsBtns[correctIdx].classList.add("correct");
    if (!isCorrect && chosen) optsBtns[i].classList.add("wrong");

    let gained = 0;
    if (isCorrect) {
      qz.correct++; qz.streak++;
      qz.bestStreak = Math.max(qz.bestStreak, qz.streak);
      gained = 100;
      // бонус за скорость
      if (state.settings.timePerQ && qz.timerLeft) {
        const frac = clamp(qz.timerLeft() / qz.timerTotal, 0, 1);
        gained += Math.round(frac * 50);
      } else {
        gained += 10; // небольшой бонус без таймера
      }
      // комбо
      if (state.settings.combo && qz.streak >= 2) gained += Math.min(qz.streak - 1, 5) * 25;
      qz.score += gained;
      SoundFX.good();
      if (qz.streak > 0 && qz.streak % 5 === 0) toast(`🔥 Комбо x${qz.streak}!`);
    } else {
      qz.streak = 0;
      if (state.settings.lives) {
        qz.lives--;
        if (qz.lives <= 0) { updateHud(); qz.history.push(makeHistoryEntry(chosen, viaTimeout)); showFeedback(-1); setTimeout(finishQuiz, 1400); return; }
      }
      SoundFX.bad();
    }

    qz.history.push(makeHistoryEntry(chosen, viaTimeout));
    updateHud();
    showFeedback(isCorrect ? gained : 0);
  }

  function makeHistoryEntry(chosen, viaTimeout) {
    const qz = state.quiz, item = qz.questions[qz.idx];
    return {
      q: item.q,
      correctText: item.a[0],
      yourText: viaTimeout ? null : (chosen ? chosen.text : null),
      ok: !!chosen && chosen.ok,
      timeout: viaTimeout,
      cat: `${item.icon} ${item.catName}`,
    };
  }

  function showFeedback(gained) {
    const item = state.quiz.questions[state.quiz.idx];
    const factBox = $("#factBox");
    let html = "";
    if (gained > 0) html += `<b style="color:var(--good)">Верно! +${gained} очков</b>`;
    else if (gained <= 0 && state.quiz.history.length) {
      const last = state.quiz.history[state.quiz.history.length - 1];
      html += last.timeout
        ? `<b style="color:var(--bad)">⌛ Время вышло!</b>`
        : `<b style="color:var(--bad)">Мимо…</b>`;
    }
    if (state.settings.facts && item.d) html += `<div style="margin-top:6px">💡 ${esc(item.d)}</div>`;
    if (html) { factBox.innerHTML = html; factBox.hidden = false; }

    const nextBtn = $("#btnNext");
    nextBtn.hidden = false;
    nextBtn.textContent = state.quiz.idx + 1 >= state.quiz.questions.length ? "Результаты 🏁" : "Дальше →";
    nextBtn.focus({ preventScroll: true });
  }

  function nextQuestion() {
    const qz = state.quiz;
    if (!qz || !qz.answered) return;
    qz.idx++;
    if (qz.idx >= qz.questions.length) return finishQuiz();
    updateHud();
    renderQuestion();
  }

  /* ---------- Подсказки ---------- */
  function useJoker(type) {
    const qz = state.quiz;
    if (!qz || qz.answered || qz.locked) return;
    if (!qz.jokers[type]) return;
    qz.jokers[type] = false;
    const btn = $(`.joker-btn[data-joker="${type}"]`);
    if (btn) btn.disabled = true;
    SoundFX.joker();

    if (type === "fifty") {
      const wrongIdx = qz.options.map((o, i) => (o.ok ? -1 : i)).filter((i) => i >= 0);
      shuffle(wrongIdx).slice(0, 2).forEach((i) => $$("#answers .answer-btn")[i].classList.add("dimmed"));
      toast("✂️ 50/50 использована");
    }
    if (type === "time") {
      startTimer(10);
      toast("⏳ Плюс 10 секунд!");
    }
    if (type === "audience") {
      const bars = document.createElement("div");
      bars.className = "audience-bars";
      const correctIdx = qz.options.findIndex((o) => o.ok);
      const weights = qz.options.map((_, i) => (i === correctIdx ? 45 + Math.random() * 30 : 6 + Math.random() * 22));
      const sum = weights.reduce((a, b) => a + b, 0);
      bars.innerHTML = qz.options.map((_, i) => {
        const pct = Math.round((weights[i] / sum) * 100);
        return `<div class="abar"><div class="fill" style="height:0px"></div><span>${pct}%</span><span>Вариант ${i + 1}</span></div>`;
      }).join("");
      $("#factBox").after(bars);
      requestAnimationFrame(() => {
        bars.querySelectorAll(".fill").forEach((f, i) => { f.style.height = Math.round((weights[i] / sum) * 56) + "px"; });
      });
      const bestIdx = weights.indexOf(Math.max(...weights));
      const optBtns = $$("#answers .answer-btn");
      if (optBtns[bestIdx]) optBtns[bestIdx].classList.add("picked-best");
      qz.timers.audienceBars = bars;
      toast("👥 Зал проголосовал");
    }
  }

  function clearAudienceBars() {
    const bars = state.quiz && state.quiz.timers && state.quiz.timers.audienceBars;
    if (bars) bars.remove();
    if (state.quiz) state.quiz.timers.audienceBars = null;
  }

  /* ---------- Завершение ---------- */
  function finishQuiz() {
    stopTimers();
    const qz = state.quiz;
    const total = qz.questions.length;
    const percent = Math.round((qz.correct / total) * 100);
    const secs = Math.round((Date.now() - qz.startedAt) / 1000);

    let medal, title, sub;
    if (percent >= 90) { medal = "🏆"; title = "Безупречно!"; sub = "Вы настоящий знаток этой темы!"; }
    else if (percent >= 70) { medal = "🥇"; title = "Отличный результат!"; sub = "Ещё чуть-чуть — и абсолютный идеал."; }
    else if (percent >= 50) { medal = "🥈"; title = "Хорошая работа!"; sub = "База крепкая, есть куда расти."; }
    else if (percent >= 30) { medal = "🥉"; title = "Неплохо для старта"; sub = "Повторите темы — и станет лучше!"; }
    else { medal = "🌱"; title = "Есть рост!"; sub = "Каждая ошибка делает вас умнее."; }

    $("#resultMedal").textContent = medal;
    $("#resultTitle").textContent = title;
    $("#resultSub").textContent = sub + (qz.lives <= 0 && state.settings.lives ? " Жизни закончились — но это не повод сдаваться!" : "");
    $("#resultCorrect").textContent = `${qz.correct} / ${total}`;

    const ring = $("#resultRing");
    const CIRC = 2 * Math.PI * 52;
    ring.style.strokeDashoffset = CIRC;
    ring.style.stroke = percent >= 70 ? "var(--good)" : percent >= 40 ? "var(--warn)" : "var(--bad)";

    // плавный счётчик процентов
    animateNumber($("#resultPercent"), 0, percent, 1100, (v) => v + "%");
    setTimeout(() => { ring.style.strokeDashoffset = CIRC * (1 - percent / 100); }, 120);

    $("#resultStats").innerHTML = `
      <div class="rstat"><b>⭐ ${qz.score}</b><span>очков</span></div>
      <div class="rstat"><b>🔥 ${qz.bestStreak}</b><span>лучшее комбо</span></div>
      <div class="rstat"><b>⏱ ${fmtTime(secs)}</b><span>время игры</span></div>
      <div class="rstat"><b>❌ ${total - qz.correct}</b><span>ошибок</span></div>`;

    $("#reviewList").innerHTML = qz.history.map((h) => `
      <div class="review-item ${h.ok ? "ok" : "no"}">
        <div class="review-q">${h.cat} · ${esc(h.q)}</div>
        <div class="review-a">
          Ваш ответ: ${h.yourText == null ? '<span class="badtxt">⌛ время вышло</span>' : `<span class="${h.ok ? "good" : "badtxt"}">${esc(h.yourText)}</span>`}
          ${!h.ok ? ` &nbsp;·&nbsp; Правильно: <span class="good">${esc(h.correctText)}</span>` : ""}
        </div>
      </div>`).join("");

    // история и рекорд
    const entry = {
      date: new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
      topics: topicNamesJoined(), correct: qz.correct, total, percent, score: qz.score, medal,
    };
    const history = storage.get("qd_history", []);
    history.unshift(entry);
    storage.set("qd_history", history.slice(0, 20));
    const best = storage.get("qd_best", null);
    if (!best || qz.score > best.score) storage.set("qd_best", { score: qz.score, percent });

    state.lastSetup = {
      topics: [...state.selectedTopics],
      cats: [...state.selectedCats],
      pool: qz.questions,
    };

    showScreen("result");
    if (percent >= 70 && state.settings.confetti) launchConfetti();
    if (percent >= 50) SoundFX.win(); 
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    return m ? `${m} мин ${s % 60} с` : `${s} с`;
  }

  function animateNumber(el, from, to, dur, fmt) {
    const start = performance.now();
    const step = (now) => {
      const p = clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- Конфетти ---------- */
  function launchConfetti() {
    const canvas = $("#confettiCanvas");
    const ctx = canvas.getContext("2d");
    canvas.width = innerWidth; canvas.height = innerHeight;
    const colors = ["#7c5cff", "#22d3ee", "#ec4899", "#fbbf24", "#34d399"];
    const parts = Array.from({ length: 160 }, () => ({
      x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.5,
      w: 6 + Math.random() * 7, h: 8 + Math.random() * 8,
      vy: 2 + Math.random() * 3.5, vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI, vr: -0.15 + Math.random() * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frames = 0;
    (function loop() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (++frames < 260) requestAnimationFrame(loop);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    })();
  }

  /* ============================================================
     ТЕМА / НАСТРОЙКИ ПРИЛОЖЕНИЯ
     ============================================================ */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    storage.set("qd_theme", theme);
    $("#btnTheme").textContent = theme === "dark" ? "🌙" : "☀️";
  }

  /* ---------- Перехват выхода из игры ---------- */
  function quitQuiz() {
    if (!state.quiz) return;
    if (confirm("Выйти из квиза? Прогресс раунда будет потерян.")) {
      stopTimers();
      state.quiz = null;
      showScreen("home");
      renderHome();
    }
  }

  /* ============================================================
     ПРИВЯЗКА СОБЫТИЙ
     ============================================================ */
  function bind() {
    // Шапка
    $("#btnHome").addEventListener("click", () => {
      if (state.screen === "quiz" && state.quiz) return quitQuiz();
      showScreen("home"); renderHome();
    });
    $("#btnSound").addEventListener("click", () => {
      const on = SoundFX.toggle();
      $("#btnSound").textContent = on ? "🔊" : "🔇";
      toast(on ? "🔊 Звук включён" : "🔇 Звук выключен");
    });
    $("#btnTheme").addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
    $("#btnHelp").addEventListener("click", () => ($("#helpModal").hidden = false));
    $("#btnCloseHelp").addEventListener("click", () => ($("#helpModal").hidden = true));
    $("#helpModal").addEventListener("click", (e) => { if (e.target === $("#helpModal")) $("#helpModal").hidden = true; });

    // Главная
    $("#btnStartFlow").addEventListener("click", () => { SoundFX.click(); renderTopics(""); showScreen("topics"); $("#topicSearch").focus(); });
    $("#btnRandom").addEventListener("click", () => { SoundFX.click(); startRandomQuiz(); });

    // Темы
    $("#topicSearch").addEventListener("input", (e) => renderTopics(e.target.value));
    $("#btnPickAllTopics").addEventListener("click", () => {
      Object.keys(QUESTIONS_DB).forEach((k) => state.selectedTopics.add(k));
      state.selectedCats.clear();
      SoundFX.click(); renderTopics($("#topicSearch").value);
    });
    $("#btnClearTopics").addEventListener("click", () => {
      state.selectedTopics.clear(); state.selectedCats.clear();
      SoundFX.click(); renderTopics($("#topicSearch").value);
    });
    $("#btnToCats").addEventListener("click", () => { SoundFX.click(); goCats(); });

    // Подкатегории
    $("#btnCatsAll").addEventListener("click", () => {
      state.selectedCats.clear(); // пустое множество = «все»
      SoundFX.click(); renderCats();
    });
    $("#btnToSettings").addEventListener("click", () => {
      SoundFX.click(); renderSettings(); showScreen("settings");
    });

    // Настройки
    $("#levelGrid").addEventListener("click", (e) => {
      const card = e.target.closest(".level-card"); if (!card) return;
      state.settings.count = +card.dataset.count; saveSettings();
      $$("#levelGrid .level-card").forEach((b) => b.classList.toggle("selected", b === card));
      SoundFX.click(); updatePoolHint(); updateRecap();
    });
    $("#timerSeg").addEventListener("click", (e) => {
      const b = e.target.closest(".seg-btn"); if (!b) return;
      state.settings.timePerQ = +b.dataset.time; saveSettings();
      $$("#timerSeg .seg-btn").forEach((x) => x.classList.toggle("selected", x === b));
      SoundFX.click(); updateRecap();
    });
    $("#livesSeg").addEventListener("click", (e) => {
      const b = e.target.closest(".seg-btn"); if (!b) return;
      state.settings.lives = +b.dataset.lives; saveSettings();
      $$("#livesSeg .seg-btn").forEach((x) => x.classList.toggle("selected", x === b));
      SoundFX.click(); updateRecap();
    });
    const swMap = { optHardcore: "hardcore", optCombo: "combo", optFacts: "facts", optConfetti: "confetti" };
    Object.entries(swMap).forEach(([id, key]) => {
      $("#" + id).addEventListener("change", (e) => {
        state.settings[key] = e.target.checked; saveSettings();
        SoundFX.click(); updateRecap();
        if (key === "hardcore") {
          $("#timerSeg").querySelector('[data-time="0"]').disabled = e.target.checked;
          if (e.target.checked && state.settings.timePerQ === 0) {
            state.settings.timePerQ = 20;
            $$("#timerSeg .seg-btn").forEach((x) => x.classList.toggle("selected", +x.dataset.time === 20));
          }
          if (e.target.checked) { state.settings.combo = true; $("#optCombo").checked = true; }
          updateRecap();
        }
      });
    });
    $("#btnStartQuiz").addEventListener("click", () => { SoundFX.click(); clearAudienceBars(); startQuiz(); });

    // Игра
    $("#btnQuit").addEventListener("click", quitQuiz);
    $("#btnNext").addEventListener("click", () => { SoundFX.click(); clearAudienceBars(); nextQuestion(); });
    $$(".joker-btn").forEach((b) => b.addEventListener("click", () => useJoker(b.dataset.joker)));

    // Результаты
    $("#btnAgain").addEventListener("click", () => { SoundFX.click(); startRandomQuiz(); });
    $("#btnSameSetup").addEventListener("click", () => {
      SoundFX.click();
      if (state.lastSetup) {
        state.selectedTopics = new Set(state.lastSetup.topics);
        state.selectedCats = new Set(state.lastSetup.cats);
        startQuiz();
      } else startRandomQuiz();
    });
    $("#btnNewQuiz").addEventListener("click", () => { SoundFX.click(); showScreen("topics"); renderTopics(""); });

    // Кнопки «Назад»
    $$("[data-back]").forEach((b) => b.addEventListener("click", () => {
      SoundFX.click();
      const target = b.dataset.back;
      if (target === "topics") { renderTopics($("#topicSearch").value); showScreen("topics"); }
      else showScreen(target);
      if (target === "home") renderHome();
    }));

    // Горячие клавиши
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea")) return;
      const k = e.key;

      if (k === "Escape") {
        if (!$("#helpModal").hidden) { $("#helpModal").hidden = true; return; }
        if (state.screen === "quiz") quitQuiz();
        else if (state.screen !== "home") showScreen("home"), renderHome();
        return;
      }
      if (k === "?" ) { $("#helpModal").hidden = !$("#helpModal").hidden; return; }
      if (k.toLowerCase() === "t" || k === "т") { applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); return; }
      if (k.toLowerCase() === "s" || k === "ы") { $("#btnSound").click(); return; }

      if (state.screen === "quiz" && state.quiz) {
        if (["1", "2", "3", "4"].includes(k)) {
          const idx = +k - 1;
          const btns = $$("#answers .answer-btn");
          if (btns[idx] && !btns[idx].classList.contains("dimmed")) answer(idx);
        }
        if (k === "Enter" || k === " ") { if (!$("#btnNext").hidden) { e.preventDefault(); clearAudienceBars(); nextQuestion(); } }
        if (k === "!" ) useJoker("fifty");
        if (k === "@") useJoker("time");
        if (k === "#") useJoker("audience");
      } else if (state.screen === "result" && (k === "Enter" || k === " ")) {
        e.preventDefault(); $("#btnSameSetup").click();
      }
    });

    window.addEventListener("resize", () => {
      const c = $("#confettiCanvas"); c.width = innerWidth; c.height = innerHeight;
    });
  }

  /* ---------- Старт ---------- */
  function init() {
    applyTheme(storage.get("qd_theme", "dark"));
    $("#btnSound").textContent = SoundFX.enabled ? "🔊" : "🔇";
    renderHome();
    renderQuickPicks();
    renderTopics("");
    bind();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
