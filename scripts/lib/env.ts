/** 流水线脚本统一加载 .env.local（shell source 无法处理含 & 的 URL） */
import { config } from "dotenv";

config({ path: ".env.local" });
