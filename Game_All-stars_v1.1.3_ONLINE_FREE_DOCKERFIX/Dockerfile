FROM node:20-alpine
WORKDIR /app
COPY server/package.json ./server/package.json
COPY server/server.js ./server/server.js
COPY server/storage ./server/storage
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000
CMD ["node", "server/server.js"]
