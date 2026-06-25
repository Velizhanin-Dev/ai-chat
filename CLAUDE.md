# CLAUDE.md — creative-chat

AI-ассистент Велижанина (методика КМК) в формате SaaS-продукта. Чат с AI в голосе
Николая Велижанина на Claude API. Next.js 14 + TypeScript + Prisma + Mantine.

> Подробности архитектуры чата, слоёв базы знаний и system-промпта — в памяти проекта
> (`project_overview.md`). Этот файл — про SaaS-обвязку и дорожную карту продукта.

---

## ⚠️ КОНВЕНЦИЯ ДОКУМЕНТИРОВАНИЯ (читать первым)

**При реализации любой фишки из дорожной карты ниже, а также при добавлении новой
или переработке существующей — обновляй этот файл в той же задаче:**

- меняй статус пункта (`🔴 не начато` → `🟡 в работе` → `🟢 готово`);
- дописывай, *как именно* реализовано: ключевые файлы, модели БД, эндпоинты, провайдеры;
- если появилась новая составляющая, которой нет в списке — добавляй пункт;
- если переработали (сменили провайдера платежей, схему авторизации и т.п.) —
  правь описание, не плоди дубли.

Документация и код едут вместе. Не оставляй этот файл отставать от реальности.

---

## Дорожная карта SaaS-составляющих

Легенда статусов: 🟢 готово · 🟡 в работе · 🔴 не начато

### Уже есть
- 🟢 **Лендинг** — брендовый продающий лендинг + дизайн-система velizhanin.com
  (акцент `#EC582E`, шрифт RandomGrotesque). `src/app/page.tsx`, `docs/design-system.md`.
- 🟢 **Чат с AI-ассистентом** — `POST /api/chat` (стриминг, prompt caching).
  `src/app/chat/page.tsx`, `src/app/api/chat/route.ts`. Ответы рендерятся как
  **markdown** (`components/Chat/Markdown.tsx`, react-markdown + remark-gfm; стили
  `.md-body` в globals.css). Свои сообщения вправо, баббл по контенту. Бабблы —
  токен-ориентированные классы `.bubble-user` / `.bubble-assistant` (контраст ≥4.5:1
  в обеих темах; свои — оранжевый тинт бренда + обычный текст, ответы — нейтральная
  поверхность gray.1 / dark.6 с видимым бордером).
  - **Без карточки-обводки:** сообщения «текут» по фону страницы (раньше была
    `Paper withBorder` — на тёмной давала резкую серую рамку). Композер (поле ввода +
    «отправить») — отдельный мягкий блок `.chat-composer`: скруглённая поверхность
    (gray-0 / dark-6, без бордера), `Textarea variant="unstyled"` сливается с ней,
    фокус — `outline` бренд-акцента на `:focus-within`. По «Новый чат» фокус прыгает
    в поле через `inputFocusSignal` (тик в `chatSlice`, слушает `ChatInput`).
  - **Черновик ввода:** недоотправленный текст пишется в localStorage по debounce
    (400 мс), ключ `creative-chat:chat-draft-v1` (scoped по `userId`). Восстанавливается
    при заходе на /chat (не затирая уже начатый ввод), удаляется при отправке. Всё в
    `ChatInput.tsx`.
- 🟢 **История диалогов (localStorage, без бэкенда)** — много-диалоговая модель в
  `store/chatSlice.ts` (`conversations` + `activeId`), сайдбар со списком/активным/
  переключением/удалением в `components/Shell/AppShell.tsx`, кнопка «Новый чат».
  **Диалог создаётся лениво** — только при первом сообщении (`startNewChat` чистит
  активный, `ChatInput` создаёт при отправке), как в ChatGPT/Claude. Заголовок слева —
  **контекстный, от нейронки**: `POST /api/title` (haiku) по первому сообщению; фолбэк —
  обрезанный текст. Персист + миграция старого формата — `store/StoreProvider.tsx`
  (ключи `…:conversations-v1`, `…:settings-v1`, `…:auth-v1`).
  **Скелетон при гидратации:** localStorage читается на клиенте, поэтому пока чат не
  гидратирован (`chat.hydrated=false`) сайдбар показывает 4 `Skeleton`, а не ложное
  «Пока нет диалогов». Флаг ставит `chatHydrated()` в конце `hydrateOnce` (всегда, даже
  если localStorage пуст). На сервере флаг false → скелетоны и в SSR-HTML (без mismatch).
