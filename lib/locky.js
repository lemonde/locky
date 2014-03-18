/**
 * Module dependencies.
 */

var _ = require('lodash');
var resourceKey = require('./resource-key');

/**
 * Expose module.
 */

module.exports = Locky;

/**
 * Create a new Locky client.
 *
 * @param {Object} options
 * @param {Function|Object} options.redis
 * @param {Object} options.userAdapter
 * @param {Object} options.resourceAdapter
 * @param {Number} options.ttl
 */

function Locky(options) {
  options = _.defaults(options || {}, {
    ttl: null,
    unserializeUser: asyncIdentity,
    redis: {}
  });

  function asyncIdentity(obj, cb) {
    cb(null, obj);
  }

  this.unserializeUser = options.unserializeUser;
  this.ttl = Math.round(options.ttl / 1000); // Convert TTL to second (support redis < 2.6)
  this.redis = this._createRedisClient(options.redis);
}

/**
 * Create the redis client.
 *
 * @param {Object} options
 */

Locky.prototype._createRedisClient = function _createRedisClient(options) {
  if (_.isFunction(options)) return options();

  try {
    return require('redis').createClient(options.port, options.host, _.omit(options, 'port', 'host'));
  }
  catch(err) {
    throw new Error('You must add redis as dependency.');
  }
};

/**
 * Lock a resource to a user.
 *
 * @param {Mixed} resourceId
 * @param {Mixed} userId
 * @param {Function} callback
 */

Locky.prototype.lock = function lock(resourceId, userId, callback) {
  // Format key with resource id.
  var key = resourceKey.format(resourceId);

  // Intialize redis transaction.
  var multi = this.redis.multi();

  // Set the lock key.
  multi.set(key, userId);

  // Set the ttl of the key if defined.
  if (this.ttl) multi.expire(key, this.ttl);

  multi.exec(callback);
};

/**
 * Refresh the lock ttl of a resource.
 *
 * @param {Mixed} resourceId
 * @param {Function} callback
 */

Locky.prototype.refresh = function refresh(resourceId, callback) {
  // If there is no TTL, do nothing.
  if (! this.ttl) return callback();

  // Format key with resource id.
  var key = resourceKey.format(resourceId);

  // Set the TTL of the key.
  this.redis.expire(key, this.ttl, callback);
};

/**
 * Unlock a resource.
 *
 * @param {Mixed} resourceId
 * @param {Function} callback
 */

Locky.prototype.unlock = function unlock(resourceId, callback) {
  // Format key with resource id.
  var key = resourceKey.format(resourceId);

  // Remove the key.
  this.redis.del(key, callback);
};

/**
 * Return the locker of a resource.
 *
 * @param {Mixed} resourceId
 * @param {Function} callback
 */

Locky.prototype.getLocker = function getLocker(resourceId, callback) {
  // Format key with resource id.
  var key = resourceKey.format(resourceId);

  // Get the user id.
  this.redis.get(key, function (err, userId) {
    if (err) return callback(err);

    // Unserialize the user id.
    this.unserializeUser(userId, callback);
  }.bind(this));
};