# 📐 План реализации: PLAN-012 — v48 «Polish & Fix»: багфиксы аудита + UX/перф + дизайн-анимации

> **Статус:** ✅ COMPLETED (все этапы A–D выполнены и проверены вживую)  
> **Дата создания:** 2026-11-01  
> **Автор / Агент:** ZCode (GLM 5.3 Flash)  
> **Связанная задача:** [TASK-012](file:///agents/tasks/active_task.md)  
> **Связанные баги:** BUG-002, BUG-003, BUG-004 (bugs_and_fixes/)  
> **Целевая ветка / Ревизия:** main

---

## 1. 🎯 Цель и контекст

- **Проблема:** Аудит v47 (2026-11-01) подтвердил 3 бага (сломанный Ночник, гонка бинауральных,
  сырой HTML в цитатах), 6 средних недочётов и выявила нереализованные возможности дизайна
  (мёртвый `revealCheck` без `.reveal`-элементов, `bell-pulse` без CSS).
- **Ожидаемый результат:** Релиз v48 — все баги закрыты, рендер резкий на retina, оверлеи и
  вкладки анимированы, прокрутка оживлена, a11y-пробелы закрыты, документация актуальна.

## 2. 🔍 Анализ и затронутые компоненты

### Затронутые файлы:
- `[MODIFY]` `style.css` — фикс `.nightmode`, блок `v48` в конце (анимации, focus-visible, тач-таргеты, reduced-motion).
- `[MODIFY]` `app.js` — guard `setBinaural`, strip HTML в `clean()`, ленивый rAF сада, guard-листенеры, Space-делегат, бинауральные в `stopAllSounds`, try/catch localStorage, dblclick-камень, DPR-рендер двух канвасов, fade цитаты.
- `[MODIFY]` `index.html` — бамп `?v=48` (4 ссылки), `class="reveal"` на 3 Bento-секции.
- `[MODIFY]` `sw.js` — `CACHE_VERSION = 'v48'`.
- `[UPDATE]` `agents/architecture/CODEBASE_MAP.md`, `agents/STATUS.md`, `README.md`, `agents/tasks/active_task.md`, `agents/bugs_and_fixes/BUG_00{2,3,4}*.md` (статусы → 🟢).

### Риски и откат:
- DPR-пересчёт координат Сада Дзен — главный риск. Откат: git-реверт app.js.
- SW-кеш: без бампа версий изменения не дойдут до повторных визитов — бамп обязателен первым шагом.

## 3. 📝 Пошаговый план реализации

- [x] **Этап A: Багфиксы (ядро)**
  - [x] A1. `style.css`: удалить `position: relative` из `.nightmode`; вернуть fade-in `nmIn`.
  - [x] A2. `app.js setBinaural()`: захват старых узлов в замыкание + guard `if (binNodes === old)` + `disconnect()`.
  - [x] A3. `app.js clean()`: strip HTML-тегов, `&nbsp;`, схлопывание пробелов.
  - [x] A4. `index.html` `?v=48` ×4; `sw.js` `CACHE_VERSION = 'v48'`.
- [x] **Этап B: UX/перф**
  - [x] B1. rAF сада: цикл спит без ряби, будится в `addRipple` (+ снапшот-восстановление песка — вода не оставляет следов и не стирает узоры).
  - [x] B2. `initZenGarden`: duplicate-listener guard.
  - [x] B3. Space: не перехватывать, если фокус на интерактивном элементе.
  - [x] B4. `stopAllSounds()`: выключать бинауральные.
  - [x] B5. try/catch вокруг голого `localStorage` (5 мест `zenTodNight`).
  - [x] B6. dblclick-камень: не дублировать в режиме «Камни».
- [x] **Этап C: Дизайн и анимации**
  - [x] C1. CSS `v48`-блок: `stageIn` для вкладок студии, `popIn` для оверлеев и пульта, fade-in ночника, элегантные тонкие часы ночника.
  - [x] C2. Подключить `class="reveal"` к `#quote`, `#sounds`, `#techniques` (оживить `revealCheck`).
  - [x] C3. `bell-pulse` keyframes для кольца таймера.
  - [x] C4. Мягкий `fadeUp` при смене цитаты (класс `quote-in`).
  - [x] C5. DPR-рендер: `zenCanvas` (логические 560×400) и `sceneryCanvas`.
  - [x] C6. `:focus-visible` глобально; тач-таргеты `.mc-btn`/`.qt-chip` ≥44px на мобиле; pulse-свечение кнопки дыхания в idle; bump стрика.
  - [x] C7. Расширить `prefers-reduced-motion` (`.breath-petals`, `.nm-glow`, `.stage-card`, `.ov-card`, `.palette`, `.reveal`).
- [x] **Этап D: Проверка и документация**
  - [x] D1. Живой прогон в браузере: все оверлеи, вкладки, сад (рисование/рябь/снапшот), бинауральные гонка/выключение, Space, пульт, сценарий сцены — 0 ошибок JS, скриншоты сняты.
  - [x] D2. `check_integrity.py` → 100%.
  - [x] D3. Обновить CODEBASE_MAP (sw.js, docs/, brain.py, LICENSE, .github/), README (v48), STATUS, BUG-002/3/4 → 🟢, history.

## 4. 🧪 Критерии готовности (Definition of Done)
1. Ночник — fullscreen чёрный экран с часами, выход тапом/Esc.
2. Альфа→Тета→«Выкл» за <1 c — полная тишина; консоль без ошибок.
3. В «Мысли дня» нет `<`, `/>`, `&nbsp;`.
4. Сад рисует борозды и круги, картинка резкая (retina), после ухода со вкладки rAF не тикает.
5. Оверлеи/вкладки/цитата анимированы, reduced-motion гасит всё.
6. `check_integrity.py` 100%, документация синхронизирована.
