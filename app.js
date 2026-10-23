// ============================================================
//  Логика сайта «Тихий ум».
//  Всё содержимое берётся с внешних API (см. config.js):
//   • AdviceSlip  — советы         (CORS ✓)
//   • DummyJSON   — цитаты         (CORS ✓)
//   • MyMemory    — перевод EN→RU  (CORS ✓)
//   • Picsum      — фоновые виды
//   • SoundHelix  — фоновая музыка
//  Звуки природы синтезируются локально через Web Audio API.
// ============================================================

"use strict";

const $ = (sel) => document.querySelector(sel);

/* ------------------------- Общие утилиты ------------------------- */

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function fetchTimeout(url, ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
}

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4500);
}

/* --------------------- Мысль дня (несколько API) --------------------- */
// Цепочка источников: если один недоступен — пробуем следующий,
// в крайнем случае показываем локальную офлайн-подборку.

// Перевод EN → RU через MyMemory; результат кешируется, чтобы
// не сжигать бесплатную дневную квоту API.
async function translateToRu(text) {
  const cached = transCacheGet(text);
  if (cached) return cached;
  const r = await fetchTimeout(API.translate(text));
  if (!r.ok) throw new Error("translate " + r.status);
  const d = await r.json();
  const t = d?.responseData?.translatedText;
  // MyMemory иногда возвращает фразу-подсказку вместо перевода
  if (d?.responseStatus !== 200 || !t || /MYMEMORY WARNING|QUERY LENGTH/i.test(t)) return null;
  transCacheSet(text, t);
  return t;
}

const TRANS_KEY = "zenTrans";

function transCacheGet(text) {
  try { const m = JSON.parse(localStorage.getItem(TRANS_KEY)) || {}; return m[text]; }
  catch { return undefined; }
}

function transCacheSet(text, ru) {
  try {
    const m = JSON.parse(localStorage.getItem(TRANS_KEY)) || {};
    m[text] = ru;
    const keys = Object.keys(m);
    if (keys.length > 400) delete m[keys[0]]; // держим кеш небольшим
    localStorage.setItem(TRANS_KEY, JSON.stringify(m));
  } catch { /* приватный режим — просто без кеша */ }
}

const QUOTE_SOURCES = [
  {
    // Основной источник: тысячи русских цитат, без перевода
    label: "Викицитатник (RU)",
    get: async () => {
      const r1 = await fetchTimeout(API.wikiquote.random());
      const d1 = await r1.json();
      const pages = d1?.query?.random || [];
      if (!pages.length) throw new Error("нет случайных страниц");

      const clean = (s0) => {
        let s = s0;
        for (let i = 0; i < 4; i++) s = s.replace(/\{\{[^{}]*\}\}/g, ""); // вложенные шаблоны
        return s
          .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
          .replace(/<ref[^>]*\/>/g, "")
          .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
          .replace(/\[https?:\/\/\S+\]/g, "")
          .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
          .replace(/\[\[([^\]]+)\]\]/g, "$1")
          .replace(/'{2,}/g, "")
          .replace(/^[:*]+\s*/, "")
          .replace(/^—\s*/, "")
          .trim();
      };

      const HEADING = /^(={2,})\s*([^=]+?)\s*\1$/;

      // Берём только разделы «Цитаты», «Афоризмы», «Высказывания», «Изречения» —
      // биографии и персонажи автоматически отсекаются структурно.
      const collect = (wt) => {
        const items = [];
        let sec = null; // { depth, lastAuthor }
        for (const raw of wt.split("\n")) {
          const line = raw.trim();
          const m = line.match(HEADING);
          if (m) {
            const depth = m[1].length;
            const isQuote = /цитат|афоризм|высказыван|изречен|мудр/i.test(m[2]);
            if (sec && depth > sec.depth) continue; // подзаголовок внутри раздела цитат
            sec = isQuote ? { depth, lastAuthor: "" } : null;
            continue;
          }
          if (!sec) continue;
          if (line.startsWith("**")) { sec.lastAuthor = clean(line); continue; }
          if (line.startsWith("*")) {
            const text = clean(line);
            if (text.length >= 15 && text.length <= 300 && !/^см\./i.test(text)) {
              items.push({ text, author: sec.lastAuthor || "" });
            }
          }
        }
        return items;
      };

      const order = pages.sort(() => Math.random() - 0.5);
      for (const page of order) {
        try {
          const r2 = await fetchTimeout(API.wikiquote.parse(page.title));
          const d2 = await r2.json();
          const wt = d2?.parse?.wikitext?.["*"] || "";
          const items = collect(wt);
          if (!items.length) continue;
          const it = items[Math.floor(Math.random() * items.length)];
          return { text: it.text, author: it.author, source: page.title };
        } catch { /* следующая страница */ }
      }
      throw new Error("на случайных страницах нет цитат");
    },
  },
  {
    label: "Advice Slip API",
    get: async () => {
      const r = await fetchTimeout(API.advice(Date.now()));
      const d = await r.json();
      const text = d?.slip?.advice;
      if (!text) throw new Error("пустой совет");
      const ru = await translateToRu(text).catch(() => null);
      return { text: ru || text, author: "", source: "advice: " + (ru ? "RU (переведено)" : "EN оригинал") };
    },
  },
  {
    label: "DummyJSON · Quotes",
    get: async () => {
      const r = await fetchTimeout(API.quotes);
      const d = await r.json();
      const list = d?.quotes || [];
      const q = list[Math.floor(Math.random() * list.length)];
      if (!q) throw new Error("нет цитат");
      const ru = await translateToRu(q.quote).catch(() => null);
      return { text: ru || q.quote, author: q.author, source: (ru ? "quotes (RU)" : "quotes (EN)") };
    },
  },
];

// Локальный резерв, если все API недоступны (страница открыта офлайн)
const FALLBACK_QUOTES = [
  { text: "Дыхание — это мост между телом и разумом.", author: "Тит Нат Хан" },
  { text: "Спокойный ум сильнее спешащего.", author: "Лао-цзы" },
  { text: "Вы не можете остановить волны, но можете научиться серфингу.", author: "Джон Кабат-Зинн" },
  { text: "Каждое утро мы рождаемся заново. Важно то, чем мы станем сегодня.", author: "Будда" },
  { text: "Тишина — иногда самый лучший ответ.", author: "Народная мудрость" },
  { text: "Не всегда нужно спешить. Медленный шаг тоже приводит к цели.", author: "Моцарт" },
];

const TOPIC_QUOTES = {
  stoic: [
    { text: "Нас тревожат не вещи вокруг, а наше мнение о них.", author: "Эпиктет", label: "Стоицизм · Внутренняя опора" },
    { text: "Спокойствие — не что иное, как надлежащий порядок в мыслях.", author: "Марк Аврелий", label: "Стоицизм · Размышления" },
    { text: "Мы страдаем чаще в воображении, чем в реальности.", author: "Сенека", label: "Стоицизм · Нравственные письма" },
    { text: "У вас есть власть над своим разумом, а не над внешними событиями. Осознайте это — и обретёте силу.", author: "Марк Аврелий", label: "Стоицизм · Крепость духа" },
    { text: "Тот, кто боится будущего, теряет настоящее.", author: "Сенека", label: "Стоицизм · О скоротечности жизни" },
    { text: "Счастье твоей жизни зависит от качества твоих мыслей.", author: "Марк Аврелий", label: "Стоицизм · Осознанность" },
    { text: "Не требуй, чтобы события происходили так, как ты хочешь; желай, чтобы они происходили так, как происходят.", author: "Эпиктет", label: "Стоицизм · Принятие" },
  ],
  zen: [
    { text: "Путь в тысячу ли начинается с одного спокойного шага.", author: "Лао-цзы", label: "Дао дэ цзин" },
    { text: "Сидя тихо, ничего не делая, весна приходит, и трава растёт сама собой.", author: "Дзенский коан", label: "Дзен · Естественность" },
    { text: "Вода преодолевает препятствия не силой, а мягкостью и текучестью.", author: "Лао-цзы", label: "Дао · Путь воды" },
    { text: "Когда ум чист, весь мир вокруг становится ясным зеркалом.", author: "Бодхидхарма", label: "Дзен · Чистый ум" },
    { text: "В уме новичка содержится множество возможностей, в уме эксперта — лишь несколько.", author: "Сюнрю Судзуки", label: "Дзен · Сознание новичка" },
    { text: "Не ищите истину вовне, просто перестаньте цепляться за суждения.", author: "Сен-цан", label: "Дзен · Доверие сердцу" },
    { text: "Если чашка полна, в неё невозможно ничего налить. Опустошите свой ум.", author: "Притча о мастере", label: "Дзен · Пустота" },
  ],
  mind: [
    { text: "Дыхание — это якорь, возвращающий нас в настоящий момент.", author: "Тит Нат Хан", label: "Осознанность · Мир в каждом шаге" },
    { text: "Прошлое уже ушло, будущее ещё не наступило. Есть только здесь и сейчас.", author: "Будда Гаутама", label: "Осознанность · Настоящее" },
    { text: "Осознанность — это способность заметить происходящее прямо сейчас без критики.", author: "Джон Кабат-Зинн", label: "MBSR · Практика" },
    { text: "Настоящая медитация начинается тогда, когда вы встаете с коврика в повседневную жизнь.", author: "Джидду Кришнамурти", label: "Осознанность · Жизнь" },
    { text: "Примите то, что есть, и только тогда начнётся подлинная трансформация.", author: "Экхарт Толле", label: "Сила настоящего" },
    { text: "Улыбнитесь своему дыханию. Это величайший подарок жизни.", author: "Тит Нат Хан", label: "Осознанность · Радость" },
  ],
};

let currentTopic = "all";

function saveThought(data) {
  try { localStorage.setItem("zenThought", JSON.stringify(data)); } catch { /* приватный режим */ }
}

const TOD_MOOD_TAG = {
  morning: "🌅 Утреннее намерение",
  day:     "☀️ Дневная пауза",
  evening: "🌙 Вечернее замедление",
  night:   "✨ Ночная тишина",
};

function renderQuote(text, author, label, warn) {
  $("#quoteText").classList.remove("skel");
  $("#quoteText").textContent = `«${text}»`;
  $("#quoteAuthor").textContent = author ? `— ${author}` : "";
  const tag = $("#quoteSource");
  tag.textContent = label;
  tag.classList.toggle("warn", !!warn);
  const moodTag = $("#quoteMood");
  if (moodTag) moodTag.textContent = TOD_MOOD_TAG[timeOfDayName()] || "✨ Мудрость";
}

async function loadQuote(topic = currentTopic) {
  currentTopic = topic;
  const tag = $("#quoteSource");
  tag.textContent = "загружаем…";
  tag.classList.remove("warn");
  $("#quoteText").classList.add("skel");

  if (topic !== "all" && TOPIC_QUOTES[topic]) {
    const list = TOPIC_QUOTES[topic];
    const item = list[Math.floor(Math.random() * list.length)];
    renderQuote(item.text, item.author, item.label);
    return;
  }

  for (const src of QUOTE_SOURCES) {
    try {
      const q = await src.get();
      renderQuote(q.text, q.author, src.label + " · " + q.source);
      saveThought({ date: new Date().toDateString(), text: q.text, author: q.author, label: src.label + " · " + q.source });
      return;
    } catch { /* пробуем следующий источник */ }
  }
  const q = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
  renderQuote(q.text, q.author, "офлайн-подборка", true);
}

// Переключение рубрик мудрости
document.querySelectorAll(".qt-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".qt-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const topic = btn.dataset.topic || "all";
    loadQuote(topic);
  });
});

// «Мысль дня»: один раз за день берём с API и кешируем локально
function initThought() {
  try {
    const saved = JSON.parse(localStorage.getItem("zenThought") || "null");
    if (saved && saved.date === new Date().toDateString()) {
      renderQuote(saved.text, saved.author, saved.label + " · из кеша");
      return;
    }
  } catch { /* ignore */ }
  loadQuote();
}

/* ------------------------- Дыхательные практики ------------------------- */

const PATTERNS = [
  { name: "4 · 7 · 8", sub: "глубокое успокоение перед сном",
    phases: [ { t: "Вдох", d: 4, s: 1 }, { t: "Задержка", d: 7, s: null }, { t: "Выдох", d: 8, s: 0.55 } ] },
  { name: "Квадрат 4·4·4·4", sub: "концентрация и ясность",
    phases: [ { t: "Вдох", d: 4, s: 1 }, { t: "Пауза", d: 4, s: null }, { t: "Выдох", d: 4, s: 0.55 }, { t: "Пауза", d: 4, s: null } ] },
  { name: "5 · 5", sub: "мягкая релаксация днём",
    phases: [ { t: "Вдох", d: 5, s: 1 }, { t: "Выдох", d: 5, s: 0.55 } ] },
  { name: "4 · 6", sub: "антистресс: выдох чуть длиннее вдоха",
    phases: [ { t: "Вдох", d: 4, s: 1 }, { t: "Выдох", d: 6, s: 0.55 } ] },
  { name: "Вздох 3·1·6", sub: "физиологический вздох: двойной вдох для быстрого снятия стресса",
    phases: [ { t: "Вдох", d: 3, s: 0.88 }, { t: "Довдох", d: 1.5, s: 1.0 }, { t: "Выдох", d: 6, s: 0.55 } ] },
  { name: "7 · 8", sub: "для засыпания: очень медленный ритм",
    phases: [ { t: "Вдох", d: 7, s: 1 }, { t: "Выдох", d: 8, s: 0.55 } ] },
];

let breathRunning = false;
let breathGen = 0;
let breathCycles = 0;
let currentPattern = 0;

const circle = $("#breathCircle");
const petals = $("#breathPetals");
const label = $("#breathLabel");
const breathBtn = $("#breathBtn");

function alive(gen) { return breathRunning && gen === breathGen; }

// Дуга-прогресс фазы: заполняется на вдохе, стекает на выдохе
function arcTo(target, dur) {
  const arc = document.getElementById("phaseArc");
  if (!arc) return;
  arc.classList.remove("hold");
  arc.style.transitionDuration = dur + "s";
  arc.style.strokeDashoffset = target;
}

// Фаза дыхания дублируется в заголовок вкладки (таймер сеанса главнее)
function setBreathTitle(text) {
  if (tRunning) return;
  document.title = text ? `${text} · Тихий ум` : "Тихий ум — медитация и дыхание";
}

/* ---------------- Дыхательные отклики: whoosh и вибро-такт ---------------- */

let breathFx = false;
try { breathFx = localStorage.getItem("zenBreathFx") === "1"; } catch { /* ignore */ }

let whooshRef = null;

function whooshQuiet(tau) {
  if (!whooshRef) return;
  const now = AC.currentTime;
  whooshRef.g.gain.cancelScheduledValues(now);
  whooshRef.g.gain.setTargetAtTime(0.0001, now, tau);
}

