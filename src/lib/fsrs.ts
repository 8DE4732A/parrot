/**
 * ts-fsrs 封装（详设 §8）：DB 行 ↔ Card 转换 + 调度器
 */
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card,
  type CardInput,
  type Grade,
  type RecordLogItem,
  type State,
} from "ts-fsrs";

const DEFAULT_REQUEST_RETENTION = 0.9;

export function createScheduler(requestRetention = DEFAULT_REQUEST_RETENTION) {
  return fsrs(
    generatorParameters({
      request_retention: requestRetention,
      enable_fuzz: true,
      enable_short_term: false, // 背单词按天粒度，跳过分钟级短期循环
    })
  );
}

/** card_progress 行形状（与 DB 列一一对应） */
export interface CardRow {
  state: number;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  lastReview: Date | null;
}

export function toCard(row: CardRow): CardInput {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.lastReview ?? undefined,
    learning_steps: 0, // enable_short_term:false 下无分钟级学习步骤，恒为 0
  };
}

export function rowFromCard(
  card: Card
): Omit<CardRow, "lastReview"> & { lastReview: Date | null } {
  return {
    state: card.state,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review ?? null,
  };
}

export function newCard(now = new Date()): Card {
  return createEmptyCard(now) as Card;
}

/** 评分调度：返回 card（写 card_progress）与 log（写 review_logs） */
export function reviewCard(
  row: CardRow | null,
  grade: Grade,
  now = new Date(),
  requestRetention = DEFAULT_REQUEST_RETENTION
): RecordLogItem {
  const scheduler = createScheduler(requestRetention);
  if (!row) {
    // 新词首学：createEmptyCard 后直接评分
    const empty = newCard(now);
    return scheduler.next(empty, now, grade);
  }
  return scheduler.next(toCard(row), now, grade);
}
