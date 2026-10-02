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
6. **Varias instrucciones en un mismo mensaje** — "gasté 3500 en el super y cuánto
   gasté este mes" (típico de un audio): las separa y las resuelve una por una.
7. **Nada se anota sin tu OK** — si la IA no está segura de lo que escuchó, o el
   monto parece dudoso, el gasto queda pendiente y te lo confirmás con botones.
8. **Borrar y editar** — `/borrar` y `/editar` te listan tus últimos gastos con
   botones: vos elegís cuál tocar, el bot nunca adivina.
9. **Resumen semanal automático** — todos los lunes a las 10:00 (hora de Argentina)
   te escribe cómo viene el mes y cómo están tus topes, sin que tengas que pedirlo.
10. **Exportación a CSV** — `/exportar` te manda todos tus gastos como archivo, listo
    para abrir en Excel y analizarlo.
11. **Errores con código** — si algo falla, el mensaje incluye un código (`E-6TRP`) y
    `/error` muestra los últimos. Se puede diagnosticar sin leer los logs del servidor.

> Estado actual: **MVP funcional.** Registro (texto / audio / foto), consultas,
> topes con alertas, categorías propias, varias instrucciones por mensaje, borrado
> y edición funcionan de punta a punta. Los tickets se leen con el modelo de visión
> de Groq (misma cuenta que el audio) y todo lo dudoso **se confirma con botones**
> antes de quedar anotado.

### Cómo se usa

| Querés…             | Decí o mandá                                                           |
| ------------------- | ---------------------------------------------------------------------- |
| Anotar un gasto     | `gasté 3500 en el super` · `cargué 20 lucas de nafta` · un audio 🎙️    |
| Anotar un ticket    | una foto del ticket 📸 (el bot te muestra lo que leyó y **confirmás**) |
| Consultar           | `cuánto gasté este mes` · `cuánto gasté en super` · `en qué gasté más` |
| Ver tus topes       | `cómo vienen mis topes`                                                |
| Fijar un tope       | `presupuesto de 50 lucas en super`                                     |
| Borrar un tope      | `borrá el tope de super`                                               |
| Crear una categoría | `creá la categoría gimnasio`                                           |
| Borrar un gasto     | `/borrar` (te lista los últimos con botones) · `borrá el último`       |
| Corregir un gasto   | `/editar` (elegís el gasto y el campo: monto o categoría)              |
| Ver el resumen      | `/resumen` (o esperás al lunes y te lo manda solo)                     |
| Bajar los gastos    | `/exportar` (te llega un `.csv` listo para Excel)                      |
| Ver si algo falló   | `/error` (códigos de los últimos errores)                              |
| Empezar de cero     | `/reset` (borra todo pidiendo confirmación)                            |

**Todo esto funciona igual por texto que por audio.** Comandos disponibles:
`/start`, `/help`, `/resumen`, `/presupuesto`, `/categoria`, `/borrar`, `/editar`,
`/exportar`, `/error`, `/reset`.

### Exportar a CSV

`/exportar` te manda un archivo `gastos-AAAA-MM-DD.csv` con **todos** tus gastos.
Cuatro detalles que hacen que se abra bien en Excel:

- **Separador `;`**: en es-AR la coma es el separador decimal. Con coma de columna,
  Excel con configuración regional argentina abre el archivo partido al medio.
- **BOM UTF-8**: sin él, "Peluquería" aparece como "PeluquerÃ­a".
- **Sin emoji en la categoría**: "🍔 Comida" no agrupa con "Comida" al filtrar.
- **Montos como números** (`8000`, no `$8.000`): para que la planilla los sume.

Se excluyen los gastos que borraste (`rejected`): exportar también lo que ya no
existe daría una contabilidad que no es real.

### Cuando algo falla

El mensaje de error incluye un código corto:

```
No pude procesar el audio 🙈

Grabalo de nuevo y pruebo otra vez 🎙️

Si sigue pasando, contame el código E-6TRP.
```

Con `/error` ves los últimos. El código se **deriva del mensaje del error**, así que
el mismo fallo siempre tiene el mismo código y se puede buscar en los logs sin
ambigüedad. Si el guardado del error falla, el log del servidor igual queda escrito:
perder un registro es mejor que romper el manejo de errores.

### El resumen semanal

Todos los **lunes a las 10:00** (hora de Argentina) el bot te escribe solo:

