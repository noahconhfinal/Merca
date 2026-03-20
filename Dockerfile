FROM cloudron/base:4.2.0@sha256:46da2fffb36353ef714f97ae8e962bd2c212ca091108d768ba473078319a47f4

RUN mkdir -p /app/code
WORKDIR /app/code

COPY package.json /app/code/
RUN npm install --production

COPY . /app/code/

# Cloudron uses /app/data for persistent storage
RUN mkdir -p /app/data

CMD ["node", "server.js"]
