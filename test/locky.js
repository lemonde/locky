var redis = require('redis');
var async = require('async');
var sinon = require('sinon');
var _ = require('lodash');
var expect = require('chai').use(require('sinon-chai')).expect;
var Locky = require('../lib/locky');

describe('Locky', function () {
  var createLocky, locky;

  beforeEach(function () {
    createLocky = function createLocky(options) {
      options = _.defaults(options || {});

      return new Locky(options);
    };
  });

  afterEach(function () {
    if (locky) locky.close();
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
      locky = createLocky();

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
      locky = createLocky({ ttl: 10000 });

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

    it('should emit an expire event when the lock expire', function (done) {
      this.timeout(3000);

      var spy = sinon.spy();
      locky = createLocky({ ttl: 1000 });
      locky.on('expire', spy);

      async.series([
        function lockArticle(next) {
          locky.lock('article', 'john');
          setTimeout(next, 2100);
        },
        function checkExpire(next) {
          expect(spy).to.be.calledWith('article');
          next();
        }
      ], done);
    });

    it('should emit a "lock" event', function (done) {
      var spy = sinon.spy();
      locky = createLocky({ ttl: 10000 });
      locky.on('lock', spy);

      async.series([
        function lockArticle(next) {
          locky.lock('article', 'john', next);
        },
        function checkEvent(next) {
          expect(spy).to.be.calledWith('article', 'john');
          next();
        }
      ], done);
    });

    it('should work without callback', function (done) {
      locky = createLocky();
      locky.lock('article', 'john');
      setTimeout(done, 40);
    });
  });

  describe('#refresh', function () {
    it('should refresh the ttl of a key', function (done) {
      locky = createLocky({ ttl: 30000 });

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

    it('should emit an expire event when the lock expire', function (done) {
      this.timeout(3000);

      var spy = sinon.spy();
      locky = createLocky({ ttl: 1000 });
      locky.on('expire', spy);

      async.series([
        function createLockKey(next) {
          locky.redis.multi()
          .set('lock:resource:article', 'john')
          .expire('article', 20)
          .exec(next);
        },
        function refresh(next) {
          locky.refresh('article');
          setTimeout(next, 2100);
        },
        function checkExpire(next) {
          expect(spy).to.be.calledWith('article');
          next();
        }
      ], done);
    });

    it('should work without callback', function (done) {
      locky = createLocky();
      locky.refresh('article');
      setTimeout(done, 40);
    });
  });

  describe('#unlock', function () {
    it('should remove the key', function (done) {
      locky = createLocky();

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

    it('should emit a "unlock" event', function (done) {
      var spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      async.series([
        function createLockKey(next) {
          locky.redis.set('lock:resource:article', 'john', next);
        },
        function unlock(next) {
          locky.unlock('article', next);
        },
        function checkEvent(next) {
          expect(spy).to.be.calledWith('article');
          next();
        }
      ], done);
    });

    it('should not emit a "unlock" event if the resource is not locked', function (done) {
      var spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      async.series([
        function unlock(next) {
          locky.unlock('article', next);
        },
        function checkEvent(next) {
          expect(spy).to.not.be.called;
          next();
        }
      ], done);
    });

    it('should work without callback', function (done) {
      locky = createLocky();
      locky.unlock('article');
      setTimeout(done, 40);
    });
  });

  describe('#getLockerId', function () {
    it('should return the locker id', function (done) {
      locky = createLocky();

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
      locky = createLocky();

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
      locky = createLocky({
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

  describe('#close', function () {
    beforeEach(function () {
      locky = createLocky();
      sinon.spy(locky.redis, 'quit');
    });

    afterEach(function () {
      locky.redis.quit.restore();
    });

    it('should close the redis connection', function () {
      locky.close();
      expect(locky.redis.quit).to.be.called;
    });
  });
});