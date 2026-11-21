# reverie-ml: embedding models over HTTP. Requirements first so a code-only change reuses the torch layer.
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models \
    HF_HUB_DISABLE_TELEMETRY=1

WORKDIR /srv
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app

EXPOSE 8090
# Weights are downloaded on first start into the HF_HOME volume; /health reports ready=false until they load.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
