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

    // for expirate listener
    this.expirateInterval = setInterval(() => this.expirateListener(), this.ttl);
    this.expirateResource = 'locky:expirate:collector';
    this.expirateWorking = false;
    this.expirateListener();

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

    // add the lock to the unique set
    this.redis.sadd(this.set, key);

    // add the lock key.
    return this.redis[method](key, options.locker)
    .then((res) => {
      const success = res !== 0;

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

    // Remove the ky from the unique set
    this.redis.srem(this.set, key);

    // Remove the key.
    return this.redis.del(key)
    .then((res) => {
      if (res === 0) return false;

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

  close(callback) {
    return nodeify(this.closePromise(), callback);
  }

  closePromise() {
    return new Promise((resolve) => {
      const quit = () => {
        clearInterval(this.expirateInterval);
        this.redis.quit();
        return resolve(true);
      };

      if (this.expirateWorking) {
        this.once('expirateCollectorEnd', () => quit);
      }

      return quit();
    });
  }

  /**
   * Check for expirations
   * Cluster singleton
   */

  expirateListener() {
    if (!this.ttl || this.expirateWorking) return;

    return this.redis.setnx(this.expirateResource, 'OK')
    .then(result => {
      if (result === 0) return Promise.resolve(false);
      this.expirateWorking = true;
      return this.expirateCollector();
    })
    .then(() => {
      this.expirateWorking = false;
      this.emit('expirateCollectorEnd', true);

      return this.redis.del(this.expirateResource);
    })
    .catch((err) => {
      this.emit('error', err);
      this.expirateWorking = false;
      this.emit('expirateCollectorEnd', true);

      return this.redis.del(this.expirateResource);
    });
  }

  /**
   * Launch expirations collector
   */

  expirateCollector() {
    let keys;

    return this.redis
    .smembers(this.set)
    .then((_keys) => {
      keys = _keys;

      // if there is not keys, we dont do anything
      if (! keys) return Promise.resolve(false);

      return Promise.all(keys.map(key => this.redis.pttl(key)));
    })
    .then((results) => {
      if (! keys) return Promise.resolve(true);

      const expired = _(keys)
      .zipWith(results, (key, result) => {
        return result === -2 ? { key, resource: resourceKey.parse(key) } : null;
      })
      .compact()
      .value();

      // if there is not expired key, we dont do anything
      if (_.isEmpty(expired)) return Promise.resolve(true);

      expired.forEach(({ key, resource }) => this.emit('expire', resource));

      this.redis.srem(this.set, ..._.map(expired, 'key'));

      return this.redis.pexpire(this.set, this.ttl * 2);
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
