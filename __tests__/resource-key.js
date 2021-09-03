const roomKey = require("../lib/resource-key");

const PREFIX = "locky:";

describe("Resource key", () => {
  describe("#format", () => {
    it("formats key", () => {
      expect(roomKey.format(PREFIX, "article")).toBe("locky:lock:article");
    });
  });

  describe("#parse", () => {
    it("parses key", () => {
      expect(roomKey.parse(PREFIX, "locky:lock:article")).toBe("article");
    });
  });

  it("is symetrics", () => {
    expect(roomKey.parse(PREFIX, roomKey.format(PREFIX, "article"))).toBe(
      "article"
    );
  });
});
