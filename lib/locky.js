// @ts-check
const EventEmitter = require("events");
const { promisify, callbackify } = require("util");
const redis = require("redis");
const resourceKey = require("./resource-key");

/** @typedef {import('redis').RedisClient} RedisClient */

/**
 * @typedef RedisPromises
 * @property {ReturnType<import('util').promisify<RedisClient["get"]>>} get
 * @property {ReturnType<import('util').promisify<RedisClient["pexpire"]>>} pexpire
 * @property {ReturnType<import('util').promisify<RedisClient["quit"]>>} quit
 * @property {ReturnType<import('util').promisify<RedisClient["smembers"]>>} smembers
 * @property {ReturnType<import('util').promisify<RedisClient["ttl"]>>} ttl
 * @property {ReturnType<import('util').promisify<RedisClient["del"]>>} del
 * @property {ReturnType<import('util').promisify<RedisClient["watch"]>>} watch
 */

/** @typedef {RedisClient & { promises: RedisPromises }} AsyncRedisClient */

/**
 * @param {RedisClient} client
 */
const promisifyRedisClient = (client) => {
  const promises = {
    get: promisify(client.get.bind(client)),
    pexpire: promisify(client.pexpire.bind(client)),
    quit: promisify(client.quit.bind(client)),
    smembers: promisify(client.smembers.bind(client)),
    del: promisify(client.del.bind(client)),
    watch: promisify(client.watch.bind(client)),
    ttl: promisify(client.pttl.bind(client)),
  };

  /** @type {AsyncRedisClient} */ (client).promises = promises;
  return /** @type {AsyncRedisClient} */ (client);
};

/**
 * @typedef LockyOptions
 * @property {import('redis').ClientOpts | (() => RedisClient)} [redis]
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

    /** @type {() => AsyncRedisClient} */
    this.createRedisClient = () => {
      const client =
        typeof options.redis === "function"
          ? options.redis()
          : redis.createClient(options.redis);

      client.on("error", (error) => {
        this.emit("error", error);
      });

      return promisifyRedisClient(client);
    };

    /** @type {AsyncRedisClient} */
    this.redis = this.createRedisClient();

    /** @type {{ redis: AsyncRedisClient, timeout?: NodeJS.Timeout }} */
    this.expirationWorker;
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
      // Format key with resource id.
      const key = resourceKey.format(this.prefix, resource);

      if (!key) return true;
      if (!locker) return true;

      const trx = this.redis.multi();

      trx.sadd(this.currentLocksKey, key);
      if (force) {
        trx.set(key, String(locker));
      } else {
        trx.setnx(key, String(locker));
      }
      if (this.ttl) {
        trx.pexpire(key, this.ttl);
      }

      const [, setResult] = await promisify(trx.exec.bind(trx))();

      const success = setResult !== 0;

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
      // If there is no TTL, do nothing.
      if (!this.ttl) return true;

      // Format key with resource id.
      const key = resourceKey.format(this.prefix, resource);

      // Set the TTL of the key.
      const res = await this.redis.promises.pexpire(key, this.ttl);

      return res === 1;
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
      // Format key with resource id.
      const key = resourceKey.format(this.prefix, resource);

      // Remove the ky from the unique set
      const trx = this.redis.multi();
      trx.srem(this.currentLocksKey, key);
      trx.del(key);
      const [, res] = await promisify(trx.exec.bind(trx))();

      const success = res !== 0;

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
      return this.redis.promises.get(resourceKey.format(this.prefix, resource));
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
      this.redis.promises.quit(),
      this.expirationWorker?.redis.quit(),
    ]);
  }

  /**
   * Check for expirations
   * Cluster singleton
   */
  startExpirateWorker() {
    if (!this.ttl) {
      throw new Error(`You must have set a ttl to start an expiration worker.`);
    }

    if (this.expirationWorker) return;

    this.expirationWorker = {
      redis: this.createRedisClient(),
    };

    const run = async () => {
      try {
        await this.runOperation(async () => {
          const trx = this.expirationWorker.redis.multi();
          const key = `${this.prefix}expirate:worker`;
          const ttlWorker = await this.redis.promises.ttl(key);

          trx.setnx(key, "OK");
          if (ttlWorker === -2) { //the key does not exist, avoid override (eq. NX)
            trx.pexpire(key, /** @type {number} */ (this.ttl));
          }
          const [locked] = await promisify(trx.exec.bind(trx))();

          if (locked) {
            await this.expireKeys();
            await this.redis.promises.del(key);
          }
        });
      } catch (error) {
        this.asyncEmit("error", error);
      }

      this.expirationWorker.timeout = setTimeout(() => {
        run();
      }, /** @type {number} */ (this.ttl) / 10);
    };

    run();
  }

  /**
   * Worker that collects expirations to emit them
   */
  async expireKeys() {
    const redisClient = this.expirationWorker.redis;

    const keys = /** @type {string[]} */ (
      await redisClient.promises.smembers(this.currentLocksKey)
    );

    if (!keys.length) return;

    const ttlBatch = redisClient.batch();
    keys.forEach((key) => ttlBatch.pttl(key));
    const ttls = await promisify(ttlBatch.exec.bind(ttlBatch))();

    const keysToExpire = keys.filter((_, index) => ttls[index] === -2);

    if (keysToExpire.length === 0) return;

    await redisClient.promises.watch(keysToExpire);

    const trx = redisClient.multi();
    trx.srem(this.currentLocksKey, keysToExpire);
    const results = await promisify(trx.exec.bind(trx))();

    // Results are null if a watch key has been modified
    // during the transaction execution
    if (results === null) return;

    await Promise.all(
      keysToExpire.map((key) =>
        this.asyncEmit("expire", resourceKey.parse(this.prefix, key))
      )
    );
  }
}

/**
 * @param {LockyOptions} [options]
 */
function createClient(options) {
  return new Locky(options);
}

exports.createClient = createClient;
