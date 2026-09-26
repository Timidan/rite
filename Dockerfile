FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node templates ./templates
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3001

CMD ["node", "src/cli/rite.js", "server", "--port", "3001"]
