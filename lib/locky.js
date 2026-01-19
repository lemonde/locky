// @ts-check
const EventEmitter = require("events");
const { callbackify } = require("util");
const redis = require("redis");
const resourceKey = require("./resource-key");

/** @typedef {ReturnType<typeof import('redis').createClient>} RedisClient */

/**
 * @typedef RedisPromises
 * @property {ReturnType<import('util').promisify<RedisClient["get"]>>} get
 * @property {ReturnType<import('util').promisify<RedisClient["set"]>>} set
 * @property {ReturnType<import('util').promisify<RedisClient["sAdd"]>>} sAdd
 * @property {ReturnType<import('util').promisify<RedisClient["pexpire"]>>} pexpire
 * @property {ReturnType<import('util').promisify<RedisClient["quit"]>>} quit
 * @property {ReturnType<import('util').promisify<RedisClient["smembers"]>>} smembers
 * @property {ReturnType<import('util').promisify<RedisClient["del"]>>} del
 * @property {ReturnType<import('util').promisify<RedisClient["watch"]>>} watch
 */

/** @typedef {RedisClient & { promises: RedisPromises }} AsyncRedisClient */

class InitError extends Error {
  constructor() {
    super("Redis client is not initialized");
    this.name = "InitError";
  }
}

/**
 * @typedef LockyOptions
 * @property {import('redis').RedisClientOptions | (() => RedisClient)} [redis]
 * @property {string} [prefix]
 * @property {number} [ttl]
 */

class Locky extends EventEmitter {
  /**
   * @param {LockyOptions} [options]
   */
  constructor(options = {}) {
    super();

    /** @type {Promise<any>[]} */
    this.pendingOperations = [];

    /** @type {string} */
    this.prefix = options.prefix ?? "locky:";

    /** @type {string} */
    this.currentLocksKey = `${this.prefix}current:locks`;

    /** @type {number | null} */
    this.ttl = options.ttl ?? null;

    /** @type {() =>  Promise<RedisClient>} */
    this.createRedisClient = async () => {
      const client =
        typeof options.redis === "function"
          ? options.redis()
          : redis.createClient(options.redis);

      await client.connect();

      client.on("error", (error) => {
        this.emit("error", error);
      });

      return client;
    };

    /** @type {{ redis: RedisClient, timeout?: NodeJS.Timeout }} */
    this.expirationWorker;
  }

  async init() {
    /** @type {RedisClient} */
    this.redis = await this.createRedisClient();
  }

  /**
   * @template {Function} T
   * @param {T} execOperation
   * @returns {Promise<ReturnType<T>>}
   */
  async runOperation(execOperation) {
    if (this.closing) {
      throw new Error("Locky is closing");
    }
    const promise = Promise.resolve(execOperation()).finally(() => {
      const index = this.pendingOperations.indexOf(promise);
      this.pendingOperations.splice(index, 1);
    });
    this.pendingOperations.push(promise);
    return promise;
  }

