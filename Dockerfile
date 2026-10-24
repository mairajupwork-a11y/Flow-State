# WorkMars — single container: builds the React app, serves it from the Node API.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build -w web

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000 DATABASE_FILE=/data/workmars.db
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY shared shared
COPY server server
COPY --from=build /app/web/dist web/dist
VOLUME /data
EXPOSE 4000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
