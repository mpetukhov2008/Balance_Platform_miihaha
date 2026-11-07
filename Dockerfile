FROM python:3.12-slim

# Устанавливаем системные зависимости (если нужны для psycopg2 или других библиотек)
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем зависимости и ставим их
COPY backend/requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt

# Копируем весь код
COPY . .

# Открываем порт (Koyeb сам подставит нужный)
EXPOSE 8000

# Команда запуска API
CMD uvicorn backend.api:app --host 0.0.0.0 --port $PORT