- 🟢 **Логотип** — единый кликабельный `components/Brand/Logo.tsx` (одна типографика
  на лендинге и в шапке приложения). В шапке ведёт на `/chat`.
- 🟢 **Бриф клиента + карта харизмы (DISC)** — мастер «Знакомство перед стартом» в 2 шага
  (верхний степпер «О проекте» → «О себе»), вопросы идут **по одному за экран**
  (Typeform-style): крупный вопрос + одно поле + прогресс «n / N» под степпером.
  - **Один общий визард — `components/Brief/BriefFlow.tsx`.** Содержит всё состояние,
    навигацию, черновик и рендер шагов 0/1/2; принимает пропсы `onSubmit` (куда сохранить
    готовый бриф), `resultNote` / `resultActions` (что показать и какие кнопки на экране
    результата), `draftKey` + `draftScope` (ключ и «владелец» черновика). Монтируется
    заново на каждое открытие → восстановление черновика делает в эффекте на маунте (без
    прежнего `wasOpen`-ref). Двое потребителей:
    - `components/Brief/BriefModal.tsx` — тонкая обёртка `Modal` (онбординг + «пройти
      заново»). `onSubmit` = `PATCH /api/auth/brief` + `authenticated`, финал ведёт в чат.
      На мобиле `fullScreen` (`useMediaQuery`), запас снизу под клавиатуру.
    - `src/app/brief/page.tsx` — **анонимная страница по QR-коду** (см. ниже).
  - Шаг **«О проекте»** — 8 пунктов (канал, ниша, продукт, аудитория, экспертность,
    цель, запретные темы, опыт на камере), `PROJECT_ITEMS` в `BriefFlow`. **Все
    необязательны** — на пустом поле кнопка «Пропустить», на заполненном «Дальше» (и в
    модалке, и на странице). Enter = дальше, автофокус + `scrollIntoView` на активном поле.
    `maxLength` на инпутах из карты `BRIEF_LIMITS` (`src/lib/brief.ts`) — те же лимиты,
    что и в `sanitizeBrief` (виден санитайзинг ввода).
  - Шаг **«О себе»** — короткий DISC-тест (10 forced-choice вопросов под съёмку),
    тоже по одному вопросу; варианты — кликабельные `Radio.Card` с **автопереходом**
    после выбора (+ ручная «Дальше»). **Единственное обязательное** в брифе. Слово
    «харизма»/«DISC» в процессе НЕ светим — подаём как вопросы «о себе»; типаж раскрываем
    только на экране результата.
  - Результат → один из 7 архетипов харизмы (IC «Илон Маск», DI «Очаровательная
    акула», ID «Звезда», IS «Жизнь в кайф», SC «Кот Леопольд», CS «Самый
    последовательный», DC «Айрон Фист»). Вся доменка (типы, вопросы, скоринг, карта
    архетипов, лимиты `BRIEF_LIMITS`, сборка блока для промпта) — `src/lib/brief.ts`
    (чистый модуль, общий для клиента и сервера).
  - **Completeness:** `isBriefComplete` = пройден DISC (`b.disc`). Поля «о проекте»
    (включая камеру) необязательны и нигде не блокируют. Это и есть критерий снятия гейта.
  - **Энфорс брифа — серверный (не обходится через devtools):** `POST /api/chat`
    требует залогиненного юзера с пройденным брифом (`briefCompletedAt` + `isBriefComplete`),
    иначе `401`/`403 BRIEF_REQUIRED` — это единственная надёжная проверка. Вдобавок
    `AppShell` при `!briefCompleted` **не рендерит чат** под модалкой (показывает заглушку),
    чтобы интерфейс не светился, если снести оверлей. Клиентская модалка — лишь UX.
  - **Гейт + мост анонимного брифа:** в `AppShell.tsx` — если залогинен и
    `briefCompleted=false`, **сначала** пробуем подхватить анонимный бриф из localStorage
    (заполнен на `/brief` по QR до регистрации): `readAnonBrief` → `apiSaveBrief` →
    `authenticated` + `clearAnonBrief`. Тогда `briefCompleted` становится true и модалка
    не открывается. Если анонимного брифа нет (или сохранение упало) — модалка открывается
    принудительно (`mandatory`: без крестика). Пробуем мост один раз на сессию входа
    (`bridgeTried`-ref, сбрасывается на логауте). Работает только на том же
    устройстве/браузере — норм для QR-сценария.
  - **Страница по QR — `src/app/brief/page.tsx`:** анонимна (юзера/сессии нет), в навигации
    её нет — попадают только по прямой ссылке/QR (QR делаем отдельно). Свой layout (лого +
    `BriefFlow` в `Paper`, `100dvh`). `onSubmit` = `writeAnonBrief` (localStorage,
    `src/lib/anon-brief.ts`, ключ `creative-chat:anon-brief-v1`, хранит только завершённый
    бриф). Финал: экран архетипа + CTA «Попробовать AI» (на главную) и «Пройти заново».
    `/brief` добавлен в `BARE_ROUTES` (без шапки/сайдбара/гейта), middleware его не гейтит.
  - **Черновик в localStorage:** прогресс (поля + ответы теста + текущий шаг/вопрос)
    пишется на каждое изменение; ключ + scope приходят от родителя (`BriefFlow`): модалка —
    `creative-chat:brief-draft-v1` (scope = `userId`), страница — `…-anon-v1` (scope `anon`).
    Не теряется при обновлении/плохом интернете. Приоритет восстановления: незавершённый
    черновик → стартовый бриф (`initialBrief`, режим «пройти заново») → пусто. Чистится
    после успешного `onSubmit`. Экран результата (step 2) не восстанавливается; ответы
    нормализуются под актуальную структуру теста.
  - **Хранение (аккаунт):** бэкенд. `User.brief` (Json) + `User.briefCompletedAt`
    (`schema.prisma`, миграция `add_user_brief`). Сохранение — `PATCH /api/auth/brief`
    (валидирует через `isBriefComplete`, ставит `briefCompletedAt`). В клиентский снимок
    (`publicUser`) добавлены `brief` и `briefCompleted`; гидратация через `/api/auth/me`.
  - **В модель:** `ChatInput` шлёт `brief` в `/api/chat`, `route.ts` через `buildBriefBlock`
    вставляет отдельным system-блоком (поля брифа + карта архетипа: форматы / что работает /
    что убивает) рядом с «о себе».
  - **Пройти заново:** кнопка в `SettingsModal` (Основные → «Бриф и тип харизмы»), открывает
    ту же модалку в необязательном режиме (через `onRetakeBrief` из `AppShell`).
