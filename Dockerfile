FROM node:24-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim-trixie
WORKDIR /app
COPY backend/requirements.lock.txt backend/requirements.lock.txt
RUN pip install --no-cache-dir -r backend/requirements.lock.txt
COPY backend backend
COPY Исходники Исходники
COPY --from=frontend /build/dist frontend/dist
RUN mkdir -p /app/runtime && chown 65534:65534 /app/runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER 65534:65534
EXPOSE 8000
CMD ["sh","-c","exec uvicorn backend.api:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
