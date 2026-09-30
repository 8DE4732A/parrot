/** 素材包校验 CLI（package.json 的 material:validate） */
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

import { validatePackage } from "../materials/schema";

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

  let failed = false;
  for (const slug of packages) {
    const issues = validatePackage(path.join(MATERIALS_DIR, slug));
    if (issues.length === 0) {
      console.log(`✅ ${slug}: 校验通过`);
    } else {
      failed = true;
      console.error(`❌ ${slug}: ${issues.length} 个问题`);
      for (const issue of issues.slice(0, 20))
        console.error(`   [规则${issue.rule}] ${issue.message}`);
      if (issues.length > 20) console.error(`   ... 共 ${issues.length} 个`);
    }
  }
  if (failed) process.exit(1);
  console.log(`material:validate — ${packages.length} 个素材包全部通过`);
}

main();