- 🟡 **Настройки (модалка)** — `components/Settings/SettingsModal.tsx`, открывается из
  меню профиля **только для залогиненных** (кнопка скрыта для гостей). Вкладки: Основные,
  Биллинг, Язык. Слайс — `store/settingsSlice.ts`.
  - **Основные → Аккаунт:** имя и почта в один ряд (по `TextInput`). Имя «как обращаться» —
    редактируемое, **автосейв с дебаунсом** (700 мс, без кнопки): `PATCH /api/auth/me`
    обновляет `User.name` и диспатчит `authenticated` → шапка/сайдбар подхватывают новое имя;
    в поле — лоадер при сохранении и галочка после. Почта — `readOnly`-инпут с иконкой
    статуса подтверждения; если `emailVerified=false`, ниже кнопка «Отправить заново»
    (`/api/auth/resend-verification`).
  - **Основные → О себе:** `settings.aboutYou`, реально подгружается в нейронку (`ChatInput`
    шлёт в `/api/chat`, `route.ts` вставляет отдельным system-блоком в конец).
  - **Основные → Бриф и тип харизмы:** статус (бейдж с архетипом) + кнопка «Пройти бриф
    заново» → открывает `BriefModal` (см. отдельный пункт «Бриф клиента + карта харизмы»).
  - **Биллинг:** карточки тарифов тянутся из БД через `GET /api/plans` (модель `Plan`,
    редактируется в админке — см. «Админка + фичефлаги» → «Тарифы в БД»), тот же источник,
    что и у лендинга. id'шники `PlanId` (`start`/`blogger`/`studio`) исторические. Переход
    на тариф — **заглушка**: онлайн-оплаты нет, `settings.plan` не меняем, показываем
    `Alert` про ручной перевод (`handleChoosePlan` → `pendingPlan`).
  - **Язык:** пока только русский.
