/** 调试：查 PGLite 内容 */
import { PGlite } from "@electric-sql/pglite";

async function main() {
  const pg = new PGlite(".pglite");
  const decks = await pg.query("SELECT id, slug, name FROM decks");
  console.log("decks:", JSON.stringify(decks.rows));
  const words = await pg.query("SELECT COUNT(*) AS n FROM words");
  console.log("words:", JSON.stringify(words.rows));
  const exp = await pg.query("SELECT COUNT(*) AS n FROM word_explanations");
  console.log("explanations:", JSON.stringify(exp.rows));
  process.exit(0);
}
main();
