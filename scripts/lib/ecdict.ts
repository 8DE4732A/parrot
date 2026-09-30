/** ECDICT SQLite 读取封装（node:sqlite，同步） */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export const WORK_DIR = path.resolve(__dirname, "..", ".work");

let db: DatabaseSync | null = null;

export function openEcdict(): DatabaseSync {
  if (!db) {
    const file = path.join(WORK_DIR, "stardict.db");
    db = new DatabaseSync(file, { readOnly: true });
  }
  return db;
}

export interface EcdictRow {
  word: string;
  phonetic: string | null;
  translation: string | null;
  definition: string | null;
  pos: string | null;
  tag: string | null;
  bnc: number | null;
  frq: number | null;
  exchange: string | null;
}

const COLS = "word, phonetic, translation, definition, pos, tag, bnc, frq, exchange";

export function queryByTag(db: DatabaseSync, tag: string): EcdictRow[] {
  return db
    .prepare(`SELECT ${COLS} FROM stardict WHERE tag LIKE ?`)
    .all(`%${tag}%`) as unknown as EcdictRow[];
}

export function queryWords(db: DatabaseSync, words: string[]): Map<string, EcdictRow> {
  const map = new Map<string, EcdictRow>();
  const stmt = db.prepare(`SELECT ${COLS} FROM stardict WHERE word = ? COLLATE NOCASE`);
  for (const w of words) {
    const row = stmt.get(w) as EcdictRow | undefined;
    if (row) map.set(row.word.toLowerCase(), row);
  }
  return map;
}

/** 挖掘候选漏词：无 tag、BNC 排名在区间内、非专名 */
export function queryUntaggedByBnc(
  db: DatabaseSync,
  minBnc: number,
  maxBnc: number
): EcdictRow[] {
  return db
    .prepare(
      `SELECT ${COLS} FROM stardict
       WHERE (tag IS NULL OR tag = '')
         AND bnc >= ? AND bnc <= ?
         AND word NOT GLOB '* *'
         AND word GLOB '[a-z]*'
       ORDER BY bnc`
    )
    .all(minBnc, maxBnc) as unknown as EcdictRow[];
}

/**
 * 解析 ECDICT exchange 字段为词形变化对象。
 * 格式：p:took/d:taken/i:taking/3:takes/s:takes/r:rounder/t:roundest/0:round/1:rounded
 */
export function parseExchange(
  exchange: string | null
): Record<string, string> | undefined {
  if (!exchange) return undefined;
  const keyMap: Record<string, string> = {
    p: "past",
    d: "pastParticiple",
    i: "presentParticiple",
    "3": "thirdPerson",
    s: "plural",
    r: "comparative",
    t: "superlative",
    "0": "lemma",
    "1": "lemma",
  };
  const out: Record<string, string> = {};
  for (const seg of exchange.split("/")) {
    const [code, ...rest] = seg.split(":");
    const key = keyMap[code];
    const value = rest.join(":");
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
