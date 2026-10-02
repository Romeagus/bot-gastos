-- =============================================================================
-- Anotador de Gastos Inteligente · Esquema base PostgreSQL
-- -----------------------------------------------------------------------------
-- Archivo : db/schema.sql
-- Motor   : PostgreSQL 15+ (compatible con Supabase y Neon)
-- Uso     : Fuente de verdad (source of truth) del modelo relacional.
--           Aplicar con:  npm run db:apply
--           o bien:       psql "$DATABASE_URL" -f db/schema.sql
--
-- Decisiones de diseño relevantes:
--   * Script idempotente: puede ejecutarse varias veces sin perder datos.
--   * Se usan dominios TEXT + CHECK en lugar de tipos ENUM de PostgreSQL.
--     Motivo: los ENUM nativos son costosos de evolucionar (no se puede quitar
--     un valor y agregar valores requiere ALTER TYPE). Para un producto vivo
--     (nuevos métodos de pago, nuevas fuentes de captura) un CHECK es más
--     mantenible.
--   * Claves primarias UUID (gen_random_uuid) para no exponer ids secuenciales
--     y facilitar sincronización entre entornos.
--   * Timestamps en TIMESTAMPTZ (UTC) para evitar ambigüedades de zona horaria.
-- =============================================================================

BEGIN;

-- Necesario para gen_random_uuid() en instalaciones anteriores a PostgreSQL 13.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Función utilitaria: mantener updated_at al día en cada UPDATE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


-- =============================================================================
-- Tabla: users
-- Mapea una cuenta de Telegram con su configuración financiera básica.
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id   BIGINT      NOT NULL,
  username      TEXT,
  first_name    TEXT,
  language_code TEXT,
  currency      CHAR(3)     NOT NULL DEFAULT 'ARS',
  timezone      TEXT        NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT users_telegram_id_key UNIQUE (telegram_id),
  CONSTRAINT users_currency_chk    CHECK (currency ~ '^[A-Z]{3}$')
);

COMMENT ON TABLE  users             IS 'Usuarios del bot, identificados por telegram_id.';
COMMENT ON COLUMN users.telegram_id IS 'ID numérico de Telegram (único por usuario).';
COMMENT ON COLUMN users.currency    IS 'Moneda por defecto del usuario (ISO 4217).';

-- =============================================================================
-- Tabla: categories
-- Categorías estándar (globales) y categorías personalizadas por usuario.
--   * user_id IS NULL  -> categoría estándar/global (is_system = TRUE).
--   * user_id NOT NULL -> categoría propia del usuario (is_system = FALSE).
-- =============================================================================
CREATE TABLE IF NOT EXISTS categories (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES users(id) ON DELETE CASCADE,
  slug       TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  emoji      TEXT,
  is_system  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT categories_slug_format_chk CHECK (slug ~ '^[a-z0-9_]+$'),
  -- Invariante: una categoría es de sistema si y sólo si es global (sin dueño).
  CONSTRAINT categories_scope_chk       CHECK (is_system = (user_id IS NULL))
);

COMMENT ON TABLE  categories           IS 'Categorías de gasto: estándar (globales) y personalizadas.';
COMMENT ON COLUMN categories.is_system IS 'TRUE = categoría estándar global; FALSE = categoría del usuario.';

-- Unicidad del nombre lógico: las globales compiten entre sí; las de usuario
-- compiten dentro de cada usuario. Se usan índices únicos parciales.
CREATE UNIQUE INDEX IF NOT EXISTS categories_system_slug_uidx
  ON categories (slug)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS categories_user_slug_uidx
  ON categories (user_id, slug)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS categories_user_id_idx
  ON categories (user_id);

