FROM node:20-alpine
WORKDIR /app

# Toan bo ma nguon dung Node.js stdlib (http, crypto, fs, path, os) - khong can cai goi phu thuoc ngoai
COPY package*.json ./

# Sao chep toan bo thu muc ung dung
COPY . .

# Cong va URL mac dinh cho Google AI Studio / Cloud Run
ENV PORT=8080
ENV NODE_ENV=production
ENV APP_URL=https://mini-quiz-classroom-n12.ai.studio

EXPOSE 8080

CMD ["npm", "start"]
