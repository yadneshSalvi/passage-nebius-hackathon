FROM node:22-bookworm-slim
LABEL org.passage.worker="react-static-v1"
WORKDIR /opt/passage
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && mkdir /input && chmod 755 /input
COPY build.mjs ./
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["node", "/opt/passage/build.mjs"]