function whooshStart() {
  if (whooshRef) return whooshRef;
  const len = 2 * AC.sampleRate;
  const buf = AC.createBuffer(1, len, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = AC.createBufferSource();
  src.buffer = buf; src.loop = true;
  const f = AC.createBiquadFilter(); f.type = "lowpass";
  f.frequency.value = 300; f.Q.value = 0.3;
  const g = AC.createGain(); g.gain.value = 0.0001;
  src.connect(f); f.connect(g); g.connect(master);
  src.start();
  whooshRef = { f, g };
  return whooshRef;
}

// Вдох — мягкий набор воздуха, выдох — спад, задержка — почти замирание
function shapeWhoosh(ph) {
  if (!breathFx || !AC) return;
  ensureAudio();
  const w = whooshStart();
  const now = AC.currentTime;
  const cur = Math.max(0.0001, w.g.gain.value);
  w.g.gain.cancelScheduledValues(now);
  w.f.frequency.cancelScheduledValues(now);
  if (ph.t === "Довдох") {
    w.g.gain.setValueAtTime(cur, now);
    w.g.gain.linearRampToValueAtTime(0.075, now + ph.d);
    w.f.frequency.setValueAtTime(450, now);
    w.f.frequency.linearRampToValueAtTime(820, now + ph.d);
  } else if (ph.t.includes("Вдох")) {
    w.g.gain.setValueAtTime(cur, now);
    w.g.gain.linearRampToValueAtTime(0.06, now + ph.d);
    w.f.frequency.setValueAtTime(300, now);
    w.f.frequency.linearRampToValueAtTime(750, now + ph.d);
  } else if (ph.t.includes("Выдох")) {
    w.g.gain.setValueAtTime(cur, now);
    w.g.gain.linearRampToValueAtTime(0.0001, now + ph.d);
    w.f.frequency.setValueAtTime(750, now);
    w.f.frequency.linearRampToValueAtTime(280, now + ph.d);
  } else { // «Задержка» и «Пауза»
    w.g.gain.setValueAtTime(cur, now);
    w.g.gain.linearRampToValueAtTime(0.012, now + Math.min(1.2, ph.d));
  }
}

const fxChip = $("#breathFxChip");
function fxChipUI() {
  fxChip.classList.toggle("active", breathFx);
  fxChip.setAttribute("aria-pressed", String(breathFx));
}
fxChip.addEventListener("click", () => {
  breathFx = !breathFx;
  try { localStorage.setItem("zenBreathFx", breathFx ? "1" : "0"); } catch { /* ignore */ }
  fxChipUI();
  if (breathFx && breathRunning) ensureAudio();
  if (!breathFx) whooshQuiet(0.15);
});
fxChipUI();

function breathPhase(ph, gen) {
  return new Promise((resolve) => {
    say(ph.t);
    if (breathFx) {
      shapeWhoosh(ph);
      if (!ph.t.includes("Задержка") && !ph.t.includes("Пауза")) navigator.vibrate?.(25);
    }
    if (ph.s !== null) {
      circle.style.transitionDuration = ph.d + "s";
      circle.style.transform = `scale(${ph.s})`;
      if (petals) {
        petals.style.transitionDuration = ph.d + "s";
        petals.style.transform = `scale(${ph.s})`;
      }
      arcTo(ph.t.includes("Вдох") ? 0 : 100, ph.d);
    } else {
      document.getElementById("phaseArc")?.classList.add("hold");
    }
    let left = ph.d;
    label.textContent = `${ph.t} · ${left}`;
    setBreathTitle(`${ph.t} · ${left}с`);
    const iv = setInterval(() => {
      if (!alive(gen)) { clearInterval(iv); resolve(); return; }
      left--;
      if (left <= 0) { clearInterval(iv); resolve(); }
      else {
        label.textContent = `${ph.t} · ${left}`;
        setBreathTitle(`${ph.t} · ${left}с`);
      }
    }, 1000);
  });
}

function stopBreath() {
  breathRunning = false;
  breathGen++;
  whooshQuiet(0.15);
  circle.classList.remove("idle"); // перезапуск idle-анимации
  void circle.offsetWidth;
  circle.classList.add("idle");
  circle.style.transform = "";
  if (petals) petals.style.transform = "";
  arcTo(100, 0.6);
  setBreathTitle("");
  label.textContent = "Готовы?";
  breathBtn.textContent = "Начать дыхание";
}

async function startBreath() {
  breathRunning = true;
  const gen = ++breathGen;
  breathCycles = 0;
  $("#cycleCount").textContent = "0";
  lotusRender(0);
  circle.classList.remove("idle");
  breathBtn.textContent = "Остановить";
  say(pick(PHRASES.breathStart));

  // мягкий вход
  label.textContent = "Приготовьтесь…";
  setBreathTitle("Приготовьтесь");
  circle.style.transitionDuration = "1.2s";
  circle.style.transform = "scale(0.4)";
  if (petals) {
    petals.style.transitionDuration = "1.2s";
    petals.style.transform = "scale(0.4)";
  }
  arcTo(100, 1.2);
  await sleep(1300);
  if (!alive(gen)) return stopBreath();

  while (alive(gen)) {
    for (const ph of PATTERNS[currentPattern].phases) {
      await breathPhase(ph, gen);
      if (!alive(gen)) return stopBreath();
    }
    breathCycles++;
    $("#cycleCount").textContent = breathCycles;
    lotusRender(breathCycles);
    if (breathCycles === 8) toast("🪷 Цветок практики расцвёл — восемь циклов.");
    if (breathCycles % 4 === 0) {
      toast(`Мягко и ровно: ${breathCycles} циклов.`);
      say(pick(PHRASES.cycles));
    }
  }
}

breathBtn.addEventListener("click", () => (breathRunning ? stopBreath() : startBreath()));

// Чипы выбора ритма (выбор запоминается)
const chipsBox = $("#patternChips");
try {
  const savedPat = Number(localStorage.getItem("zenPattern"));
  if (Number.isInteger(savedPat) && savedPat >= 0 && savedPat < PATTERNS.length) currentPattern = savedPat;
} catch { /* ignore */ }
PATTERNS.forEach((p, i) => {
  const b = document.createElement("button");
  b.className = "chip" + (i === currentPattern ? " active" : "");
  b.textContent = p.name;
  b.addEventListener("click", () => setPattern(i));
  chipsBox.appendChild(b);
});
// Выбор ритма одной функцией — ею пользуются чипы и сценарии
function setPattern(i) {
  currentPattern = i;
  try { localStorage.setItem("zenPattern", String(i)); } catch { /* ignore */ }
  [...chipsBox.children].forEach((c, j) => c.classList.toggle("active", j === i));
  updatePatternHint();
  applyCycleVar();
}
// Ритм задаёт не только практику, но и «дыхание» живых деталей интерфейса
function applyCycleVar() {
  const cycle = PATTERNS[currentPattern].phases.reduce((s, p) => s + p.d, 0);
  document.documentElement.style.setProperty("--breath-cycle", `${cycle}s`);
}
applyCycleVar();
function updatePatternHint() {
  $("#patternHint").textContent = `${PATTERNS[currentPattern].name} — ${PATTERNS[currentPattern].sub}`;
}

/* ── Чек-ин самочувствия и умный подбор практики ── */
const MOOD_RECS = {
  stress: {
    rec: "💡 Рекомендация: Дыхание «Вздох 3·1·6» + «Снятие зажимов»",
    pattern: 4,
    toast: "Подобран ритм «Вздох 3·1·6» для быстрого снятия стресса ✨",
  },
  tired: {
    rec: "💡 Рекомендация: Мягкий ритм 5·5 + микс «Уютный чердак»",
    pattern: 2,
    toast: "Включен мягкий ритм 5·5 для восстановления сил 🌿",
  },
  calm: {
    rec: "💡 Рекомендация: Глубокое дыхание 4·7·8 + микс «Обитель покоя»",
    pattern: 0,
    toast: "Активирован глубокий расслабляющий ритм 4·7·8 🌙",
  },
  focus: {
    rec: "💡 Рекомендация: Дыхание «Квадрат 4·4·4·4» для концентрации",
    pattern: 1,
    toast: "Выбран «Квадрат 4·4·4·4» для собранности и ясности ⚡",
  },
};

document.querySelectorAll(".mc-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mc-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const m = btn.dataset.mood;
    const info = MOOD_RECS[m];
    if (info) {
      const recEl = $("#mcRec");
      if (recEl) {
        recEl.hidden = false;
        recEl.textContent = info.rec;
      }
      setPattern(info.pattern);
      toast(info.toast);
    }
  });
});

/* ------------------------- Таймер медитации ------------------------- */

const RING_C = 2 * Math.PI * 88;
let tTotal = 300, tLeft = 300, tEnd = 0, tRunning = false, tIv = null;
let anchorMin = 0, anchorNextMark = 1; // 🔔 якорь: мягкий звонок каждые N минут сеанса

const ringVal = $("#ringVal");
const timerText = $("#timerText");
const timerBtn = $("#timerBtn");

function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function renderTimer() {
  timerText.textContent = fmt(tLeft);
  ringVal.style.strokeDashoffset = RING_C * (1 - (tTotal - tLeft) / tTotal);
  document.title = tRunning ? `${fmt(tLeft)} · Тихий ум` : "Тихий ум — медитация и дыхание";
  const endEl = $("#timerEndTime");
  if (endEl) {
    if (tRunning && tEnd > 0) {
      const d = new Date(tEnd);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      endEl.textContent = `Завершится в ${hh}:${mm}`;
      endEl.classList.add("active");
    } else {
      endEl.textContent = `Сеанс: ${Math.round(tTotal / 60)} мин`;
      endEl.classList.remove("active");
    }
  }
}

function timerTick() {
  tLeft = (tEnd - Date.now()) / 1000;
  if (tLeft <= 0) { finishTimer(); return; }
  renderTimer();
  if (anchorMin > 0) { // 🔔 якорь звенит по ходу сеанса — пауза и сброс учитываются автоматически
    const passed = Math.floor((tTotal - tLeft) / (anchorMin * 60));
    if (passed >= anchorNextMark) { anchorNextMark = passed + 1; anchorBell(); }
  }
}

function finishTimer() {
  clearInterval(tIv);
  ambientStop(); // тихий фон плавно уходит — остаются колокол и голос
  if (breathSync && breathRunning) stopBreath();
  navigator.vibrate?.([120, 60, 200]);
  tRunning = false;
  tLeft = tTotal;
  tIv = null;
  timerBtn.textContent = "Старт";
  say(pick(PHRASES.finish));
  ringVal.style.strokeDashoffset = 0; // красивый заполненный круг
  bell();
  const min = tTotal / 60;
  statsAdd(min);
  toast(`Готово! ${min} минут практики за вами. ⏳`);
  loadQuote(); // свежая мысль после сессии
  setTimeout(renderTimer, 1200);
}

timerBtn.addEventListener("click", () => {
  if (tRunning) {
    clearInterval(tIv);
    tLeft = Math.max(0, (tEnd - Date.now()) / 1000);
    tRunning = false;
    timerBtn.textContent = "Старт";
    renderTimer();
    if (breathSync && breathRunning) stopBreath(); // пауза — дыхание тоже отдыхает
  } else {
    ensureAudio(); // чтобы звонок гарантированно сработал
    tEnd = Date.now() + tLeft * 1000;
    tRunning = true;
    anchorNextMark = 1;
    timerBtn.textContent = "Пауза";
    say(pick(PHRASES.timerStart));
    tIv = setInterval(timerTick, 200);
    ambientStart();
    if (breathSync) startBreath(); // сеанс дышит вместе с вами
  }
});

$("#timerReset").addEventListener("click", () => {
  clearInterval(tIv); tIv = null;
  ambientStop();
  if (breathSync && breathRunning) stopBreath();
  tRunning = false; tLeft = tTotal;
  anchorNextMark = 1;
  timerBtn.textContent = "Старт";
  renderTimer();
});

// Чипы длительности (+ своя)
const timerChips = $("#timerChips");
function setDurationMin(min, chipEl) {
  if (tRunning) return;
  tTotal = min * 60; tLeft = tTotal;
  [...timerChips.children].forEach((c) => c.classList.remove("active"));
  const el = chipEl || [...timerChips.children].find((c) => c.textContent === `${min} мин`);
  el?.classList.add("active");
  renderTimer();
  try { localStorage.setItem("zenLastDur", String(min)); } catch { /* ignore */ } // память таймера
}
[5, 10, 15, 20, 30].forEach((min) => {
  const b = document.createElement("button");
  b.className = "chip" + (min === 5 ? " active" : "");
  b.textContent = `${min} мин`;
  b.addEventListener("click", () => setDurationMin(min, b));
  timerChips.appendChild(b);
});

// Своя длительность: чип превращается в поле ввода минут
const customChip = document.createElement("button");
customChip.className = "chip";
customChip.textContent = "＋ Своя";
customChip.title = "Своя длительность — от 1 до 180 минут";
customChip.addEventListener("click", () => {
  if (tRunning || document.getElementById("customMin")) return;
  const inp = document.createElement("input");
  inp.id = "customMin";
  inp.type = "number"; inp.min = 1; inp.max = 180;
  inp.className = "custom-min";
  inp.placeholder = "мин";
  inp.title = "Минуты (1–180). Enter — применить, Esc — отмена";
  customChip.replaceWith(inp);
  inp.focus();
  let applied = false; // защита от двойного срабатывания (Enter + blur)
  const apply = () => {
    if (applied) return;
    applied = true;
    const m = Math.min(180, Math.max(1, Math.round(Number(inp.value) || 5)));
    if (inp.parentNode) inp.replaceWith(customChip);
    customChip.textContent = `⏱ ${m} мин`;
    setDurationMin(m, customChip);
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") apply();
    if (e.key === "Escape" && !applied) { applied = true; if (inp.parentNode) inp.replaceWith(customChip); }
  });
  inp.addEventListener("blur", apply);
});
timerChips.appendChild(customChip);

/* --------- 🔔 Якорь: звонок-напоминание каждые N минут --------- */

const anchorChipsBox = $("#anchorChips");
const ANCHOR_OPTS = [0, 5, 10, 15, 20];
ANCHOR_OPTS.forEach((min, i) => {
  const b = document.createElement("button");
  b.className = "chip";
  b.textContent = min === 0 ? "Выкл" : `${min} мин`;
  b.title = "Мягкий звонок-напоминание вернуться к дыханию";
  b.addEventListener("click", () => {
    anchorMin = min;
    anchorNextMark = 1;
    try { localStorage.setItem("zenAnchor", String(min)); } catch { /* ignore */ }
    [...anchorChipsBox.children].forEach((c, j) => c.classList.toggle("active", j === i));
    toast(min === 0
      ? "🔔 Якорь выключен."
      : `🔔 Звонок-якорь каждые ${min} минут — тихо напомнит вернуться к дыханию.`);
  });
  anchorChipsBox.appendChild(b);
});
function anchorChipsUI() {
  [...anchorChipsBox.children].forEach((c, j) => c.classList.toggle("active", ANCHOR_OPTS[j] === anchorMin));
}
anchorChipsUI();
try {
  const savedAnchor = Number(localStorage.getItem("zenAnchor"));
  if (ANCHOR_OPTS.includes(savedAnchor)) { anchorMin = savedAnchor; anchorChipsUI(); }
} catch { /* ignore */ }

