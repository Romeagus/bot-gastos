# Bot Gastos — Anotador de Gastos Inteligente

Asistente financiero conversacional para Telegram. Elimina la fricción del
registro financiero diario mediante:

1. **Registro por texto, audio o foto** — el texto y el audio se interpretan con
   Groq (Whisper para el audio) y el ticket se lee con un modelo de visión.
2. **Consultas en lenguaje natural** — "cuánto gasté este mes", "en qué gasté más".
3. **Topes por categoría con avance** — límite mensual, cuánto llevás gastado y
   cuánto te queda.
4. **Alertas preventivas** — te avisa al cruzar el umbral y te lo recuerda en
   cada gasto mientras sigas cerca o pasado del tope.
5. **Categorías propias** — creá las tuyas ("gimnasio", "jardín") y usalas tanto
   para anotar gastos como para ponerles un tope.

> Estado actual: **MVP funcional.** Registro (texto / audio / foto), consultas,
> topes con alertas y categorías propias funcionan de punta a punta. Los tickets
> se leen con el modelo de visión de Groq (misma cuenta que el audio) y el gasto
> **siempre se confirma con botones** antes de quedar anotado.

### Cómo se usa

| Querés…             | Decí o mandá                                                           |
| ------------------- | ---------------------------------------------------------------------- |
| Anotar un gasto     | `gasté 3500 en el super` · `cargué 20 lucas de nafta` · un audio 🎙️    |
| Anotar un ticket    | una foto del ticket 📸 (el bot te muestra lo que leyó y **confirmás**) |
| Consultar           | `cuánto gasté este mes` · `cuánto gasté en super` · `en qué gasté más` |
| Ver tus topes       | `cómo vienen mis topes`                                                |
| Fijar un tope       | `presupuesto de 50 lucas en super`                                     |
| Crear una categoría | `creá la categoría gimnasio`                                           |

**Todo esto funciona igual por texto que por audio.** Comandos disponibles:
`/start`, `/help`, `/presupuesto`, `/categoria`.

## Stack

| Capa              | Tecnología                                  |
| ----------------- | ------------------------------------------- |
| Runtime           | Node.js (ESM) + TypeScript estricto         |
| Framework del bot | Telegraf                                    |
| Base de datos     | PostgreSQL (Supabase / Neon)                |
| Acceso a datos    | SQL directo tipado con `pg`                 |
| Transcripción     | Groq API — `whisper-large-v3`               |
| Visión / tickets  | Groq API — `qwen/qwen3.8-27b`               |
| Razonamiento      | API compatible con OpenAI (Groq / DeepSeek) |

Los proveedores de IA exponen una API compatible con OpenAI, por lo que se
consumen con `fetch` nativo (Node 18+) en lugar de sumar SDKs.

## Estructura del proyecto

```
bot-gastos/
├─ db/
│  ├─ schema.sql                 # DDL (fuente de verdad del modelo)
│  └─ seeds/
│     └─ 001_categories.sql      # categorías estándar
├─ scripts/
│  └─ apply-schema.ts            # runner de esquema + semillas
├─ src/
│  ├─ index.ts                   # entrada del proceso (bootstrap)
│  ├─ config/
│  │  └─ env.ts                  # lectura y validación de variables de entorno
│  ├─ bot/
│  │  ├─ bot.ts                  # instancia de Telegraf + middlewares globales
│  │  ├─ handlers/               # comandos y mensajes (audio, foto, texto)
│  │  ├─ middlewares/            # auth por usuario, logging, manejo de errores
│  │  └─ keyboards/              # teclados inline/reply
│  ├─ services/
│  │  ├─ ai/
│  │  │  ├─ transcription.service.ts   # Groq / Whisper
│  │  │  ├─ vision.service.ts          # Groq / Qwen (tickets)
│  │  │  └─ reasoning.service.ts       # DeepSeek (estructuración a JSON)
│  │  ├─ expenses.service.ts     # lógica de negocio de gastos
│  │  ├─ budgets.service.ts      # lógica de negocio de presupuestos
│  │  ├─ categories.service.ts   # resolución de categorías
│  │  └─ alerts.service.ts       # cálculo/emisión de alertas
│  ├─ db/
│  │  ├─ client.ts               # Pool de conexiones (pg)
│  │  └─ repositories/           # acceso a datos, una tabla por archivo
│  ├─ domain/
│  │  ├─ types/                  # tipos y DTOs del dominio
│  │  └─ schemas/                # esquemas zod (validación de salidas de IA)
│  ├─ jobs/                      # tareas programadas (alertas de presupuesto)
│  └─ utils/                     # logger, errores, helpers de dinero/fechas
├─ tests/
├─ .env.example
├─ eslint.config.js
├─ tsconfig.json
└─ package.json
```

## Setup

