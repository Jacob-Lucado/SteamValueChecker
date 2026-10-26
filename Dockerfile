FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
CMD ["node", "--disable-warning=ExperimentalWarning", "--max-old-space-size=400", "src/index.js"]
