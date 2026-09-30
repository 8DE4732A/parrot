/**
 * 素材包校验入口（详设 §2.6）
 * M1：扫描 materials/ 下所有包含 manifest.json 的目录，无素材包时直接通过。
 * M2：接入 materials/schema 的 Zod 全量校验（schema/引用完整性/覆盖率/sha256）。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const MATERIALS_DIR = path.resolve(__dirname, "..", "materials");

function main() {
  if (!existsSync(MATERIALS_DIR)) {
    console.log("material:validate — materials/ 不存在，无素材包，通过");
    return;
  }
  const packages = readdirSync(MATERIALS_DIR).filter((name) => {
    const dir = path.join(MATERIALS_DIR, name);
    return statSync(dir).isDirectory() && existsSync(path.join(dir, "manifest.json"));
  });
  if (packages.length === 0) {
    console.log("material:validate — 无素材包，通过");
    return;
  }
  // M2: 在此调用 validatePackage(dir) 逐包校验
  console.log(`material:validate — 发现 ${packages.length} 个素材包，M2 接入全量校验，暂通过`);
}

main();
