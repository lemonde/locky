const { promisify } = require("util");
const redis = require("redis");
const locky = require("../lib/locky");

const createLocky = (options = {}) => {
  return locky.createClient({
    redis: {
      host: process.env.REDIS_HOST ?? undefined,
      port: process.env.REDIS_PORT ?? undefined,
    },
    ...options,
  });
};

describe("Locky", () => {
  let locky;
  let testRedis;

  beforeEach(async () => {
    locky = null;

    testRedis = redis.createClient({
      host: process.env.REDIS_HOST ?? undefined,
      port: process.env.REDIS_PORT ?? undefined,
    });
    testRedis.setAsync = promisify(testRedis.set.bind(testRedis));
    testRedis.smembersAsync = promisify(testRedis.smembers.bind(testRedis));
    testRedis.delAsync = promisify(testRedis.del.bind(testRedis));
    testRedis.ttlAsync = promisify(testRedis.ttl.bind(testRedis));
    testRedis.existsAsync = promisify(testRedis.exists.bind(testRedis));
    testRedis.quitAsync = promisify(testRedis.quit.bind(testRedis));

    const keys = await testRedis.smembersAsync("locky:current:locks");
    await testRedis.delAsync([...keys, "locky:current:locks"]);
  });

  afterEach(async () => {
    if (locky) {
      await locky.close();
    }
    await testRedis.quitAsync();
  });

  describe("#lock", () => {
    it("locks", async () => {
      locky = createLocky();

      const res = await locky.lock({
        resource: "article1",
        locker: "john",
      });
      expect(res).toBe(true);
      const batch = testRedis
        .batch()
        .get("lock:resource:article1")
        .ttl("lock:resource:article1");
      const [value, ttl] = await promisify(batch.exec.bind(batch))();

      expect(value).toBe("john");
      expect(ttl).toBe(-1);
    });

    it("does not lock if already locked by another resource", async () => {
      locky = createLocky();

      const handleLock = jest.fn();
      locky.on("lock", handleLock);

      const res = await locky.lock({
        resource: "article2",
        locker: "john",
      });

      expect(res).toBe(true);
      expect(handleLock).toHaveBeenCalledTimes(1);
      expect(handleLock).toHaveBeenCalledWith("article2", "john");

      const secondRes = await locky.lock({
        resource: "article2",
        locker: "ryan",
      });
      expect(secondRes).toBe(false);
    });

    it("locks if already locked by another resource and forced", async () => {
      locky = createLocky();

      const handleLock = jest.fn();
      locky.on("lock", handleLock);

      const res = await locky.lock({
        resource: "article2",
        locker: "john",
      });

      expect(res).toBe(true);
      expect(handleLock).toHaveBeenCalledTimes(1);
      expect(handleLock).toHaveBeenCalledWith("article2", "john");

      const secondRes = await locky.lock({
        resource: "article2",
        locker: "ryan",
        force: true,
      });
      expect(secondRes).toBe(true);
      expect(handleLock).toHaveBeenCalledTimes(2);
      expect(handleLock).toHaveBeenCalledWith("article2", "ryan");
    });

    it("sets the correct ttl", async () => {
      locky = createLocky({ ttl: 10000 });

      const res = await locky.lock({
        resource: "article3",
        locker: "john",
      });
      expect(res).toBe(true);

      const ttl = await testRedis.ttlAsync("lock:resource:article3");
      expect(ttl).toBeLessThanOrEqual(10);
    });
  });

  describe("#startExpireWorker", () => {
    it("emits an expire event when the lock expire", async () => {
      const handleExpire = jest.fn();
      locky = createLocky({ ttl: 100 });
      locky.on("expire", handleExpire);
      locky.startExpirateWorker();

      const res = await locky.lock({
        resource: "article4",
        locker: "john",
      });
      expect(res).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(handleExpire).toHaveBeenCalledTimes(1);
      expect(handleExpire).toHaveBeenCalledWith("article4");
    });
  });

  describe("#refresh", () => {
    it("refreshes the ttl of a key", async () => {
      locky = createLocky({ ttl: 30000 });

      const trx = testRedis.multi();
      trx.set("lock:resource:article7", "john");
      trx.pexpire("lock:resource:article7", 20000);
      await promisify(trx.exec.bind(trx))();

      const res = await locky.refresh("article7");

      expect(res).toBe(true);

      const ttl = await testRedis.ttlAsync("lock:resource:article7");

      expect(ttl).toBeLessThanOrEqual(30);
    });
  });

  describe("#unlock", () => {
    it("removes the key", async () => {
      locky = createLocky();

      await testRedis.setAsync("lock:resource:article10", "john");

      const res = await locky.unlock("article10");

      expect(res).toBe(true);

      const exists = await testRedis.existsAsync("lock:resource:article10");
      expect(exists).toBe(0);
    });

    it('emits a "unlock" event', async () => {
      locky = createLocky();

      const handleUnlock = jest.fn();
      locky.on("unlock", handleUnlock);

      await testRedis.setAsync("lock:resource:article11", "john");

      const res = await locky.unlock("article11");

      expect(res).toBe(true);

      expect(handleUnlock).toHaveBeenCalledTimes(1);
      expect(handleUnlock).toHaveBeenCalledWith("article11");
    });

    it('does not emit a "unlock" event if the resource is not locked', async () => {
      locky = createLocky();

      const handleUnlock = jest.fn();
      locky.on("unlock", handleUnlock);

      const res = await locky.unlock("article12");
      expect(res).toBe(false);

      expect(handleUnlock).not.toHaveBeenCalled();
    });

    it('does not expire if we "unlock"', async () => {
      locky = createLocky({ ttl: 300 });

      const handleExpire = jest.fn();
      locky.on("expire", handleExpire);

      await locky.lock({
        resource: "article13",
        locker: "john",
      });

      await locky.unlock("article13");
      locky.startExpirateWorker();

      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(handleExpire).not.toHaveBeenCalled();
    });
  });

  describe("#getLocker", () => {
    it("returns locker", async () => {
      locky = createLocky();

      await locky.lock({
        resource: "article14",
        locker: "john",
      });

      expect(await locky.getLocker("article14")).toBe("john");
      expect(await locky.getLocker("unknown")).toBe(null);
    });
  });
});
