# MojoMeet Worker

LiveKit agent worker for meeting transcription and AI processing.

## Setup

```bash
cd apps/worker
uv sync
cp .env.example .env  # fill in secrets
```

## Run (development)

```bash
uv run python -m src.main dev
```

## Run (Docker)

```bash
docker build -t meet-worker .
docker run --env-file .env meet-worker
```
