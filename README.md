# locky
[![Build Status](https://travis-ci.org/neoziro/locky.svg?branch=master)](https://travis-ci.org/neoziro/locky)
[![Dependency Status](https://david-dm.org/neoziro/locky.svg?theme=shields.io)](https://david-dm.org/neoziro/locky)
[![devDependency Status](https://david-dm.org/neoziro/locky/dev-status.svg?theme=shields.io)](https://david-dm.org/neoziro/locky#info=devDependencies)

Resource locking system.

## Install

```
npm install locky
```

## Usage

```js
var Locky = require('locky');

// Create a new locky client.
var locky = new Locky();

// Lock the resource 'article:12' with the locker 20.
locky.lock('article:12', 20, cb);

// Refresh the lock TTL of the resource 'article:12'.
locky.refresh('article:12', cb);

// Unlock the resource 'article:12.
locky.unlock('article:12', cb);

// Get the locker of the resource 'article:12'.
locky.getLocker('article:12', cb);
```

### new Locky(options)

Create a new locky client with some options.

#### redis

Type: `Object` or `Function`

If you specify an **object**, the properties will be used to call `redis.createClient` method.

```js
new Locky({
  redis: {
    port: 6379,
    host: '127.0.0.1',
    connect_timeout: 200
  }
})
```

If you specify a **function**, it will be called to create redis clients.

```js
var redis = require('redis');

new Locky({
  redis: createClient
})

function createClient() {
  var client = redis.createClient();
  client.select(1); // Choose a custom database.
  return client;
}
```

#### ttl

Type: `Number`

Define the expiration time of the lock in ms. Defaults to `null` (no expiration).

```js
new Locky({
  ttl: 2000
})
```

### locky.lock(opts, callback)

Lock a resource for a locker.

If the resource was already locked,
you can't lock it but by passing `force: true`.

```js
locky.lock({
  resource: 'article:23',
  locker: 20,
  force: false
}, function (err, res) { ... });
```

#### resource

Type: `String` | `Number`

Which resource would you like to lock.

#### locker

Type: `String` | `Number`

Which locker should lock the resource, can by any string.

#### force

Type: `Boolean`

Should we take a lock if it's already locked?

#### callback(err, res)

##### res

Type: `Boolean`

Was the lock successful? If so you will also get a `lock` event.

### locky.refresh(resource, callback)

Refresh the lock ttl of a resource, if the resource is not locked, do nothing.

```js
// Refresh the resource "article:23".
locky.refresh('article:23', function (err) { ... });
```

### locky.unlock(resource, callback)

Unlock a resource, if the resource is not locked, do nothing.

```js
// Unlock the resource "article:23".
locky.unlock('article:23', function (err) { ... });
```

### locky.getLocker(resource, callback)

Return the locker of a resource, if the resource is not locked, return `null`.

```js
// Return the locker of the resource "article:23".
locky.getLocker('article:23', function (err, locker) { ... });
```

### Events

#### "lock"

Emitted when a resource is locked.

```js
locky.on('lock', function (resource, locker) { ... });
```

#### "unlock"

Emitted when a resource is unlocked.

```js
locky.on('unlock', function (resource) { ... });
```

#### "expire"

Emitted when the lock on a resource has expired.

```js
locky.on('expire', function (resource) { ... });
```

## License

MIT