var redis = require('redis');
var async = require('async');
var sinon = require('sinon');
var _ = require('lodash');
var expect = require('chai').use(require('sinon-chai')).expect;
var Locky = require('../lib/locky');

var testRedis = redis.createClient();

describe('Locky', function () {
  var createLocky, locky;

  beforeEach(function(done) {
    testRedis.keys('lock:resource*', function(err, keys) {
      if (!keys) return done();
      testRedis.del(keys.join(' '), done);
    });
  });

  beforeEach(function () {
    createLocky = function createLocky(options) {
      options = _.defaults(options || {});
      return new Locky(options);
    };
  });

  afterEach(function (done) {
    if (!locky) return done();
    locky.close();
    done();
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
          locky.lock({
            resource: 'article1',
            locker: 'john'
          }, next);
        },
        function checkValue(next) {
          locky.redis.get('lock:resource:article1', function (err, value) {
            expect(value).to.equal('john');
            next(err);
          });
        },
        function checkTTL(next) {
          locky.redis.ttl('lock:resource:article1', function (err, ttl) {
            expect(ttl).to.equal(-1);
            next(err);
          });
        }
      ], done);
    });

    it('should not be able to lock an already locked resource', function(done) {
      locky = createLocky();

      var locked = sinon.spy();
      locky.on('lock', locked);

      locky.lock({
        resource: 'article2',
        locker: 'john'
      }, function(err, res) {
        expect(err).to.be.null;
        expect(res).to.be.true;
        locky.lock({
          resource: 'article2',
          locker: 'john'
        }, function(err, res) {
          expect(locked).to.be.calledOnce;
          expect(err).to.be.null;
          expect(res).to.be.false;
          done();
        });
      });
    });

    it('should set the correct ttl', function (done) {
      locky = createLocky({ ttl: 10000 });

      async.series([
        function lockArticle(next) {
          locky.lock({
            resource: 'article3',
            locker: 'john'
          }, next);
        },
        function checkTTL(next) {
          locky.redis.ttl('lock:resource:article3', function (err, ttl) {
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
          locky.lock({
            resource: 'article4',
            locker: 'john'
          });
          setTimeout(next, 2100);
        },
        function checkExpire(next) {
          expect(spy).to.be.calledWith('article4');
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
          locky.lock({
            resource: 'article5',
            locker: 'john'
          }, next);
        },
        function checkEvent(next) {
          expect(spy).to.be.calledWith('article5', 'john');
          next();
        }
      ], done);
    });

    it('should work without a callback', function (done) {
      locky = createLocky();
      locky.lock({
        resource: 'article6',
        locker: 'john'
      });
      setTimeout(done, 40);
    });
  });

  describe('#refresh', function () {
    it('should refresh the ttl of a key', function (done) {
      locky = createLocky({ ttl: 30000 });

      async.series([
        function createLockKey(next) {
          locky.redis.multi()
          .set('lock:resource:article7', 'john')
          .expire('lock:resource:article7', 20)
          .exec(next);
        },
        function refresh(next) {
          locky.refresh('lock:resource:article7', next);
        },
        function checkTTL(next) {
          locky.redis.ttl('lock:resource:article7', function (err, ttl) {
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
          .set('lock:resource:article8', 'john')
          .expire('lock:resource:article8', 20)
          .exec(next);
        },
        function refresh(next) {
          locky.refresh('article8');
          setTimeout(next, 2100);
        },
        function checkExpire(next) {
          expect(spy).to.be.calledWith('article8');
          next();
        }
      ], done);
    });

    it('should work without callback', function (done) {
      locky = createLocky();
      locky.refresh('article9');
      setTimeout(done, 40);
    });
  });

  describe('#unlock', function () {
    it('should remove the key', function (done) {
      locky = createLocky();

      async.series([
        function createLockKey(next) {
          locky.redis.set('lock:resource:article10', 'john', next);
        },
        function unlock(next) {
          locky.unlock('article10', next);
        },
        function checkTTL(next) {
          locky.redis.exists('lock:resource:article10', function (err, exists) {
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
          locky.redis.set('lock:resource:article11', 'john', next);
        },
        function unlock(next) {
          locky.unlock('article11', next);
        },
        function checkEvent(next) {
          expect(spy).to.be.calledWith('article11');
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
          locky.unlock('article12', next);
        },
        function checkEvent(next) {
          expect(spy).to.not.be.called;
          next();
        }
      ], done);
    });

    it('should work without callback', function (done) {
      locky = createLocky();
      locky.unlock('article13');
      setTimeout(done, 40);
    });
  });

  describe('#getLocker', function () {
    it('should return the locker', function (done) {
      locky = createLocky();

      async.series([
        function lockArticle(next) {
          locky.lock({
            resource: 'article14',
            locker: 'john'
          }, next);
        },
        function getLocker(next) {
          locky.getLocker('article14', function (err, locker) {
            expect(locker).to.eql('john');
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