-- =============================================================================
-- Tabla: expenses
-- Registro de un gasto, cualquiera sea su vía de captura (audio, foto, texto).
-- =============================================================================
CREATE TABLE IF NOT EXISTS expenses (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID          NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id         UUID          REFERENCES categories(id)          ON DELETE SET NULL,
  amount              NUMERIC(14,2) NOT NULL,
  currency            CHAR(3)       NOT NULL DEFAULT 'ARS',
  merchant            TEXT,
  description         TEXT,
  payment_method      TEXT          NOT NULL DEFAULT 'other',
  spent_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  source_type         TEXT          NOT NULL,
  status              TEXT          NOT NULL DEFAULT 'pending',
  raw_input           TEXT,
  raw_payload         JSONB         NOT NULL DEFAULT '{}'::jsonb,
  ai_model            TEXT,
  ai_confidence       NUMERIC(4,3),
  telegram_message_id BIGINT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT expenses_amount_chk         CHECK (amount >= 0),
  CONSTRAINT expenses_currency_chk       CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT expenses_payment_method_chk CHECK (
    payment_method IN ('cash', 'debit_card', 'credit_card', 'transfer', 'mercadopago', 'other')
  ),
  CONSTRAINT expenses_source_type_chk    CHECK (
    source_type IN ('audio', 'photo', 'text', 'manual')
  ),
  CONSTRAINT expenses_status_chk         CHECK (
    status IN ('pending', 'confirmed', 'needs_review', 'rejected')
  ),
  CONSTRAINT expenses_confidence_chk     CHECK (
    ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)
  )
);

COMMENT ON TABLE  expenses             IS 'Gastos registrados por el usuario.';
COMMENT ON COLUMN expenses.amount      IS 'Monto del gasto, siempre positivo.';
COMMENT ON COLUMN expenses.spent_at    IS 'Momento en que ocurrió el gasto (no el de carga).';
COMMENT ON COLUMN expenses.source_type IS 'Vía de captura: audio | photo | text | manual.';
COMMENT ON COLUMN expenses.status      IS 'Estado del registro dentro del flujo de confirmación.';
COMMENT ON COLUMN expenses.raw_input   IS 'Texto original o transcripción cruda del input del usuario.';
COMMENT ON COLUMN expenses.raw_payload IS 'Metadatos de IA: salida cruda del modelo, confianza, ids de mensajes, etc.';

-- Índices sobre los patrones de consulta más frecuentes:
--   * "mis gastos del mes"            -> (user_id, spent_at DESC)
--   * "cuánto gasté en la categoría X" -> (user_id, category_id, spent_at)
--   * panel de pendientes             -> (user_id, status)
CREATE INDEX IF NOT EXISTS expenses_user_spent_at_idx
  ON expenses (user_id, spent_at DESC);

CREATE INDEX IF NOT EXISTS expenses_user_category_spent_at_idx
  ON expenses (user_id, category_id, spent_at DESC);

CREATE INDEX IF NOT EXISTS expenses_user_status_idx
  ON expenses (user_id, status);

CREATE INDEX IF NOT EXISTS expenses_category_id_idx
  ON expenses (category_id);

-- Búsqueda dentro de los metadatos de IA (jsonb_path_ops = índice más compacto).
CREATE INDEX IF NOT EXISTS expenses_raw_payload_gin_idx
  ON expenses USING GIN (raw_payload jsonb_path_ops);

