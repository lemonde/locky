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

    this.ttl = options.ttl;
    this.redis = this._createRedisClient(options.redis);
    this._resourceTimeouts = {};

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
      return nodeify(this._lock(options), callback);
   }

  _lock(options) {
    options = options || {};

    // Format key with resource id.
    const key = resourceKey.format(options.resource);

    // Define the method to use.
    const method = options.force ? 'set' : 'setnx';

    // Set the lock key.
    return this
    .redis[method](key, options.locker)
    .then((res) => {
      const success = res === 1 || res === 'OK';

      if (! this.ttl || ! success) return success;

      return this
      .redis.pexpire(key, this.ttl)
      .then(() => {
        this._listenExpiration(options.resource);
        return success;
      });
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
      return nodeify(this._refresh(resource), callback);
   }

  _refresh(resource) {
    return new Promise((resolve, reject) => {
      // If there is no TTL, do nothing.
      if (!this.ttl) return resolve();

      // Format key with resource id.
      const key = resourceKey.format(resource);

      // Set the TTL of the key.
      this.redis.pexpire(key, this.ttl)
      .then(resolve, reject);
    })
    .then(() => {
      this._listenExpiration(resource);
    });
  }

  /**
   * Unlock a resource.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  unlock(resource, callback) {
    return nodeify(this._unlock(resource), callback);
  }

  _unlock(resource) {
    // Format key with resource id.
    const key = resourceKey.format(resource);

    // Remove the key.
    return this.redis.del(key)
    .then((res) => {
      if (res === 0) return;

      this.emit('unlock', resource);
      this._clearExpiration(resource);
    });
  }

  /**
   * Return the resource locker.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  getLocker(resource, callback) {
    return nodeify(this._getLocker(resource), callback);
  }

  _getLocker(resource) {
    return this.redis.get(resourceKey.format(resource));
  }

  /**
   * Close the client.
   *
   * @param {function} [callback] Optional callback
   */

  close(callback) {
    return nodeify(this._close(), callback);
  }

  _close() {
    return this.redis.quit();
  }

  /**
   * Listen expiration.
   *
   * @param {string} resource Resource
   */

  _listenExpiration(resource) {
    const bindedExpire = this._onExpire.bind(this, resource);
    this._resourceTimeouts[resource] = setTimeout(bindedExpire, this.ttl);
  }

  /**
   * Clear timeout on expiration.
   *
   * @param {string} resource Resource
   */

  _clearExpiration(resource) {
    const timeout = this._resourceTimeouts[resource];

    if (timeout) clearTimeout(timeout);
  }

  /**
   * Called when a lock expire.
   *
   * @param {string} resource
   */

  _onExpire(resource) {
    return this.getLocker(resource)
    .then((locker) => {
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

  _createRedisClient(options) {
    if (_.isFunction(options)) return options();

    return redis.createClient(options);
  }
}

/**
 * Expose module.
 */

module.exports = Locky;
