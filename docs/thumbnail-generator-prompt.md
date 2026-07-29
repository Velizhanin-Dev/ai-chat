# Генератор превью — модель и промпты (черновик под тесты)

Источник правил: методичка арт-дирекшена студии из `knowledge-base-tg-closed.ts`
(«Дизайн превью», «Три кита превью», «Баннерная слепота», «Стратегии превью под ЦА»,
«Идеальное ТЗ на превью»), раздел «Превью и обложки» + «Превью: конкретика с разборов»
в `knowledge-base-youtube.ts`, антипаттерны №3/№4/№13.

---

## 1. Модель

| Задача | Модель (OpenRouter id) | Почему |
|---|---|---|
| **Основная** | `google/gemini-3-pro-image` (Nano Banana Pro) | до 5 субъектов с сохранением личности, 2K/4K, лучший рендер **кириллицы** — критично, текст на превью русский |
| Дешёвые черновики / батч вариантов | `google/gemini-3.1-flash-image` (Nano Banana 2) | ~в 4 раза дешевле, годится прогнать 5–10 композиций и выбрать |
| Не брать | `google/gemini-2.5-flash-image` (первая «нано банана») | слабый кириллический текст, ломается на 3+ референсах |

Цены (OpenRouter, июль 2026): Pro — $2/M вход, $12/M выход; Nano Banana 2 — $0.50/M и $3/M.
Считается **картинка в выходных токенах**, ориентир ≈ **$0.13–0.15 за 2K-картинку** у Pro
и ≈ $0.03 у Nano Banana 2 (перепроверить по факту на своих запросах — зависит от разрешения).

Запрос: `modalities: ["image","text"]`, референсы — `image_url` (base64 data-URI или https),
**порядок картинок важен** — в промпте на них ссылаемся как Image 1 / Image 2 / Image 3.
Соотношение сторон надёжнее дублировать текстом в промпте (`16:9`), а не только в `image_config`.

**Важная оговорка из базы:** «ИИ-превью пока слишком ИИшные — люди это замечают и отпугиваются».
Поэтому целевой режим — **не «сгенерируй превью с нуля», а композит**: реальное фото спикера
(Image 1) + реальный объект + сгенерированный фон/доп-элемент. В промпте это зашито блоком
IDENTITY LOCK и ANTI-AI.

---

## 2. Промпт генерации (английский, слоты в `{{ }}`)

