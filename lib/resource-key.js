/**
 * Format a resource key.
 * @param {string} id
 * @param {string} id
 */
function format(prefix, id) {
  return `${prefix}lock:${id}`;
}
exports.format = format;

/**
 * Parse a resource key.
 * @param {string} prefix
 * @param {string} key
 */
function parse(prefix, key) {
  return key.slice(`${prefix}lock:`.length);
}
exports.parse = parse;
