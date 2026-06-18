# Деплой VELIZHANIN AI на сервер

Гайд под **Ubuntu 22.04 / 24.04** (для другой ОС поменяй пакетный менеджер).
Схема: `docker compose` поднимает приложение (Next.js standalone) + Postgres,
а **nginx на хосте** работает reverse-proxy'ем и терминирует HTTPS.

```
Интернет ──HTTPS──▶ nginx (хост, :80/:443) ──HTTP──▶ app (127.0.0.1:3000, docker)
                                                        └▶ postgres (docker, внутр. сеть)
```

> Везде ниже замени `velizhanin.com` на свой домен и подставь свои секреты.

---

## 0. Перед стартом

- VPS с публичным IP (мин. 2 ГБ RAM — сборка Next.js прожорлива; если 1 ГБ,
  обязательно сделай swap, см. §1).
- Доменные A-записи `velizhanin.com` и `www.velizhanin.com` → IP сервера
  (проверь: `dig +short velizhanin.com`).
- Доступ по SSH под пользователем с `sudo`.

---

## 1. Базовая настройка сервера

```bash
# Обновления
sudo apt update && sudo apt upgrade -y

# Таймзона (по желанию)
sudo timedatectl set-timezone Europe/Moscow

# Swap 2 ГБ — спасает сборку на маленьком VPS (пропусти, если RAM ≥4 ГБ)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Firewall: только SSH + HTTP + HTTPS
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## 2. Установка Docker + Docker Compose

```bash
# Официальный скрипт (ставит docker-ce + compose-plugin)
curl -fsSL https://get.docker.com | sudo sh

# Запускать docker без sudo (перелогинься после этой команды)
sudo usermod -aG docker $USER

# Автозапуск
sudo systemctl enable --now docker

# Проверка
docker --version && docker compose version
```

---

## 3. Установка nginx + certbot (для HTTPS)

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx

# certbot через snap (рекомендованный способ)
sudo snap install core && sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
```

---

## 4. Деплой приложения

```bash
# Код (замени URL на свой репозиторий)
sudo mkdir -p /opt/velizhanin && sudo chown $USER:$USER /opt/velizhanin
git clone https://github.com/Velizhanin-Dev/ai-chat.git /opt/velizhanin
cd /opt/velizhanin

# .env из примера
cp .env.example .env
```

Сгенерируй секреты и впиши их в `.env`:

```bash
# Стойкий JWT-секрет
openssl rand -hex 32          # → вставь в JWT_SECRET

# Пароль БД
openssl rand -hex 16          # → вставь в POSTGRES_PASSWORD и в POSTGRES_URL
```

Итоговый прод-`.env` (пример):

```ini
ANTHROPIC_API_KEY=sk-ant-...

# Хост БД = имя сервиса из compose (postgres), а не localhost!
POSTGRES_URL=postgresql://postgres:ВАШ_ПАРОЛЬ@postgres:5432/creative_chat
POSTGRES_PASSWORD=ВАШ_ПАРОЛЬ
# POSTGRES_USER / POSTGRES_DB можно не задавать — дефолты postgres / creative_chat

# Боевой URL (для ссылок в письмах и абсолютных адресов) — обязательно https
NEXT_PUBLIC_APP_URL=https://velizhanin.com

JWT_SECRET=СГЕНЕРИРОВАННЫЙ_HEX_32

# Письма (Unisender); без ключей письма не уходят — ссылки пишутся в лог
UNISENDER_API_KEY=...
UNISENDER_LIST_ID=...
EMAIL_FROM="Велижанин AI <noreply@velizhanin.com>"
```

> Важно: `POSTGRES_URL` указывает на хост **`postgres`** (имя docker-сервиса),
> а не `localhost`. И `NEXT_PUBLIC_APP_URL` должен быть **https** — сессионная
> cookie помечается `Secure`, по http она просто не сохранится и логин «не залогинит».

Сборка и запуск (миграции прогонятся автоматически сервисом `migrate`):

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app   # Ctrl+C для выхода
```

Локальная проверка, что приложение отвечает:

```bash
curl -I http://127.0.0.1:3000      # должен прийти HTTP-ответ от Next.js
```

---

## 5. nginx reverse proxy + SSL

```bash
# Конфиг из репозитория (в нём — проксирование и SSE для /api/chat)
sudo cp /opt/velizhanin/deploy/nginx/velizhanin.conf /etc/nginx/sites-available/velizhanin.conf
sudo ln -s /etc/nginx/sites-available/velizhanin.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default      # убрать дефолтный сайт

# Проверить и применить
sudo nginx -t && sudo systemctl reload nginx

# Выпустить сертификат — certbot сам допишет 443-блок и редирект 80→443
sudo certbot --nginx -d velizhanin.com -d www.velizhanin.com

# Автопродление уже настроено snap'ом; проверка:
sudo certbot renew --dry-run
```

После этого открой `https://velizhanin.com` — должно работать, включая
стриминг ответа в чате.

---

## 6. Обновление (выкатка новой версии)

```bash
cd /opt/velizhanin
git pull
docker compose -f docker-compose.prod.yml up -d --build
# миграции применяются автоматически сервисом migrate перед стартом app
```

---

## 7. Шпаргалка по эксплуатации

```bash
# Логи приложения / БД
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f postgres

# Рестарт только приложения
docker compose -f docker-compose.prod.yml restart app

# Остановить всё / поднять
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# Бэкап базы
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U postgres creative_chat | gzip > backup_$(date +%F).sql.gz

# Восстановление из бэкапа
gunzip -c backup_2026-06-18.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres creative_chat

# Логи nginx
sudo tail -f /var/log/nginx/error.log
```

---

## Частые грабли

- **Стрим в чате не идёт / «печатает…» и резкий вывод в конце** — забыли
  `proxy_buffering off` для `/api/chat` (в конфиге он есть; проверь, что
  certbot не выкинул location при апгрейде на 443).
- **Логин не логинит** — сайт открыт по `http`, а не `https`: `Secure`-cookie
  не сохраняется. Нужен валидный сертификат и `NEXT_PUBLIC_APP_URL=https://...`.
- **app не стартует, ошибка подключения к БД** — в `POSTGRES_URL` стоит
  `localhost` вместо `postgres` (имя docker-сервиса).
- **Сборка падает с OOM** на маленьком VPS — добавь swap (§1).
- **502 Bad Gateway** — контейнер app ещё поднимается/упал: смотри
  `docker compose -f docker-compose.prod.yml logs app`.