```text
# ROLE
You are an art director producing a YouTube thumbnail for a Russian-language channel.
Output: ONE image, 16:9, 2048x1152, no borders, no frames, no UI, no watermark.
The ONLY success metric is click-through rate (CTR), not beauty. A "designer-pretty"
thumbnail that reads slowly is a failure. It must be fully readable at 320x180 px.

# INPUT IMAGES
Image 1 = the speaker (host). Identity reference.
Image 2..N = objects / props / locations to place in the frame. {{REFERENCE_LEGEND}}

# IDENTITY LOCK — highest priority, overrides all style instructions
Reproduce the person from Image 1 with EXACT facial identity: same face geometry, eye
shape and spacing, nose, mouth, jawline, hairline, hairstyle, facial hair, skin tone,
skin texture, visible age, body type and weight.
Do NOT beautify, slim, de-age, smooth skin, symmetrize the face, change ethnicity,
change eye colour, or replace the face with a generic model. Keep real pores and real
skin. A stranger who knows this person must recognise them instantly.
You MAY change: facial expression, head angle, pose, hands, clothing, lighting,
background, and camera distance.
If several photos of the same person are supplied, treat them as one identity.

# OBJECT LOCK
Objects from Image 2..N keep their exact silhouette, proportions, colour, material,
branding and logo. Do not restyle, "improve", or replace them with a generic version.
Relight them to match the scene; do not redesign them.

# ONE IDEA
The thumbnail carries exactly ONE message: {{ONE_IDEA}}
Every element must serve it. If an element does not add clickability, remove it.
Hand test: cover any single element — the topic must still be understandable.

# COMPOSITION
- Foreground: the speaker + the text. Both large, high contrast, surrounded by empty
  space (air). The speaker occupies {{SPEAKER_SCALE|~45-55% of frame height}}, face
  clearly readable at thumbnail size. A small speaker = low trust = failure.
- Midground: exactly ONE supporting object that explains the topic ({{SUPPORT_OBJECT}}).
  Never more than 2 objects. NEVER add extra people as supporting elements — max
  {{PEOPLE_COUNT|1}} human(s) in the whole frame (hard max 2, and if 2, face-to-face,
  never a crowd/poster layout).
- Background: context only — darker, desaturated, blurred, low contrast. It must not
  compete for attention.
- Text, speaker and object must be on THREE different visual scales. If they are the
  same size, the eye wanders and the thumbnail dies from banner blindness.
- Depth: linear perspective (near = large, far = small) + aerial perspective (far plane
  loses contrast). {{SCALE_BREAK|Optional: deliberately break scale for dissonance.}}
- Reading direction is left→right: growth/positive goes up to the right, "before/after"
  and "good/bad" split left/right.
- Balance: no huge mass in one corner with emptiness in the other.

# EMOTION
Speaker emotion must match the topic: {{EMOTION}}.
Never a neutral passport face. {{EXAGGERATION|Exaggerated open-mouth emotion is allowed}}
— but for strict B2B/premium topics use a composed, serious, high-status expression
instead, since theatrical emotion lowers perceived status.
Wardrobe/pose archetype: {{ARCHETYPE|e.g. Sage: dark layered clothing, glasses, composed pose}}.

# TEXT ON THE THUMBNAIL — render exactly
Render this Cyrillic text, character for character, with no additions, no translation,
no transliteration, no invented words, no extra captions anywhere in the image:

  «{{THUMB_TEXT}}»

Key word rendered in CAPS: «{{KEY_WORD}}» — it gets the largest size + a colour plate
or thick outline. The rest is smaller and unhighlighted.
Rules: max 5 words total. ONE typeface only ({{FONT|heavy geometric sans-serif / grotesque}}),
max 2 colours. Very high contrast against whatever is behind it. Alignment
{{TEXT_ALIGN|centered}}. Thick strokes; a crude heavy outline is acceptable and preferred
over elegant thin type. Numbers, if present, are rendered LARGE — the bigger the digit,
the better. Letters must not touch or overlap the speaker's face.
If perfect Cyrillic rendering is not achievable, prioritise legibility of these exact
characters over any decorative effect. No other text, no subtitles, no logos except
{{ALLOWED_LOGOS|none}}.

# COLOUR
Palette: {{PALETTE}}. Rationale (do not deviate): {{PALETTE_RATIONALE}}.
Green = good / cheap / before, red = bad / expensive / after — use only this pairing for
comparisons, never yellow-vs-purple. Keep the background darker so the foreground pops.

# AUDIENCE STYLE — obey literally, congruence beats taste
{{AUDIENCE_STYLE}}
(presets:
 · mass / econom / DIY: deliberately crude, "ugly" thumbnail — plain photo, arrow, circle,
   fat outlined text, no gradients, no polish. Polish LOWERS CTR here.
 · strict B2B / finance: dry, desaturated, grey base, red only as an accent, composed
   expression, no theatrics.
 · older audience: huge grotesque text, no gradients, no shadows, high legibility,
   professional wardrobe.
 · female / beauty / wellness: light soft background, restrained poses, pink as accent
   only — not neon-on-black.
 · young / kids: maximum saturation, big props, theatrical open-mouth emotion.)

# DO NOT
- Do not reveal the answer/payoff of the video. Keep one element hidden, blurred, or
  marked with "?" if it would spoil the intrigue.
- No crowd of people, no "movie poster" layout, no extra faces.
- No glossy AI look: no plastic skin, no symmetrical CGI face, no lens flares, no
  neon rim-light everywhere, no floating particles, no fake bokeh confetti.
- No gibberish or mangled letters anywhere. No Latin text unless it is inside
  {{ALLOWED_LOGOS|none}}.
- No YouTube UI, play button, duration badge, progress bar, frame or border.
- No thin, small, or low-contrast type. No decorative script fonts.
- No tautology with the video title — the thumbnail carries emotion, the title carries
  the rational/SEO part. Thumbnail text here: «{{THUMB_TEXT}}», video title (for
  awareness only, do NOT draw it): «{{VIDEO_TITLE}}».

# CONTEXT
Niche: {{NICHE}}. Audience: {{AUDIENCE}}. Video is about: {{VIDEO_SUMMARY}}.
Channel style to stay consistent with: {{CHANNEL_STYLE|n/a}}.
Reference score (studio system): {{REF_SCORE|1}} — 1 = ignore the reference,
3 = copy only the named element ({{REF_ELEMENT}}), 5 = copy the reference composition
one-to-one, replacing the speaker and restyling to this channel's palette.
```