```
🌞 Buen día! Así viene tu mes 👇

💸 Octubre: $246.500 en 11 movimientos

🏆 En qué se fue:
  1. 💡 Servicios · $80.000
  2. 🍔 Comida · $67.000
  3. 🏋️ Gimnasio · $50.000

🎯 Topes:
  🚨 🛒 Supermercado: te pasaste por $18.500 (1950%)
  ⚠️ 💡 Servicios: vas 80%, te quedan $20.000

Mandame un audio o un ticket y lo anoto 😉
```

Tres detalles que importan:

- **No se manda si no hay nada que contar**: si no anotaste nada en el mes, no
  llega un mensaje vacío.
- **Nunca se duplica**: el envío se registra con la clave de la semana ISO
  (`2026-W41`) en la tabla `scheduled_reports`. Si Railway reinicia el contenedor
  justo a las 10:00, el resumen no se manda dos veces.
- **Usa tu zona horaria**: sale a las 10:00 de tu hora local (la tabla `users`
  tiene `timezone`), no a la del servidor.

Si bloqueás el bot, el sistema te da de baja solo y deja de mandarte mensajes.

### Cuando no te entiende

Tres medidas para que un error de la IA no te ensucie la cuenta:

- **Varias órdenes en un mensaje**: _"gasté 3500 en el super y cuánto gasté este
  mes"_ se parte y se responde una por una (hasta 5).
- **Baja confianza**: si el modelo no está seguro de lo que escuchó, el gasto
  **no se anota**: queda pendiente y te lo confirmás con **Sí / No**.
- **Nada destructivo por voz**: decir _"borrá el último"_ **no borra**: te muestra
  el menú para que elijas vos cuál. Lo mismo con `borrar todo`.

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
│  │  ├─ handlers/               # un archivo por comando/mensaje + shared.ts
│  │  ├─ middlewares/            # auth por usuario, logging, manejo de errores
│  │  ├─ pending-edit.ts         # edición en curso (expira a los 5 min)
│  │  ├─ reply-error.ts          # error al usuario + código de registro
│  │  └─ keyboards/              # (reservado)
│  ├─ jobs/
│  │  └─ weekly-report.job.ts    # resumen semanal (lunes 10:00, zona del usuario)
│  ├─ services/
│  │  ├─ ai/
│  │  │  ├─ transcription.service.ts   # Groq / Whisper
│  │  │  ├─ vision.service.ts          # Groq / Qwen (tickets)
│  │  │  ├─ reasoning.service.ts       # estructuración a JSON
│  │  │  ├─ instructions.service.ts    # separa varias órdenes en un mensaje
│  │  │  └─ openai-compatible.client.ts
│  │  ├─ expenses.service.ts     # alta, borrado lógico y edición de gastos
│  │  ├─ expenses-menu.service.ts# menus de /borrar, /editar y /reset
│  │  ├─ budgets.service.ts      # topes, avance y alertas
│  │  ├─ categories.service.ts   # resolución de categorías (alias + propias)
│  │  ├─ queries.service.ts      # consultas en lenguaje natural
│  │  ├─ weekly-report.service.ts# texto del resumen semanal (lo usa /resumen)
│  │  ├─ export.service.ts       # CSV de gastos (lo usa /exportar)
│  │  ├─ diagnostics.service.ts  # códigos de error visibles (E-XXXX)
│  │  └─ answer.ts               # respuesta (texto + botones) sin Telegraf
│  ├─ db/
│  │  ├─ client.ts               # Pool de conexiones (pg)
│  │  └─ repositories/           # acceso a datos, una tabla por archivo
│  ├─ domain/
│  │  ├─ types/                  # tipos y DTOs del dominio
│  │  └─ schemas/                # esquemas zod (validación de salidas de IA)
│  └─ utils/                     # logger, errores, nlp, dinero/fechas, agenda
├─ tests/                        # tests unitarios (node:test + tsx, sin DB)
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
| `npm test`              | Tests unitarios (runner nativo de Node).              |
| `npm run db:apply`      | Aplica `db/schema.sql` y los seeds.                   |
| `npm run db:verify`     | Verifica esquema y repositorios contra la base real.  |
| `npm run ai:transcribe` | Prueba la transcripción de audio (Groq Whisper).      |
| `npm run lint`          | ESLint.                                               |
| `npm run format`        | Prettier.                                             |

### Tests

```bash
npm test
```

Corren con el runner nativo de Node (`node:test`) vía `tsx`: **sin dependencias
extra y sin base de datos** (solo lógica pura). Cubren los puntos que ya dieron
problemas una vez: el parseo de montos (`19.000` no es `19`), los alias de
categorías con artículos ("en el super" → supermercado), las variantes de
"limitar", el contrato tolerante de la salida de la IA y el texto del reporte de
presupuestos.

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