// ⏱ Память таймера: последняя длительность ждёт при следующем визите
try {
  const savedDur = Number(localStorage.getItem("zenLastDur"));
  if (Number.isInteger(savedDur) && savedDur >= 1 && savedDur <= 180) {
    const chip = [...timerChips.children].find((c) => c.textContent === `${savedDur} мин`);
    if (chip) chip.click();
    else { // своя длительность — вернуть кастом-чип с этим числом
      customChip.textContent = `⏱ ${savedDur} мин`;
      setDurationMin(savedDur, customChip);
    }
  }
} catch { /* ignore */ }

/* --------- Дыхание вместе с сеансом таймера --------- */

let breathSync = false;
try { breathSync = localStorage.getItem("zenBreathSync") === "1"; } catch { /* ignore */ }

const syncChip = $("#syncBreathChip");
function syncChipUI() {
  syncChip.classList.toggle("active", breathSync);
  syncChip.setAttribute("aria-pressed", String(breathSync));
}
syncChip.addEventListener("click", () => {
  breathSync = !breathSync;
  try { localStorage.setItem("zenBreathSync", breathSync ? "1" : "0"); } catch { /* ignore */ }
  syncChipUI();
  if (tRunning && breathSync && !breathRunning) startBreath();
  if (!breathSync && breathRunning) stopBreath();
});
syncChipUI();

/* ------------------------- Звук: Web Audio ------------------------- */

let AC = null, master = null, masterVol = 0.6;

function ensureAudio() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain();
    master.gain.value = masterVol;
    master.connect(AC.destination);
  }
  if (AC.state === "suspended") AC.resume();
  return AC;
}

const noiseBufs = {};
function noiseBuffer(kind) {
  if (noiseBufs[kind]) return noiseBufs[kind];
  const c = ensureAudio();
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === "brown") {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  } else {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  noiseBufs[kind] = buf;
  return buf;
}

function filter(type, freq, q) {
  const f = AC.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  if (q) f.Q.value = q;
  return f;
}

/* ——— Пространственный звук: у каждого источника своё место ——— */

const SOUND_PAN = {
  rain: -0.3, stream: 0.42, ocean: 0, wind: -0.45, thunder: -0.12,
  noise: 0, bowl: 0.12, birds: -0.55, fire: 0.3, crickets: 0.5, chimes: 0.6,
  purr: 0, roof: -0.25, train: 0.3,
};
let spatialOn = true;
try { spatialOn = localStorage.getItem("zenSpatial") !== "0"; } catch { /* ignore */ }
const panCache = {};

function soundPan(key) {
  const cached = panCache[key];
  if (cached) return cached;
  const p = AC.createStereoPanner();
  const jitter = (Math.random() - 0.5) * 0.3; // лёгкая случайность — панорама живая
  p.pan.value = spatialOn ? Math.max(-0.9, Math.min(0.9, (SOUND_PAN[key] || 0) + jitter)) : 0;
  p.connect(master);
  panCache[key] = p;
  return p;
}

function applySpatial() {
  if (!AC) return;
  const now = AC.currentTime;
  const smooth = AC.state === "running"; // на живом контексте — мягкий переход
  for (const [key, p] of Object.entries(panCache)) {
    const jitter = (Math.random() - 0.5) * 0.3;
    const target = spatialOn ? Math.max(-0.9, Math.min(0.9, (SOUND_PAN[key] || 0) + jitter)) : 0;
    if (smooth) p.pan.setTargetAtTime(target, now, 0.3);
    else p.pan.value = target; // контекст ещё не запущен — значение сразу
  }
}

// Чип стерео — состояние запоминается
const spatialChip = $("#spatialChip");
function spatialChipUI() {
  spatialChip.classList.toggle("active", spatialOn);
  spatialChip.setAttribute("aria-pressed", String(spatialOn));
}
spatialChip.addEventListener("click", () => {
  spatialOn = !spatialOn;
  try { localStorage.setItem("zenSpatial", spatialOn ? "1" : "0"); } catch { /* ignore */ }
  spatialChipUI();
  applySpatial();
  toast(spatialOn ? "🎧 Стерео: у каждого звука своё место." : "Звуки вернулись в центр.");
});
spatialChipUI();

/* ——— 🎵 Тон-дрон: глубокий медитативный тон с обертонами ——— */
const DRONE_FREQS = [
  { id: "111", name: "111 Гц", hz: 111 },
  { id: "om", name: "🕉 Ом 136.1", hz: 136.1 },
  { id: "174", name: "174 Гц", hz: 174 },
  { id: "432", name: "432 Гц", hz: 432 },
];
let droneFreqIdx = 1;
try {
  const d = Number(localStorage.getItem("zenDroneFreq"));
  if (Number.isInteger(d) && d >= 0 && d < DRONE_FREQS.length) droneFreqIdx = d;
} catch { /* ignore */ }

const BUILDERS = {
  rain() {
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("white"); src.loop = true;
    const hp = filter("highpass", 400);
    const bp = filter("bandpass", 1600, 0.6);
    const g = AC.createGain(); g.gain.value = 0;
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(soundPan("rain"));
    src.start();
    return { g, level: 0.5 };
  },
  ocean() {
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("brown"); src.loop = true;
    const lp = filter("lowpass", 480);
    const g = AC.createGain(); g.gain.value = 0;
    // медленные «приливы» громкости
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.08;
    const lfoG = AC.createGain(); lfoG.gain.value = 0.25;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(soundPan("ocean"));
    src.start(); lfo.start();
    return { g, level: 0.45, base: 0.35 };
  },
  wind() {
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("white"); src.loop = true;
    const bp = filter("bandpass", 500, 1);
    const g = AC.createGain(); g.gain.value = 0;
    // ветер «дует порывами»: частота фильтра плавает
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.3;
    const lfoG = AC.createGain(); lfoG.gain.value = 250;
    lfo.connect(lfoG); lfoG.connect(bp.frequency);
    src.connect(bp); bp.connect(g); g.connect(soundPan("wind"));
    src.start(); lfo.start();
    return { g, level: 0.4 };
  },
  stream() {
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("white"); src.loop = true;
    const hp = filter("highpass", 500);
    const bp = filter("bandpass", 1100, 0.9);
    const g = AC.createGain(); g.gain.value = 0;
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.18;
    const lfoG = AC.createGain(); lfoG.gain.value = 320;
    lfo.connect(lfoG); lfoG.connect(bp.frequency);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(soundPan("stream"));
    src.start(); lfo.start();
    return { g, level: 0.35 };
  },
  thunder() {
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("brown"); src.loop = true;
    const lp = filter("lowpass", 140);
    const g = AC.createGain(); g.gain.value = 0;
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.05;
    const lfoG = AC.createGain(); lfoG.gain.value = 0.3;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(soundPan("thunder"));
    src.start(); lfo.start();
    return { g, level: 0.6, base: 0.45 };
  },
  noise() {
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("white"); src.loop = true;
    const lp = filter("lowpass", 3600);
    const g = AC.createGain(); g.gain.value = 0;
    src.connect(lp); lp.connect(g); g.connect(soundPan("noise"));
    src.start();
    return { g, level: 0.22 };
  },
  purr() {
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("brown"); src.loop = true;
    const lp = filter("lowpass", 160);
    const bp = filter("bandpass", 80, 2);
    const g = AC.createGain(); g.gain.value = 0;
    const lfo = AC.createOscillator(); lfo.frequency.value = 26;
    const lfoG = AC.createGain(); lfoG.gain.value = 0.45;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    const sub = AC.createOscillator(); sub.type = "sine"; sub.frequency.value = 52;
    const subG = AC.createGain(); subG.gain.value = 0.08;
    sub.connect(subG); subG.connect(g);
    src.connect(lp); lp.connect(bp); bp.connect(g); g.connect(soundPan("purr"));
    src.start(); lfo.start(); sub.start();
    return { g, level: 0.55, base: 0.4 };
  },
  roof() {
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("white"); src.loop = true;
    const lp = filter("lowpass", 420);
    const bp = filter("bandpass", 320, 1.2);
    const g = AC.createGain(); g.gain.value = 0;
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.2;
    const lfoG = AC.createGain(); lfoG.gain.value = 0.15;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(bp); bp.connect(g); g.connect(soundPan("roof"));
    src.start(); lfo.start();
    return { g, level: 0.48, base: 0.38 };
  },
  train() {
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("brown"); src.loop = true;
    const lp = filter("lowpass", 240);
    const g = AC.createGain(); g.gain.value = 0;
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.75;
    const lfoG = AC.createGain(); lfoG.gain.value = 0.35;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(soundPan("train"));
    src.start(); lfo.start();
    return { g, level: 0.42, base: 0.3 };
  },
};

// Музыка: каждый раз случайный трек из каталога SoundHelix (см. config.js)
const sounds = {};
const musicAudio = new Audio();
musicAudio.loop = true;

// Периодические звуки: тибетская чаша и птичьи трели
const SCHEDULERS = {
  bowl() {
    let alive = true;
    const strike = () => {
      if (!alive) return;
      ensureAudio();
      const now = AC.currentTime;
      const partials = [432, 864.7, 1246, 1731];
      partials.forEach((f, i) => {
        const o = AC.createOscillator(); o.type = "sine";
        o.frequency.value = f * (1 + (Math.random() * 0.004 - 0.002));
        const g = AC.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.5 / (i + 1.4), now + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 6 + i * 0.6);
        o.connect(g); g.connect(soundPan("bowl"));
        o.start(now); o.stop(now + 9);
      });
      setTimeout(strike, 9000 + Math.random() * 9000);
    };
    strike();
    return () => { alive = false; };
  },
  birds() {
    let alive = true;
    const chorus = () => {
      if (!alive) return;
      ensureAudio();
      const notes = 2 + Math.floor(Math.random() * 4);
      const base = 2600 + Math.random() * 1600;
      for (let i = 0; i < notes; i++) {
        const t0 = AC.currentTime + i * (0.09 + Math.random() * 0.07);
        const f = base * (0.9 + Math.random() * 0.25);
        const o = AC.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(f, t0);
        o.frequency.linearRampToValueAtTime(f * (0.85 + Math.random() * 0.4), t0 + 0.05);
        const g = AC.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.05, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);
        o.connect(g); g.connect(soundPan("birds"));
        o.start(t0); o.stop(t0 + 0.09);
      }
      setTimeout(chorus, 1400 + Math.random() * 4600);
    };
    chorus();
    return () => { alive = false; };
  },
  fire() {
    let alive = true;
    const crackle = () => {
      if (!alive) return;
      ensureAudio();
      const pops = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < pops; i++) {
        const t0 = AC.currentTime + Math.random() * 0.12;
        const src = AC.createBufferSource();
        src.buffer = noiseBuffer("white");
        const bp = filter("bandpass", 1200 + Math.random() * 2200, 1.2);
        const g = AC.createGain();
        const v = 0.05 + Math.random() * 0.12;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(v, t0 + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05 + Math.random() * 0.06);
        src.connect(bp); bp.connect(g); g.connect(soundPan("fire"));
        src.start(t0); src.stop(t0 + 0.25);
      }
      setTimeout(crackle, 250 + Math.random() * 700);
    };
    crackle();
    return () => { alive = false; };
  },
  crickets() {
    let alive = true;
    const chirp = () => {
      if (!alive) return;
      ensureAudio();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const t0 = AC.currentTime + i * 0.07;
        const o = AC.createOscillator(); o.type = "square";
        o.frequency.value = 4200 + Math.random() * 600;
        const bp = filter("bandpass", 4500, 4);
        const g = AC.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
        o.connect(bp); bp.connect(g); g.connect(soundPan("crickets"));
        o.start(t0); o.stop(t0 + 0.07);
      }
      setTimeout(chirp, 900 + Math.random() * 2200);
    };
    chirp();
    return () => { alive = false; };
  },
  chimes() {
    let alive = true;
    const PENTA = [523.25, 587.33, 659.25, 783.99, 880];
    const ding = () => {
      if (!alive) return;
      ensureAudio();
      const now = AC.currentTime;
      const f = pick(PENTA);
      [1, 2.76, 5.4].forEach((m, i) => {
        const o = AC.createOscillator(); o.type = "sine";
        o.frequency.value = f * m * (1 + (Math.random() * 0.004 - 0.002));
        const g = AC.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.12 / (i + 1), now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 2.6 - i * 0.5);
        o.connect(g); g.connect(soundPan("chimes"));
        o.start(now); o.stop(now + 3);
      });
      setTimeout(ding, 2500 + Math.random() * 5000);
    };
    ding();
    return () => { alive = false; };
  },
  drone() {
    const hz = DRONE_FREQS[droneFreqIdx].hz;
    const g = AC.createGain(); g.gain.value = 0;
    // покачивание живёт в отдельной ступени — выключенный тон молчит полностью
    const vib = AC.createGain(); vib.gain.value = 1;
    const oscs = [];
    [[1, 0.55], [2.004, 0.17], [1.5, 0.09]].forEach(([m, lv]) => {
      const o = AC.createOscillator(); o.type = "sine";
      o.frequency.value = hz * m;
      const og = AC.createGain(); og.gain.value = lv;
      o.connect(og); og.connect(vib);
      o.start(); oscs.push(o);
    });
    // совсем медленное покачивание — тон дышит и не замерзает
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.06;
    const lfoG = AC.createGain(); lfoG.gain.value = 0.14;
    lfo.connect(lfoG); lfoG.connect(vib.gain);
    lfo.start(); oscs.push(lfo);
    vib.connect(g); g.connect(soundPan("drone"));
    return {
      g, level: 0.4,
      dispose: () => oscs.forEach((o) => { try { o.stop(); } catch { /* уже остановлен */ } }),
    };
  },
};

// Название текущего трека под сеткой звуков
function showTrack(url) {
  const box = document.getElementById("trackNow");
  if (!box) return;
  if (!url) { box.hidden = true; return; }
  const m = url.match(/Song-(\d+)/i);
  document.getElementById("trackName").textContent = m ? `SoundHelix Song ${m[1]}` : "SoundHelix";
  box.hidden = false;
}

// Единое включение/выключение природного звука (клики по плиткам и миксы)
function setSoundState(key, wantOn) {
  if (key === "music") return;
  const btn = document.querySelector(`.sound[data-sound="${key}"]`);
  if (SCHEDULERS[key]) {
    const st = (sounds[key] ||= { on: false, stopFn: null });
    if (st.on === wantOn) return;
    if (st.on) {
      st.stopFn?.(); st.stopFn = null; st.on = false;
      btn?.classList.remove("on");
    } else {
      st.stopFn = SCHEDULERS[key]();
      st.on = true; btn?.classList.add("on");
    }
    return;
  }
  const st = (sounds[key] ||= { ref: null, on: false });
  if (st.on === wantOn) return;
  if (!st.ref) st.ref = BUILDERS[key]();
  const now = AC.currentTime;
  const target = wantOn ? (st.ref.base ?? st.ref.level) : 0.0001;
  st.ref.g.gain.cancelScheduledValues(now);
  st.ref.g.gain.setTargetAtTime(target, now, 0.8);
  st.on = wantOn;
  btn?.classList.toggle("on", wantOn);
}