### Как заполнять (пример — стройка, масс-сегмент)

```
ONE_IDEA        = the contractor is cheating you on the concrete delivery
THUMB_TEXT      = НЕДОВОЗ БЕТОНА
KEY_WORD        = НЕДОВОЗ
SUPPORT_OBJECT  = concrete mixer truck chute with a red circle and arrow drawn on it
EMOTION         = angry/alarmed, mouth open, pointing at the chute
PALETTE         = red + black + white, warning-tape yellow accent
AUDIENCE_STYLE  = mass / econom preset
PEOPLE_COUNT    = 1
REF_SCORE       = 1
```

---

## 3. Промпт арт-директора (шаг A — текстовая модель заполняет слоты)

Ставится перед генерацией: обычная LLM (наш чат уже знает методику) получает тему ролика,
нишу, ЦА, DISC-архетип спикера и отдаёт JSON, который подставляется в шаблон выше.

```text
You are the art director of Velizhanin's YouTube studio. Given a video brief, produce the
spec for ONE thumbnail. You optimise CTR, never beauty. Answer with JSON only.

Rules you must apply:
- Thumbnail text: 3-5 words max, one key word that survives the "remove-a-word" test gets
  CAPS + a colour plate. Kill weak words: правильный, актуальный, как, это, причины,
  безопасное, качественный, информация, точный.
- The thumbnail text must NOT duplicate the meaning of the video title (no tautology).
  Title = rational + SEO, thumbnail = emotion (причастность / интрига).
- Text must pass the "и чё?" test: if a viewer can answer "и чё?" — rewrite it.
- One thumbnail = one idea. Max 1 supporting object. Never people as supporting elements.
- Do not spoil the payoff.
- Pick the palette from the niche/audience colour psychology, not from taste; state why.
- Pick the speaker's emotion and wardrobe from the topic and the speaker's archetype.
- Choose an audience preset (mass/econom, strict B2B, older, female, young).

JSON schema:
{ "one_idea": "", "thumb_text": "", "key_word": "", "support_object": "",
  "emotion": "", "archetype": "", "palette": "", "palette_rationale": "",
  "audience_style": "", "people_count": 1, "text_align": "centered",
  "speaker_scale": "", "video_title": "", "why_it_clicks": "" }

Video brief: {{...}}
```

---

## 4. Как тестировать

1. Генерить сразу **3 максимально разных** варианта (методика студии: 3 разных превью,
   «загрузи и забудь», а не бесконечная ручная переделка одного).
2. Прогонять каждый по чек-листу: **правило одной руки** → **«и чё?»** → **«закрой и пойми»**
   (закрыл название — понятно ли по превью; закрыл превью — понятно ли по названию) →
   тавтология с названием → читается ли текст на 320×180.
3. Ловить типовые сбои модели: мелкий спикер, три объекта вместо одного, текст в 6+ слов,
   пластиковая ИИ-кожа, латиница вместо кириллицы, лишние люди в кадре.
