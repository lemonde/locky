var expect = require('chai').expect;
var roomKey = require('../lib/resource-key');

describe('Resource key', function () {
  describe('#format', function () {
    it('should format key', function () {
      expect(roomKey.format('article')).to.equal('lock:resource:article');
    });
  });

  describe('#parse', function () {
    it('should parse key', function () {
      expect(roomKey.parse('lock:resource:article')).to.equal('article');
    });
  });

  it('should be symetric', function () {
    expect(roomKey.parse(roomKey.format('article'))).to.equal('article');
  });
});
