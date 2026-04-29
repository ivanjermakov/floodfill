from alpine:latest

run apk add nodejs npm

copy src /src
copy index.html /
copy package.json /
copy tsconfig.json /
copy vite.config.ts /

run npm install
run npx vite build

entrypoint npx bun src/server.ts

