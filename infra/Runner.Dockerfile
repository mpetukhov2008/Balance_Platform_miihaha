FROM python:3.12-slim
WORKDIR /app
COPY backend/__init__.py backend/domain.py backend/sandbox_entry.py backend/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65534:65534
ENTRYPOINT ["python", "-m", "backend.sandbox_entry"]
