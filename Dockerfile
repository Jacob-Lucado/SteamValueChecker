FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV LUNA_CHROMIUM=/usr/bin/chromium
# ffmpeg decodes the audio for music; yt-dlp finds the SoundCloud streams (it's rebuilt on every deploy, so it stays current)
# chromium opens Amazon Luna's claims page (it has no API); it only runs for a few seconds every couple of hours
RUN apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 install -y --no-install-recommends ffmpeg ca-certificates curl python3 chromium \
    && curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 20 --max-time 120 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
CMD ["node", "--disable-warning=ExperimentalWarning", "--max-old-space-size=700", "src/index.js"]
