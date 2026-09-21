import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

/**
 * The event table is append-only. Nothing in this service ever UPDATEs an event
 * row, including when an anonymous visitor logs in: stitching is a separate
 * resolution table joined at read time, so a bad merge is reversible and the
 * raw record of what the device sent is never lost.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  event_id         TEXT PRIMARY KEY,          -- client-generated UUIDv7: the idempotency key
  event_name       TEXT NOT NULL,
  schema_version   INTEGER NOT NULL,
  occurred_at      TEXT NOT NULL,             -- clamped into a plausible window
  occurred_at_raw  TEXT NOT NULL,             -- exactly what the device sent
  clock_skew_ms    INTEGER NOT NULL,
  clamped          INTEGER NOT NULL,
  received_at      TEXT NOT NULL,
  anonymous_id     TEXT NOT NULL,
  customer_id      TEXT,
  session_id       TEXT NOT NULL,
  surface          TEXT NOT NULL,
  app_version      TEXT NOT NULL,
  feed_request_id  TEXT,
  payload          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_anon     ON events(anonymous_id);
CREATE INDEX IF NOT EXISTS events_by_customer ON events(customer_id);
CREATE INDEX IF NOT EXISTS events_by_name_ts  ON events(event_name, occurred_at);
CREATE INDEX IF NOT EXISTS events_by_feed     ON events(feed_request_id);

CREATE TABLE IF NOT EXISTS identity_resolutions (
  anonymous_id  TEXT NOT NULL,
  customer_id   TEXT NOT NULL,
  resolved_at   TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  PRIMARY KEY (anonymous_id, customer_id)
);

CREATE TABLE IF NOT EXISTS ingest_rejections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at  TEXT NOT NULL,
  event_id     TEXT,
  reason       TEXT NOT NULL,
  raw          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_counters (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
);
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  return db;
}

export function bumpCounter(db: DB, name: string, by: number): void {
  if (by === 0) return;
  db.prepare(
    `INSERT INTO ingest_counters(name, value) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET value = value + excluded.value`,
  ).run(name, by);
}
