const sinon = require('sinon');
const _ = require('lodash');
const Promise = require('bluebird');
const expect = require('chai').use(require('sinon-chai')).expect;
const redis = require('../lib/redis');
const Locky = require('../lib/locky');

const testRedis = redis.createClient();

describe('Locky', () => {
  let createLocky, locky;

  beforeEach((done) => {
    testRedis.smembersAsync('locky:current:locks')
    .then((keys) => {
      if (! keys || ! keys.length) return Promise.resolve(true);
      return testRedis.delAsync(keys);
    })
    .then(() => testRedis.delAsync('locky:current:locks'))
    .then(() => done())
    .catch(done);
  });

  beforeEach(() => {
    createLocky = (options) => {
      options = _.defaults(options || {});
      return new Locky(options);
    };
  });

  afterEach((done) => {
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
    });
  });

  describe('#lock', () => {
    it('should lock the user', () => {
      locky = createLocky();

      return locky.lock({
        resource: 'article1',
        locker: 'john'
      })
      .then(() => {
        return locky.redis.getAsync('lock:resource:article1').then((value) => {
          expect(value).to.equal('john');
          return true;
        });
      })
      .then(() => {
        return locky.redis.ttlAsync('lock:resource:article1').then((ttl) => {
          expect(ttl).to.equal(-1);
          return true;
        });
      });
    });

    it('should not be able to lock an already locked resource', () => {
      locky = createLocky();

      const locked = sinon.spy();
      locky.on('lock', locked);

      return locky.lock({
        resource: 'article2',
        locker: 'john'
      }).then((res) => {
        expect(res).to.be.true;

        return locky.lock({
          resource: 'article2',
          locker: 'john'
        });
      }).then((res) => {
        expect(locked).to.be.calledOnce;
        expect(res).to.be.false;
        return true;
      });
    });

    it('should set the correct ttl', () => {
      locky = createLocky({ ttl: 10000 });

      return locky.lock({
        resource: 'article3',
        locker: 'john'
      })
      .then(() => {
        return locky.redis.ttlAsync('lock:resource:article3');
      }).then((ttl) => {
        expect(ttl).to.be.most(10);
        return true;
      });
    });

    it('should emit an expire event when the lock expire', () => {
      const spy = sinon.spy();
      locky = createLocky({ ttl: 100 });
      locky.on('expire', spy);

      return locky.lock({
        resource: 'article4',
        locker: 'john'
      })
      .then(() => Promise.delay(250))
      .then(() => {
        expect(spy).to.be.calledWith('article4');
        return true;
      });
    });

    it('should emit a "lock" event', () => {
      const spy = sinon.spy();
      locky = createLocky({ ttl: 10000 });
      locky.on('lock', spy);

      return locky.lock({
        resource: 'article5',
        locker: 'john'
      })
      .then(() => {
        expect(spy).to.be.calledWith('article5', 'john');
        return true;
      });
    });
  });

  describe('#refresh', () => {
    it('should refresh the ttl of a key', () => {
      locky = createLocky({ ttl: 30000 });

      return locky.redis.setAsync('lock:resource:article7', 'john')
      .then(() => locky.redis.pexpireAsync('lock:resource:article7', 20))
      .then(() => locky.refresh('lock:resource:article7'))
      .then(() => locky.redis.ttlAsync('lock:resource:article7'))
      .then((ttl) => {
        expect(ttl).to.be.most(30);
        return true;
      });
    });

    it('should emit an expire event when the lock expire', () => {
      const spy = sinon.spy();
      locky = createLocky({ ttl: 100 });
      locky.on('expire', spy);

      return locky.redis.setAsync('lock:resource:article8', 'john')
      .then(() => locky.redis.saddAsync(locky.set, 'lock:resource:article8'))
      .then(() => locky.redis.pexpireAsync('lock:resource:article8', 20))
      .then(() => Promise.delay(250))
      .then(() => {
        expect(spy).to.be.calledWith('article8');
        return true;
      });
    });
  });

  describe('#unlock', () => {
    it('should remove the key', () => {
      locky = createLocky();

      return locky.redis.setAsync('lock:resource:article10', 'john')
      .then(() => locky.unlock('article10'))
      .then(() => {
        return locky.redis.existsAsync('lock:resource:article10');
      })
      .then((exists) => {
        expect(exists).to.equal(0);
        return true;
      });
    });

    it('should emit a "unlock" event', () => {
      const spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      return locky.redis.setAsync('lock:resource:article11', 'john')
      .then(() => locky.unlock('article11'))
      .then(() => {
        expect(spy).to.be.calledWith('article11');
        return true;
      });
    });

    it('should not emit a "unlock" event if the resource is not locked', () => {
      const spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      return locky
      .unlock('article12')
      .then(() => {
        expect(spy).to.not.be.called;
        return true;
      });
    });

    it('should not expire if we "unlock"', () => {
      const spy = sinon.spy();
      locky = createLocky({ ttl: 100 });
      locky.on('expire', spy);

      return locky.lock({
        resource: 'article13',
        locker: 'john'
      })
      .then(() => locky.unlock('article13'))
      .then(() => Promise.delay(250))
      .then(() => {
        expect(spy).to.not.be.called;
        return true;
      });
    });
  });

  describe('#getLocker', () => {
    it('should return the locker', () => {
      locky = createLocky();

      return locky
      .lock({
        resource: 'article14',
        locker: 'john'
      })
      .then(() => locky.getLocker('article14'))
      .then(function (locker) {
        expect(locker).to.eql('john');
        return true;
      });
    });
  });

  describe('#close', () => {
    beforeEach(() => {
      locky = createLocky();
      sinon.spy(locky.redis, 'quit');
    });

    it('should close the redis connection', () => {
      return locky.close()
      .then(() => {
        expect(locky.redis.quit).to.be.called;
        locky = null;
        return true;
      });
    });
  });

  describe('#callback', () => {
    beforeEach(() => {
      locky = createLocky();
    });

    it('should work with callback', (done) => {
      locky.lock({ resource: 'article1', locker: 'user1' }, done);
    });

    // https://github.com/petkaantonov/bluebird/issues/695
    // passed but skipped cause rejection error is on the output
    it.skip('should catch error with callback', (done) => {
      const error = new Error('hello');

      sinon.stub(locky.redis, 'setnxAsync').returns(Promise.reject(error));

      locky.lock({ resource: 'article1', locker: 'user1' }, (err) => {
        expect(err).to.eql(error);
        done();
      });
    });
  });
});