- 🟢 **Авторизация (реальный бэкенд)** — email+пароль и OAuth (VK ID / Яндекс) на
  своём бэкенде.
  - **Сессия:** подписанный JWT (`jose`, HS256) в httpOnly-cookie `cc_session` (30 дней),
    сервер сессии не хранит. Хелперы — `src/lib/auth.ts` (bcrypt-хэш пароля, sign/verify
    JWT, set/clear cookie, `getSessionUser`, одноразовые токены). `JWT_SECRET` в env.
  - **Модели БД** (`schema.prisma`): `User` (email, name, `passwordHash` — nullable,
    у OAuth-юзеров null; plan, emailVerified), `VerificationToken` (sha256-хэш токена,
    type `email_verify`|`password_reset`, TTL) и `OAuthAccount` (provider,
    providerAccountId, userId; `@@unique([provider, providerAccountId])`). Миграции
    `add_user_auth`, `add_oauth`.
  - **API** `src/app/api/auth/*`: `register`, `login`, `logout`, `me`, `verify-email`,
    `resend-verification`, `forgot-password`, `reset-password`. Без энумерации почты
    (логин и forgot отвечают одинаково независимо от наличия юзера). Логин не пускает
    OAuth-юзеров (passwordHash=null) — тот же ответ «неверная почта/пароль».
  - **OAuth (VK ID / Яндекс):** `src/lib/oauth.ts` (конфиги провайдеров, PKCE для VK,
    обмен кода, профиль, `findOrCreateOAuthUser`). Старт — `GET /api/auth/oauth/[provider]`
    (генерит state + PKCE-verifier, кладёт в httpOnly-cookie `oauth_state`, редиректит на
    провайдера). Колбэк — `GET /api/auth/callback/[provider]` (сверяет state, меняет code
    на профиль, находит/создаёт юзера по `(provider, providerAccountId)` → фолбэк email,
    ставит сессию, редирект на `next`/`/chat`; ошибки → `/login?error=...`, маппинг в
    `LoginPage`). Redirect URI: `{NEXT_PUBLIC_APP_URL}/api/auth/callback/{yandex|vk}`.
    Ключи — `YANDEX_CLIENT_ID/SECRET`, `VK_CLIENT_ID` (+опц. `VK_CLIENT_SECRET`) в env;
    нет ключей → кнопка ведёт на `?error=oauth_unavailable`. `SocialButtons` — обычные
    ссылки на старт. **Не протестировано вживую** (нужны реальные ключи провайдеров).
  - **Письма:** Unisender (метод `sendEmail`, `src/lib/mail.ts`) — подтверждение почты и
    сброс пароля. Без `UNISENDER_API_KEY`/`UNISENDER_LIST_ID` письмо не уходит, ссылка
    пишется в лог сервера (dev). `EMAIL_FROM` (sender_name + подтверждённый sender_email),
    `UNISENDER_LIST_ID` (список для отписки) — в env.
  - **Verify-gate выключен:** регистрация сразу логинит, письмо подтверждения уходит, но
    вход не блокируется (`emailVerified` пишем для будущего гейта).
  - **Защита роутов:** `src/middleware.ts` (edge) гейтит `/chat` — без валидной
    сессии (нет/битый/истёкший `cc_session`) редирект на `/login?next=/chat` ещё до
    рендера, без вспышки контента. Проверяет ТОЛЬКО подпись JWT через `jose`
    (email-подтверждение НЕ требуем, см. verify-gate); Prisma/Node-API на edge нет,
    поэтому логика `verifySession` продублирована. `LoginPage` после входа возвращает
    на безопасный внутренний `next` (иначе `/chat`). Матчер — `/chat` и `/chat/:path*`.
  - **Клиент + SSR-засев:** `store/authSlice.ts` (флаг `ready`, источник правды —
    серверная cookie, в localStorage auth не персистим), `src/lib/auth-client.ts`
    (обёртка над API). Юзера засеваем **на сервере**: `app/layout.tsx` (async) читает
    `getSessionUser()` из cookie и отдаёт `initialUser` в `StoreProvider`. Стор теперь
    **per-request** (`makeStore(preloadedState)` в `store/store.ts`, синглтон убран — иначе
    на сервере утёк бы чужой юзер); провайдер создаёт его через `useRef` и засевает
    `auth = { user, ready: true }`. Поэтому серверный HTML и первый клиентский рендер
    совпадают — без мигания «Войти → аккаунт» и без `/api/auth/me` на старте (раньше юзер
    тянулся в `useEffect`, отсюда вспышка). `layout.tsx` стал динамическим (читает cookie).
    Чат/настройки по-прежнему гидратируются из localStorage в `useEffect`. Auth-страницы
    дёргают реальное API; вход/выход обновляют стор экшенами.
