FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
USER node
EXPOSE 3443
CMD ["npm", "start"]
