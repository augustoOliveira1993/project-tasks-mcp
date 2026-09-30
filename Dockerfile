FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/dist ./frontend/dist
USER node
EXPOSE 3443
CMD ["node", "--env-file-if-exists=.env", "dist/src/prod.js"]
