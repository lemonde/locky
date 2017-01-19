const expect = require('chai').expect;
const roomKey = require('../lib/resource-key');

describe('Resource key', () => {
  describe('#format', () => {
    it('should format key', () => {
      expect(roomKey.format('article')).to.equal('lock:resource:article');
    });
  });

  describe('#parse', () => {
    it('should parse key', () => {
      expect(roomKey.parse('lock:resource:article')).to.equal('article');
    });
  });

  it('should be symetric', () => {
    expect(roomKey.parse(roomKey.format('article'))).to.equal('article');
  });
});
