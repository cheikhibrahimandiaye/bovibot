FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/
COPY start.sh start.sh
RUN chmod +x start.sh

EXPOSE 8002

CMD ["sh", "start.sh"]
