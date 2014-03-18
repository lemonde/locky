# locky

User / resource locking system.

## Usage

```js
var Locky = require('locky');

// Create a new locky client.
var locky = new Locky();

// Lock a resource.
locky.lock(resourceId, userId, cb);

// Refresh the lock on a resource.
locky.refresh(resourceId, cb);

// Unlock a resource.
locky.unlock(resourceId, cb);

// Get locker.
locky.getLocker(resourceId, cb);
```

### new Locky(options)

Create a new locky client with some options.

#### redis

Type: `Object` or `Function`

If you specify an **object**, the properties will be used to call `redis.createClient` method. The redis module used
will be the Redis module installed. This project doesn't have [node_redis](https://github.com/mranney/node_redis/) module as dependency.

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

#### unserializeUser

Type: `Object`

Define a user adapter to serialize and unserialize user.

```js
new Locky({
  unserializeUser: function unserializeUser(id, cb) {
    cb(null, { id: id, type: 'user' });
  }
})
```

#### ttl

Type: `Number`

Define the expiration time of the lock in ms. Defaults to `null` (no expiration).

```js
new Locky({
  ttl: 2000
})
```

### locky.lock(resourceId, userId, callback)

Lock a resource to a user.

```js
// Lock the resource "article:23" with the user "20".
locky.lock('article:23', 20, function (err) { ... });
```

### locky.refresh(resourceId, callback)

Refresh the lock ttl of a resource, if the resource is not locked, do nothing.

```js
// Refresh the resource "article:23".
locky.refresh('article:23', function (err) { ... });
```

### locky.unlock(resourceId, callback)

Unlock a resource, if the resource is not locked, do nothing.

```js
// Unlock the resource "article:23".
locky.unlock('article:23', function (err) { ... });
```

### locky.getLocker(resourceId, callback)

Return the locker of a resource, if the resource is not locked, return `null`.

```js
// Return the locker of the resource "article:23".
locky.getLocker('article:23', function (err, user) { ... });
```

## License

MIT