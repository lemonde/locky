const roomKey = require("../lib/resource-key");

describe("Resource key", () => {
  describe("#format", () => {
    it("formats key", () => {
      expect(roomKey.format("article")).toBe("lock:resource:article");
    });
  });

  describe("#parse", () => {
    it("parses key", () => {
      expect(roomKey.parse("lock:resource:article")).toBe("article");
    });
  });

  it("is symetrics", () => {
    expect(roomKey.parse(roomKey.format("article"))).toBe("article");
  });
});