```bash
npm install          # instala dependencias de package.json
cp .env.example .env # completar TELEGRAM_BOT_TOKEN y DATABASE_URL
npm run db:apply     # crea tablas (schema.sql) y carga semillas
npm run dev          # levanta el bot en modo watch (tsx)
```

### Scripts disponibles

| Script                  | Descripción                                           |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | Ejecuta el bot con recarga en caliente (`tsx watch`). |
| `npm run build`         | Compila TypeScript a `dist/`.                         |
| `npm run start`         | Ejecuta la build (`node dist/index.js`).              |
| `npm run typecheck`     | Chequeo de tipos sin emitir.                          |
| `npm run db:apply`      | Aplica `db/schema.sql` y los seeds.                   |
| `npm run db:verify`     | Verifica esquema y repositorios contra la base real.  |
| `npm run ai:transcribe` | Prueba la transcripción de audio (Groq Whisper).      |
| `npm run lint`          | ESLint.                                               |
| `npm run format`        | Prettier.                                             |

### Aplicar el esquema sin Node

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seeds/001_categories.sql
```

En Supabase, también se puede pegar el contenido de `db/schema.sql` en el **SQL Editor**.

## Despliegue (para usar el bot desde cualquier dispositivo)

El bot usa **long polling**, así que **no necesita puerto ni URL pública**: solo
un proceso corriendo 24/7 en algún host.

### 1. Llevar el código a un repo

```bash
git init
git add .
git commit -m "Bot de gastos"
# crear el repo en GitHub y luego:
git remote add origin <url-del-repo>
git push -u origin main
```

> `.gitignore` ya excluye `.env`, `node_modules` y `dist`. Verificá que `.env`
> **no** se suba.

### 2. Opciones de hosting

| Opción      | Cómo                                                                                                | Notas                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Railway** | New Project → Deploy from GitHub → cargar variables                                                 | Detecta el `Dockerfile` solo.                                         |
| **Render**  | New → **Background Worker** (runtime Docker)                                                        | Los _Web Services_ exigen un puerto abierto: usar **Worker**, no Web. |
| **Fly.io**  | `fly launch` (detecta el `Dockerfile`) + `fly secrets set ...`                                      | Buen plan gratuito.                                                   |
| **VPS**     | `docker build -t bot-gastos . && docker run -d --env-file .env --restart unless-stopped bot-gastos` | Control total, sirve cualquier hosting con Docker.                    |

### 3. Variables de entorno en el host

Cargar en el panel del proveedor las mismas del `.env`:

```ini
NODE_ENV=production
TELEGRAM_BOT_TOKEN=...
DATABASE_URL=...
GROQ_API_KEY=...
REASONING_PROVIDER=groq
REASONING_API_KEY=...
REASONING_BASE_URL=https://api.groq.com/openai/v1
REASONING_MODEL=openai/gpt-oss-120b
# La visión reutiliza GROQ_API_KEY, así que no hace falta ninguna variable más.
# Para otro proveedor: VISION_PROVIDER / VISION_BASE_URL / VISION_MODEL / VISION_API_KEY.
```

### 4. Aplicar el esquema (una sola vez)

Desde tu máquina, contra la base en la nube:

```bash
npm run db:apply
npm run db:verify
```

### 5. ⚠️ Un solo proceso a la vez

Telegram permite **un único consumidor de long polling** por token. Si dejás el
bot corriendo en tu PC **y** en el servidor al mismo tiempo, se "roban" los
updates entre sí y vas a ver errores `409 Conflict`. Para probar desde el
celular, **apagá el proceso local** (`Ctrl+C`).

## Solución de problemas

### `connect ENETUNREACH <ipv6>:5432` al conectar a la base

**Causa real (proyectos nuevos de Supabase):** la conexión _directa_
`db.<ref>.supabase.co` publica **solo registros AAAA (IPv6)**, no tiene IPv4.
Como muchos hosts (Railway, Render) no tienen salida IPv6, la conexión falla con
_Network unreachable_. Preferir IPv4 no ayuda porque **no hay IPv4 para elegir**
(`setDefaultResultOrder('ipv4first')` queda igual como defensa).

**Solución:** usar la **Connection Pooler** de Supabase, que sí resuelve por IPv4.
Respecto de la cadena directa cambian dos cosas: el usuario pasa a ser
`postgres.<ref>` (antes `postgres`) y el host pasa a `aws-0-<region>.pooler.supabase.com`:

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Se obtiene en Supabase → **Project Settings → Database → Connection string →
_Session pooler_**. El puerto `6543` (_Transaction pooler_) también sirve.

### `409 Conflict: terminated by other getUpdates request`

Hay **dos procesos** haciendo long polling con el mismo token. Apagá el local
(`Ctrl+C`) o eliminá el servicio duplicado en Railway.

### `EnvValidationError: DATABASE_URL debe empezar con postgres://...`

El valor tiene comillas, espacios, o el bloque `KEY=` pegado adentro del valor.
El mensaje de error indica los primeros caracteres recibidos para ubicarlo rápido.
