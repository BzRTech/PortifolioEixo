# Imagem Node enxuta (Render injeta a porta via variavel PORT).
FROM node:22-alpine

WORKDIR /app

# Instala as dependencias primeiro (aproveita cache de camadas).
# Todas as deps sao de producao (express, cors, dotenv, pg).
COPY package*.json ./
RUN npm install --omit=dev

# Copia o restante do codigo (front, API, scripts).
COPY . .

ENV NODE_ENV=production
# Documental: o Render fornece a porta real via $PORT; o server usa process.env.PORT.
EXPOSE 3000

# Sobe o servidor (cria o schema PostGIS no boot e, se SEED_DEMO=true, popula o demo).
CMD ["npm", "start"]
