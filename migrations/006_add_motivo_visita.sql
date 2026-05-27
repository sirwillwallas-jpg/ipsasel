-- Migration 006: Añadir columna motivo_visita (texto libre) a VISITAS
BEGIN;
ALTER TABLE IF EXISTS VISITAS
  ADD COLUMN IF NOT EXISTS motivo_visita TEXT;
COMMIT;
