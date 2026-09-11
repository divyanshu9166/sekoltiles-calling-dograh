FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if required by audio processing libraries
RUN apt-get update && apt-get install -y \
    build-essential \
    ffmpeg \
    libasound2-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run the agent worker
CMD ["python", "agent.py", "start"]