- 🟢 **Админка + фичефлаги (Фазы 1–3)** — зона `/admin` на Mantine (без сторонних
  админ-фреймворков: Tailwind-шаблоны типа NextAdmin конфликтовали бы с Mantine-темой
  и брендом). Доступ, флаги, список пользователей и редактор тарифов готовы.
  - **Доступ по роли (серверный).** `User.role` (`user|admin`, миграция
    `add_admin_role_and_settings`). Гейт — `getAdminUser()` в `src/lib/admin.ts` (через
    `getSessionUser()`, роль из БД — без релогина, middleware/JWT не трогаем). Layout
    `app/admin/layout.tsx` не-админу делает `notFound()` (404, не светим существование);
    каждый `/api/admin/*` тоже отвечает 404. Бутстрап первого админа: `node
    scripts/make-admin.mjs <email>` или `ADMIN_BOOTSTRAP_EMAILS` (через запятую) в env
    (такой юзер — админ даже без role). `role` добавлен в `publicUser`/`AuthUser`; в меню
    профиля (`AppShell`) для админа есть пункт «Админка».
  - **Хранилище настроек.** Модель `AppSetting` (key→Json, без миграций под новые флаги).
    Доступ — `src/lib/settings.ts`: `getSettings()` (с дефолтами, серверно), `saveSettings()`
    (мердж + апсерт). Тип `AppSettings`: `{ briefPageEnabled, launch: { countdownEnabled,
    targetAt } }`. API `GET/PATCH /api/admin/settings` (валидирует вход).
  - **UI админки.** `components/Admin/AdminShell.tsx` (Mantine `AppShell`: сайдбар
    Флаги/Пользователи/Тарифы, шапка с бренд-знаком и «В приложение»).
    `app/admin/page.tsx` — экран «Флаги»: свитчи + `datetime-local` для даты запуска,
    «Сохранить» с фидбеком. Без новых зависимостей (нативный date-input, Mantine).
  - **Список пользователей (Фаза 2).** `GET /api/admin/users` (пагинация по 20 + поиск
    по имени/почте через `mode:"insensitive"`, бриф отдаётся сразу нормализованным).
    `app/admin/users/page.tsx` — Mantine `Table` (юзер, тариф, типаж, статус брифа, дата)
    + поиск (дебаунс 350мс) + `Pagination`; клик по строке → `Drawer` с деталями и полным
    брифом: карточка архетипа (картинка `public/images/disc`, форматы/заводит/убивает из
    `DISC_PROFILES`) + поля «о проекте» (заполненные) + опыт на камере + **история платежей**
    (пополнения: сумма/тариф/дата/статус, грузится из `GET /api/admin/payments?userId=`;
    «траты»/использование — позже, вместе с квотами). Без новых пакетов.
  - **Флаг брифа.** `/brief` — серверный гейт (`page.tsx` читает `briefPageEnabled`,
    выкл → `notFound()`), визард вынесен в клиентский `BriefStandaloneClient.tsx`.
  - **Pre-launch (таймер запуска).** Флаг `launch.countdownEnabled` + `targetAt`. Лендинг
    (`app/page.tsx`, серверный) при включении: прячет `<Pricing/>` и пункты «Тарифы» в
    навигации/футере (`hidePricing` в `LandingNav`/`FinalCta`), а в герое показывает
    анимированный отсчёт `components/Landing/LaunchCountdown.tsx` (тикает на клиенте, до
    маунта — прочерки без hydration mismatch; стили `.launch-countdown*` в globals.css).
  - **Тарифы в БД (Фаза 3).** Модель `Plan` (`schema.prisma`, миграция `add_plans`): id =
    PlanId (`start|blogger|studio`), `label`, `priceRub`, `period`, `features[]`, `limits`
    (Json: `requests/contentPlans/scenarios/shorts`, `-1`=без лимита — будущий источник
    правды для квот), `order`, `highlighted`, `active`. Доступ — `src/lib/plans.ts`
    (`getPlans`/`getActivePlans` с **ленивым idempotent-посевом** дефолтов при пустой
    таблице, `savePlan`, `formatPrice`). API: `GET/PATCH /api/admin/plans` (админ),
    публичный `GET /api/plans` (активные). Редактор — `app/admin/plans/page.tsx`
    (цена `NumberInput`, период, фичи-textarea, свитчи популярный/активен, числовые
    лимиты). **Витрины читают из БД:** лендинг `Pricing` — серверным пропом из
    `app/page.tsx` (`getActivePlans`), биллинг `SettingsModal` — через `GET /api/plans`.
    `PLAN_LABEL`/`PLAN_ORDER` в authSlice остались дефолтом-фолбэком (бейдж тарифа в шапке).
  - `/admin` добавлен в bare-ветку `AppShell` (свой layout, без чат-обвязки и гейта брифа).
