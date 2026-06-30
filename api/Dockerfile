FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl poppler-utils && rm -rf /var/lib/apt/lists/*
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
RUN npx prisma generate && npm run build
FROM node:20-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl poppler-utils && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package*.json ./
ENV NODE_ENV=production
CMD ["sh","-c","npx prisma migrate deploy && node dist/index.js"]
