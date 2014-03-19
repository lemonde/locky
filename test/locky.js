var redis = require('redis');
var async = require('async');
var sinon = require('sinon');
var _ = require('lodash');
var expect = require('chai').use(require('sinon-chai')).expect;
var Locky = require('../lib/locky');

describe('Locky', function () {
  var createLocky;

  beforeEach(function () {
    createLocky = function createLocky(options) {
      options = _.defaults(options || {});

      return new Locky(options);
    };
  });

  describe('constructor', function () {
    describe('redis options', function () {
      beforeEach(function () {
        sinon.spy(redis, 'createClient');
      });

      afterEach(function () {
        redis.createClient.restore();
      });

      it('should accept nothing', function () {
        createLocky();
      });

      it('should accept an object', function () {
        createLocky({
          redis: {
            host: 'localhost',
            port: 6379,
            socket_nodelay: true
          }
        });

        expect(redis.createClient).to.be.calledWith(6379, 'localhost', { socket_nodelay: true });
      });

      it('should accept a function', function () {
        createLocky({
          redis: redis.createClient
        });

        expect(redis.createClient).to.be.called;
      });
    });
  });

  describe('#lock', function () {
    it('should lock the user', function (done) {
      var locky = createLocky();

      async.series([
        function lockArticle(next) {
          locky.lock('article', 'john', next);
        },
        function checkValue(next) {
          locky.redis.get('lock:resource:article', function (err, value) {
            expect(value).to.equal('john');
            next(err);
          });
        },
        function checkTTL(next) {
          locky.redis.ttl('lock:resource:article', function (err, ttl) {
            expect(ttl).to.equal(-1);
            next(err);
          });
        }
      ], done);
    });

    it('should set the correct ttl', function (done) {
      var locky = createLocky({ ttl: 10000 });

      async.series([
        function lockArticle(next) {
          locky.lock('article', 'john', next);
        },
        function checkTTL(next) {
          locky.redis.ttl('lock:resource:article', function (err, ttl) {
            expect(ttl).to.be.most(10);
            next(err);
          });
        }
      ], done);
    });

    it('should emit an event "lock"', function (done) {
      var spy = sinon.spy();
      var locky = createLocky({ ttl: 10000 });
      locky.on('lock', spy);

      async.series([
        function lockArticle(next) {
          locky.lock('article', 'john', next);
        },
        function checkTTL(next) {
          expect(spy).to.be.calledWith('article', 'john');
          next();
        }
      ], done);
    });
  });

  describe('#refresh', function () {
    it('should refresh the ttl of a key', function (done) {
      var locky = createLocky({ ttl: 30000 });

      async.series([
        function createLockKey(next) {
          locky.redis.multi()
          .set('lock:resource:article', 'john')
          .expire('article', 20)
          .exec(next);
        },
        function refresh(next) {
          locky.refresh('article', next);
        },
        function checkTTL(next) {
          locky.redis.ttl('lock:resource:article', function (err, ttl) {
            expect(ttl).to.be.most(30);
            next(err);
          });
        }
      ], done);
    });
  });

  describe('#unlock', function () {
    it('should remove the key', function (done) {
      var locky = createLocky();

      async.series([
        function createLockKey(next) {
          locky.redis.set('lock:resource:article', 'john', next);
        },
        function unlock(next) {
          locky.unlock('article', next);
        },
        function checkTTL(next) {
          locky.redis.exists('lock:resource:article', function (err, exists) {
            expect(exists).to.equal(0);
            next(err);
          });
        }
      ], done);
    });
  });

  describe('#getLockerId', function () {
    it('should return the locker id', function (done) {
      var locky = createLocky();

      async.series([
        function lockArticle(next) {
          locky.lock('article', 'john', next);
        },
        function getLocker(next) {
          locky.getLockerId('article', function (err, locker) {
            expect(locker).to.eql('john');
            next(err);
          });
        }
      ], done);
    });
  });

  describe('#getLocker', function () {
    it('should return the locker', function (done) {
      var locky = createLocky();

      async.series([
        function lockArticle(next) {
          locky.lock('article', 'john', next);
        },
        function getLocker(next) {
          locky.getLocker('article', function (err, locker) {
            expect(locker).to.eql('john');
            next(err);
          });
        }
      ], done);
    });

    it('should use the user adapter', function (done) {
      var locky = createLocky({
        unserializeUser: function unserializeUser(id, cb) {
          return cb(null, { id: id });
        }
      });

      async.series([
        function lockArticle(next) {
          locky.lock('article', 'john', next);
        },
        function getLocker(next) {
          locky.getLocker('article', function (err, locker) {
            expect(locker).to.eql({ id: 'john' });
            next(err);
          });
        }
      ], done);
    });
  });
});