- 🟡 **Оплата (эквайринг ТБанк, разовый платёж — MVP)** — оплата тарифа по схеме
  T-Bank/Tinkoff Acquiring. Сделан разовый платёж (доступ на 30 дней, продление —
  новый платёж); при первом платеже регистрируем `RebillId` (`Recurrent=Y`) — задел под
  автосписание. Осталось (фаза «автоплатёж»): cron + `Charge` по `RebillId`, обработка
  неудач/отмен. **Не протестировано вживую** (нужен тестовый терминал).
  - **Клиент ТБанк** — `src/lib/tbank.ts`: `Init`/`GetState`, подпись `buildToken`
    (корневые скаляры + `Password`, сортировка по ключу, SHA-256 — выверена по эталону
    из доков), `verifyNotificationToken` (проверка Token вебхука), типы чека `Receipt`.
    База `securepay.tinkoff.ru/v2` (env `TBANK_API_URL`).
  - **Домен** — `src/lib/billing.ts`: `createPayment` (строка `Payment(NEW)` → `Init` →
    `PaymentURL`), `handleNotification` (вебхук), `syncPayment` (GetState на возврате,
    идемпотентный `markPaid` ставит `User.plan` + `planExpiresAt`+30д + `rebillId`). Чек
    54-ФЗ (`Receipt`) собирается всегда: позиция = подписка, `Email` покупателя,
    `Taxation`/`Tax` — из env (`TBANK_TAXATION`/`TBANK_VAT`, опц. `TBANK_FFD_VERSION`).
  - **Модели БД** (`schema.prisma`, миграция `add_payments`): `Payment` (id=OrderId,
    planId, amount-копейки, status, tbankPaymentId, rebillId, paidAt) + `User.planExpiresAt`
    и `User.rebillId`. `planExpiresAt` в `publicUser`/`AuthUser` (показ срока в биллинге).
  - **API** `src/app/api/payments/*`: `POST create` (авторизован → ссылка на оплату),
    `POST webhook` (публичный, Token-проверка, ответ телом `OK`; невалидный Token → 403),
    `GET status?order=` (синк на возврате → статус + свежий юзер). Источник правды —
    вебхук **и** GetState-синк (последний даёт работать без публичного `NotificationURL`,
    напр. в dev/песочнице).
  - **UI** — биллинг в `SettingsModal`: «Перейти» → `apiCreatePayment` → редирект на
    `PaymentURL` (или ошибка в `Alert`, в т.ч. graceful «Оплата временно недоступна» без
    ключей); строка «Тариф активен до …». Возврат на `/chat?payment=success&order=…` —
    эффект в `chat/page.tsx` синкает платёж, обновляет тариф в сторе и чистит query.

