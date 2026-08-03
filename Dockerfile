FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
# patches/ нужны ДО установки: postinstall запускает patch-package, который без
# папки patches тихо ничего не пропатчит (напр. фикс lookbehind в
# mdast-util-gfm-autolink-literal для Safari < 16.4).
COPY patches ./patches
RUN npm ci || npm install

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* инлайнятся на этапе `next build`, поэтому переменную надо протащить
# в build-стадию как ARG (из build.args в docker-compose), а не только в рантайм.
ARG NEXT_PUBLIC_YM_ID
ENV NEXT_PUBLIC_YM_ID=$NEXT_PUBLIC_YM_ID
RUN npx prisma generate
RUN npm run build

# Stage for running migrations (has full node_modules)
FROM base AS migrator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

# Minimal production runtime
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# Утилитные скрипты (напр. scripts/make-admin.mjs) — чтобы их можно было гонять
# на проде через `docker compose exec app node scripts/make-admin.mjs <email>`.
COPY --from=builder /app/scripts ./scripts
# Российский корневой CA (Минцифры). ТБанк (securepay.tinkoff.ru) отдаёт TLS-цепочку
# под корнем «Russian Trusted Root CA», которого нет в стандартном CA-бандле Node →
# без него fetch на эквайринг падает с SELF_SIGNED_CERT_IN_CHAIN. Кладём бандл в образ
# и указываем на него Node через NODE_EXTRA_CA_CERTS (только доп. доверие, штатные CA
# сохраняются — Anthropic/Google/остальной аутбаунд не затрагивается).
COPY deploy/certs/russian-trusted-ca.pem /app/certs/russian-trusted-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian-trusted-ca.pem
# Папка загрузок (референсы + сгенерированные превью). В проде поверх неё
# монтируется volume ./data/uploads — тогда владельцем становится хостовая папка
# (на хосте нужен chown 1001:1001). Без volume (локальный запуск) пишем сюда.
RUN mkdir -p /app/data/uploads && chown -R 1001:1001 /app/data

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
