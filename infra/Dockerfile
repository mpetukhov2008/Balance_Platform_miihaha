FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends docker.io && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.lock.txt backend/requirements.lock.txt
RUN pip install --no-cache-dir -r backend/requirements.lock.txt
COPY backend backend
COPY Исходники Исходники
ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8000"]