### 🔴 Критично (без этого продавать нельзя)

1. 🟢 **Реальная авторизация** — сделано (см. «Уже есть» → «Авторизация (реальный
   бэкенд)»): модель `User` + bcrypt-хэш; свой JWT в httpOnly-cookie; роуты
   register/login/logout/me/verify-email/reset-password/forgot-password; письма через
   Unisender. Осталось от владельца: завести `UNISENDER_API_KEY` + `UNISENDER_LIST_ID` +
   подтверждённый sender_email (`EMAIL_FROM`) для боевой отправки писем; на проде задать
   стойкий `JWT_SECRET`.
2. 🟡 **Платежи и подписки** — эквайринг **ТБанк** (разовый платёж + чек 54-ФЗ) сделан,
   см. «Уже есть» → «Оплата (эквайринг ТБанк)». Осталось: тестовый прогон с реальным
   терминалом; автоплатёж (cron + `Charge` по `RebillId`); отмена/возвраты. Онлайн-касса
   54-ФЗ — на стороне терминала ТБанк (шлём `Receipt`).
3. **Квоты / лимиты использования** — счётчик сообщений/токенов на юзера по тарифу
   (числовые лимиты уже лежат в `Plan.limits` — источник правды);
   rate limiting на `/api/chat`. Защита от слива баланса Anthropic.

### 🔴 Юридическое
- Публичная оферта (договор)
- Политика конфиденциальности (152-ФЗ — обязательно)
- Согласие на обработку персональных данных (галочка при регистрации)
- Пользовательское соглашение
- Cookie-уведомление
- Реквизиты (ИП / самозанятый / ООО) в подвале

### 🔴 Важно, но можно после запуска
- **Личный кабинет** — профиль, текущий тариф, история платежей, отмена подписки
- 🟢 **Админка** — доступ по роли, фичефлаги, список зареганных + бриф и редактор тарифов
  (цены/лимиты в БД) готовы (Фазы 1–3, см. «Уже есть» → «Админка + фичефлаги»). Дальше —
  по мере надобности: метрики, ручное управление подписками (после эквайринга).
- **История чатов на юзера** — сейчас `ChatMessage.sessionId` без привязки к `User`
- **Аналитика** — Яндекс.Метрика / Plausible
- **Онбординг** — welcome-флоу для новых юзеров

