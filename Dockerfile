FROM node:15.5.1
WORKDIR /usr/src/app
COPY package.json yarn.lock ./
RUN yarn install
COPY . .
CMD ["node", "index.js"]
