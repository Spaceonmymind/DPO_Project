# Развёртывание «ДПО Ассистент»

## Требования

Linux-сервер с Docker Engine 24+ и Docker Compose v2, 2 CPU, 4 ГБ RAM, 20 ГБ свободного места, DNS-имя и TLS-сертификат. PostgreSQL и backend наружу не публикуются; единственная точка входа — frontend/reverse proxy.

## Установка и первый запуск

1. Установите Docker по инструкции для дистрибутива и добавьте администратора в группу `docker`.
2. Клонируйте репозиторий и перейдите в него.
3. Выполните `cp .env.example .env`, задайте уникальные `POSTGRES_PASSWORD` и `APP_SECRET_KEY` (не менее 32 случайных символов) и адрес в `APP_BASE_URL`. Для первого запуска по обычному HTTP оставьте `SESSION_COOKIE_SECURE=false`; включайте `true` только после подключения HTTPS. Оставьте `APP_ENV=staging`, `LLM_PROVIDER=mock`, `SEED_DEMO_USERS=true` для автоматического создания двух стартовых аккаунтов.
4. Проверьте конфигурацию: `docker compose config --quiet`.
5. Запустите: `docker compose up --build -d`.
6. Миграции Alembic выполняются backend-контейнером до старта ASGI. Проверка: `docker compose exec backend alembic current`.
7. При первом запуске автоматически создаются `Ivanov / Ivanov` и `Petrova / Petrova`. Если пользователи уже существуют, seed их не изменяет.

Перед backend автоматически выполняется одноразовый сервис `storage-init`: он создаёт `uploads`, `templates`, `generated` и выдаёт непривилегированному backend права на запись в эти каталоги. Существующие документы и их содержимое при этом не изменяются.

Приложение доступно на порту `APP_PORT` (по умолчанию 5173). `/health` возвращает только состояние backend. Проверки: `docker compose ps`, `curl -fsS http://127.0.0.1:5173/health`.

## Пользователи

```bash
docker compose exec backend python -m app.cli.create_user \
  --username ivanov --full-name "Иванов Иван Иванович" \
  --email ivanov@example.internal --department "ДПО"
```

Пароль запрашивается интерактивно и не попадает в историю shell.

## Домен и HTTPS

Контейнер frontend уже обслуживает production-сборку и проксирует `/api/` во внутренний backend. Настройте внешний Nginx/LB на проксирование всего домена к `127.0.0.1:$APP_PORT`. Шаблон — `deploy/reverse-proxy.conf.example`. Замените домен и пути сертификатов; сертификат и приватный ключ не храните в Git. После включения HTTPS установите `APP_BASE_URL=https://реальный-домен` и `SESSION_COOKIE_SECURE=true`, затем пересоздайте контейнеры.

Если TLS завершается инфраструктурным балансировщиком, публикуйте `APP_PORT` только на доверенном интерфейсе/firewall. Backend намеренно не принимает клиентские `X-Forwarded-*` заголовки.

## Обновление и остановка

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
docker compose ps
```

Данные не удаляются при пересборке. Для остановки: `docker compose down`. Никогда не используйте `docker compose down -v` на рабочем окружении.

## Логи и диагностика

```bash
docker compose logs --tail=200 frontend
docker compose logs --tail=200 backend
docker compose logs --tail=200 db
```

Docker ограничивает каждый лог-файл 10 МБ и хранит пять файлов. Приложение не должно логировать пароли, cookies, ключи LLM или содержимое документов.

## Резервное копирование

Создавайте резервные копии в закрытом каталоге вне репозитория:

```bash
mkdir -p /srv/backups/dpo
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > /srv/backups/dpo/dpo-$(date +%F-%H%M).dump
tar -C ./storage -czf /srv/backups/dpo/documents-$(date +%F-%H%M).tar.gz uploads generated templates
```

Периодически проверяйте архивы на отдельном тестовом окружении. Docker volume не является резервной копией.

## Восстановление

Восстанавливайте только в остановленное отдельное тестовое окружение. Создайте чистую БД, затем:

```bash
cat /srv/backups/dpo/dpo-YYYY-MM-DD-HHMM.dump | docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists
tar -C ./storage -xzf /srv/backups/dpo/documents-YYYY-MM-DD-HHMM.tar.gz
docker compose up -d
```

Не выполняйте восстановление поверх рабочей БД во время тестирования.
