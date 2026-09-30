import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------- 素材域（仅 publish-materials.ts / 运行时兜底生成写入）----------

export const decks = pgTable("decks", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  exam: text("exam"),
  defaultDailyNewLimit: integer("default_daily_new_limit").notNull().default(10),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const words = pgTable("words", {
  id: serial("id").primaryKey(),
  word: text("word").notNull().unique(),
  phonetic: text("phonetic"),
  translation: text("translation").notNull(),
  definition: text("definition"),
  pos: text("pos"),
  bnc: integer("bnc"),
  frq: integer("frq"),
  inflections: jsonb("inflections"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deckWords = pgTable(
  "deck_words",
  {
    deckId: integer("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    wordId: integer("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(), // 词书内顺序（= 词频序）
  },
  (t) => [
    primaryKey({ columns: [t.deckId, t.wordId] }),
    index("idx_deck_words_deck_ord").on(t.deckId, t.ord),
  ]
);

export const wordRelations = pgTable(
  "word_relations",
  {
    id: serial("id").primaryKey(),
    wordId: integer("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    relatedWordId: integer("related_word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    relation: text("relation").notNull(), // 'inflection' | 'derivative'
  },
  (t) => [
    uniqueIndex("uq_word_relations").on(t.wordId, t.relatedWordId),
    index("idx_relations_related").on(t.relatedWordId),
  ]
);

export const wordExplanations = pgTable("word_explanations", {
  id: serial("id").primaryKey(),
  wordId: integer("word_id")
    .notNull()
    .unique()
    .references(() => words.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  status: text("status").notNull().default("pending"), // pending|ready|failed
  content: jsonb("content"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  origin: text("origin").notNull().default("pipeline"), // pipeline|client|server
  generatedBy: integer("generated_by").references(() => users.id),
  retryCount: integer("retry_count").notNull().default(0),
  lastError: text("last_error"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
});

// ---------- 用户域（仅运行时 API 写入，publish 永不触碰）----------

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  githubId: text("github_id").notNull().unique(),
  githubLogin: text("github_login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userDecks = pgTable(
  "user_decks",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deckId: integer("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    dailyNewLimit: integer("daily_new_limit").notNull().default(10),
    active: boolean("active").notNull().default(true),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deckId] })]
);

export const cardProgress = pgTable(
  "card_progress",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wordId: integer("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    state: smallint("state").notNull().default(0), // 0New 1Learning 2Review 3Relearning
    due: timestamp("due", { withTimezone: true }).notNull(),
    stability: real("stability").notNull().default(0),
    difficulty: real("difficulty").notNull().default(0),
    elapsedDays: integer("elapsed_days").notNull().default(0),
    scheduledDays: integer("scheduled_days").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    lastReview: timestamp("last_review", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.wordId] }),
    index("idx_card_progress_user_due").on(t.userId, t.due),
  ]
);

export const reviewLogs = pgTable(
  "review_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wordId: integer("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    grade: smallint("grade").notNull(), // 1Again 2Hard 3Good 4Easy
    state: smallint("state"),
    due: timestamp("due", { withTimezone: true }),
    stability: real("stability"),
    difficulty: real("difficulty"),
    elapsedDays: integer("elapsed_days"),
    scheduledDays: integer("scheduled_days"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull().default("card"), // card|quiz_choice|quiz_spell|quiz_cloze
  },
  (t) => [index("idx_review_logs_user_time").on(t.userId, t.reviewedAt)]
);

export const quizRecords = pgTable("quiz_records", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  wordId: integer("word_id")
    .notNull()
    .references(() => words.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // choice|spell|cloze
  question: jsonb("question"),
  answer: text("answer"),
  correct: boolean("correct").notNull(),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userSettings = pgTable(
  "user_settings",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // 'llm' | 'fsrs'
    value: jsonb("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })]
);
