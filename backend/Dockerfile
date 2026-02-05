FROM python:3.10-slim

WORKDIR /app

# Ensure logs are visible in real-time
ENV PYTHONUNBUFFERED=1

# Install system dependencies if needed (e.g. for building headers)
# RUN apt-get update && apt-get install -y build-essential

# Copy requirements
COPY requirements.txt .

# Install python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app ./app
COPY .env . 

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
