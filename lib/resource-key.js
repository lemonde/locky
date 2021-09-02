/**
 * Format a resource key.
 * @param {string | number} id
 */
function format(id) {
  return `lock:resource:${id}`;
}
exports.format = format;

/**
 * Parse a resource key.
 * @param {string} key
 */
function parse(key) {
  return key.replace(/^lock:resource:/, "");
}
exports.parse = parse;
