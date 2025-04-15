# locky

![Node.js CI](https://github.com/lemonde/locky/workflows/Node.js%20CI/badge.svg)

Fast resource locking system based on redis.

## Install

```
npm install locky
```

## Usage

```js
import redis from "redis";
import { createClient } from "locky";

// Create a new locky client.
const locky = await createClient({ redis: () => redis.createClient() });

// Lock the resource 'article:12' with the locker 20.
await locky.lock("article:12", 20);

// Refresh the lock TTL of the resource 'article:12'.
await locky.refresh("article:12");

// Unlock the resource 'article:12.
await locky.unlock("article:12");

// Get the locker of the resource 'article:12'.
await locky.getLocker("article:12");
```

### createClient(options)

Create a new locky client with some options.

#### redis

Type: `import('redis').ClientOpts | (() => import('redis').RedisClient)`

If you specify an **object**, the properties will be used to call `redis.createClient` method.

```js
await createClient({
  redis: {
    port: 6379,
    host: "127.0.0.1",
    connect_timeout: 200,
  },
});
```

If you specify a **function**, it will be called to create redis clients.

```js
import redis from "redis";

await createClient({
  redis: () => redis.createClient(),
});
```

#### ttl

Type: `number`

Define the expiration time of the lock in ms. Defaults to `null` (no expiration).

```js
const locky = await createClient({ ttl: 2000 });
```

#### prefix

Type: `string`, default: `"locky:"`

Define the prefix of every keys used by locky.

```js
const locky = await createClient({ prefix: "something:" });
```

### locky.startExpirateWorker()

Start an expiration worker, it means locky will emit "expire" events.

### locky.lock(options, [callback])

Lock a resource for a locker.

If the resource was already locked,
you can't lock it but by passing `force: true`.

```js
const locked = await locky.lock({
  resource: "article:23",
  locker: 20,
  force: false,
});
// `locked` is `true` if lock has been taken, `false` if not
```

#### resource

Type: `string | number`

Which resource would you like to lock.

#### locker

Type: `string | number`

Which locker should lock the resource, can by any string.

#### force

Type: `boolean`

Should we take a lock if it's already locked?

### locky.refresh(resource, [callback])

Refresh the lock ttl of a resource, if the resource is not locked, do nothing.

```js
// Refresh the resource "article:23".
locky.refresh('article:23').then(...);
```

### locky.unlock(resource, [callback])

Unlock a resource, if the resource is not locked, do nothing.

```js
// Unlock the resource "article:23".
locky.unlock('article:23').then(...);
```

### locky.getLocker(resource, [callback])

Return the locker of a resource, if the resource is not locked, return `null`.

```js
// Return the locker of the resource "article:23".
locky.getLocker('article:23').then(...);
```

### Events

#### "lock"

Emitted when a resource is locked.

```js
locky.on("lock", (resource, locker) => {
  /* ... */
});
```

#### "unlock"

Emitted when a resource is unlocked.

```js
locky.on("unlock", (resource) => {
  /* ... */
});
```

#### "expire"

Emitted when the lock on a resource has expired.

```js
locky.on("expire", (resource) => {
  /* ... */
});
```

## License

MIT