$("#soundGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest(".sound");
  if (!btn) return;
  const key = btn.dataset.sound;
  ensureAudio();
  if (key === "music") {
    if (musicAudio.paused) {
      musicAudio.volume = masterVol * 0.7;
      const tryPlay = async () => {
        musicAudio.src = pick(API.musicTracks);
        await musicAudio.play();
        showTrack(musicAudio.src);
      };
      try { await tryPlay(); }
      catch {
        try { await tryPlay(); }
        catch { toast("Музыка недоступна — источник API не отвечает."); return; }
      }
    } else { musicAudio.pause(); showTrack(null); }
    btn.classList.toggle("on", !musicAudio.paused);
    return;
  }
  setSoundState(key, !sounds[key]?.on);
  syncSoundPressed(); // мгновенно снимаем активность миксов при ручной правке
});

// aria-состояния кнопок звуков — скринридеры понимают, что включено
function syncSoundPressed() {
  const btns = [...document.querySelectorAll("[data-sound]")];
  btns.forEach((b) => b.setAttribute("aria-pressed", b.classList.contains("on") ? "true" : "false"));
  const wave = document.getElementById("soundWave");
  if (wave) wave.hidden = !btns.some((b) => b.classList.contains("on"));
  // ручная правка звуков снимает активность с пресетов-миксов
  document.querySelectorAll(".mix-chip.active").forEach((c) => c.classList.remove("active"));
}
$("#soundGrid").addEventListener("click", () => setTimeout(syncSoundPressed, 80));
syncSoundPressed();

function setVolume(pct) {
  masterVol = pct / 100;
  if (master) master.gain.value = masterVol;
  musicAudio.volume = masterVol * 0.7;
  const volEl = $("#volume");
  if (volEl && Number(volEl.value) !== pct) volEl.value = pct;
  try { localStorage.setItem("zenVol", String(pct)); } catch { /* ignore */ }
}
$("#volume").addEventListener("input", (e) => setVolume(Number(e.target.value)));
try {
  const savedVol = localStorage.getItem("zenVol");
  if (savedVol !== null) setVolume(Number(savedVol));
} catch { /* ignore */ }

/* ------------------------- Миксы звуков (пресеты) ------------------------- */

const ALL_NATURE = ["rain", "stream", "ocean", "wind", "thunder", "noise", "bowl", "birds", "fire", "crickets", "chimes", "drone", "purr", "roof", "train"];

const MIXES = [
  { id: "storm", name: "🌧 Дождь с грозой", sounds: ["rain", "thunder"], vol: 65 },
  { id: "fire", name: "🔥 У камина", sounds: ["fire", "crickets"], vol: 60 },
  { id: "attic", name: "🛖 Уютный чердак", sounds: ["purr", "roof", "fire"], vol: 54 },
  { id: "train_night", name: "🚂 Ночная дорога", sounds: ["train", "roof", "wind"], vol: 50 },
  { id: "ocean", name: "🌊 Океан и ветер", sounds: ["ocean", "wind"], vol: 55 },
  { id: "creek", name: "🌲 Ручей и птицы", sounds: ["stream", "birds"], vol: 50 },
  { id: "forest", name: "🍃 Шелест леса", sounds: ["wind", "birds"], vol: 52 },
  { id: "sanctuary", name: "🕉 Обитель покоя", sounds: ["drone", "chimes", "bowl"], vol: 48 },
  { id: "sleep", name: "💤 Сон", sounds: ["ocean", "noise", "purr"], vol: 30 },
  { id: "quiet", name: "⏹ Тишина", sounds: [], vol: null },
];

// Подбор микса по времени суток: ночью — мягче, утром — бодрее
const MIX_POOLS = {
  morning: ["forest", "creek", "fire", "ocean", "storm"],
  day: ["forest", "storm", "fire", "ocean", "creek", "sanctuary", "attic"],
  evening: ["sanctuary", "attic", "train_night", "fire", "forest", "ocean", "sleep"],
  night: ["sanctuary", "sleep", "attic", "train_night", "ocean"],
};

const mixChipsBox = $("#mixChips");
const mixChipEls = [];

function applyMix(mix, chip, msg) {
  ensureAudio();
  // выключаем всё лишнее и включаем только звуки микса
  ALL_NATURE.forEach((k) => setSoundState(k, mix.sounds.includes(k)));
  if (!musicAudio.paused) {
    musicAudio.pause(); showTrack(null);
    document.querySelector('[data-sound="music"]')?.classList.remove("on");
  }
  if (mix.vol !== null) setVolume(mix.vol);
  syncSoundPressed();
  if (mix.id) {
    try { localStorage.setItem("zenLastMix", mix.id); } catch { /* ignore */ }
    updateRepeatChip();
  }
  [...mixChipsBox.children].forEach((c) => c.classList.remove("active"));
  chip?.classList.add("active");
  toast(msg || (mix.sounds.length ? `Микс «${mix.name}» включён 🙏` : "Тишина — все звуки выключены."));
}

MIXES.forEach((mix) => {
  const b = document.createElement("button");
  b.className = "chip mix-chip";
  b.textContent = mix.name;
  b.addEventListener("click", () => applyMix(mix, b));
  mixChipEls.push(b);
  mixChipsBox.appendChild(b);
});

// 🔁 Повторить последний микс — появляется после первого применения
let repeatChip = null, repeatMix = null;
function updateRepeatChip() {
  let lastId = null;
  try { lastId = localStorage.getItem("zenLastMix"); } catch { /* ignore */ }
  const mix = MIXES.find((m) => m.id === lastId && m.sounds.length);
  repeatMix = mix || null;
  if (!mix) { repeatChip?.remove(); return; }
  if (!repeatChip) {
    repeatChip = document.createElement("button");
    repeatChip.className = "chip mix-chip repeat-chip";
    repeatChip.addEventListener("click", () => { if (repeatMix) applyMix(repeatMix, repeatChip); });
  }
  repeatChip.textContent = `🔁 ${mix.name}`;
  repeatChip.title = "Повторить прошлый микс";
  if (!repeatChip.isConnected) mixChipsBox.insertBefore(repeatChip, mixChipsBox.firstChild);
}
updateRepeatChip();

// Случайный микс — с учётом времени суток: ночью мягче и тише
const randChip = document.createElement("button");
randChip.className = "chip mix-chip";
randChip.textContent = "🎲 Случайный";
randChip.title = "Случайный микс по времени суток — ночью тише и мягче";
randChip.addEventListener("click", () => {
  const tod = timeOfDayName();
  const mix = MIXES.find((m) => m.id === pick(MIX_POOLS[tod]));
  const chip = mixChipEls[MIXES.indexOf(mix)];
  const soften = tod === "night" && mix.vol != null;
  applyMix(
    soften ? { ...mix, vol: Math.min(mix.vol, 35) } : mix,
    chip,
    `🎲 ${(TOD_RU[tod] || tod)} — ${mix.name}${soften ? ", приглушённо" : ""}`
  );
});
mixChipsBox.appendChild(randChip);

/* ------------------------- Тихий фон на время таймера ------------------------- */

let autoKeys = [], autoPrevVol = null;

// Если на старте сеанса тишина — включаем едва слышный фон по времени суток
function ambientStart() {
  autoKeys = [];
  const somethingOn = document.querySelectorAll("#soundGrid .sound.on").length > 0 || !musicAudio.paused;
  if (somethingOn) return; // у практика уже есть свой звуковой мир
  const key = ambientKey();
  if (!key) return; // «Без фона»
  ensureAudio();
  autoPrevVol = Math.round(masterVol * 100);
  setSoundState(key, true);
  setVolume(22);
  autoKeys = [key];
  toast(`${key === "rain" ? "🌧 Дождь" : "🌊 Океан"} — тихий фон на время сеанса`);
}

// Убираем только звуки, включённые нами; чужие не трогаем
function ambientStop() {
  if (!autoKeys.length) return;
  autoKeys.forEach((k) => { if (sounds[k]?.on) setSoundState(k, false); });
  autoKeys = [];
  if (autoPrevVol != null) { setVolume(autoPrevVol); autoPrevVol = null; }
  syncSoundPressed();
}

/* --------- Тихий фон: выбор звука --------- */

const AMBIENT_OPTS = [
  { id: "auto", name: "✨ Авто" },
  { id: "rain", name: "🌧 Дождь" },
  { id: "ocean", name: "🌊 Океан" },
  { id: "stream", name: "🏞 Ручей" },
  { id: "off", name: "⏹ Нет" },
];
let ambientPref = "auto";
try { ambientPref = localStorage.getItem("zenAmbient") || "auto"; } catch { /* ignore */ }

function ambientKey() {
  if (ambientPref === "off") return null;
  if (ambientPref !== "auto") return ambientPref;
  return timeOfDayName() === "night" ? "ocean" : "rain";
}

const ambientChipsBox = $("#ambientChips");
AMBIENT_OPTS.forEach((opt) => {
  const b = document.createElement("button");
  b.className = "chip" + (opt.id === ambientPref ? " active" : "");
  b.textContent = opt.name;
  b.addEventListener("click", () => setAmbientPref(opt.id));
  ambientChipsBox.appendChild(b);
});
// Выбор фона одной функцией — чипы ряда и сценарии
function setAmbientPref(id) {
  ambientPref = id;
  try { localStorage.setItem("zenAmbient", id); } catch { /* ignore */ }
  [...ambientChipsBox.children].forEach((c, j) => c.classList.toggle("active", AMBIENT_OPTS[j].id === id));
  if (autoKeys.length) { // сеанс идёт — фон подхватывает новый выбор
    ambientStop();
    if (tRunning) ambientStart();
  }
}

/* ------------------------- Горячие клавиши: 1–9 — звуки ------------------------- */

document.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const t = e.target;
  if (t && t.matches && t.matches("input, textarea, select")) return; // не мешаем вводу
  if (e.key < "1" || e.key > "9") return;
  const tile = document.querySelectorAll("#soundGrid .sound")[Number(e.key) - 1];
  if (!tile) return;
  e.preventDefault();
  tile.click(); // делегат сам разберёт: музыка, планировщики, строители
});

// Мягкий колокольчик в конце сессии — оттенок общий для финала и якоря
const BELL_TONES = [
  { id: "temple", name: "🏔 Храм", f: 174.6, partials: [1, 2.7, 5.4], decay: 5.5 },
  { id: "clear", name: "🍃 Светлый", f: 523.25, partials: [1, 2, 3.01], decay: 3.2 },
  { id: "quiet", name: "🌙 Тишина", f: 396, partials: [1, 2.02], decay: 4.5 },
  { id: "crystal", name: "✨ Кристалл", f: 864.7, partials: [1, 1.008, 2.76], decay: 4 },
];
let bellToneIdx = 0;
try {
  const bt = localStorage.getItem("zenBellTone");
  const i = BELL_TONES.findIndex((t) => t.id === bt);
  if (i >= 0) bellToneIdx = i;
} catch { /* ignore */ }

// Одна купель, разная амплитуда: так финал и якорь звучат в одном строе
function playBell(peak, scale = 1, div = 1) {
  ensureAudio();
  const tone = BELL_TONES[bellToneIdx];
  const dur = tone.decay * scale;
  const now = AC.currentTime;
  tone.partials.forEach((m, i) => {
    const o = AC.createOscillator(); o.type = "sine";
    o.frequency.value = tone.f * m;
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak / (i + div), now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(master);
    o.start(now); o.stop(now + dur + 0.6);
  });
}

function bell() { playBell(0.3); }

// 🔔 Якорь: тише финального колокола, одиночный мягкий удар
function anchorBell() {
  playBell(0.12, 1.15, 1.2);
  const rv = document.getElementById("ringVal");
  if (rv) {
    rv.classList.add("bell-pulse");
    setTimeout(() => rv.classList.remove("bell-pulse"), 1200);
  }
}

/* ------------------------- Прогресс (localStorage) ------------------------- */

const STATS_KEY = "zenStats";

function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY)) || { sessions: 0, minutes: 0, streak: 0, last: null }; }
  catch { return { sessions: 0, minutes: 0, streak: 0, last: null }; }
}

function renderStats() {
  const s = loadStats();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("statSessions", s.sessions);
  set("statMinutes", s.minutes);
  set("statStreak", s.streak);
  set("statStreakMini", s.streak);
}

function statsAdd(minutes) {
  const s = loadStats();
  s.sessions++;
  s.minutes = Math.round(s.minutes + minutes);
  const today = new Date();
  if (s.last !== today.toDateString()) {
    const yesterday = new Date(today.getTime() - 86400000).toDateString();
    s.streak = s.last === yesterday ? s.streak + 1 : 1;
    s.last = today.toDateString();
  }
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  renderStats();
}

/* ------------------------- Голосовые подсказки ------------------------- */

let voiceOn = true;
try { voiceOn = localStorage.getItem("zenVoice") !== "0"; } catch { /* ignore */ }

const voiceBtn = $("#voiceBtn");

function renderVoice() {
  voiceBtn.textContent = voiceOn ? "🔊" : "🔇"; // в шапке — только эмодзи, текст state читается в настройках
  voiceBtn.title = `Голосовые подсказки: ${voiceOn ? "включены" : "выключены"}`;
  voiceBtn.classList.toggle("active", voiceOn);
  voiceBtn.setAttribute("aria-pressed", String(voiceOn));
  voiceBtn.setAttribute("aria-label", `Голосовые подсказки: ${voiceOn ? "включены" : "выключены"}`);
}

voiceBtn.addEventListener("click", () => {
  voiceOn = !voiceOn;
  try { localStorage.setItem("zenVoice", voiceOn ? "1" : "0"); } catch { /* ignore */ }
  if (!voiceOn && "speechSynthesis" in window) speechSynthesis.cancel();
  renderVoice();
  if (voiceOn) say("Голос включён.");
});

// Голос через встроенный синтезатор речи браузера (работает офлайн)
const VOICE_PREFS = ["дмитрий", "юрий", "yuriy", "милена", "milena", "татьяна", "tatyana", "ирина", "irina", "pavel", "google русский", "google russian"];

function pickVoice() {
  const vs = (speechSynthesis.getVoices() || []).filter((v) => (v.lang || "").toLowerCase().startsWith("ru"));
  if (!vs.length) return null;
  return vs.find((v) => VOICE_PREFS.some((p) => v.name.toLowerCase().includes(p))) || vs[0];
}

function say(text, opts = {}) {
  if (!("speechSynthesis" in window)) return;
  if (!voiceOn && !opts.force) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    u.rate = 0.9 + Math.random() * 0.06;   // чуть разная скорость — не монотонно
    u.pitch = 0.96 + Math.random() * 0.12; // живее, естественнее
    const v = pickVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* тихо работаем без голоса */ }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Разные формулировки — голос не повторяется слово в слово
