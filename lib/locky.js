// @ts-check
const EventEmitter = require("events");
const { promisify, callbackify } = require("util");
const redis = require("redis");
const resourceKey = require("./resource-key");

/**
 * @typedef LockyOptions
 * @property {import('redis').ClientOpts | (() => import('redis').RedisClient)} [redis]
 * @property {string} [set]
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

    this.set = options.set ?? "locky:current:locks";
    this.ttl = options.ttl ?? null;
    this.redis =
      typeof options.redis === "function"
        ? options.redis()
        : redis.createClient(options.redis);
    this.getAsync = promisify(this.redis.get.bind(this.redis));
    this.pexpireAsync = promisify(this.redis.pexpire.bind(this.redis));
    this.quitAsync = promisify(this.redis.quit.bind(this.redis));
    this.smembersAsync = promisify(this.redis.smembers.bind(this.redis));
    this.delAsync = promisify(this.redis.del.bind(this.redis));

    this.expirateResource = "locky:expirate:worker";

    /** @type {Promise<any> | null} */
    this.expirationWorkerPromise = null;
    /** @type {NodeJS.Timeout | null} */
    this.expirationWorkerTimeout = null;

    this.redis.on("error", (error) => {
      this.emit("error", error);
    });
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
   * @param {string | number} params.resource Resource identifier to lock
   * @param {string | number} params.locker Locker identifier
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
   * @param {string | number} params.resource Resource identifier to lock
   * @param {string | number} params.locker Locker identifier
   * @param {boolean} [params.force] Force gaining lock even if it's taken
   */
  async lockPromise({ resource, locker, force }) {
    return this.runOperation(async () => {
      // Format key with resource id.
      const key = resourceKey.format(resource);

      if (!key) return true;
      if (!locker) return true;

      const trx = this.redis.multi();

      trx.sadd(this.set, key);
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
      const key = resourceKey.format(resource);

      // Set the TTL of the key.
      const res = await this.pexpireAsync(key, this.ttl);

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
      const key = resourceKey.format(resource);

      // Remove the ky from the unique set
      const trx = this.redis.multi();
      trx.srem(this.set, key);
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
      return this.getAsync(resourceKey.format(resource));
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
    if (this.expirationWorkerTimeout) {
      clearTimeout(this.expirationWorkerTimeout);
    }
    try {
      await Promise.allSettled(this.pendingOperations);
    } catch (error) {
      // Ignore errors since they are already catched
    }
    if (this.expirationWorkerTimeout) {
      clearTimeout(this.expirationWorkerTimeout);
    }
    await this.quitAsync();
  }

  /**
   * Check for expirations
   * Cluster singleton
   */
  startExpirateWorker() {
    if (!this.ttl) {
      throw new Error(`You must have set a ttl to start an expiration worker.`);
    }

    if (this.expirationWorkerPromise) return;

    const run = async () => {
      try {
        await this.runOperation(async () => {
          const trx = this.redis.multi();
          trx.setnx(this.expirateResource, "OK");
          trx.pexpire(this.expirateResource, /** @type {number} */ (this.ttl));
          const [locked] = await promisify(trx.exec.bind(trx))();

          if (locked) {
            await this.expireKeys();
            // @ts-ignore
            await this.delAsync(this.expirateResource);
          }
        });
      } catch (error) {
        this.asyncEmit("error", error);
      }

      this.expirationWorkerTimeout = setTimeout(() => {
        this.expirationWorkerPromise = run();
      }, /** @type {number} */ (this.ttl) / 10);
    };

    this.expirationWorkerPromise = run();
  }

  /**
   * Worker that collects expirations to emit them
   */
  async expireKeys() {
    const keys = await this.smembersAsync(this.set);
    if (!keys.length) return;

    const ttlBatch = this.redis.batch();
    keys.forEach((key) => ttlBatch.pttl(key));
    const ttls = await promisify(ttlBatch.exec.bind(ttlBatch))();

    const keysToExpire = keys.filter((_, index) => ttls[index] === -2);

    if (keysToExpire.length === 0) return;

    const trx = this.redis.multi();
    trx.watch(keysToExpire);
    trx.srem(this.set, keysToExpire);
    await promisify(trx.exec.bind(trx))();

    await Promise.all(
      keysToExpire.map((key) =>
        this.asyncEmit("expire", resourceKey.parse(key))
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
