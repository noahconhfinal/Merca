FROM node:20-alpine

RUN mkdir -p /app/code /app/data
WORKDIR /app/code

COPY package.json package-lock.json* /app/code/
RUN npm install --production

COPY . /app/code/

ENV PORT=3000
ENV CLOUDRON_APP_DATA=/app/data

EXPOSE 3000

CMD ["node", "server.js"]
