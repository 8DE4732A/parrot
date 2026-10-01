/**
 * 表结构初始化：本地 PGLite 无 drizzle-kit push 流程，首次访问时执行 DDL。
 * 生产（Neon）不走此路径——用 drizzle-kit 迁移。
 */
import { db, client } from "./db";

let ensured: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      if (process.env.DATABASE_URL) return; // 生产由 drizzle-kit 管理
      // PGLite 的 exec 支持多语句 DDL（simple query protocol）
      await (client as { exec: (q: string) => Promise<unknown> }).exec(DDL);
    })();
  }
  return ensured;
}

export const DDL = `
CREATE TABLE IF NOT EXISTS decks (
  id serial PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL,
  description text, exam text, default_daily_new_limit integer NOT NULL DEFAULT 10,
  display_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS words (
  id serial PRIMARY KEY, word text NOT NULL UNIQUE, phonetic text, phonetic_us text, translation text NOT NULL,
  definition text, pos text, bnc integer, frq integer, inflections jsonb, source text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS deck_words (
  deck_id integer NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  word_id integer NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  ord integer NOT NULL, PRIMARY KEY (deck_id, word_id));
CREATE INDEX IF NOT EXISTS idx_deck_words_deck_ord ON deck_words (deck_id, ord);
CREATE TABLE IF NOT EXISTS word_relations (
  id serial PRIMARY KEY,
  word_id integer NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  related_word_id integer NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  relation text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_word_relations ON word_relations (word_id, related_word_id);
CREATE INDEX IF NOT EXISTS idx_relations_related ON word_relations (related_word_id);
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY, github_id text NOT NULL UNIQUE, github_login text NOT NULL,
  name text, avatar_url text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS user_decks (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id integer NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  daily_new_limit integer NOT NULL DEFAULT 10, active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, deck_id));
CREATE TABLE IF NOT EXISTS word_explanations (
  id serial PRIMARY KEY, word_id integer NOT NULL UNIQUE REFERENCES words(id) ON DELETE CASCADE,
  model text NOT NULL, status text NOT NULL DEFAULT 'pending', content jsonb,
  prompt_tokens integer, completion_tokens integer, origin text NOT NULL DEFAULT 'pipeline',
  generated_by integer REFERENCES users(id), retry_count integer NOT NULL DEFAULT 0,
  last_error text, generated_at timestamptz);
CREATE TABLE IF NOT EXISTS card_progress (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id integer NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  state smallint NOT NULL DEFAULT 0, due timestamptz NOT NULL,
  stability real NOT NULL DEFAULT 0, difficulty real NOT NULL DEFAULT 0,
  elapsed_days integer NOT NULL DEFAULT 0, scheduled_days integer NOT NULL DEFAULT 0,
  reps integer NOT NULL DEFAULT 0, lapses integer NOT NULL DEFAULT 0,
  last_review timestamptz, PRIMARY KEY (user_id, word_id));
CREATE INDEX IF NOT EXISTS idx_card_progress_user_due ON card_progress (user_id, due);
CREATE TABLE IF NOT EXISTS review_logs (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id integer NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  grade smallint NOT NULL, state smallint, due timestamptz, stability real, difficulty real,
  elapsed_days integer, scheduled_days integer,
  reviewed_at timestamptz NOT NULL DEFAULT now(), source text NOT NULL DEFAULT 'card');
CREATE INDEX IF NOT EXISTS idx_review_logs_user_time ON review_logs (user_id, reviewed_at);
CREATE TABLE IF NOT EXISTS quiz_records (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id integer NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  type text NOT NULL, question jsonb, answer text, correct boolean NOT NULL,
  duration_ms integer, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS user_settings (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL, value jsonb NOT NULL, PRIMARY KEY (user_id, key));
`;
