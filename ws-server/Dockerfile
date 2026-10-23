FROM node:20-alpine

# Security: run as a non-root user
RUN addgroup -S wsgroup && adduser -S wsuser -G wsgroup

WORKDIR /app

# Copy manifests first so Docker layer cache is reused on code-only changes
COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

COPY index.js ./

# Health endpoint is served on the same port as socket.io
EXPOSE 3001

USER wsuser

CMD ["node", "index.js"]
