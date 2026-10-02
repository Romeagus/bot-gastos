-- =============================================================================
-- Semilla: categorías estándar (globales)
-- -----------------------------------------------------------------------------
-- Archivo  : db/seeds/001_categories.sql
-- Aplicar  : npm run db:apply   (el runner ejecuta schema.sql y luego los seeds)
-- Idempotente gracias a ON CONFLICT DO NOTHING (choca contra el índice único
-- parcial categories_system_slug_uidx).
-- =============================================================================

BEGIN;

INSERT INTO categories (slug, name, emoji, is_system, user_id)
VALUES
  ('comida',       'Comida',       '🍔', TRUE, NULL),
  ('salidas',      'Salidas',      '🍻', TRUE, NULL),
  ('supermercado', 'Supermercado', '🛒', TRUE, NULL),
  ('transporte',   'Transporte',   '🚕', TRUE, NULL),
  ('servicios',    'Servicios',    '💡', TRUE, NULL),
  ('varios',       'Varios',       '🧾', TRUE, NULL)
ON CONFLICT DO NOTHING;

COMMIT;