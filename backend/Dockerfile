FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN adduser --disabled-password --gecos '' appuser \
 && apt-get update \
 && apt-get install -y --no-install-recommends build-essential libpq-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && pip check
COPY . .
USER appuser
EXPOSE 8000
# Gunicorn (prod). Your dev command was: uvicorn app.main:app --reload --port 3333
CMD sh -c 'gunicorn -k uvicorn.workers.UvicornWorker -w ${GUNICORN_WORKERS:-2} -b 0.0.0.0:8000 app.main:app'
