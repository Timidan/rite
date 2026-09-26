FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node dist ./dist

USER node
EXPOSE 3001

CMD ["node", "src/cli/rite.js", "server", "--port", "3001"]
