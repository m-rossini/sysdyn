FROM node:22-slim

WORKDIR /app

# Install dependencies layer
COPY package.json package-lock.json* ./
COPY packages/sysdyn-core/package.json packages/sysdyn-core/package.json
COPY packages/sysdyn-demo/package.json packages/sysdyn-demo/package.json

RUN npm install

# Copy source
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev:demo", "--", "--host", "0.0.0.0"]
