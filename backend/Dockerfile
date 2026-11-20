FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /workspace/backend

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libportaudio2 \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app app
COPY frontend/data/schemas /workspace/frontend/data/schemas
COPY frontend/docs/lote-1-lsec-conadis-2026-10-30.json /workspace/frontend/docs/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