---

## Стек (кратко)
- Next.js 14 App Router + TypeScript
- LLM-провайдеры (стратегии, `src/lib/llm/*`): **Claude** (Anthropic SDK, `claude-opus-4-8`,
  prompt caching + adaptive thinking/effort) и **GLM** (Z.ai / Zhipu, OpenAI-совместимый
  стрим). Переключаются из чата (`provider` в теле `/api/chat`). Роутер знаний — отдельно
  на `claude-haiku-4-5`.
- PostgreSQL + Prisma ORM
- Redux Toolkit + Mantine UI v7
- Docker Compose

## Переключатель модели (Claude / GLM)
- 🟢 **Стратегии провайдера** — `src/lib/llm/`: `types.ts` (интерфейс `LlmStrategy` +
  тип `LlmProvider`), `claude.ts` (Anthropic SDK: модель/effort/кэш/лог стоимости),
  `glm.ts` (fetch на OpenAI-совместимый `/chat/completions`, парсинг SSE, склейка
  system-блоков Anthropic в один system-месседж), `index.ts` (`getStrategy` /
  `normalizeProvider`). Обе стратегии отдают текстовые дельты — `route.ts` оборачивает их
  в SSE одинаково. `route.ts` больше не знает про конкретного провайдера: собирает system,
  роутит знания, выбирает стратегию по `body.provider` (дефолт claude).
- 🟢 **Стоимость в логах** — каждая стратегия логирует свою строку `[chat] provider=…`.
  Claude — по тарифам Opus (вход/выход/кэш). GLM — по `usage` из последнего чанка стрима
  (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`): кэш у GLM
  **автоматический** (implicit, `cache_control`/ttl не нужны и игнорируются), попадания
  считаем по льготному тарифу. Тарифы GLM — константы в `glm.ts` (как тарифы Opus в
  `claude.ts`); под GLM-5.2 (вход $1.4 / выход $4.4 / кэш $0.26 за 1M).
- 🟢 **UI-переключатель** — `SegmentedControl` (Claude / GLM) в шапке чата рядом с
  заголовком/удалением (`src/app/chat/page.tsx`). Выбор в `settings.provider`
  (`store/settingsSlice.ts`, экшен `setProvider`), персистится в localStorage вместе с
  остальными настройками, едет в `/api/chat` из `ChatInput`.

## Переменные окружения
`ANTHROPIC_API_KEY`, `POSTGRES_URL`, `NEXT_PUBLIC_APP_URL`.
Админка: `ADMIN_BOOTSTRAP_EMAILS` (опц., через запятую) — эти почты считаются админами
без `role` в БД, для разового бутстрапа; альтернатива — `node scripts/make-admin.mjs <email>`.
Оплата (ТБанк): `TBANK_TERMINAL_KEY`, `TBANK_PASSWORD` (секрет терминала) — обязательны для
оплаты; без них кнопка отдаёт «Оплата временно недоступна». `TBANK_API_URL` (дефолт
`https://securepay.tinkoff.ru/v2`), `TBANK_TAXATION` (дефолт `usn_income`), `TBANK_VAT`
(дефолт `none`), `TBANK_FFD_VERSION` (опц.) — для чека 54-ФЗ. `NEXT_PUBLIC_APP_URL` нужен
для `NotificationURL`/`SuccessURL`/`FailURL` (в ТБанк-кабинете укажи тот же домен).
GLM: `GLM_API_KEY` (обязателен для движка GLM), `GLM_MODEL` (дефолт `glm-5.2`),
`GLM_BASE_URL` (дефолт `https://api.z.ai/api/paas/v4`; для bigmodel.cn —
`https://open.bigmodel.cn/api/paas/v4`). Без `GLM_API_KEY` выбор GLM отдаёт ошибку,
Claude работает как раньше. Тарифы GLM захардкожены в `glm.ts` (как у Opus в `claude.ts`).
