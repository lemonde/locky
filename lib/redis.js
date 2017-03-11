const bluebird = require('bluebird');
const redis = require('redis');

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

/**
 * Create the redis client.
 *
 * @param {object|function} options
 */

module.exports.createClient = (options) => redis.createClient(options);