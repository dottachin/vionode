FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN adduser --disabled-password --gecos '' appuser
WORKDIR /app
COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt \
 && pip check
COPY . .
RUN mkdir -p /app/logs && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD sh -c 'gunicorn -k uvicorn.workers.UvicornWorker -w ${GUNICORN_WORKERS:-2} --timeout 6000 -b 0.0.0.0:8000 main:app'
