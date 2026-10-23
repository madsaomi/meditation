# 📐 План реализации: PLAN-004 — Микро‑анимации v40: hover lotus, pulse orb, loading spinner, enhanced chip transitions

**Статус:** 🟡 DRAFT | 🟢 APPROVED | 🔵 IN_PROGRESS | ✅ COMPLETED  
**Дата создания:** 2026-10-23  
**Автор / Агент:** AI Assistant  
**Связанная задача:** [TASK-001](file:///agents/tasks/active_task.md)  
**Целевая ветка / Ревизия:** main  

---

## 1. 🎯 Цель и контекст

- **Проблема / Задача:** Добавить тонкие интерактивные анимации (ховера, pulse, спиннер) к уже реализованным фичам v38‑v39 (палитры, лотос, дрон, колокол) для создания более живого и отзывчного интерфейса. Пользователи любит «живые» детали, но они не должны ломать Reduced‑Motion и мобильную вёрстку.
- **Ожидаемый результат:** 
  - Чувство отзывчивости при наведении на чип‑звуков, кнопки и SVG‑логотип.
  - Плавный pulse-орб при простоянии (останавливается при Reduced‑Motion).
  - НевидимыйLoading‑спINNER при долгих операциях (например, при смене тем или инициализации звука).
  - Улучшенные переходы при смене палитры и ритма дыхания.
  - 0 регрессов в доступности и мобильной адаптации 390 px.

---

## 2. 🔍 Анализ и затронутые компоненты

### Затронутые файлы:
- `[MODIFY]` `style.css` — добавление правил ховера, pulse, спиннера, переходов.
- `[MODIFY]` `app.js` — флаги Reduced‑Motion, управление классами анимаций, возможная инициализация спиннера.
- `[MODIFY]` `index.html` — добавление контейнера для спиннера при необходимости (например, рядом с кнопкой настроек).
- `[UPDATE]` `agents/plans/plan_004_mikroanimatsii_v40_hover_lotus_pulse_orb_loading_spinner_enhanced_chip_transitions.md` — чек‑лист раунда.

### Зависимости и влияние:
- Влияние на существующие API: никак — только CSS‑классы и CSS‑классы.
- Риск ломающих изменений: НЕТ. Все изменения но прогрессивное улучшение (progressive enhancement), отключаются через `prefers-reduce-motion`.

---

## 3. 📝 Пошаговый план реализации (Atomic Steps)

### Этап 1: Подготовка и контракты
- [ ] Шаг 1.1: Убедиться, что в `style.css` есть блоки `@media (prefers-reduce-motion: reduce)` (уже есть с 1097‑1099 строкой).
- [ ] Шаг 1.2: Добавить переменную `--animation-duration` в `:root` (по умолчанию `0.2s`), чтобы можно было быстро глобально замедлить/ускорить анимации при необходимости.

### Этап 2: Реализация базовой логики
- [ ] Шаг 2.1: В `style.css` добавить правила ховера для `.chip` (already done in v39); расширить: `.chip:hover { transform: translateY(-2px) scale(1.04) … }` с переходом `transition: transform .15s ease, box-shadow .15s ease;`.
- [ ] Шаг 2.2: Добавить `:active` состояние `.chip:active { transform: translateY(1px) scale(.98); }`.
- [ ] Шаг 2.3: Добавить ховер для `.sound` кнопок: `.sound:hover { transform: scale(1.02); transition: transform .12s ease; }`.
- [ ] Шаг 2.4: Добавить `@keyframes brandPulse` (уже есть из v39) и правило `.brand { animation: brandPulse 5s ease-in-out infinite; }`; внутри `@media (prefers-reduce-motion: reduce) { .brand { animation: none; } }`.
- [ ] Шаг 2.5: Добавить CSS‑класс `.loading-spinner` с `width: 20px; height: 20px; border: 3px solid var(--accent); border-color: var(--accent transparent transparent transparent); border-radius: 50%; animation: spin 1s linear infinite;`. Добавить `@keyframes spin { to { transform: rotate(360deg); } }`.
- [ ] Шаг 2.6: Добавить правила для ховера и активного состояния SVG‑элементов лотоса: `.lotus .petal:hover { fill: color-mix(in srgb, var(--accent) 30%, transparent); stroke: var(--accent); }`.
- [ ] Шаг 2.7: Добавить улучшенные переходы при смене палитры: `.body[data-palette] { transition: --accent .4s ease, --accent-bright .4s ease, --accent2 .4s ease; }` (уже есть благодаря @property, но можно добавить явный transition на корневой элемент).

### Этап 3: Тестирование и верификация
- [ ] Шаг 3.1: Ручной тест ховера на всех чипах (зонд, океан, дрон, колокол и др.) — проверка появления transform и цвета.
- [ ] Шаг 3.2: Включить Reduced‑Motion в настройках ОС/браузера — убедиться, что brandPulse,lotor hover анимации и спиннер останавливаются (animation: none).
- [ ] Шаг 3.3: Проверка на мобильном 390 px: ховер‑эффекты не должны ломать layout, кнопки остаются тапаемыми.
- [ ] Шаг 3.4: Проверить, что спиннер появляется/ desapare при соответствующих действиях (можно привязать к setTimeout в app.js при инициализации, но на этом этапе достаточно наличия CSS‑класса).

### Этап 4: Документирование и сдача
- [ ] Шаг 4.1: Обновить `CODEBASE_MAP.md` про новых CSS‑классов.
- [ ] Шаг 4.2: Зафиксировать сессию `brain.py end` и обновить `STATUS.md`.

### Этап 5: Риски и откат
- [ ] Шаг 5.1: Если кто‑то отключит Reduced‑Motion, анимации включатся (ожидаемое поведение).
- [ ] Шаг 5.2: План отката: `git checkout main` к предыдущему коммиту (до v40) — изменения но additive, откат безопасен.

---

## 4. 🛡️ Риски, сайд‑эффекты и план отката (Rollback Strategy)
- **Потенциальные риски:** 
  - Анимации могут вызывать Motion‑Sickness у некоторых пользователей — mitigated Reduced‑Motion flag.
  - Лишние DOM‑элементы (спиннер) могут сломать верстку на узких экранах — mitigated `max-width: 390px` тесты.
- **План отката в случае сбоя:** `git checkout main` к предыдущему коммиту (v39). Изменения но additive CSS‑классы, отключение их просто удалением классов из HTML или комментариев в CSS.

---

## 5. 🧪 План тестирования и критерий приемки
1. **Ручная проверка ховера:** наведение на любой `.chip` или `.sound` дает transform + цвет.
2. **Reduced‑Motion:** в системных настройках отключены все ключевые анимации (brandPulse,lotus hover, spinner).
3. **Мобильная 390 px:** верстка не ломается, кнопки остаются кликабельными, отступы сохранены.
4. **Критерий "Готово":** 
   - [ ] CSS‑код компилируется без ошибок.
   - [ ] Визуальный тест пройден в Chrome DevTools (Device Toolbar 390 px, Reduced‑Motion включен/выключен).
   - [ ] Чек‑лист плана [x] полностью выполнен.

---

## 6. 📁 Релевантные файлы
- `style.css` — ховеры, pulse, спиннер, переходы.
- `app.js` — флаги Reduced‑Motion, классы анимаций.
- `index.html` — контейнер спиннера (по необходимости).
- `agents/plans/plan_004_mikroanimatsii_v40_hover_lotus_pulse_orb_loading_spinner_enhanced_chip_transitions.md` — чек‑лист раунда.