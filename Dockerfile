# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package.json (+ pnpm-lock.yaml إن وُجد — يرفعه CI تلقائياً بأول تشغيل، راجع build-check.yml)
COPY package.json pnpm-lock.yaml* ./

# ✅ بناء قابل للتكرار: مع وجود القفل نثبّت بحرفيّته (--frozen-lockfile) فلا تتغير إصدارات
# الحزم بين بناء وآخر؛ وبدونه نولّده مؤقتاً كما كان (ثم تنسخه المرحلة التالية).
RUN npm install -g pnpm@10.4.1 && \
    if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install --no-frozen-lockfile; fi

# Copy the rest of the source code
COPY . .

# استقبال متغيرات Firebase كـ Build Args (رندر يمررها تلقائياً بنفس الاسم
# والقيمة من إعدادات Environment الخاصة بالخدمة) ثم تحويلها لمتغيرات بيئة
# فعلية عشان Vite يقدر يقرأها وقت "pnpm build" ويحقنها داخل الحزمة النهائية.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_RECAPTCHA_SITE_KEY
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
ENV VITE_RECAPTCHA_SITE_KEY=$VITE_RECAPTCHA_SITE_KEY

# Build the application
RUN pnpm build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install pnpm (pinned to match "packageManager" in package.json)
RUN npm install -g pnpm@10.4.1

# Copy package.json and generated lock file from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./

# Install production dependencies using frozen lockfile
RUN pnpm install --frozen-lockfile

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# ✅ لا يعمل السيرفر بصلاحية root — صورة node الرسمية تتضمن المستخدم "node"
RUN chown -R node:node /app
USER node

# Start the application
CMD ["node", "dist/index.js"]