const PHRASES = {
  breathStart: [
    "Начинаем дыхание. Дышите вместе с кругом.",
    "Вы здесь, и это главное. Начинаем.",
    "Отпустите заботы на минуту. Круг покажет ритм.",
    "Вдох, пока круг растёт. Выдох, пока сжимается.",
  ],
  timerStart: [
    "Начали. Приятной практики.",
    "Сессия запущена. Всё лишнее может подождать.",
    "Начали. Дышите ровно, ничего не нужно делать.",
  ],
  finish: [
    "Готово. Сессия завершена. Отличная работа.",
    "Практика завершена. Спасибо, что были с собой.",
    "Время вышло. Пусть спокойствие останется с вами.",
  ],
  cycles: [
    "Ровное дыхание. Так держать.",
    "Отлично. Вы справляетесь.",
    "Хорошо. Не спешите.",
    "Плавно и спокойно. Продолжайте.",
  ],
};

if ("speechSynthesis" in window) {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}
renderVoice();

/* ------------------------- Тема под время суток ------------------------- */

const TIME_GREETINGS = {
  night:   "Доброй ночи 🌙",
  morning: "Доброе утро ☀️",
  day:     "Добрый день 🌤",
  evening: "Добрый вечер ✨",
};

function timeOfDayName() {
  const h = new Date().getHours();
  if (h < 5) return "night";
  if (h < 11) return "morning";
  if (h < 17) return "day";
  if (h < 22) return "evening";
  return "night";
}

const MONTHS_RU = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const TOD_RU = { morning: "утро", day: "день", evening: "вечер", night: "ночь" };

function initDayTheme() {
  let tod = timeOfDayName();
  const forced = localStorage.getItem("zenTodNight"); // "1" — ночь, "2" — глубокая ночь (OLED)
  if (forced === "1" || forced === "2") tod = "night";
  const oled = forced === "2";
  document.body.dataset.time = tod;
  document.body.dataset.oled = oled ? "1" : "0";
  $("#greetTitle").textContent = TIME_GREETINGS[tod];
  const d = new Date();
  $("#timeTag").textContent = `${d.getDate()} ${MONTHS_RU[d.getMonth()]} · ${oled ? "глубокая ночь" : TOD_RU[tod]}`;
  const tc = document.getElementById("themeColor");
  if (tc) tc.content = tod === "night" ? (oled ? "#040507" : "#161a22") : "#eceff3";
  return tod;
}
initDayTheme();

/* Сезон подмешивает характер палитры — тонко и автоматически по дате */
const SEASON_OF_MONTH = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];
const SEASON_RU = { winter: "❄ зима", spring: "🌱 весна", summer: "☀ лето", autumn: "🍂 осень" };
function applySeason() {
  document.body.dataset.season = SEASON_OF_MONTH[new Date().getMonth()];
}
applySeason();

// Цикл кнопки: авто-освещение → ночь → глубокая ночь (OLED) → авто
const themeBtn = $("#themeBtn");
function syncThemeBtn() {
  const f = localStorage.getItem("zenTodNight");
  themeBtn.textContent = f === "1" ? "● Ночь+" : f === "2" ? "☀ День" : "☾ Ночь";
  themeBtn.title = f === "1" ? "Глубокая ночная тема — почти чёрный OLED-фон"
    : f === "2" ? "Вернуть обычное освещение" : "Тёмная тема";
}
themeBtn.addEventListener("click", () => {
  const f = localStorage.getItem("zenTodNight");
  if (f === "1") localStorage.setItem("zenTodNight", "2");
  else if (f === "2") localStorage.removeItem("zenTodNight");
  else localStorage.setItem("zenTodNight", "1");
  initDayTheme();
  syncThemeBtn();
});
syncThemeBtn();

// Явный выбор темы (используется панелью настроек)
function setThemePref(v) {
  if (v) localStorage.setItem("zenTodNight", v);
  else localStorage.removeItem("zenTodNight");
  initDayTheme();
  syncThemeBtn();
}

/* ------------------------- Быстрые техники 1–3 мин ------------------------- */

const TECHNIQUES = [
  {
    title: "Пауза на минуту", emoji: "⏸", dur: "1 мин",
    steps: [
      { d: 10, t: "Сядьте удобно и закройте глаза" },
      { d: 15, t: "Сделайте глубокий вдох… и медленный выдох" },
      { d: 15, t: "Отпустите напряжение в плечах и лице" },
      { d: 10, t: "Ещё один глубокий вдох — и отпустите всё" },
      { d: 10, t: "Верните внимание в тело и откройте глаза" },
    ],
  },
  {
    title: "Один цикл 4·7·8", emoji: "🌬", dur: "20 сек",
    steps: [
      { d: 4, t: "Вдох носом — 4 секунды" },
      { d: 7, t: "Задержите дыхание — 7 секунд" },
      { d: 8, t: "Медленный выдох ртом — 8 секунд" },
    ],
  },
  {
    title: "Заземление 5–4–3–2–1", emoji: "🌳", dur: "2 мин",
    steps: [
      { d: 25, t: "Назовите про себя 5 вещей, которые видите" },
      { d: 25, t: "Послушайте 4 звука вокруг вас" },
      { d: 20, t: "Заметьте 3 прикосновения к вашему телу" },
      { d: 15, t: "Уловите 2 запаха" },
      { d: 10, t: "Вспомните 1 вкус. Вы здесь. Всё хорошо." },
    ],
  },
  {
    title: "Сканирование тела", emoji: "🧍", dur: "5 мин",
    steps: [
      { d: 35, t: "Устройтесь удобно. Заметьте вес тела — как стул держит вас" },
      { d: 40, t: "Внимание в стопах: тепло, покалывание, тяжесть — что есть?" },
      { d: 40, t: "Колени и бёдра. Отпустите лишнее напряжение оттуда" },
      { d: 40, t: "Живот и поясница: позвольте им мягко двигаться с дыханием" },
      { d: 40, t: "Грудь, плечи, лопатки. Плечи могут опуститься" },
      { d: 35, t: "Кисти, пальцы, шея, лицо. Брови, челюсть, глаза — мягко" },
      { d: 30, t: "Почувствуйте тело целиком. Оно здесь, и оно дышит" },
    ],
  },
  {
    title: "Полный цикл 4·7·8", emoji: "🌙", dur: "2 мин",
    steps: [
      { d: 4, t: "Вдох носом — 4 секунды" },
      { d: 7, t: "Задержка — 7 секунд" },
      { d: 8, t: "Медленный выдох — 8 секунд" },
      { d: 4, t: "Вдох снова. Считайте про себя, ровно и спокойно" },
      { d: 7, t: "Задержка. Плечи расслаблены, челюсть мягкая" },
      { d: 8, t: "Выдох длиннее вдоха — тело уходит в покой" },
      { d: 4, t: "Последний вдох" },
      { d: 7, t: "Задержка — и отпустите всё" },
      { d: 8, t: "Выдох. Спасибо себе за эту практику" },
    ],
  },
  {
    title: "Момент благодарности", emoji: "💛", dur: "2 мин",
    steps: [
      { d: 40, t: "Вспомните человека, за которого вы благодарны" },
      { d: 40, t: "Представьте его лицо. Что вы хотели бы ему сказать?" },
      { d: 35, t: "Тепло в груди — это и есть благодарность. Подышите с ней" },
      { d: 30, t: "Добавьте в список и себя. За что вы благодарны себе?" },
      { d: 25, t: "Два спокойных вдоха. Сохраните это чувство с собой" },
    ],
  },
  {
    title: "Осознанная прогулка", emoji: "👣", dur: "3 мин",
    steps: [
      { d: 40, t: "Встаньте и постойте минуту. Тяжесть тела, спокойное дыхание" },
      { d: 45, t: "Идите медленно. Чувствуйте: ступень за ступенью" },
      { d: 45, t: "Согласуйте шаги с дыханием: шаг — вдох, шаг — выдох" },
      { d: 40, t: "Замечайте звуки вокруг — просто замечайте, не называя" },
      { d: 30, t: "Остановитесь. Три спокойных вдоха — и продолжайте день" },
    ],
  },
  {
    title: "Снятие зажимов", emoji: "💆", dur: "2 мин",
    steps: [
      { d: 25, t: "Мягко опустите плечи вниз и отведите их назад" },
      { d: 25, t: "Разомкните зубы, расслабьте челюсть и язык" },
      { d: 25, t: "Разгладьте лоб и точку между бровями" },
      { d: 25, t: "Глубокий спокойный вдох… и мягкий выдох ртом" },
      { d: 20, t: "Почувствуйте лёгкость во всём лице, шее и плечах" },
    ],
  },
  {
    title: "Перезагрузка глаз", emoji: "👁", dur: "1 мин",
    steps: [
      { d: 15, t: "Оторвите взгляд от экрана и посмотрите далеко в окно" },
      { d: 15, t: "Мягко поморгайте несколько раз, снимая сухость" },
      { d: 20, t: "Согрейте ладони трением и прикройте ими глаза (пальминг)" },
      { d: 10, t: "Спокойный вдох в темноту ладоней… и откройте глаза" },
    ],
  },
  {
    title: "Любящая доброта (Метта)", emoji: "💛", dur: "2 мин",
    steps: [
      { d: 25, t: "Положите руку на грудь: пусть я буду в безопасности и мире" },
      { d: 30, t: "Вспомните дорогого человека: пусть ты будешь счастлив" },
      { d: 30, t: "Вспомните любого незнакомца: пусть и у тебя всё будет хорошо" },
      { d: 25, t: "Расширьте это тепло на весь мир вокруг вас. Покой в сердце" },
    ],
  },
  {
    title: "Квадрат Box 4·4", emoji: "📦", dur: "1.5 мин",
    steps: [
      { d: 4, t: "Вдох носом — 4 секунды" },
      { d: 4, t: "Задержка дыхания — 4 секунды" },
      { d: 4, t: "Плавный выдох — 4 секунды" },
      { d: 4, t: "Пауза в пустоте — 4 секунды. Пульс ровный" },
    ],
  },
  {
    title: "Шея и челюсть", emoji: "💆‍♂️", dur: "1 мин",
    steps: [
      { d: 15, t: "Мягко наклоните голову к правому плечу, потяните шею" },
      { d: 15, t: "Плавный перекат к левому плечу, отпуская затылок" },
      { d: 15, t: "Широко зевните и разомкните зубы, расслабляя челюсть" },
      { d: 15, t: "Опустите плечи и сделайте свободный выдох" },
    ],
  },
  {
    title: "Такт 3·1·6 Релакс", emoji: "🌊", dur: "1 мин",
    steps: [
      { d: 3, t: "Быстрый вдох носом — 3 секунды" },
      { d: 1, t: "Короткая пауза — 1 секунда" },
      { d: 6, t: "Длинный выдох через губы — 6 секунд" },
      { d: 15, t: "Почувствуйте, как сердце замедляет свой ритм" },
    ],
  },
  {
    title: "Чек-ин: Где я?", emoji: "🌿", dur: "1 мин",
    steps: [
      { d: 20, t: "Где сейчас ваши мысли? Просто заметьте их, не оценивая" },
      { d: 20, t: "Ощутите подошвы стоп и устойчивую опору под вами" },
      { d: 20, t: "Сделайте вдох в живот. Вы прямо здесь, в этой секунде" },
    ],
  },
];

let ovGen = 0;
const overlay = $("#overlay");

async function runTechnique(t) {
  const gen = ++ovGen;
  $("#ovTitle").textContent = `${t.emoji} ${t.title} · ${t.dur}`;
  $("#ovDots").innerHTML = t.steps.map((_, i) => `<span class="dot" data-i="${i}"></span>`).join("");
  overlay.hidden = false;
  document.body.style.overflow = "hidden";

  for (let i = 0; i < t.steps.length; i++) {
    if (gen !== ovGen) return;
    [...$("#ovDots").children].forEach((dot, j) => {
      dot.classList.toggle("cur", j === i);
      dot.classList.toggle("done", j < i);
    });
    $("#ovText").textContent = t.steps[i].t;
    say(t.steps[i].t);
    const totalMs = t.steps[i].d * 1000;
    for (let ms = 0; ms < totalMs; ms += 250) {
      if (gen !== ovGen) return;
      await sleep(250);
    }
  }
  if (gen !== ovGen) return;
  closeOverlay();
  toast("Готово 🙏 Хорошая работа. Небольшая пауза — уже забота о себе.");
  statsAdd(Math.round(t.steps.reduce((s, st) => s + st.d, 0) / 60));
}

function closeOverlay() {
  ovGen++;
  overlay.hidden = true;
  document.body.style.overflow = "";
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

$("#ovStop").addEventListener("click", closeOverlay);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeOverlay(); // клик по фону мимо карточки
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !overlay.hidden) closeOverlay();
});

const techRow = $("#techRow");
TECHNIQUES.forEach((t) => {
  const b = document.createElement("button");
  b.className = "tech";
  b.innerHTML = `<span class="tech-ico">${t.emoji}</span><span class="tech-body"><b>${t.title}</b><span class="tech-dur">${t.dur}</span></span>`;
  b.addEventListener("click", () => runTechnique(t));
  techRow.appendChild(b);
});

// Четвёртая карточка — случайная практика
const randTech = document.createElement("button");
randTech.className = "tech tech-rand";
randTech.innerHTML = `<span class="tech-ico">🎲</span><span class="tech-body"><b>Случайная техника</b><span class="tech-dur">на выбор</span></span>`;
randTech.addEventListener("click", () => {
  const t = pick(TECHNIQUES);
  toast(`🎲 Сегодня — ${t.title}`);
  runTechnique(t);
});
techRow.appendChild(randTech);

/* ------------------------- Фокус-режим, таймер сна, шорткаты ------------------------- */

// Фокус: прячем весь интерфейс, остаётся только дышащий круг
const focusBtn = $("#focusBtn");

function setFocusMode(on) {
  document.body.classList.toggle("focus-mode", on);
  focusBtn.textContent = on ? "⛶ Обычный вид" : "⛶ Фокус";
  if (on) toast("Фокус: только дыхание. Esc — выйти, пробел — старт/стоп.");
}

focusBtn.addEventListener("click", () => setFocusMode(!document.body.classList.contains("focus-mode")));
$("#focusExit").addEventListener("click", () => setFocusMode(false));

// Таймер сна: через N минут все звуки мягко выключаются
let sleepTimeout = null;

function stopAllSounds() {
  musicAudio.pause();
  showTrack(null);
  const musicBtn = document.querySelector('[data-sound="music"]');
  if (musicBtn) musicBtn.classList.remove("on");
  for (const [key, st] of Object.entries(sounds)) {
    if (!st.on) continue;
    if (st.stopFn) { st.stopFn(); st.stopFn = null; }
    if (st.ref?.g && AC) {
      const now = AC.currentTime;
      st.ref.g.gain.cancelScheduledValues(now);
      st.ref.g.gain.setTargetAtTime(0.0001, now, 1.2);
    }
    st.on = false;
    const b = document.querySelector(`[data-sound="${key}"]`);
    if (b) b.classList.remove("on");
  }
  syncSoundPressed();
}