  /**
   * Emit in asynchronous to avoid synchronous errors.
   * @param {string} event
   * @param {...any} args
   * @returns {Promise<void>}
   */
  asyncEmit(event, ...args) {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.emit(event, ...args);
        resolve();
      });
    });
  }

  /**
   * Try to lock a resource using a locker identifier.
   *
   * @param {object} params
   * @param {string} params.resource Resource identifier to lock
   * @param {string} params.locker Locker identifier
   * @param {boolean} [params.force] Force gaining lock even if it's taken
   * @param {(err?: Error, res?: boolean) => void} [callback]
   */
  lock(params, callback) {
    if (typeof callback === "function") {
      callbackify(this.lockPromise.bind(this, params))(callback);
      return;
    }
    return this.lockPromise(params);
  }

  /**
   * Try to lock a resource using a locker identifier.
   *
   * @param {object} params
   * @param {string} params.resource Resource identifier to lock
   * @param {string} params.locker Locker identifier
   * @param {boolean} [params.force] Force gaining lock even if it's taken
   */
  async lockPromise({ resource, locker, force }) {
    return this.runOperation(async () => {
      if (!this.redis) {
        throw new InitError();
      }
      // Format key with resource id.
      const key = resourceKey.format(this.prefix, resource);

      if (!key) return true;
      if (!locker) return true;

      const trx = this.redis.multi();

      trx.sAdd(this.currentLocksKey, key);
      if (force) {
        trx.set(key, String(locker));
      } else {
        trx.set(key, String(locker), { NX: true });
      }
      if (this.ttl) {
        trx.pExpire(key, this.ttl);
      }

      const [, setResult] = await trx.exec();

      const success = setResult !== null;

      if (success) {
        await this.asyncEmit("lock", resource, locker);
      }

      return success;
    });
  }

  /**
   *  Refresh the lock ttl of a resource.
   * @param {string} resource
   * @param {(err?: Error, res?: boolean) => void} [callback]
   */
  refresh(resource, callback) {
    if (typeof callback === "function") {
      callbackify(this.refreshPromise.bind(this, resource))(callback);
      return;
    }
    return this.refreshPromise(resource);
  }

  /**
   * Refresh the lock ttl of a resource.
   * @param {string} resource
   */
  async refreshPromise(resource) {
    return this.runOperation(async () => {
      if (!this.redis) {
        throw new InitError();
      }

      // If there is no TTL, do nothing.
      if (!this.ttl) return true;

      // Format key with resource id.
      const key = resourceKey.format(this.prefix, resource);

      // Set the TTL of the key.
      const expire = await this.redis.pExpire(key, this.ttl);

      return expire === 1;
    });
  }

  /**
   * Unlock a resource.
   * @param {string} resource Resource
   * @param {(err?: Error, res?: boolean) => void} [callback]
   */
  unlock(resource, callback) {
    if (typeof callback === "function") {
      callbackify(this.unlockPromise.bind(this, resource))(callback);
      return;
    }
    return this.unlockPromise(resource);
  }

  /**
   * Unlock a resource.
   * @param {string} resource Resource
   */
  async unlockPromise(resource) {
    return this.runOperation(async () => {
      if (!this.redis) {
        throw new InitError();
      }
      // Format key with resource id.
      const key = resourceKey.format(this.prefix, resource);

      // Remove the ky from the unique set
      const trx = this.redis.multi();
      trx.sRem(this.currentLocksKey, key);
      trx.del(key);
      const [, res] = await trx.exec();

      const success = /** @type {number} */ (/** @type {any} */ (res)) !== 0;

      if (success) {
        await this.asyncEmit("unlock", resource);
      }

      return success;
    });
  }

  /**
   * Return the resource locker.
   * @param {string} resource Resource
   * @param {(err?: Error, res?: string | null) => void} [callback]
   */
  getLocker(resource, callback) {
    if (typeof callback === "function") {
      callbackify(this.getLockerPromise.bind(this))(resource, callback);
      return;
    }
    return this.getLockerPromise(resource);
  }

  /**
   * Return the resource locker.
   * @param {string} resource Resource
   * @returns {Promise<string | null>}
   */
  async getLockerPromise(resource) {
    return this.runOperation(async () => {
      if (!this.redis) {
        throw new InitError();
      }
      return this.redis.get(resourceKey.format(this.prefix, resource));
    });
  }

  /**
   * Close locky client
   * @param {(err?: Error, res?: boolean) => void} [callback]
   */
  close(callback) {
    if (typeof callback === "function") {
      return callbackify(this.closePromise.bind(this))(callback);
    }
    return this.closePromise();
  }

  /**
   * Close locky client
   */
  async closePromise() {
    if (!this.redis) {
      throw new InitError();
    }
    if (this.closing) return;
    this.closing = true;
    if (this.expirationWorker?.timeout) {
      clearTimeout(this.expirationWorker.timeout);
    }
    try {
      await Promise.allSettled(this.pendingOperations);
    } catch (error) {
      // Ignore errors since they are already catched
    }
    if (this.expirationWorker?.timeout) {
      clearTimeout(this.expirationWorker.timeout);
    }
    await Promise.all([
      this.redis.close(),
      this.expirationWorker?.redis.close(),
    ]);
  }

  /**
   * Check for expirations
   * Cluster singleton
   */
  async startExpirateWorker() {
    if (!this.ttl) {
      throw new Error(`You must have set a ttl to start an expiration worker.`);
    }

    if (this.expirationWorker) return;

    this.expirationWorker = {
      redis: await this.createRedisClient(),
    };

    const run = async () => {
      try {
        await this.runOperation(async () => {
          if (!this.redis) {
            throw new InitError();
          }
          const key = `${this.prefix}expirate:worker`;
          const locked = await this.redis.set(key, "OK", {
            NX: true,
            PX: /** @type {number} */ (this.ttl),
          });
          if (locked) {
            await this.expireKeys();
            await this.redis.del(key);
          }
        });
      } catch (error) {
        this.asyncEmit("error", error);
      }

      this.expirationWorker.timeout = setTimeout(
        () => {
          run();
        },
        /** @type {number} */ (this.ttl) / 10,
      );
    };

    run();
  }

  /**
   * Worker that collects expirations to emit them
   */
  async expireKeys() {
    const redisClient = this.expirationWorker.redis;

    const keys = /** @type {string[]} */ (
      await redisClient.sMembers(this.currentLocksKey)
    );

    if (!keys.length) return;

    const ttlBatch = redisClient.multi();
    keys.forEach((key) => ttlBatch.pTTL(key));
    const ttls = /** @type {number[]} */ (
      /** @type {any[]} */ (await ttlBatch.exec())
    );

    const keysToExpire = keys.filter((_, index) => ttls[index] === -2);

    if (keysToExpire.length === 0) return;

    await redisClient.watch(keysToExpire);

    const trx = redisClient.multi();
    trx.sRem(this.currentLocksKey, keysToExpire);
    const results = await trx.exec();

    // Results are null if a watch key has been modified
    // during the transaction execution
    if (results === null) return;

    await Promise.all(
      keysToExpire.map((key) =>
        this.asyncEmit("expire", resourceKey.parse(this.prefix, key)),
      ),
    );
  }
}

/**
 * @param {LockyOptions} [options]
 */
async function createClient(options) {
  const client = new Locky(options);
  await client.init();
  return client;
}

exports.createClient = createClient;
