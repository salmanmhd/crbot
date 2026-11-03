FROM node:22-slim
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY dashboard ./dashboard
ENV NODE_ENV=production TZ=UTC
VOLUME /data
EXPOSE 8080
# `run` initialises the experiment on first start, ticks every minute, resumes after restarts, stops at 48h.
CMD ["node", "--no-warnings", "src/cli.ts", "run", "--out", "/data"]