function setSleepTimer(min) {
  clearTimeout(sleepTimeout);
  sleepTimeout = null;
  if (!min) { toast("Таймер сна выключен."); return; }
  toast(`Звуки выключатся сами через ${min} мин 💤`);
  sleepTimeout = setTimeout(() => {
    stopAllSounds();
    say("Спокойной ночи.", { force: true });
    toast("Звуки выключены. Спокойной ночи 🌙");
  }, min * 60000);
}

const sleepChipsBox = $("#sleepChips");
[{ label: "15 мин", min: 15 }, { label: "30 мин", min: 30 }, { label: "1 час", min: 60 }, { label: "Выкл", min: 0 }]
  .forEach((o, i) => {
    const b = document.createElement("button");
    b.className = "chip" + (i === 3 ? " active" : "");
    b.textContent = o.label;
    b.addEventListener("click", () => {
      [...sleepChipsBox.children].forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
      setSleepTimer(o.min);
    });
    sleepChipsBox.appendChild(b);
  });

/* ------------------------- Сценарии: ритуал в один клик ------------------------- */

function setVoiceState(on) { if (voiceOn !== on) voiceBtn.click(); }
function setSyncState(on) { if (breathSync !== on) syncChip.click(); }
function sleepChipClick(min) {
  const label = min >= 60 ? "1 час" : `${min} мин`;
  const b = [...sleepChipsBox.children].find((c) => c.textContent === label);
  if (b) b.click(); else setSleepTimer(min);
}
function mixById(id) {
  const i = MIXES.findIndex((m) => m.id === id);
  return i >= 0 ? applyMix(MIXES[i], mixChipEls[i]) : null;
}

const SCENES = [
  {
    name: "🌙 Сон",
    run() {
      setThemePref("1");            // ночная тема
      setPattern(0);                // 4·7·8
      setVoiceState(false);         // без голоса
      setSyncState(true);           // дыхание ведёт сеанс
      setAmbientPref("ocean");      // тихий океан
      setDurationMin(30);
      sleepChipClick(30);           // звуки уснут сами
      toast("🌙 Сон: ночная тема, океан, дыхание 4·7·8 и таймер сна. Спокойной ночи.");
    },
  },
  {
    name: "🔥 Уют",
    run() {
      setThemePref("1");
      setAmbientPref("off");        // фон не нужен — играет микс
      mixById("fire");              // костёр и сверчки
      setSyncState(false);
      setDurationMin(15);
      toast("🔥 Уют: костёр со сверчками, тёмная тема, 15 минут для себя.");
    },
  },
  {
    name: "⚡ Фокус",
    run() {
      setThemePref("");             // авто-освещение
      setAmbientPref("off");
      stopAllSounds();
      ensureAudio();
      setSoundState("noise", true); // белый шум глушит мир
      setVolume(45);
      syncSoundPressed();
      setVoiceState(false);
      setSyncState(false);
      setDurationMin(25);
      setFocusMode(true);           // и чистый экран
      toast("⚡ Фокус: белый шум, чистый экран, 25 минут. Esc — выйти из фокуса.");
    },
  },
  {
    name: "🌅 Утро",
    run() {
      setThemePref("");
      setAmbientPref("off");
      mixById("creek");             // ручей и птицы
      setPattern(2);                // 5·5
      setVoiceState(true);
      setSyncState(false);
      setDurationMin(10);
      setFocusMode(false);
      toast("🌅 Утро: ручей и птицы, ритм 5·5, лёгкие 10 минут в подарок себе.");
    },
  },
];

const sceneChipsBox = $("#sceneChips");
SCENES.forEach((s) => {
  const b = document.createElement("button");
  b.className = "chip scene-chip";
  b.textContent = s.name;
  b.addEventListener("click", () => {
    if (tRunning) { toast("Остановите сеанс — сценарий настроит всё заново."); return; }
    s.run();
  });
  sceneChipsBox.appendChild(b);
});

/* ------------------------- Свои сцены: запомнить свою атмосферу ------------------------- */

let myScenes = [];
try { myScenes = JSON.parse(localStorage.getItem("zenMyScenes") || "[]"); } catch { myScenes = []; }
function saveMyScenes() {
  try { localStorage.setItem("zenMyScenes", JSON.stringify(myScenes)); } catch { /* ignore */ }
}

// Снимок текущего состояния: звуки, музыка, громкость, таймер, тема, ритм, голос, фон
function snapshotScene(name) {
  const snd = {};
  ALL_NATURE.forEach((k) => {
    snd[k] = !!document.querySelector(`.sound[data-sound="${k}"]`)?.classList.contains("on");
  });
  return {
    name,
    sounds: snd,
    music: !musicAudio.paused,
    vol: Math.round(masterVol * 100),
    dur: Math.round(tTotal / 60),
    theme: localStorage.getItem("zenTodNight") || "",
    pattern: currentPattern,
    voice: voiceOn,
    sync: breathSync,
    amb: ambientPref,
  };
}

function runMyScene(s) {
  if (tRunning) { toast("Остановите сеанс — сценарий настроит всё заново."); return; }
  setThemePref(s.theme || "");
  setPattern(Math.min(Number.isInteger(s.pattern) ? s.pattern : 0, PATTERNS.length - 1));
  setVoiceState(!!s.voice);
  setSyncState(!!s.sync);
  setAmbientPref(s.amb || "auto");
  setDurationMin(Math.min(180, Math.max(1, s.dur || 10)));
  ensureAudio();
  ALL_NATURE.forEach((k) => setSoundState(k, !!s.sounds[k]));
  const musicOn = !musicAudio.paused;
  if (!!s.music !== musicOn) document.querySelector('.sound[data-sound="music"]')?.click();
  setVolume(Math.min(100, Math.max(0, s.vol || 50)));
  syncSoundPressed();
  toast(`💾 «${s.name}» — ваша атмосфера включена.`);
}

function renderMyScenes() {
  sceneChipsBox.querySelectorAll(".my-scene").forEach((c) => c.remove());
  myScenes.forEach((s) => {
    const b = document.createElement("button");
    b.className = "chip scene-chip my-scene";
    b.textContent = s.name;
    b.title = "Ваш сценарий. ПКМ — удалить";
    b.addEventListener("click", () => runMyScene(s));
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      myScenes = myScenes.filter((x) => x !== s);
      saveMyScenes();
      renderMyScenes();
      toast(`Сценарий «${s.name}» удалён.`);
    });
    sceneChipsBox.insertBefore(b, saveSceneChip);
  });
}

// Чип сохранения: превращается в поле названия (как «＋ Своя» у таймера)
const saveSceneChip = document.createElement("button");
saveSceneChip.className = "chip scene-chip save-scene";
saveSceneChip.textContent = "💾 Своя сцена";
saveSceneChip.title = "Запомнить текущие звуки, таймер, ритм и тему под своим именем";
saveSceneChip.addEventListener("click", () => {
  if (document.getElementById("sceneNameInput")) return;
  const inp = document.createElement("input");
  inp.id = "sceneNameInput";
  inp.className = "custom-min scene-name";
  inp.maxLength = 18;
  inp.placeholder = "название";
  inp.title = "Enter — сохранить, Esc — отмена";
  saveSceneChip.replaceWith(inp);
  inp.focus();
  let applied = false;
  const apply = () => {
    if (applied) return;
    applied = true;
    if (inp.parentNode) inp.replaceWith(saveSceneChip);
    const name = inp.value.trim() || "Мой сценарий";
    if (myScenes.length >= 6) { toast("Больше шести своих сценариев не влезет — удалите лишние (ПКМ по чипу)."); return; }
    myScenes.push(snapshotScene(name));
    saveMyScenes();
    renderMyScenes();
    toast(`💾 Сценарий «${name}» сохранён. Клик — включить.`);
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") apply();
    if (e.key === "Escape" && !applied) { applied = true; if (inp.parentNode) inp.replaceWith(saveSceneChip); }
  });
  inp.addEventListener("blur", apply);
});
sceneChipsBox.appendChild(saveSceneChip);
renderMyScenes();

// Горячие клавиши: пробел — дыхание, Esc — фокус/оверлей, N — ночник
document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (e.code === "Space") {
    e.preventDefault();
    breathRunning ? stopBreath() : startBreath();
  }
  if (e.key === "Escape" && !nightMode.hidden) { setNightMode(false); return; } // сначала ночник
  if (e.key === "Escape" && document.body.classList.contains("focus-mode")) setFocusMode(false);
  if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && overlay.hidden) {
    setNightMode(nightMode.hidden);
  }
});

/* ------------------------- Мысль: кнопки и автосмена ------------------------- */

$("#quoteBtn").addEventListener("click", () => loadQuote());

$("#quoteSay").addEventListener("click", () => {
  const t = $("#quoteText").textContent.replace(/[«»]/g, "").trim();
  const a = $("#quoteAuthor").textContent.replace(/^—\s*/, "").trim();
  say(a ? `${t} ${a}` : t, { force: true });
});

// ⧉ Копировать мысль: буфер, а на file:// — запасной путь
$("#quoteCopy").addEventListener("click", async () => {
  const t = $("#quoteText").textContent.trim();
  const a = $("#quoteAuthor").textContent.trim();
  const text = a ? `${t} ${a}` : t;
  try {
    await navigator.clipboard.writeText(text);
    toast("⧉ Мысль скопирована.");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("⧉ Мысль скопирована."); }
    catch { toast("Скопировать не удалось — но мысль осталась с вами."); }
    ta.remove();
  }
});

// Мысль обновляется сама каждые 5 минут — контент не «засыхается»
setInterval(() => {
  if (overlay.hidden && document.visibilityState === "visible") loadQuote();
}, 5 * 60 * 1000);

/* ------------------------- Запуск ------------------------- */

initThought();
updatePatternHint();
renderTimer();
renderStats();

/* ------------------------- Появление секций при прокрутке ------------------------- */

let revealT = null;
window.addEventListener(
  "scroll",
  () => {
    if (revealT) return;
    revealT = setTimeout(() => { revealT = null; revealCheck(); navSpyCheck(); }, 120);
  },
  { passive: true }
);

/* Плавное появление секций при прокрутке */
function revealCheck() {
  document.querySelectorAll(".reveal:not(.visible)").forEach((el) => {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) el.classList.add("visible");
  });
}

/* ------------------------- Студийная сцена: переключение дыхание / таймер / Сад Дзен ------------------------- */
function switchStage(stage) {
  const isBreath = stage === "breath";
  const isTimer = stage === "timer";
  const isGarden = stage === "garden";

  $("#tabBreath")?.classList.toggle("active", isBreath);
  $("#tabTimer")?.classList.toggle("active", isTimer);
  $("#tabGarden")?.classList.toggle("active", isGarden);

  const breathSec = $("#breath");
  const timerSec = $("#timer");
  const gardenSec = $("#zenGarden");

  if (breathSec) breathSec.hidden = !isBreath;
  if (timerSec) timerSec.hidden = !isTimer;
  if (gardenSec) {
    gardenSec.hidden = !isGarden;
    if (isGarden) initZenGarden();
  }
}
$("#tabBreath")?.addEventListener("click", () => switchStage("breath"));
$("#tabTimer")?.addEventListener("click", () => switchStage("timer"));
$("#tabGarden")?.addEventListener("click", () => switchStage("garden"));

/* Живая навигация: шапка подсвечивает текущий раздел */
const navSpyLinks = [...document.querySelectorAll(".tb-nav a")];
const navSpySections = ["breath", "timer", "sounds", "techniques", "quote"];
function navSpyCheck() {
  let active = navSpySections[0];
  for (const id of navSpySections) {
    const el = document.getElementById(id);
    if (el && !el.hidden && el.getBoundingClientRect().top < window.innerHeight * 0.42) active = id;
  }
  navSpyLinks.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === `#${active}`));
}
navSpyCheck();

