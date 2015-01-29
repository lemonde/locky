var redis = require('then-redis');
var async = require('async');
var sinon = require('sinon');
var _ = require('lodash');
var expect = require('chai').use(require('sinon-chai')).expect;
var Locky = require('../lib/locky');
var Promise = require('bluebird');

var testRedis = redis.createClient();

describe('Locky', function () {
  var createLocky, locky;

  beforeEach(function () {
    return testRedis.keys('lock:resource*')
    .then(function (keys) {
      if (!keys || !keys.length) return;
      return testRedis.del(keys);
    });
  });

  beforeEach(function () {
    createLocky = function createLocky(options) {
      options = _.defaults(options || {});
      return new Locky(options);
    };
  });

  afterEach(function () {
    if (!locky) return;
    return locky.close();
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
            socket_nodelay: true,
            socket_keepalive: true
          }
        });

        expect(redis.createClient).to.be.calledWith({
          host: 'localhost',
          port: 6379,
          socket_nodelay: true,
          socket_keepalive: true
        });
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
    it('should lock the user', function () {
      locky = createLocky();

      return locky.lock({
        resource: 'article1',
        locker: 'john'
      })
      .then(function () {
        return locky.redis.get('lock:resource:article1').then(function (value) {
          expect(value).to.equal('john');
        });
      })
      .then(function () {
        return locky.redis.ttl('lock:resource:article1').then(function (ttl) {
          expect(ttl).to.equal(-1);
        });
      });
    });

    it('should not be able to lock an already locked resource', function () {
      locky = createLocky();

      var locked = sinon.spy();
      locky.on('lock', locked);

      return locky.lock({
        resource: 'article2',
        locker: 'john'
      }).then(function(res) {
        expect(res).to.be.true;

        return locky.lock({
          resource: 'article2',
          locker: 'john'
        });
      }).then(function(res) {
        expect(locked).to.be.calledOnce;
        expect(res).to.be.false;
      });
    });

    it('should set the correct ttl', function () {
      locky = createLocky({ttl: 10000});

      return locky.lock({
        resource: 'article3',
        locker: 'john'
      })
      .then(function () {
        return locky.redis.ttl('lock:resource:article3').then(function (ttl) {
          expect(ttl).to.be.most(10);
        });
      });
    });

    it('should emit an expire event when the lock expire', function () {
      this.timeout(3000);

      var spy = sinon.spy();
      locky = createLocky({ttl: 1000});
      locky.on('expire', spy);

      return locky.lock({
        resource: 'article4',
        locker: 'john'
      })
      .then(function () {
        return Promise.delay(2100);
      })
      .then(function () {
        expect(spy).to.be.calledWith('article4');
      });
    });

    it('should emit a "lock" event', function () {
      var spy = sinon.spy();
      locky = createLocky({ttl: 10000});
      locky.on('lock', spy);

      return locky.lock({
        resource: 'article5',
        locker: 'john'
      })
      .then(function () {
        expect(spy).to.be.calledWith('article5', 'john');
      });
    });
  });

  describe('#refresh', function () {
    it('should refresh the ttl of a key', function () {
      locky = createLocky({ttl: 30000});

      locky.redis.multi();
      locky.redis.set('lock:resource:article7', 'john');
      locky.redis.expire('lock:resource:article7', 20);
      return locky.redis.exec()
      .then(function () {
        return locky.refresh('lock:resource:article7');
      })
      .then(function () {
        return locky.redis.ttl('lock:resource:article7').then(function (ttl) {
          expect(ttl).to.be.most(30);
        });
      });
    });

    it('should emit an expire event when the lock expire', function () {
      this.timeout(3000);

      var spy = sinon.spy();
      locky = createLocky({ttl: 1000});
      locky.on('expire', spy);

      locky.redis.multi();
      locky.redis.set('lock:resource:article8', 'john');
      locky.redis.expire('lock:resource:article8', 20);
      return locky.redis.exec()
      .then(function () {
        locky.refresh('article8');
        return Promise.delay(2100);
      })
      .then(function () {
        expect(spy).to.be.calledWith('article8');
      });
    });
  });

  describe('#unlock', function () {
    it('should remove the key', function () {
      locky = createLocky();

      return locky.redis.set('lock:resource:article10', 'john')
      .then(function () {
        return locky.unlock('article10');
      })
      .then(function () {
        return locky.redis.exists('lock:resource:article10').then(function (exists) {
          expect(exists).to.equal(0);
        });
      });
    });

    it('should emit a "unlock" event', function () {
      var spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      return locky.redis.set('lock:resource:article11', 'john')
      .then(function () {
        return locky.unlock('article11');
      })
      .then(function () {
        expect(spy).to.be.calledWith('article11');
      });
    });

    it('should not emit a "unlock" event if the resource is not locked', function () {
      var spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      return locky.unlock('article12')
      .then(function () {
        expect(spy).to.not.be.called;
      });
    });
  });

  describe('#getLocker', function () {
    it('should return the locker', function () {
      locky = createLocky();

      return locky.lock({
        resource: 'article14',
        locker: 'john'
      })
      .then(function () {
        return locky.getLocker('article14').then(function (locker) {
          expect(locker).to.eql('john');
        });
      });
    });
  });

  describe('#close', function () {
    beforeEach(function () {
      locky = createLocky();
      sinon.spy(locky.redis, 'quit');
    });

    it('should close the redis connection', function () {
      return locky.close().then(function () {
        expect(locky.redis.quit).to.be.called;
        locky = null;
      });
    });
  });
});
