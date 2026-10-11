# ---- build frontend ----
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- runtime ----
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist ./static
ENV DATA_DIR=/var/data
RUN mkdir -p /var/data
EXPOSE 10000
CMD ["sh","-c","uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
