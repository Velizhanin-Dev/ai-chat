# Creative Chat RAG

RAG-система (Retrieval-Augmented Generation) на основе Next.js 14, позволяющая загружать документы и задавать по ним вопросы с помощью GPT-4o.

## Стек технологий

- **Next.js 14** (App Router) — фреймворк
- **Redux Toolkit** — управление состоянием
- **Mantine UI v7** — компоненты интерфейса
- **PostgreSQL + Prisma ORM** — реляционная база данных
- **Pinecone** — векторная база данных
- **OpenAI API** — эмбеддинги (text-embedding-3-small) и генерация (gpt-4o)
- **Docker Compose** — контейнеризация

## Как это работает

### Загрузка документов (`/ingest`)
1. Текст или файл (.txt, .pdf) загружается через веб-интерфейс
2. Текст разбивается на чанки по 1000 символов с перекрытием 200
3. Каждый чанк превращается в эмбеддинг через OpenAI
4. Эмбеддинги сохраняются в Pinecone, метаданные — в PostgreSQL

### Чат с документами (`/chat`)
1. Пользователь задаёт вопрос
2. Используется HyDE: GPT генерирует гипотетический ответ
3. По гипотетическому ответу ищутся топ-5 релевантных чанков в Pinecone
4. Чанки + вопрос отправляются в GPT-4o со стримингом
5. История чата сохраняется в PostgreSQL

## Быстрый старт

### Предварительные требования
- Node.js 20+
- PostgreSQL 16 (или Docker)
- Аккаунт Pinecone с созданным индексом (dimension: 1536, metric: cosine)
- API-ключ OpenAI

### Установка

```bash
# Клонировать и перейти в директорию
cd creative-chat

# Установить зависимости
npm install

# Скопировать и заполнить переменные окружения
cp .env.example .env
# Отредактируйте .env — заполните OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX

# Сгенерировать Prisma Client
npx prisma generate

# Применить миграции
npx prisma migrate dev

# Запустить в режиме разработки
npm run dev
```

Приложение будет доступно на http://localhost:3000

### Запуск через Docker Compose

```bash
# Заполните .env файл
cp .env.example .env

# Запуск
docker-compose up --build
```

Docker Compose поднимет PostgreSQL и Next.js приложение. Миграции применяются автоматически при старте.

## Переменные окружения

| Переменная | Описание |
|---|---|
| `OPENAI_API_KEY` | API-ключ OpenAI |
| `PINECONE_API_KEY` | API-ключ Pinecone |
| `PINECONE_INDEX` | Название индекса в Pinecone (dim: 1536, cosine) |
| `POSTGRES_URL` | Connection string для PostgreSQL |
| `NEXT_PUBLIC_APP_URL` | URL приложения |

## Структура проекта

```
prisma/
  schema.prisma              — модели Document, Chunk, ChatMessage
src/
  app/
    api/
      chat/route.ts          — API чата с RAG и стримингом
      ingest/route.ts        — API загрузки и индексации документов
    chat/page.tsx             — страница чата
    ingest/page.tsx           — страница загрузки
    layout.tsx                — корневой layout с Mantine + Redux
  components/
    Chat/ChatWindow.tsx       — окно сообщений
    Chat/ChatInput.tsx        — ввод вопроса
    Ingest/IngestForm.tsx     — форма загрузки
    Ingest/DocumentList.tsx   — список загруженных документов
    Shell/AppShell.tsx        — навигация
  store/
    chatSlice.ts              — состояние чата
    ingestSlice.ts            — состояние загрузки
    store.ts                  — конфигурация Redux
  lib/
    openai.ts                 — клиент OpenAI
    pinecone.ts               — клиент Pinecone
    prisma.ts                 — singleton Prisma
    chunker.ts                — нарезка текста
    rag.ts                    — HyDE + поиск + генерация
```

## Полезные команды

```bash
# Prisma Studio (визуальный редактор БД)
npx prisma studio

# Создать новую миграцию
npx prisma migrate dev --name <название>

# Применить миграции (продакшен)
npx prisma migrate deploy

# Сборка для продакшена
npm run build && npm start
```
