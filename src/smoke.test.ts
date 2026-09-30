import { describe, expect, it } from "vitest";

// M1 冒烟测试：验证测试链路本身；M2 起被 fsrs/queue/schema 单测充实
describe("smoke", () => {
  it("vitest 工作正常", () => {
    expect(1 + 1).toBe(2);
  });
});
