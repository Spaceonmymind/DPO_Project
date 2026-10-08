# Руководство администратора

Все команды выполняются из каталога проекта. Пароли вводятся скрыто и должны быть уникальными (минимум 12 символов).

## Управление пользователями

Создание:

```bash
docker compose exec backend python -m app.cli.create_user --username sidorov --full-name "Сидоров Пётр Иванович" --email sidorov@example.internal --department "ДПО"
```

Отключение (также завершает все сессии):

```bash
docker compose exec backend python -m app.cli.disable_user --username sidorov
```

Сброс пароля (также завершает все сессии):

```bash
docker compose exec backend python -m app.cli.reset_password --username sidorov
```

Изменение ФИО и повторное включение:

```bash
docker compose exec backend python -m app.cli.update_user --username sidorov --full-name "Сидоров Пётр Петрович" --enable
```

Публичной регистрации нет. При `SEED_DEMO_USERS=true` первый запуск создаёт `Ivanov / Ivanov` и `Petrova / Petrova`. Seed идемпотентен и не меняет существующие аккаунты. После первичного тестирования смените пароли командой `reset_password` или установите `SEED_DEMO_USERS=false` для окружений, где стартовые аккаунты не нужны.

## Эксплуатация

- Состояние: `docker compose ps` и `curl -fsS http://127.0.0.1:5173/health`.
- Логи: `docker compose logs --tail=200 -f backend` (аналогично `frontend`, `db`).
- Миграции: `docker compose exec backend alembic current`.
- Обновление: `git pull --ff-only && docker compose build --pull && docker compose up -d`.
- Остановка: `docker compose down` без `-v`.

Резервное копирование и восстановление описаны в `docs/DEPLOYMENT.md`. Храните дампы и архивы документов за пределами репозитория с ограниченными правами доступа.
