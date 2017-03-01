/**
 * Expose module.
 */

exports.format = format;
exports.parse = parse;

/**
 * Format a resource key.
 *
 * @param {String} id
 * @returns {String} key
 */

function format(id) {
  return `lock:resource:${id}`;
}

/**
 * Parse a resource key.
 *
 * @param {String} key
 * @returns {String} id
 */

function parse(key) {
  return key.replace(/^lock:resource:/, '');
}
