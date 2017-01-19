const redis = require('then-redis');
const sinon = require('sinon');
const _ = require('lodash');
const expect = require('chai').use(require('sinon-chai')).expect;
const Locky = require('../lib/locky');

const testRedis = redis.createClient();

describe('Locky', () => {
  let createLocky, locky;

  beforeEach(() => {
    return testRedis.keys('lock:resource*')
    .then((keys) => {
      if (!keys || !keys.length) return;
      return testRedis.del(keys);
    });
  });

  beforeEach(() => {
    createLocky = function createLocky(options) {
      options = _.defaults(options || {});
      return new Locky(options);
    };
  });

  afterEach(() => {
    if (!locky) return;
    return locky.close();
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
        createLocky({
          redis: redis.createClient
        });

        expect(redis.createClient).to.be.called;
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
        return locky.redis.get('lock:resource:article1').then((value) => {
          expect(value).to.equal('john');
        });
      })
      .then(() => {
        return locky.redis.ttl('lock:resource:article1').then((ttl) => {
          expect(ttl).to.equal(-1);
        });
      });
    });

    it('should lock many users', () => {
      locky = createLocky();

      return locky.lock({
        bulk: [{
          resource: 'article1',
          locker: 'john'
        }, {
          resource: 'article10',
          locker: 'marc'
        }]
      })
      .then(() => {
        return locky.redis.get('lock:resource:article1').then((value) => {
          expect(value).to.equal('john');
        });
      })
      .then(() => {
        return locky.redis.get('lock:resource:article10').then((value) => {
          expect(value).to.equal('marc');
        });
      })
      .then(() => {
        return locky.redis.ttl('lock:resource:article1').then((ttl) => {
          expect(ttl).to.equal(-1);
        });
      })
      .then(() => {
        return locky.redis.ttl('lock:resource:article10').then((ttl) => {
          expect(ttl).to.equal(-1);
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
      });
    });

    it('should not be able to lock an already locked resource inside bulk', () => {
      locky = createLocky();

      const locked = sinon.spy();
      locky.on('lock', locked);

      return locky.lock({
        resource: 'article2',
        locker: 'john'
      })
      .then(() => {
        return locky.lock({
          bulk: [{
            resource: 'article1',
            locker: 'john'
          }, {
            resource: 'article2',
            locker: 'marc'
          }, {
            resource: 'article20',
            locker: 'tandy'
          }]
        });
      })
      .then((res) => {
        expect(res).to.be.true;

        return locky.lock({
          resource: 'article2',
          locker: 'john'
        });
      }).then((res) => {
        expect(locked).to.be.calledThrice;
        expect(res).to.be.false;
      });
    });

    it('should set the correct ttl', () => {
      locky = createLocky({ttl: 10000});

      return locky.lock({
        resource: 'article3',
        locker: 'john'
      })
      .then(() => {
        return locky.redis.ttl('lock:resource:article3').then(function (ttl) {
          expect(ttl).to.be.most(10);
        });
      });
    });

    it('should emit an expire event when the lock expire', () => {
      const spy = sinon.spy();
      locky = createLocky({ttl: 100});
      locky.on('expire', spy);

      return locky.lock({
        resource: 'article4',
        locker: 'john'
      })
      .then(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve(true), 200);
        });
      })
      .then(() => {
        expect(spy).to.be.calledWith('article4');
      });
    });

    it('should emit a "lock" event', () => {
      const spy = sinon.spy();
      locky = createLocky({ttl: 10000});
      locky.on('lock', spy);

      return locky.lock({
        resource: 'article5',
        locker: 'john'
      })
      .then(() => {
        expect(spy).to.be.calledWith('article5', 'john');
      });
    });
  });

  describe('#refresh', () => {
    it('should refresh the ttl of a key', () => {
      locky = createLocky({ttl: 30000});

      locky.redis.multi();
      locky.redis.set('lock:resource:article7', 'john');
      locky.redis.expire('lock:resource:article7', 20);
      return locky.redis.exec()
      .then(() => {
        return locky.refresh('lock:resource:article7');
      })
      .then(() => {
        return locky.redis.ttl('lock:resource:article7').then(function (ttl) {
          expect(ttl).to.be.most(30);
        });
      });
    });

    it('should emit an expire event when the lock expire', () => {
      const spy = sinon.spy();
      locky = createLocky({ttl: 100});
      locky.on('expire', spy);

      locky.redis.multi();
      locky.redis.set('lock:resource:article8', 'john');
      locky.redis.expire('lock:resource:article8', 20);
      return locky.redis.exec()
      .then(() => {
        locky.refresh('article8');
        return new Promise(resolve => {
          setTimeout(() => resolve(true), 200);
        });
      })
      .then(() => {
        expect(spy).to.be.calledWith('article8');
      });
    });

    it('should refresh the ttl of all keys', () => {
      locky = createLocky({ttl: 30000});

      locky.redis.multi();
      locky.redis.set('lock:resource:article7', 'john');
      locky.redis.expire('lock:resource:article7', 20);
      locky.redis.set('lock:resource:article17', 'marc');
      locky.redis.expire('lock:resource:article17', 20);
      return locky.redis.exec()
      .then(() => {
        return locky.refresh(['lock:resource:article7', 'lock:resource:article17']);
      })
      .then(() => {
        return locky.redis.ttl('lock:resource:article7').then(function (ttl) {
          expect(ttl).to.be.most(30);
        });
      })
      .then(() => {
        return locky.redis.ttl('lock:resource:article17').then(function (ttl) {
          expect(ttl).to.be.most(30);
        });
      });
    });

    it('should emit an expire event when the locks expire', () => {
      const spy = sinon.spy();
      locky = createLocky({ttl: 100});
      locky.on('expire', spy);

      locky.redis.multi();
      locky.redis.set('lock:resource:article8', 'john');
      locky.redis.expire('lock:resource:article8', 20);
      locky.redis.set('lock:resource:article18', 'marc');
      locky.redis.expire('lock:resource:article18', 20);
      return locky.redis.exec()
      .then(() => {
        locky.refresh(['article8', 'article18']);
        return new Promise(resolve => {
          setTimeout(() => resolve(true), 200);
        });
      })
      .then(() => {
        expect(spy).to.be.calledWith('article8');
        expect(spy).to.be.calledWith('article18');
      });
    });
  });

  describe('#unlock', () => {
    it('should remove the key', () => {
      locky = createLocky();

      return locky.redis.set('lock:resource:article10', 'john')
      .then(() => {
        return locky.unlock('article10');
      })
      .then(() => {
        return locky.redis.exists('lock:resource:article10').then(function (exists) {
          expect(exists).to.equal(0);
        });
      });
    });

    it('should emit a "unlock" event', () => {
      const spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      return locky.redis.set('lock:resource:article11', 'john')
      .then(() => {
        return locky.unlock('article11');
      })
      .then(() => {
        expect(spy).to.be.calledWith('article11');
      });
    });

    it('should not emit a "unlock" event if the resource is not locked', () => {
      const spy = sinon.spy();
      locky = createLocky();
      locky.on('unlock', spy);

      return locky.unlock('article12')
      .then(() => {
        expect(spy).to.not.be.called;
      });
    });

    it('should not expire if we "unlock"', () => {
      const spy = sinon.spy();
      locky = createLocky({ttl: 100});
      locky.on('expire', spy);

      return locky.lock({
        resource: 'article13',
        locker: 'john'
      })
      .then(() => {
        return locky.unlock('article13');
      })
      .then(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve(true), 200);
        });
      })
      .then(() => {
        expect(spy).to.not.be.called;
      });
    });
  });

  describe('#getLocker', () => {
    it('should return the locker', () => {
      locky = createLocky();

      return locky.lock({
        resource: 'article14',
        locker: 'john'
      })
      .then(() => {
        return locky.getLocker('article14').then(function (locker) {
          expect(locker).to.eql('john');
        });
      });
    });

    it('should return the lockers', () => {
      locky = createLocky();

      return locky.lock({
        resource: 'article14',
        locker: 'john'
      })
      .then(() => {
        return locky.lock({
          resource: 'article15',
          locker: 'marc'
        });
      })
      .then(() => {
        return locky.lock({
          resource: 'article16',
          locker: 'kevin'
        });
      })
      .then(() => {
        return locky.lock({
          resource: 'article17',
          locker: 'kevin'
        });
      })
      .then(() => {
        return locky.getLocker([
          'article14',
          null,
          'article15',
          'unknown',
          'article16',
          'article17'
        ]);
      })
      .then((lockers) => {
        expect(lockers).to.eql([
          'john',
          null,
          'marc',
          null,
          'kevin',
          'kevin'
        ]);
      });
    });
  });

  describe('#close', () => {
    beforeEach(() => {
      locky = createLocky();
      sinon.spy(locky.redis, 'quit');
    });

    it('should close the redis connection', () => {
      return locky.close().then(() => {
        expect(locky.redis.quit).to.be.called;
        locky = null;
      });
    });
  });
});
