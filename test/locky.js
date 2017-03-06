const redis = require('redis');
const sinon = require('sinon');
const _ = require('lodash');
const async = require('async');
const expect = require('chai').use(require('sinon-chai')).expect;
const Locky = require('../lib/locky');

const testRedis = redis.createClient();

describe('Locky', () => {
  let createLocky, locky;

  beforeEach((done) => {
    testRedis.keys('lock:resource*', (err, keys) => {
      if (err) return done(err);
      if (! keys || ! keys.length) return done();
      return testRedis.del(keys, done);
    });
  });

  beforeEach(() => {
    createLocky = (options) => {
      options = _.defaults(options || {});
      return new Locky(options);
    };
  });

  after((done) => {
    if (! locky) return done();
    locky.close(done);
  });

  describe('constructor', () => {
    describe('redis options', () => {
      beforeEach(() => {
        sinon.spy(redis, 'createClient');
      });

      afterEach(() => {
        redis.createClient.restore();
      });

      it('should accept nothing', () => {
        createLocky();
      });

      it('should accept an object', () => {
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

      it('should accept a function', () => {
        createLocky({ redis: redis.createClient });

        expect(redis.createClient).to.be.called;
      });
    });
  });

  describe('#lock', () => {
    it('should lock the user', (done) => {
      locky = createLocky();

      async.waterfall([
        (callback) => (
          locky.lock({
            resource: 'article1',
            locker: 'john'
          }, callback)
        ),
        (success, callback) => {
          expect(success).to.be.true;
          locky.redis.get('lock:resource:article1', callback);
        },
        (result, callback) => {
          expect(result).to.equal('john');
          locky.redis.ttl('lock:resource:article1', callback);
        }
      ], (err, ttl) => {
        if (err) return done(err);
        expect(ttl).to.equal(-1);
        done();
      });
    });

    it('should not be able to lock an already locked resource', (done) => {
      locky = createLocky();

      const locked = sinon.spy();
      locky.on('lock', locked);

      async.waterfall([
        (callback) => (
          locky.lock({
            resource: 'article2',
            locker: 'john'
          }, callback)
        ),
        (success, callback) => {
          expect(success).to.be.true;
          locky.lock({
            resource: 'article2',
            locker: 'john'
          }, callback);
        }
      ], (err, result) => {
        if (err) return done(err);
        expect(locked).to.be.calledOnce;
        expect(result).to.be.false;
        done();
      });
    });

    it('should set the correct ttl', (done) => {
      locky = createLocky({ ttl: 10000 });

      async.waterfall([
        (callback) => (
          locky.lock({
            resource: 'article3',
            locker: 'john'
          }, callback)
        ),
        (success, callback) => {
          locky.redis.ttl('lock:resource:article3', callback);
        }
      ], (err, ttl) => {
        if (err) return done(err);
        expect(ttl).to.be.most(10);
        done();
      });
    });

    it('should emit an expire event when the lock expire', (done) => {
      const spy = sinon.spy();
      locky = createLocky({ ttl: 100 });
      locky.on('expire', spy);

      async.waterfall([
        (callback) => (
          locky.lock({
            resource: 'article4',
            locker: 'john'
          }, callback)
        ),
        (success, callback) => setTimeout(() => callback(), 200)
      ], (err) => {
        if (err) return done(err);
        expect(spy).to.be.calledWith('article4');
        done();
      });
    });

    it('should emit a "lock" event', (done) => {
      const spy = sinon.spy();
      locky = createLocky({ ttl: 10000 });
      locky.on('lock', spy);

      locky.lock({
        resource: 'article5',
        locker: 'john'
      }, (err) => {
        if (err) return done(err);
        expect(spy).to.be.calledWith('article5', 'john');
        done();
      });
    });
  });

  describe('#refresh', () => {
    it('should refresh the ttl of a key', (done) => {
      locky = createLocky({ ttl: 30000 });

      const multi = locky.redis.multi();
      multi.set('lock:resource:article7', 'john');
      multi.expire('lock:resource:article7', 20);

      async.waterfall([
        (callback) => multi.exec(callback),
        (results, callback) => locky.redis.ttl('lock:resource:article7', callback)
      ], (err, ttl) => {
        if (err) return done(err);
        expect(ttl).to.be.most(30);
        done();
      });
    });

    it('should emit an expire event when the lock expire', (done) => {
      const spy = sinon.spy();
      locky = createLocky({ ttl: 100 });
      locky.on('expire', spy);

      const multi = locky.redis.multi();
      multi.set('lock:resource:article8', 'john');
      multi.expire('lock:resource:article8', 20);

      async.waterfall([
        (callback) => multi.exec(callback),
        (results, callback) => locky.refresh('article8', callback),
        (callback) => setTimeout(() => callback(), 200),
      ], (err) => {
        if (err) return done(err);
        expect(spy).to.be.calledWith('article8');
        done();
      });
    });
  });

  describe('#unlock', () => {
    it('should remove the key', (done) => {
      locky = createLocky();

      async.waterfall([
        (callback) => locky.redis.set('lock:resource:article10', 'john', callback),
        (result, callback) => locky.unlock('article10', callback),
        (callback) => locky.redis.exists('lock:resource:article10', callback)
      ], (err, exists) => {
        if (err) return done(err);
        expect(exists).to.equal(0);
        done();
      });
    });

    it('should emit a "unlock" event', (done) => {
      const spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      async.waterfall([
        (callback) => locky.redis.set('lock:resource:article11', 'john', callback),
        (result, callback) => locky.unlock('article11', callback)
      ], (err) => {
        if (err) return done(err);
        expect(spy).to.be.calledWith('article11');
        done();
      });
    });

    it('should not emit a "unlock" event if the resource is not locked', (done) => {
      const spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      locky.unlock('article12', (err) => {
        if (err) return done(err);
        expect(spy).to.not.be.called;
        done();
      });
    });

    it('should not expire if we "unlock"', (done) => {
      const spy = sinon.spy();
      locky = createLocky({ ttl: 100 });
      locky.on('expire', spy);

      async.waterfall([
        (callback) => (
          locky.lock({
            resource: 'article13',
            locker: 'john'
          }, callback)
        ),
        (success, callback) => locky.unlock('article13', callback),
        (callback) => setTimeout(() => callback(), 200)
      ], (err) => {
        if (err) return done(err);
        expect(spy).to.not.be.called;
        done();
      });
    });
  });

  describe('#getLocker', () => {
    it('should return the locker', (done) => {
      locky = createLocky();

      async.waterfall([
        (callback) => (
          locky.lock({
            resource: 'article14',
            locker: 'john'
          }, callback)
        ),
        (success, callback) => locky.getLocker('article14', callback)
      ], (err, locker) => {
        if (err) return done(err);
        expect(locker).to.eql('john');
        done();
      });
    });
  });

  describe('#close', () => {
    beforeEach(() => {
      locky = createLocky();
      sinon.spy(locky.redis, 'quit');
    });

    it('should close the redis connection', (done) => {
      locky.close((err) => {
        if (err) return done(err);
        expect(locky.redis.quit).to.be.called;
        locky = null;
        done();
      });
    });
  });
});
