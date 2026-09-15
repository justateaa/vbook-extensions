FROM python:3.11-slim

# soundfile cần libsndfile; ffmpeg để pydub encode MP3 (app.py đặt
# gr.Audio(format="mp3") thay vì WAV thô). Các gói còn lại đều có wheel sẵn.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# app.py giữ nguyên byte-for-byte bản trên HF Space — đó là thứ đã xác minh
# có api_name="synthesize". Mọi tinh chỉnh đi qua biến môi trường, không vá file.
COPY app.py .

ENV HF_HOME=/data/hf \
    GRADIO_SERVER_NAME=0.0.0.0 \
    GRADIO_SERVER_PORT=7860 \
    ZEROTTS_THREADS=4

EXPOSE 7860

CMD ["python", "app.py"]