navSpyLinks.forEach((a) => {
  a.addEventListener("click", (e) => {
    const targetId = a.getAttribute("href")?.replace("#", "");
    if (targetId === "timer" || targetId === "breath" || targetId === "garden") {
      e.preventDefault();
      switchStage(targetId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
});

function applyHashStage() {
  const h = (location.hash || "").replace("#", "");
  if (h === "timer" || h === "breath" || h === "garden") switchStage(h);
}
window.addEventListener("hashchange", () => {
  applyHashStage();
  revealCheck();
  navSpyCheck();
});
revealCheck();

/* Живое стекло: блик следует за курсором */
document.addEventListener(
  "pointermove",
  (e) => {
    const box = e.target.closest?.(".card, .topbar, .dock, .ov-card");
    if (!box) return;
    const r = box.getBoundingClientRect();
    box.style.setProperty("--mx", `${e.clientX - r.left}px`);
    box.style.setProperty("--my", `${e.clientY - r.top}px`);
  },
  { passive: true }
);

/* ------------------------- 🌙 Спящий экран: затемнение ------------------------- */

const dimmerEl = document.createElement("div");
dimmerEl.className = "dimmer";
dimmerEl.setAttribute("aria-hidden", "true");
document.body.appendChild(dimmerEl);
let dimLevel = 0;

function applyDim() {
  dimmerEl.style.opacity = String(dimLevel / 100);
  dimmerEl.hidden = dimLevel === 0;
  const inp = document.getElementById("dimRange");
  if (inp && Number(inp.value) !== dimLevel) inp.value = String(dimLevel);
}
try { dimLevel = Math.min(70, Math.max(0, Number(localStorage.getItem("zenDim")) || 0)); } catch { /* ignore */ }
applyDim();
document.getElementById("dimRange")?.addEventListener("input", (e) => {
  dimLevel = Number(e.target.value);
  try { localStorage.setItem("zenDim", String(dimLevel)); } catch { /* ignore */ }
  applyDim();
});

/* ------------------------- 🕯 Ночник и 🌌 ночное сияние ------------------------- */

// Сияние — тихий живой фон ночного времени суток
const auroraEl = document.createElement("div");
auroraEl.className = "aurora";
auroraEl.setAttribute("aria-hidden", "true");
document.body.appendChild(auroraEl);

const nightMode = $("#nightMode");
let nmIv = null;

function nightRender() {
  const d = new Date();
  $("#nmTime").textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function setNightMode(on) {
  nightMode.hidden = !on;
  if (on) {
    nightRender();
    if (nmIv) clearInterval(nmIv);
    nmIv = setInterval(nightRender, 1000);
    // свечение дышит в ритме выбранного паттерна
    const cycle = PATTERNS[currentPattern].phases.reduce((s, p) => s + p.d, 0);
    $("#nmGlow")?.style.setProperty("--breath-cycle", `${cycle}s`);
    openSettings(false);
  } else if (nmIv) {
    clearInterval(nmIv); nmIv = null;
  }
}
nightMode.addEventListener("click", () => setNightMode(false)); // тап в любом месте — выход
$("#nmBtn")?.addEventListener("click", () => setNightMode(true));

/* ------------------------- 🎨 Палитры акцента · 🔔 оттенки колокола · 🕉 тон ------------------------- */

// 🎨 Палитра акцента: «Авто» подставляет цвет времени суток, остальные — своё настроение
const PALETTES = [
  { id: "", name: "✨ Авто" },
  { id: "mint", name: "🌿 Мята" },
  { id: "lavender", name: "💜 Лаванда" },
  { id: "sand", name: "🏖 Песок" },
  { id: "sky", name: "🌌 Небо" },
  { id: "quartz", name: "💗 Кварц" },
  { id: "graphite", name: "⬛ Графит" },
];
const paletteChipsBox = $("#paletteChips");

function setPalette(id) {
  if (id) document.body.dataset.palette = id;
  else delete document.body.dataset.palette;
  try {
    if (id) localStorage.setItem("zenPalette", id);
    else localStorage.removeItem("zenPalette");
  } catch { /* ignore */ }
  [...paletteChipsBox.children].forEach((c) => c.classList.toggle("active", (c.dataset.pid || "") === id));
}
PALETTES.forEach((p) => {
  const b = document.createElement("button");
  b.className = "chip";
  b.dataset.pid = p.id;
  b.textContent = p.name;
  b.addEventListener("click", () => {
    setPalette(p.id);
    toast(p.id ? `Палитра: ${p.name}` : "Палитра — авто, как время суток.");
  });
  paletteChipsBox.appendChild(b);
});
try {
  const savedPal = localStorage.getItem("zenPalette");
  setPalette(PALETTES.some((p) => p.id === savedPal) ? savedPal : "");
} catch { setPalette(""); }

// 🪷 Лотос практики: лепесток за каждый завершённый цикл дыхания
const lotusPetals = document.querySelectorAll("#lotusPetals .petal");
const lotusEl = document.getElementById("lotus");
function lotusRender(n) {
  const full = Math.min(n, 8);
  lotusPetals.forEach((p, i) => p.classList.toggle("on", i < full));
  lotusEl?.classList.toggle("full", n >= 8);
}

// 🔔 Оттенок колокола — общая купель для финала сеанса и якоря
function setBellTone(i, quiet) {
  bellToneIdx = i;
  try { localStorage.setItem("zenBellTone", BELL_TONES[i].id); } catch { /* ignore */ }
  [...bellChipsBox.children].forEach((c, j) => c.classList.toggle("active", j === i));
  if (!quiet) toast(`Оттенок колокола: ${BELL_TONES[i].name}`);
}
const bellChipsBox = $("#bellChips");
BELL_TONES.forEach((t, i) => {
  const b = document.createElement("button");
  b.className = "chip" + (i === bellToneIdx ? " active" : "");
  b.textContent = t.name;
  b.addEventListener("click", () => setBellTone(i));
  bellChipsBox.appendChild(b);
});

// 🕉 Частота тона-дрона: при смене — мягкий кроссфейд на новом тоне
const droneChipsBox = $("#droneChips");
function setDroneFreq(i) {
  const st = sounds.drone;
  const wasOn = !!st?.on;
  droneFreqIdx = i;
  try { localStorage.setItem("zenDroneFreq", String(i)); } catch { /* ignore */ }
  [...droneChipsBox.children].forEach((c, j) => c.classList.toggle("active", j === i));
  if (st?.ref) {
    if (wasOn) setSoundState("drone", false); // старый тон уходит плавно
    const old = st.ref;
    st.ref = null; // следующее включение построит частоту заново
    setTimeout(() => { try { old.dispose?.(); } catch { /* ignore */ } }, 1600);
    if (wasOn) { setSoundState("drone", true); syncSoundPressed(); }
  }
  toast(`Тон: ${DRONE_FREQS[i].name}`);
}
DRONE_FREQS.forEach((d, i) => {
  const b = document.createElement("button");
  b.className = "chip" + (i === droneFreqIdx ? " active" : "");
  b.textContent = d.name;
  b.addEventListener("click", () => setDroneFreq(i));
  droneChipsBox.appendChild(b);
});

/* ------------------------- Панель настроек (⚙) ------------------------- */

const settingsBtn = $("#settingsBtn");
const settingsPanel = $("#settingsPanel");

function openSettings(open) {
  settingsPanel.hidden = !open;
  settingsBtn.setAttribute("aria-expanded", String(open));
  if (open) renderSettings();
}

function renderSettings() {
  // Тема — явный выбор вместо цикла
  const themeBox = $("#spTheme");
  const curT = localStorage.getItem("zenTodNight") || "";
  themeBox.innerHTML = "";
  [["", "✨ Авто"], ["1", "☾ Ночь"], ["2", "● Глубокая"]].forEach(([v, name]) => {
    const b = document.createElement("button");
    b.className = "chip" + (curT === v ? " active" : "");
    b.textContent = name;
    b.addEventListener("click", () => { setThemePref(v); renderSettings(); });
    themeBox.appendChild(b);
  });
  // Голос — через штатную кнопку шапки, чтобы состояние не расходилось
  const voiceBox = $("#spVoice");
  voiceBox.innerHTML = "";
  [["1", "🔊 Вкл"], ["0", "🔇 Выкл"]].forEach(([v, name]) => {
    const b = document.createElement("button");
    b.className = "chip" + ((voiceOn ? "1" : "0") === v ? " active" : "");
    b.textContent = name;
    b.addEventListener("click", () => { if (String(voiceOn ? "1" : "0") !== v) voiceBtn.click(); renderSettings(); });
    voiceBox.appendChild(b);
  });
  // Тихий фон сеанса — через чипы ряда в таймере
  const ambBox = $("#spAmbient");
  ambBox.innerHTML = "";
  AMBIENT_OPTS.forEach((opt) => {
    const b = document.createElement("button");
    b.className = "chip" + (opt.id === ambientPref ? " active" : "");
    b.textContent = opt.name;
    b.addEventListener("click", () => {
      [...ambientChipsBox.children].find((c) => c.textContent === opt.name)?.click();
      renderSettings();
    });
    ambBox.appendChild(b);
  });
  // Дыхание с таймером и отклики фаз — через чипы секций
  const fxBox = $("#spFx");
  fxBox.innerHTML = "";
  const mkToggle = (label, on, fn) => {
    const b = document.createElement("button");
    b.className = "chip" + (on ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", () => { fn(); renderSettings(); });
    fxBox.appendChild(b);
  };
  mkToggle("🌬 Дыхание с таймером", breathSync, () => syncChip.click());
  mkToggle("🌬 Звук и вибро фаз", breathFx, () => fxChip.click());
  // 🔔 Якорь — через чипы ряда в таймере
  const anchorBox = $("#spAnchor");
  if (anchorBox) {
    anchorBox.innerHTML = "";
    ANCHOR_OPTS.forEach((min) => {
      const b = document.createElement("button");
      b.className = "chip" + (anchorMin === min ? " active" : "");
      b.textContent = min === 0 ? "Выкл" : `${min} мин`;
      b.addEventListener("click", () => {
        [...anchorChipsBox.children][ANCHOR_OPTS.indexOf(min)]?.click();
        renderSettings();
      });
      anchorBox.appendChild(b);
    });
  }
  const seasonEl = $("#spSeason");
  if (seasonEl) seasonEl.textContent = `Сезон: ${SEASON_RU[document.body.dataset.season] || "—"}`;
}

settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openSettings(settingsPanel.hidden);
});
document.addEventListener("click", (e) => {
  if (settingsPanel.hidden) return;
  if (settingsPanel.contains(e.target) || settingsBtn.contains(e.target)) return;
  openSettings(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsPanel.hidden) openSettings(false);
  if (e.key === "Escape" && !paletteBackdrop.hidden) closePalette();
});

/* ------------------------- Пульт команд (⌘K / Ctrl+K) ------------------------- */

const paletteBackdrop = $("#paletteBackdrop");
const paletteInput = $("#paletteInput");
const paletteList = $("#paletteList");
let palItems = [], palIndex = 0;

// Недавние команды — под рукой при пустом запросе
let palHistory = [];
try { palHistory = JSON.parse(localStorage.getItem("zenPalHist") || "[]"); } catch { palHistory = []; }
function palRemember(name) {
  palHistory = [name, ...palHistory.filter((n) => n !== name)].slice(0, 5);
  try { localStorage.setItem("zenPalHist", JSON.stringify(palHistory)); } catch { /* ignore */ }
}
function palRun(cmd) {
  closePalette();
  palRemember(cmd.name);
  cmd.run();
}
// Динамические команды с числом — строятся и по имени (нужно и для истории)
function palMakeNumeric(name) {
  const m = name.match(/(\d+)/);
  if (!m) return null;
  const raw = parseInt(m[1], 10);
  if (name.startsWith("Таймер:")) {
    const n = Math.min(180, Math.max(1, raw));
    return { name: `Таймер: ${n} минут`, run: () => { setDurationMin(n); toast(`Таймер ${n} минут`); } };
  }
  if (name.startsWith("Громкость:")) {
    const v = Math.min(100, Math.max(0, raw));
    return { name: `Громкость: ${v}%`, run: () => { setVolume(v); toast(`Громкость ${v}%`); } };
  }
  return null;
}

const SOUND_RU = {
  rain: "Дождь", stream: "Ручей", ocean: "Океан", wind: "Ветер", fire: "Костёр",
  thunder: "Гроза", crickets: "Сверчки", birds: "Птицы", bowl: "Колокол",
  chimes: "Колокольчики", noise: "Белый шум", music: "Музыка", drone: "Тон-дрон",
  purr: "Мурлыканье", roof: "По крыше", train: "Поезд",
};

// Команды собираются в момент открытия — состояние всегда актуальное
function buildCommands() {
  const cmds = [];
  const add = (name, run) => cmds.push({ name, kw: name.toLowerCase(), run });

  ALL_NATURE.forEach((k) =>
    add(`Звук: ${SOUND_RU[k] || k}`, () => {
      ensureAudio();
      setSoundState(k, !sounds[k]?.on);
      syncSoundPressed();
    })
  );
  add("Звук: Музыка", () => document.querySelector('.sound[data-sound="music"]')?.click());
  MIXES.forEach((m, i) => add(`Микс: ${m.name}`, () => mixChipEls[i]?.click()));
  add("Микс: случайный по времени суток", () => randChip.click());
  add("Звуки: тишина", () => stopAllSounds());
  SCENES.forEach((s) =>
    add(`Сценарий: ${s.name}`, () =>
      [...sceneChipsBox.children].find((c) => c.textContent === s.name)?.click())
  );
  myScenes.forEach((s) => add(`Мой сценарий: ${s.name}`, () => runMyScene(s)));
  PATTERNS.forEach((p, i) =>
    add(`Ритм дыхания: ${p.name}`, () => { setPattern(i); toast(`Ритм ${p.name} — ${p.sub}`); })
  );
  TECHNIQUES.forEach((t) => add(`Техника: ${t.title}`, () => runTechnique(t)));
  [5, 10, 15, 20, 30].forEach((m) =>
    add(`Таймер: ${m} минут`, () => { setDurationMin(m); toast(`Таймер ${m} минут`); })
  );
  add(tRunning ? "Таймер: пауза" : "Таймер: старт", () => timerBtn.click());
  add("Таймер: сброс", () => $("#timerReset").click());
  add("Таймер сна: 30 минут", () => sleepChipClick(30));
  ANCHOR_OPTS.forEach((m) =>
    add(m === 0 ? "Якорь: выкл" : `Якорь: ${m} минут`, () =>
      [...anchorChipsBox.children][ANCHOR_OPTS.indexOf(m)]?.click())
  );
  add("Тема: авто", () => setThemePref(""));
  add("Тема: ночь", () => setThemePref("1"));
  add("Тема: глубокая ночь", () => setThemePref("2"));
  add("Фокус: включить", () => setFocusMode(true));
  add("Фокус: выключить", () => setFocusMode(false));
  add("Голос: вкл/выкл", () => voiceBtn.click());
  add("Режим: Ночник", () => setNightMode(true));
  add("Дыхание: старт/стоп", () => breathBtn.click());
  add("Стерео: вкл/выкл", () => spatialChip.click());
  PALETTES.filter((p) => p.id).forEach((p) =>
    add(`Палитра: ${p.name}`, () => { setPalette(p.id); toast(`Палитра: ${p.name}`); })
  );
  add("Палитра: авто", () => { setPalette(""); toast("Палитра — авто, как время суток."); });
  BELL_TONES.forEach((t, i) => add(`Колокол: ${t.name}`, () => setBellTone(i)));
  DRONE_FREQS.forEach((d, i) => add(`Тон: ${d.name}`, () => setDroneFreq(i)));
  [["Дыхание", "#breath"], ["Техники", "#techniques"], ["Таймер", "#timer"], ["Звуки", "#sounds"]]
    .forEach(([n, h]) => add(`Перейти: ${n}`, () => { location.hash = h; }));
  return cmds;
}

function paletteRender(q) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = buildCommands();
  // Команды с числом: «таймер 45», «громкость 30»
  const numM = q.match(/(\d+)/);
  const special = [];
  if (numM) {
    const raw = parseInt(numM[1], 10);
    if (words.some((w) => w.includes("таймер")) && !words.some((w) => w.includes("сн"))) {
      special.push(palMakeNumeric(`Таймер: ${Math.min(180, Math.max(1, raw))} минут`));
    }
    if (words.some((w) => w.includes("громкост"))) {
      special.push(palMakeNumeric(`Громкость: ${Math.min(100, Math.max(0, raw))}%`));
    }
  }
  const rest = all.filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
  if (!words.length && palHistory.length) {
    // Пустой запрос — сверху недавние
    const recent = palHistory.map((n) => all.find((c) => c.name === n) || palMakeNumeric(n)).filter(Boolean).slice(0, 3);
    const recentNames = new Set(recent.map((c) => c.name));
    palItems = [...recent, ...rest.filter((c) => !recentNames.has(c.name))].slice(0, 9);
  } else {
    palItems = [...special, ...rest]
      .filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i)
      .slice(0, 9);
  }
  palIndex = 0;
  paletteList.innerHTML = palItems
    .map((c, i) => `<button class="pal-item${i === 0 ? " sel" : ""}" data-i="${i}" role="option">${c.name}</button>`)
    .join("");
}

function openPalette() {
  openSettings(false);
  paletteBackdrop.hidden = false;
  paletteInput.value = "";
  paletteRender("");
  paletteInput.focus();
}

function closePalette() { paletteBackdrop.hidden = true; }

paletteInput.addEventListener("input", () => paletteRender(paletteInput.value));
paletteInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closePalette(); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!palItems.length) return;
    palIndex = (palIndex + (e.key === "ArrowDown" ? 1 : -1) + palItems.length) % palItems.length;
    [...paletteList.children].forEach((el, i) => el.classList.toggle("sel", i === palIndex));
    paletteList.children[palIndex]?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Enter") {
    const cmd = palItems[palIndex];
    if (cmd) palRun(cmd);
  }
});
paletteList.addEventListener("click", (e) => {
  const b = e.target.closest(".pal-item");
  if (!b) return;
  const cmd = palItems[Number(b.dataset.i)];
  if (cmd) palRun(cmd);
});
paletteBackdrop.addEventListener("click", (e) => {
  if (e.target === paletteBackdrop) closePalette();
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    paletteBackdrop.hidden ? openPalette() : closePalette();
  }
});
$("#paletteBtn").addEventListener("click", openPalette);

