const EventEmitter = require('events');
const _ = require('lodash');
const Promise = require('bluebird');
const redis = require('./redis');
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

    this.set = options.set || 'locky:current:locks';
    this.ttl = options.ttl;
    this.redis = redis.createClient(options.redis);
    this._resourceTimeouts = {};

    // for expirate listener
    this.expirateInterval = setInterval(() => this.expirateListener(), this.ttl);
    this.expirateResource = 'locky:expirate:worker';
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
    if (!_.isFunction(callback)) return this.lockPromise(options);
    return this.lockPromise(options).asCallback(callback);
  }

  lockPromise(options = {}) {
    // Format key with resource id.
    const key = resourceKey.format(options.resource);

    if (!key) return Promise.resolve(true);
    if (!options.locker) return Promise.resolve(true);

    // Define the method to use.
    const method = options.force ? 'setAsync' : 'setnxAsync';

    // add the lock to the unique set
    return this.redis.saddAsync(this.set, key)
    .then(() => this.redis[method](key, options.locker))
    .then(res => {
      const success = res !== 0;

      if (!this.ttl || !success) return Promise.resolve(success);

      return this.redis.pexpireAsync(key, this.ttl)
      .then(() => Promise.resolve(success));
    })
    .then(success => {
      if (success) {
        this.emit('lock', options.resource, options.locker);
      }

      return Promise.resolve(success);
    });
  }

  /**
   * Refresh the lock ttl of a resource.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  refresh(resource, callback) {
    if (!_.isFunction(callback)) return this.refreshPromise(resource);
    return this.refreshPromise(resource).asCallback(callback);
  }

  refreshPromise(resource) {
    // If there is no TTL, do nothing.
    if (!this.ttl) return Promise.resolve(true);

    // Format key with resource id.
    const key = resourceKey.format(resource);

    // Set the TTL of the key.
    return this.redis.pexpireAsync(key, this.ttl);
  }

  /**
   * Unlock a resource.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  unlock(resource, callback) {
    if (!_.isFunction(callback)) return this.unlockPromise(resource);
    return this.unlockPromise(resource).asCallback(callback);
  }

  unlockPromise(resource) {
    // Format key with resource id.
    const key = resourceKey.format(resource);

    // Remove the ky from the unique set
    return this.redis.sremAsync(this.set, key)
    .then(() => this.redis.delAsync(key))
    .then((res) => {
      if (res === 0) return Promise.resolve(true);

      this.emit('unlock', resource);
      return Promise.resolve(true);
    });
  }

  /**
   * Return the resource locker.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  getLocker(resource, callback) {
    if (!_.isFunction(callback)) return this.getLockerPromise(resource);
    return this.getLockerPromise(resource).asCallback(callback);
  }

  getLockerPromise(resource) {
    return this.redis.getAsync(resourceKey.format(resource));
  }

  /**
   * Close the client.
   */

  close(callback) {
    if (!_.isFunction(callback)) return this.closePromise();
    return this.closePromise().asCallback(callback);
  }

  closePromise() {
    return new Promise(resolve => {
      const quit = () => {
        clearInterval(this.expirateInterval);
        this.redis.quit();
        resolve(true);
      };

      if (this.expirateWorking) {
        this.once('expirateEnd', quit);
      } else quit();
    });
  }

  /**
   * Check for expirations
   * Cluster singleton
   */

  expirateListener() {
    if (!this.ttl || this.expirateWorking) return;

    // try to set the worker token
    return this.redis.setnxAsync(this.expirateResource, 'OK')
    .then(hasToken => {
      // has not token, an other working
      if (!hasToken) return;
      // expirate worker is locked
      this.expirateWorking = true;
      // refresh the ttl of the worker token
      return this.redis.pexpire(this.expirateResource, this.ttl);
    })
    // launch expirate worker
    .then(() => this.expirateWorker())
    // delete the worker token
    .then(() => this.redis.delAsync(this.expirateResource))
    .catch(err => this.emit('error', err))
    .finally(() => {
      this.expirateWorking = false;
      this.emit('expirateEnd', true);

      return Promise.resolve(true);
    });
  }

  /**
   * Worker that collects expirations to emit them
   */

  expirateWorker() {
    let keys;

    return this.redis.smembersAsync(this.set)
    .then(_keys => {
      keys = _keys;

      // if there is not keys, we dont do anything
      if (!keys) return;

      const batch = this.redis.batch();
      keys.forEach((key) => batch.pttl(key));
      return batch.execAsync();
    })
    .then(results => {
      const expired = _(keys)
      .zipWith(results, (key, result) => {
        return result === -2 ? { key, resource: resourceKey.parse(key) } : null;
      })
      .compact()
      .value();

      // if there is not expired key, we dont do anything
      if (_.isEmpty(expired)) return;

      expired.forEach(({ key, resource }) => this.emit('expire', resource));

      return this.redis.sremAsync(this.set, ..._.map(expired, 'key'));
    })
    .then(() => this.redis.pexpireAsync(this.set, this.ttl * 2));
  }
}

/**
 * Expose module.
 */

module.exports = Locky;
