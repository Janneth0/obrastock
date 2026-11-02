CREATE TABLE IF NOT EXISTS obras (
  id text PRIMARY KEY, nombre text NOT NULL,
  presupuesto numeric(14,2) NOT NULL CHECK (presupuesto >= 0), gasto numeric(14,2) NOT NULL DEFAULT 0);
CREATE SEQUENCE IF NOT EXISTS mat_seq START 5;
CREATE TABLE IF NOT EXISTS materiales (
  codigo text PRIMARY KEY, descripcion text NOT NULL, unidad text NOT NULL,
  stock numeric(14,2) NOT NULL DEFAULT 0, minimo numeric(14,2) NOT NULL DEFAULT 0, costo numeric(14,2) NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS movimientos (
  id serial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(),
  codigo text NOT NULL REFERENCES materiales(codigo), obra_id text NOT NULL REFERENCES obras(id),
  tipo text NOT NULL CHECK (tipo IN ('ingreso','egreso')), cantidad numeric(14,2) NOT NULL CHECK (cantidad > 0), responsable text NOT NULL);
CREATE TABLE IF NOT EXISTS solicitudes (
  id serial PRIMARY KEY, creado timestamptz NOT NULL DEFAULT now(),
  codigo text NOT NULL REFERENCES materiales(codigo), obra_id text NOT NULL REFERENCES obras(id),
  cantidad numeric(14,2) NOT NULL CHECK (cantidad > 0), monto numeric(14,2) NOT NULL, nivel text NOT NULL,
  estado text NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Aprobada','Rechazada')),
  excede boolean NOT NULL DEFAULT false, ia boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS idx_mov_codigo_ts ON movimientos(codigo, ts);