-- Idempotencia de procesamiento: un mismo mensaje de Telegram no debe generar
-- dos veces el mismo gasto (reintentos de Telegram, reprocesos, etc.).
CREATE UNIQUE INDEX IF NOT EXISTS expenses_user_telegram_msg_uidx
  ON expenses (user_id, telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

-- =============================================================================
-- Tabla: budgets
-- Presupuesto (límite de gasto) por usuario, categoría y período mensual.
-- =============================================================================
CREATE TABLE IF NOT EXISTS budgets (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  category_id     UUID          NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period_year     SMALLINT      NOT NULL,
  period_month    SMALLINT      NOT NULL,
  limit_amount    NUMERIC(14,2) NOT NULL,
  currency        CHAR(3)       NOT NULL DEFAULT 'ARS',
  alert_threshold SMALLINT      NOT NULL DEFAULT 80,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT budgets_limit_amount_chk    CHECK (limit_amount >= 0),
  CONSTRAINT budgets_currency_chk        CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT budgets_period_month_chk    CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT budgets_period_year_chk     CHECK (period_year BETWEEN 2000 AND 2100),
  CONSTRAINT budgets_alert_threshold_chk CHECK (alert_threshold BETWEEN 1 AND 100),
  -- Un único presupuesto por usuario / categoría / período.
  CONSTRAINT budgets_user_category_period_key
    UNIQUE (user_id, category_id, period_year, period_month)
);

COMMENT ON TABLE  budgets                 IS 'Presupuestos mensuales por usuario y categoría.';
COMMENT ON COLUMN budgets.alert_threshold IS 'Porcentaje de consumo (1-100) que dispara la alerta preventiva.';
COMMENT ON COLUMN budgets.is_active       IS 'Permite desactivar un presupuesto sin borrarlo.';

-- Índice principal para las alertas: "presupuestos activos del mes".
CREATE INDEX IF NOT EXISTS budgets_user_period_active_idx
  ON budgets (user_id, period_year, period_month)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS budgets_category_id_idx
  ON budgets (category_id);

-- =============================================================================
-- Tabla: scheduled_reports
-- -----------------------------------------------------------------------------
-- Registro de los reportes programados ya enviados (ej. el resumen semanal).
--
-- Por que existe: Railway reinicia el contenedor seguido y el proceso vive en
-- memoria, asi que un flag "ya mande el resumen de esta semana" SE PIERDE en cada
-- redeploy. Con esta tabla el envio es idempotente entre reinicios: la clave
-- unica (job_name, period_key) impide mandar dos veces el mismo reporte.
--
-- `period_key` identifica el periodo del reporte en texto libre ('2026-W42'), de
-- modo que agregar otro job no requiere cambiar el esquema.
-- =============================================================================
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_name    TEXT        NOT NULL,
  period_key  TEXT        NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT scheduled_reports_user_job_period_key UNIQUE (user_id, job_name, period_key)
);

COMMENT ON TABLE  scheduled_reports             IS 'Reportes programados ya enviados, para no repetir tras un reinicio.';
COMMENT ON COLUMN scheduled_reports.period_key  IS 'Identificador del periodo del reporte (ej. 2026-W42).';

-- Consulta del job: "mandaste ya el resumen de la semana 42 a este usuario?".
CREATE INDEX IF NOT EXISTS scheduled_reports_lookup_idx
  ON scheduled_reports (job_name, period_key);

-- =============================================================================
-- Tabla: error_reports
-- -----------------------------------------------------------------------------
-- Errores que el usuario YA vio en su chat ("no pude interpretar eso", "se me
-- rompió"), guardados con su codigo.
--
-- Por que existe: el unico rastro de un fallo hoy es el log del servidor, que
-- el usuario no va a leer. Si alguien reporta "no me anda", sin esto no hay forma
-- de saber que fallo ni cuando. Con el codigo se puede buscar el error exacto.
--
-- No se guardan secretos ni el token: solo el mensaje, el tipo y de donde vino.
-- =============================================================================
CREATE TABLE IF NOT EXISTS error_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Codigo corto y legible que se le muestra al usuario para que lo reporte.
  code        TEXT        NOT NULL,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  -- Origen: 'text' | 'audio' | 'photo' | 'command' | 'job' | 'unknown'.
  source      TEXT        NOT NULL DEFAULT 'unknown',
  -- Mensaje tecnico del error (el que va al log).
  message     TEXT        NOT NULL,
  -- Contexto minimo para diagnosticar: que se estaba procesando.
  context     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT error_reports_code_key UNIQUE (code),
  CONSTRAINT error_reports_source_chk
    CHECK (source IN ('text', 'audio', 'photo', 'command', 'job', 'unknown'))
);

COMMENT ON TABLE  error_reports          IS 'Errores visibles para el usuario, con codigo para poder rastrearlos.';
COMMENT ON COLUMN error_reports.code    IS 'Codigo corto que se muestra al usuario (ej. E-7F3A).';

-- Consulta tipica: "que errores vio este usuario ultimamente".
CREATE INDEX IF NOT EXISTS error_reports_user_created_idx
  ON error_reports (user_id, created_at DESC);

-- =============================================================================
-- Triggers: mantenimiento automático de updated_at.
-- =============================================================================
DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS categories_set_updated_at ON categories;
CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS expenses_set_updated_at ON expenses;
CREATE TRIGGER expenses_set_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS budgets_set_updated_at ON budgets;
CREATE TRIGGER budgets_set_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;