/* ------------------------- 🧠 Бинауральные ритмы (Stereo Brainwaves) ------------------------- */
const BINAURAL_MODES = {
  alpha: { base: 200, beat: 10, title: "Альфа-ритм (10 Гц): Релакс и спокойствие" },
  theta: { base: 150, beat: 6, title: "Тета-ритм (6 Гц): Глубокая медитация" },
  delta: { base: 100, beat: 2, title: "Дельта-ритм (2 Гц): Сон и восстановление" },
  gamma: { base: 240, beat: 40, title: "Гамма-ритм (40 Гц): Концентрация и фокус" },
};
let curBinaural = null;
let binNodes = null;

function setBinaural(mode) {
  ensureAudio();
  if (binNodes) {
    try {
      const now = AC.currentTime;
      binNodes.g.gain.setTargetAtTime(0.0001, now, 0.2);
      setTimeout(() => {
        try {
          binNodes.oscL.stop(); binNodes.oscR.stop();
          binNodes.oscL.disconnect(); binNodes.oscR.disconnect();
        } catch {}
        binNodes = null;
      }, 300);
    } catch {}
  }
  curBinaural = mode;
  document.querySelectorAll(".bin-btn").forEach((b) => b.classList.toggle("active", (b.dataset.hz || "0") === (mode || "0")));

  if (!mode || !BINAURAL_MODES[mode]) {
    toast("Бинауральные волны выключены.");
    return;
  }
  const conf = BINAURAL_MODES[mode];
  const panL = AC.createStereoPanner(); panL.pan.value = -1;
  const panR = AC.createStereoPanner(); panR.pan.value = 1;
  const oscL = AC.createOscillator(); oscL.type = "sine"; oscL.frequency.value = conf.base - conf.beat / 2;
  const oscR = AC.createOscillator(); oscR.type = "sine"; oscR.frequency.value = conf.base + conf.beat / 2;
  const g = AC.createGain(); g.gain.value = 0.0001;
  
  oscL.connect(panL); panL.connect(g);
  oscR.connect(panR); panR.connect(g);
  g.connect(master);
  
  const now = AC.currentTime;
  oscL.start(now); oscR.start(now);
  g.gain.setTargetAtTime(0.18, now, 0.4);
  binNodes = { oscL, oscR, g };
  toast(`🎧 ${conf.title}`);
}

document.querySelectorAll(".bin-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const hz = btn.dataset.hz;
    setBinaural(hz === "0" ? null : hz);
  });
});

/* ------------------------- 🪨 Интерактивный Сад Дзен (Canvas) ------------------------- */
let zenGardenInit = false;
let gardenMode = "sand";
let stones = [];
let ripples = [];
let isDrawing = false;
let lastPt = null;

function initZenGarden() {
  const canvas = document.getElementById("zenCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!zenGardenInit) {
    zenGardenInit = true;
    canvas.width = 560;
    canvas.height = 400;
    clearZenGarden(ctx);

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height),
      };
    };

    const startDraw = (e) => {
      isDrawing = true;
      lastPt = getPos(e);
      if (gardenMode === "pond") {
        addRipple(lastPt.x, lastPt.y);
        playWaterDrop();
      } else if (gardenMode === "stone") {
        addStone(lastPt.x, lastPt.y, ctx);
      }
    };
    const moveDraw = (e) => {
      if (!isDrawing) return;
      const pt = getPos(e);
      if (gardenMode === "sand") {
        drawRakeLines(ctx, lastPt.x, lastPt.y, pt.x, pt.y);
        playRakeScrape();
      } else if (gardenMode === "pond") {
        if (Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) > 28) {
          addRipple(pt.x, pt.y);
          playWaterDrop();
        }
      }
      lastPt = pt;
    };
    const endDraw = () => { isDrawing = false; lastPt = null; };

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", moveDraw);
    window.addEventListener("mouseup", endDraw);

    canvas.addEventListener("touchstart", (e) => { e.preventDefault(); startDraw(e); }, { passive: false });
    canvas.addEventListener("touchmove", (e) => { e.preventDefault(); moveDraw(e); }, { passive: false });
    canvas.addEventListener("touchend", endDraw);

    canvas.addEventListener("dblclick", (e) => {
      const pt = getPos(e);
      addStone(pt.x, pt.y, ctx);
    });

    document.querySelectorAll(".g-tool").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".g-tool").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        gardenMode = btn.dataset.tool || "sand";
      });
    });

    document.getElementById("gardenClear")?.addEventListener("click", () => {
      clearZenGarden(ctx);
      toast("Сад Дзен разглажен.");
    });

    function animPond() {
      if (ripples.length > 0) redrawPond(ctx);
      requestAnimationFrame(animPond);
    }
    requestAnimationFrame(animPond);
  }
}

function clearZenGarden(ctx) {
  const isNight = document.body.dataset.time === "night";
  ctx.fillStyle = isNight ? "#101622" : "#e4dcce";
  ctx.fillRect(0, 0, 560, 400);

  // Песчаная текстура: легкие базовые горизонтальные дзен-борозды
  ctx.strokeStyle = isNight ? "rgba(255, 255, 255, 0.03)" : "rgba(120, 90, 50, 0.06)";
  ctx.lineWidth = 2;
  for (let y = 15; y < 400; y += 14) {
    ctx.beginPath();
    ctx.moveTo(10, y);
    ctx.lineTo(550, y);
    ctx.stroke();
  }

  stones = [
    { x: 160, y: 160, r: 26, a: -0.2 },
    { x: 380, y: 240, r: 34, a: 0.35 },
    { x: 420, y: 200, r: 18, a: 0.15 },
  ];
  ripples = [];
  stones.forEach((s) => drawStone(ctx, s.x, s.y, s.r, s.a));
}

function drawRakeLines(ctx, x1, y1, x2, y2) {
  const isNight = document.body.dataset.time === "night";
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  [-10, 0, 10].forEach((offset) => {
    ctx.beginPath();
    ctx.moveTo(x1 + nx * offset, y1 + ny * offset);
    ctx.lineTo(x2 + nx * offset, y2 + ny * offset);
    ctx.strokeStyle = isNight ? "rgba(255, 255, 255, 0.08)" : "rgba(100, 80, 50, 0.12)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x1 + nx * (offset - 1.5), y1 + ny * (offset - 1.5));
    ctx.lineTo(x2 + nx * (offset - 1.5), y2 + ny * (offset - 1.5));
    ctx.strokeStyle = isNight ? "rgba(0, 0, 0, 0.25)" : "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function addStone(x, y, ctx) {
  const r = 18 + Math.random() * 16;
  const a = (Math.random() - 0.5) * 0.8;
  stones.push({ x, y, r, a });
  drawStone(ctx, x, y, r, a);
}

function drawStone(ctx, x, y, r, a) {
  const isNight = document.body.dataset.time === "night";
  ctx.save();
  ctx.translate(x, y);

  // Концентрические дзен-круги вокруг камня
  ctx.strokeStyle = isNight ? "rgba(255, 255, 255, 0.16)" : "rgba(100, 70, 40, 0.25)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r * 1.9, 0, Math.PI * 2);
  ctx.stroke();

  // Тень
  ctx.beginPath();
  ctx.arc(4, 8, r * 1.05, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fill();

  // Камень
  const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
  if (isNight) {
    grad.addColorStop(0, "#a0b8d0");
    grad.addColorStop(0.6, "#55677c");
    grad.addColorStop(1, "#202a36");
  } else {
    grad.addColorStop(0, "#c2bcb0");
    grad.addColorStop(0.6, "#6e685c");
    grad.addColorStop(1, "#36322b");
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Блик
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.3, r * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.fill();

  ctx.restore();
}

function addRipple(x, y) {
  ripples.push({ x, y, r: 6, maxR: 70 + Math.random() * 40, alpha: 0.85 });
}

function redrawPond(ctx) {
  const isNight = document.body.dataset.time === "night";
  ctx.fillStyle = isNight ? "rgba(10, 16, 26, 0.08)" : "rgba(225, 235, 245, 0.08)";
  ctx.fillRect(0, 0, 560, 400);

  for (let i = ripples.length - 1; i >= 0; i--) {
    const rip = ripples[i];
    rip.r += 1.8;
    rip.alpha -= 0.016;
    if (rip.alpha <= 0 || rip.r >= rip.maxR) {
      ripples.splice(i, 1);
      continue;
    }
    ctx.beginPath();
    ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
    ctx.strokeStyle = isNight ? `rgba(120, 200, 255, ${rip.alpha * 0.5})` : `rgba(45, 140, 210, ${rip.alpha * 0.4})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  stones.forEach((s) => drawStone(ctx, s.x, s.y, s.r, s.a));
}

let rakeTimer = 0;
function playRakeScrape() {
  const now = Date.now();
  if (now - rakeTimer < 140) return;
  rakeTimer = now;
  try {
    ensureAudio();
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer("white");
    const bp = filter("bandpass", 650, 1.5);
    const g = AC.createGain();
    const t0 = AC.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.035, t0 + 0.02);
    g.gain.linearRampToValueAtTime(0.0001, t0 + 0.12);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + 0.14);
  } catch {}
}

let waterTimer = 0;
function playWaterDrop() {
  const now = Date.now();
  if (now - waterTimer < 180) return;
  waterTimer = now;
  try {
    ensureAudio();
    const t0 = AC.currentTime;
    const osc = AC.createOscillator(); osc.type = "sine";
    osc.frequency.setValueAtTime(800 + Math.random() * 400, t0);
    osc.frequency.exponentialRampToValueAtTime(260, t0 + 0.14);
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + 0.16);
  } catch {}
}

/* ------------------------- 🌌 Полноэкранные живые сцены (Scenery) ------------------------- */
const sceneryOverlay = $("#sceneryOverlay");
const sceneryCanvas = $("#sceneryCanvas");
let sceneryCtx = null;
let sceneryMode = "fire";
let sceneryAnimId = null;
let sceneryItems = [];

function openScenery(on) {
  sceneryOverlay.hidden = !on;
  if (on) {
    document.body.style.overflow = "hidden";
    if (!sceneryCtx) sceneryCtx = sceneryCanvas.getContext("2d");
    resizeScenery();
    initSceneryMode();
    loopScenery();
  } else {
    document.body.style.overflow = "";
    if (sceneryAnimId) { cancelAnimationFrame(sceneryAnimId); sceneryAnimId = null; }
  }
}

function resizeScenery() {
  if (!sceneryCanvas) return;
  sceneryCanvas.width = window.innerWidth;
  sceneryCanvas.height = window.innerHeight;
}
window.addEventListener("resize", () => {
  if (!sceneryOverlay?.hidden) resizeScenery();
});

function initSceneryMode() {
  sceneryItems = [];
  const w = sceneryCanvas.width, h = sceneryCanvas.height;
  if (sceneryMode === "fire") {
    for (let i = 0; i < 90; i++) {
      sceneryItems.push({
        x: w / 2 + (Math.random() - 0.5) * (w * 0.35),
        y: h * 0.85 + Math.random() * (h * 0.15),
        vy: 1.5 + Math.random() * 3.5,
        vx: (Math.random() - 0.5) * 1.5,
        r: 3 + Math.random() * 8,
        life: Math.random(),
        maxLife: 0.7 + Math.random() * 0.6,
      });
    }
  } else if (sceneryMode === "stars") {
    for (let i = 0; i < 180; i++) {
      sceneryItems.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.8 + Math.random() * 2.2,
        twinkle: Math.random() * Math.PI * 2,
        speed: 0.02 + Math.random() * 0.04,
      });
    }
  } else if (sceneryMode === "ocean") {
    for (let i = 0; i < 50; i++) {
      sceneryItems.push({
        y: h * 0.55 + (i / 50) * (h * 0.45),
        phase: Math.random() * Math.PI * 2,
        speed: 0.02 + (i / 50) * 0.03,
      });
    }
  }
}

function loopScenery() {
  if (sceneryOverlay.hidden) return;
  const ctx = sceneryCtx;
  const w = sceneryCanvas.width, h = sceneryCanvas.height;

  if (sceneryMode === "fire") {
    ctx.fillStyle = "rgba(8, 5, 4, 0.25)";
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w / 2, h * 0.88, 40, w / 2, h * 0.88, w * 0.45);
    glow.addColorStop(0, "rgba(255, 100, 20, 0.22)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    sceneryItems.forEach((p) => {
      p.y -= p.vy;
      p.x += p.vx + (Math.random() - 0.5) * 0.8;
      p.life += 0.012;
      const progress = p.life / p.maxLife;
      if (progress >= 1) {
        p.x = w / 2 + (Math.random() - 0.5) * (w * 0.35);
        p.y = h * 0.88 + Math.random() * 20;
        p.life = 0;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.r * (1 - progress * 0.7)), 0, Math.PI * 2);
      const r = 255;
      const g = Math.floor(180 * (1 - progress * 0.9));
      const b = Math.floor(40 * (1 - progress));
      const a = (1 - progress) * 0.8;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
      ctx.fill();
    });
  } else if (sceneryMode === "stars") {
    ctx.fillStyle = "rgba(4, 6, 12, 0.3)";
    ctx.fillRect(0, 0, w, h);
    sceneryItems.forEach((s) => {
      s.twinkle += s.speed;
      const alpha = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(s.twinkle));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220, 235, 255, ${alpha})`;
      ctx.fill();
    });
  } else if (sceneryMode === "ocean") {
    ctx.fillStyle = "rgba(4, 8, 16, 0.25)";
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.22, 34, 0, Math.PI * 2);
    ctx.fillStyle = "#fffaed";
    ctx.shadowColor = "#fffaed"; ctx.shadowBlur = 40;
    ctx.fill();
    ctx.shadowBlur = 0;

    sceneryItems.forEach((wave) => {
      wave.phase += wave.speed;
      ctx.beginPath();
      ctx.moveTo(0, wave.y);
      for (let x = 0; x <= w; x += 30) {
        const yOffset = Math.sin(x * 0.015 + wave.phase) * 6;
        ctx.lineTo(x, wave.y + yOffset);
      }
      ctx.strokeStyle = `rgba(180, 220, 255, ${0.08 + 0.12 * Math.sin(wave.phase)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    });
  }

  sceneryAnimId = requestAnimationFrame(loopScenery);
}

$("#sceneryBtn")?.addEventListener("click", () => openScenery(true));
$("#sceneryExit")?.addEventListener("click", () => openScenery(false));
document.querySelectorAll(".sc-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sc-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    sceneryMode = btn.dataset.scene || "fire";
    initSceneryMode();
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !sceneryOverlay?.hidden) openScenery(false);
});

// Инициализация активной вкладки по хэшу URL (#timer, #breath, #garden)
applyHashStage();

