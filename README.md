# ДПО Ассистент

Корпоративное веб-приложение для подготовки технических заданий и подбора договорных шаблонов. Frontend — React/Vite, backend — FastAPI, база — PostgreSQL, AI runtime поддерживает Mock и OpenAI-compatible providers.

## Локальный production-like запуск

```bash
cp .env.example .env
# Задайте POSTGRES_PASSWORD и APP_SECRET_KEY; для HTTP установите SESSION_COOKIE_SECURE=false
docker compose up --build -d
```

Интерфейс доступен по адресу `http://localhost:5173`. API обслуживается на том же origin по `/api/`; backend и PostgreSQL наружу не публикуются. Миграции Alembic выполняются перед запуском backend. Автоматическое создание аккаунтов в staging отключено.

Создание пользователя:

```bash
docker compose exec backend python -m app.cli.create_user \
  --username ivanov --full-name "Иванов Иван Иванович" \
  --email ivanov@example.internal --department "ДПО"
```

Пароль запрашивается интерактивно. Подробные инструкции:

- `docs/DEPLOYMENT.md` — развёртывание, HTTPS, обновление и резервное копирование;
- `docs/ADMIN_GUIDE.md` — управление пользователями и эксплуатация;
- `docs/TESTING_GUIDE.md` — инструкция участника тестирования;
- `docs/LLM_CONFIGURATION.md` — конфигурация AI runtime.

## Проверка

```bash
docker compose ps
curl -fsS http://localhost:5173/health
docker compose run --rm --no-deps \
  -v "$PWD/backend/app:/app/app:ro" \
  -v "$PWD/backend/tests:/app/tests:ro" backend pytest -q
```

Для остановки используйте `docker compose down`. Не применяйте `down -v` к окружению с данными.
