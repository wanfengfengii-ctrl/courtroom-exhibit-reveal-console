# ---- 构建阶段：纯静态产物 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 运行阶段：仅一个 Web 组件（本地静态服务器，无任何在线服务调用） ----
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=3s --timeout=3s --start-period=3s --retries=15 \
  CMD wget -q -O /dev/null http://127.0.0.1/console.html || exit 1
CMD ["nginx", "-g", "daemon off;"]
