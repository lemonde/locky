/**
 * Module dependencies.
 */

const EventEmitter = require('events');
const _ = require('lodash');
const redis = require('redis');
const async = require('async');
const resourceKey = require('./resource-key');

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

    this.ttl = options.ttl;
    this.redis = this.createRedisClient(options.redis);
    this.resourceTimeouts = {};

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
    options = options || {};

    // Format key with resource id.
    const key = resourceKey.format(options.resource);

    // Define the method to use.
    const method = options.force ? 'set' : 'setnx';

    async.waterfall([
      (callback) => this.redis[method](key, options.locker, callback),
      (result, callback) => {
        const success = result === 1 || result === 'OK';

        // if ttl and resource lock has succeed, we set the ttl to the lock
        if (this.ttl && success) {
          return this.redis.pexpire(key, this.ttl, callback);
        }

        process.nextTick(() => callback(null, success));
      }
    ], (err, success) => {
      if (err) {
        this.emit('error', err.message);
        return callback(err);
      }

      if (success) {
        this.emit('lock', options.resource, options.locker);
        this.listenExpiration(options.resource);
      }

      callback(null, success);
    });
   }

  /**
   * Refresh the lock ttl of a resource.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

   refresh(resource, callback) {
    if (!this.ttl) return process.nextTick(callback);

    // Format key with resource id.
    const key = resourceKey.format(resource);

    // Set the TTL of the key.
    this.redis.pexpire(key, this.ttl, (err) => {
      if (err) {
        this.emit('error', err);
        return callback(err);
      }

      this.listenExpiration(resource);
      callback();
    });
  }

  /**
   * Unlock a resource.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  unlock(resource, callback) {
  // Format key with resource id.
    const key = resourceKey.format(resource);

    // Remove the key.
    this.redis.del(key, (err, res) => {
      if (err) {
        this.emit('error', err);
        return callback(err);
      }

      if (res !== 0) {
        this.emit('unlock', resource);
        this.clearExpiration(resource);
      }

      callback();
    });
  }

  /**
   * Return the resource locker.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  getLocker(resource, callback) {
    this.redis.get(resourceKey.format(resource), callback);
  }

  /**
   * Close the client.
   *
   * @param {function} [callback] Optional callback
   */

  close() {
    Object.keys(this.resourceTimeouts).forEach(
      (resource) => this.clearExpiration(resource)
    );

    this.redis.quit();
  }

  /**
   * Listen expiration.
   *
   * @param {string} resource Resource
   */

  listenExpiration(resource) {
    this.resourceTimeouts[resource] = setTimeout(
      () => this.onExpire(resource),
      this.ttl
    );
  }

  /**
   * Clear timeout on expiration.
   *
   * @param {string} resource Resource
   */

  clearExpiration(resource) {
    const timeout = this.resourceTimeouts[resource];
    if (timeout) clearTimeout(timeout);
  }

  /**
   * Called when a lock expire.
   *
   * @param {string} resource
   */

  onExpire(resource) {
    this.getLocker(resource, (err, locker) => {
      if (err) {
        return this.emit('error', err);
      }

      // If there is a locker, the key has not expired.
      if (locker) return;

      // Emit an expire event.
      this.emit('expire', resource);
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
