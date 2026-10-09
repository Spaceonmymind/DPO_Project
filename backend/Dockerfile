FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app
WORKDIR /app
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --home /app --no-create-home app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=app:app . .
RUN mkdir -p /app/storage/uploads /app/storage/templates /app/storage/generated && chown -R app:app /app
USER app
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-proxy-headers"]
