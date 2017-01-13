/**
 * Module dependencies.
 */

const events = require('events');
const _ = require('lodash');
const redis = require('then-redis');
const pipeEvent = require('pipe-event');
const resourceKey = require('./resource-key');
const nodeify = require('promise-nodeify');

/**
 * Create a new Locky client.
 *
 * @param {object} options
 * @param {function|object} options.redis
 * @param {number} options.ttl
 */

class Locky extends events.EventEmitter {
  constructor(options) {
    super();

    options = _.defaults(options || {}, {
      ttl: null,
      redis: {}
    });

    this.ttl = options.ttl;

    this.redis = this._createRedisClient(options.redis);

    pipeEvent(['error'], this.redis, this);

    this._resourceTimeouts = {};
  }

  /**
   * Try to lock some resources using some locker identifiers.
   *
   * @param {object} options
   * @param {string|number} options.resource Resource identifier to lock
   * @param {string|number} options.locker Locker identifier
   * @param {[Object]} options.bulk collection of { resource, locker }
   * @param {boolean} options.force Force gaining lock even if it's taken
   * @param {Promise} [callback] Optional callback
   */

  lock(options, callback) {
    const locky = this;

    let resources = [];

    if (options.bulk) {
      resources = resources.concat(
        options.bulk.map(({ resource, locker }) => ({ id: resource, locker }))
      );
    } else if (options.resource && options.locker) {
      resources.push({ id: options.resource, locker: options.locker });
    } else {
      throw new Error('Locky: to lock, you should pass a resource and a locker, or a bulk');
    }

    return nodeify(((options) => {
      options = options || {};

      // Define the method to use.
      const cmd = options.force ? 'set' : 'setnx';

      // Lock the resources
      return locky._multi(
        resources.map(
          ({ id, locker }) => ({ cmd, args: [resourceKey.format(id), locker] })
        )
      )
      // Increase the ttl of the locked resources
      // results is an array of digit [1, 1, 0, 1, ...]
      // 0 : lock not set (cause already set, ...)
      // 1 : lock set
      .then((results) => {
        const lockedResources = _(resources)
        .zipWith(results, (resource, result) => result ? resource : null)
        .compact()
        .value();

        if (! locky.ttl || _.isEmpty(lockedResources)) {
          return lockedResources;
        }

        locky._setExpire(_.map(lockedResources, 'id'), locky.ttl);
        return lockedResources;
      })
      // Emit an event for the new locked resources
      .then((lockedResources) => {
        lockedResources.forEach((resource) => {
          locky.emit('lock', resource.id, resource.locker);
        });

        return ! _.isEmpty(lockedResources);
      });
    })(options), callback);
  }

  /**
   * Refresh the lock ttl of a collection of resources.
   *
   * @param {[string]|String} resources Resources
   * @param {function} [callback] Optional callback
   */

  refresh(resources, callback) {
    const locky = this;

    return nodeify(((resources) => {
      return locky._setExpire(_.flatten([resources]), locky.ttl);
    })(resources), callback);
  }

  /**
   * Unlock a resource.
   *
   * @param {string} resource Resource
   * @param {function} [callback] Optional callback
   */

  unlock(resource, callback) {
    const locky = this;

    return nodeify(((resource) => {
      // Format key with resource id.
      const key = resourceKey.format(resource);

      // Remove the key.
      return locky.redis.del(key)
      .then((res) => {
        if (res === 0) return;

        locky.emit('unlock', resource);
        locky._clearExpiration(resource);
      });
    })(resource), callback);
  }

  /**
   * Return the resources lockers.
   *
   * @param {[string]|String} resources Resources
   * @param {function} [callback] Optional callback
   */

  getLocker(resources, callback) {
    const locky = this;
    const keys = _([resources])
    .flatten()
    .map((resource) => resourceKey.format(resource))
    .value();

    return nodeify(((keys) =>
      locky.redis
      .mget(...keys)
      .then((values) =>
        values.length > 1 ? values : _.first(values)
      )
    )(keys), callback);
  }

  /**
   * Close the client.
   *
   * @param {function} [callback] Optional callback
   */

  close(callback) {
    const locky = this;

    return nodeify((() => locky.redis.quit())(), callback);
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
    const locky = this;

    return locky.getLocker(resource).then((locker) => {
      // If there is a locker, the key has not expired.
      if (_.first(locker)) return;

      // Emit an expire event.
      locky.emit('expire', resource);
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

  /**
   * Set the expire to many resources.
   *
   * @param {string} resource Resource
   * @param {integer} ttl
   */

  _setExpire(resources, ttl) {
    const locky = this;

    return new Promise((resolve, reject) => {
      // If there is no TTL, do nothing.
      if (! ttl) return resolve();

      locky._multi(resources.map(
        (resource) => ({ cmd: 'pexpire', args: [resourceKey.format(resource), ttl] })
      )).then(resolve, reject);
    })
    .then(() => {
      resources.forEach((resource) => locky._listenExpiration(resource));
    });
  }

  /**
   * Execute multi operations in redis in a single query (pipeline).
   *
   * @param {string} resource Resource
   * @param {integer} ttl
   */

  _multi(ops) {
    const locky = this;

    locky.redis.multi();
    ops.forEach((op) => locky.redis[op.cmd](...op.args));
    return locky.redis.exec();
  }
}

/**
 * Expose module.
 */

module.exports = Locky;
