/**
 * Module dependencies.
 */

const EventEmitter = require('events').EventEmitter;
const _ = require('lodash');
const redis = require('then-redis');
const resourceKey = require('./resource-key');
const nodeify = require('promise-nodeify');

/**
 * Create a new Locky client.
 *
 * @param {object} options
 * @param {function|object} options.redis
 * @param {number} options.ttl
 */

class Locky extends EventEmitter {
  constructor(options = {}) {
    super();

    options = _.defaults(options, {
      ttl: null,
      redis: {}
    });

    this.set = options.set || 'locky:current:locks';
    this.ttl = options.ttl;
    this.redis = this.createRedisClient(options.redis);
    this._resourceTimeouts = {};

    this.expiration = setInterval(() => this.expirationCollector(), this.ttl * 0.5);
    this.redis.on('error', (err) => this.emit('error', err));
  }

  /**
   * Try to lock a resource using a locker identifier.
   *
   * @param {object} options
   * @param {string|number} options.resource Resource identifier to lock
   * @param {string|number} options.locker Locker identifier
   * @param {boolean} options.force Force gaining lock even if it's taken
   * @param {Promise} [callback] Optional callback
   */

  lock(options, callback) {
      return nodeify(this.lockPromise(options), callback);
   }

  lockPromise(options = {}) {
    // Format key with resource id.
    const key = resourceKey.format(options.resource);

    // Define the method to use.
    const method = options.force ? 'set' : 'setnx';

    this.redis.multi();
    this.redis[method](key, options.locker);
    this.redis.sadd(this.set, key);

    // Set the lock key.
    return this.redis.exec()
    .then((res) => {
      const success = _.first(res) !== 0;

      if (! this.ttl || ! success) return success;

      return this.redis
      .pexpire(key, this.ttl)
      .then(() => success);
    })
    .then((success) => {
      if (success) {
        this.emit('lock', options.resource, options.locker);
      }

      return success;
    });
  }

  /**
   * Refresh the lock ttl of a resource.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  refresh(resource, callback) {
      return nodeify(this.refreshPromise(resource), callback);
   }

  refreshPromise(resource) {
    return new Promise((resolve, reject) => {
      // If there is no TTL, do nothing.
      if (!this.ttl) return resolve();

      // Format key with resource id.
      const key = resourceKey.format(resource);

      // Set the TTL of the key.
      return this.redis
      .pexpire(key, this.ttl)
      .then(resolve, reject);
    });
  }

  /**
   * Unlock a resource.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  unlock(resource, callback) {
    return nodeify(this.unlockPromise(resource), callback);
  }

  unlockPromise(resource) {
    // Format key with resource id.
    const key = resourceKey.format(resource);

    this.redis.multi();
    this.redis.del(key);
    this.redis.srem(this.set, key);

    // Remove the key.
    return this.redis.exec()
    .then((res) => {
      if (_.first(res) === 0) return false;

      this.emit('unlock', resource);
      return true;
    });
  }

  /**
   * Return the resource locker.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  getLocker(resource, callback) {
    return nodeify(this.getLockerPromise(resource), callback);
  }

  getLockerPromise(resource) {
    return this.redis.get(resourceKey.format(resource));
  }

  /**
   * Close the client.
   */

  close() {
    if (this.expirationWorking) {
      return this.once('expirationWorking', () => this.close());
    }

    clearInterval(this.expiration);
    return this.redis.quit();
  }

  /**
   * Check for expirations
   */

  expirationCollector() {
    if (!this.ttl || this.expirationWorking) return;

    this.expirationWorking = true;

    let keys;

    return this.redis.smembers(this.set)
    .then((_keys) => {
      keys = _keys;

      this.redis.multi();
      keys.forEach((key) => this.redis.ttl(key));
      return this.redis.exec();
    })
    .then((results) => {
      const expired = _(keys)
      .zipWith(results, (key, result) => result < 0 ? { key, resource: resourceKey.parse(key) } : null)
      .compact()
      .value();

      this.redis.multi();
      expired.forEach(({ key, resource }) => {
        this.emit('expire', resource);
        this.redis.srem(this.set, key);
      });
      this.redis.expire(this.set, this.ttl * 2);

      return this.redis.exec();
    })
    .then(() => {
      this.expirationWorking = false;
      this.emit('expirationWorking', false);
      return true;
    });
  }

  /**
   * Create the redis client.
   *
   * @param {object|function} options
   */

  createRedisClient(options) {
    if (_.isFunction(options)) return options();

    return redis.createClient(options);
  }
}

/**
 * Expose module.
 */

module.exports = Locky;
