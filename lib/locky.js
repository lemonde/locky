/**
 * Module dependencies.
 */

var events = require('events');
var util = require('util');
var _ = require('lodash');
var resourceKey = require('./resource-key');
var redis = require('redis');

/**
 * Expose module.
 */

module.exports = Locky;

/**
 * Create a new Locky client.
 *
 * @param {object} options
 * @param {function|object} options.redis
 * @param {number} options.ttl
 */

function Locky(options) {
  options = _.defaults(options || {}, {
    ttl: null,
    redis: {}
  });

  function asyncIdentity(obj, cb) {
    cb(null, obj);
  }

  this.ttl = options.ttl;
  this.ttlSecond = Math.ceil(options.ttl / 1000); // Convert TTL to second (support redis < 2.6)
  this.redis = this._createRedisClient(options.redis);

  events.EventEmitter.call(this);
}

/**
 * Inherits from EventEmitter.
 */

util.inherits(Locky, events.EventEmitter);

/**
 * Try to lock a resource using a locker identifier.
 *
 * @param {string|number} opts.resource resource identifier to lock
 * @param {string|number} opts.locker locker identifier
 * @param {boolean} opts.force force gaining lock even if it's taken
 * @param {lock~callback} cb
 */

/**
 * Callback called with lock result
 * @callback lock~cb
 * @param {?error} err
 * @param {boolean} res did we managed to get the lock or not
 */

Locky.prototype.lock = function lock(opts, callback) {
  var resource = opts.resource;
  var locker = opts.locker;
  var force = opts.force;

  // was the lock successful?
  var success;

  // Format key with resource id.
  var key = resourceKey.format(resource);

  // Set the lock key.
  if (force) {
    this.redis.set(key, locker, setDone.bind(this));
  } else {
    this.redis.set(key, locker, 'NX', setDone.bind(this));
  }

  function setDone(err, res) {
    success = res === 'OK';

    if (err !== null) return hadError.call(this, err);

    if (!this.ttlSecond || !success) {
      return lockDone.call(this);
    }

    this.redis.expire(key, this.ttlSecond, expireSet.bind(this));
  }

  function expireSet(err) {
    if (err) return hadError.call(this, err);
    this._listenExpiration(resource);
    lockDone.call(this);
  }

  function lockDone() {
    if (success) this.emit('lock', resource, locker);
    if (callback) callback(null, success);
  }

  function hadError(err) {
    if (!callback) return this.emit('error', err);

    callback(err);
  }
};

/**
 * Refresh the lock ttl of a resource.
 *
 * @param {string} resource
 * @param {function} callback
 */

Locky.prototype.refresh = function refresh(resource, callback) {
  // If there is no TTL, do nothing.
  if (! this.ttl) {
    if (callback) callback();
    return ;
  }

  // Format key with resource id.
  var key = resourceKey.format(resource);

  // Set the TTL of the key.
  this.redis.expire(key, this.ttlSecond, callback);
  this._listenExpiration(resource);
};

/**
 * Unlock a resource.
 *
 * @param {string} resource
 * @param {function} callback
 */

Locky.prototype.unlock = function unlock(resource, callback) {
  // Format key with resource id.
  var key = resourceKey.format(resource);

  // Remove the key.
  this.redis.del(key, function keyDeleted(err, res) {
    if (err && callback) return callback(err);
    if (err && ! callback) return this.redis.emit('error', err);


    if (res !== 0) this.emit('unlock', resource);

    if(callback) callback();
  }.bind(this));
};

/**
 * Return the resource locker.
 *
 * @param {string} resource
 * @param {function} callback
 */

Locky.prototype.getLocker = function getLocker(resource, callback) {
  this.redis.get(resourceKey.format(resource), callback);
};

/**
 * Close the client.
 *
 * @param {function} callback
 */

Locky.prototype.close = function close(callback) {
  this.redis.quit(callback);
};

/**
 * Listen expiration.
 *
 * @param {string} resource
 */

Locky.prototype._listenExpiration = function _listenExpiration(resource) {
  // We add a timeout to simulate the notification of expiring in redis.
  // There is a lag of 1s to ensure that the redis key is expired (redis 2.4 sux).
  var expireTime = this.ttlSecond * 1000 + 1000;
  setTimeout(this._onExpire.bind(this, resource), expireTime);
};

/**
 * Called when a lock expire.
 *
 * @param {string} resource
 */

Locky.prototype._onExpire = function _onExpire(resource) {
  this.getLocker(resource, function gotLocker(err, locker) {
    if (err) return this.redis.emit('error', err);

    // If there is a locker, the key has not expired.
    if (locker) return ;

    // Emit an expire event.
    this.emit('expire', resource);

  }.bind(this));
};

/**
 * Create the redis client.
 *
 * @param {object} options
 */

Locky.prototype._createRedisClient = function _createRedisClient(options) {
  if (_.isFunction(options)) return options();
  return redis
    .createClient(
      options.port,
      options.host,
      _.omit(options, 'port', 'host')
    );
};