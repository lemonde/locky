# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [6.0.0](https://github.com/lemonde/locky/compare/v4.0.1...v6.0.0) (2026-01-21)


### ⚠ BREAKING CHANGES

* **redis:**     - `createClient()` is now async
    - redis configuration object must follow [node-redis@v4](https://github.com/redis/node-redis/blob/master/docs/v3-to-v4.md#createclient)

* **redis:** use redis@4.7.0 ([d82f029](https://github.com/lemonde/locky/commit/d82f02945d646d2bda6972203839ba67ec2ed0a9))

## [5.0.0](https://github.com/lemonde/locky/compare/v4.0.1...v5.0.0) (2025-04-15)


### ⚠ BREAKING CHANGES

* **redis:**     - `createClient()` is now async
    - redis configuration object must follow [node-redis@v4](https://github.com/redis/node-redis/blob/master/docs/v3-to-v4.md#createclient)

* **redis:** use redis@4.7.0 ([d82f029](https://github.com/lemonde/locky/commit/d82f02945d646d2bda6972203839ba67ec2ed0a9))

### [4.0.1](https://github.com/lemonde/locky/compare/v4.0.0...v4.0.1) (2022-07-26)


### Bug Fixes

* **worker:** fix worker lock algorithm ([ccf24ef](https://github.com/lemonde/locky/commit/ccf24efa2b3582ffef88badd98e6eda331ba8f94))

## [4.0.0](https://github.com/lemonde/locky/compare/v3.0.0...v4.0.0) (2021-09-03)


### ⚠ BREAKING CHANGES

* resource keys are now prefixed by "locky:lock:" instead of "lock:resource:", "set" option is no longer available.

### Features

* allow prefix configuration ([7eb9254](https://github.com/lemonde/locky/commit/7eb9254ca3aa979ca45d93c9fc6174fb8ec5b7a6))
* **worker:** better watching with separated client ([994bb83](https://github.com/lemonde/locky/commit/994bb83c987d31140281bf142487f1d99bfed9c1))


### Bug Fixes

* **worker:** more robust expiration worker ([c744257](https://github.com/lemonde/locky/commit/c7442575b902fb1e71b80d3db573aaf7b396a98d))

## [3.0.0](https://github.com/lemonde/locky/compare/v2.2.2...v3.0.0) (2021-09-02)


### ⚠ BREAKING CHANGES

* createClient & startExpirationWorker

### Features

* modernize project ([#21](https://github.com/lemonde/locky/issues/21)) ([b8f696b](https://github.com/lemonde/locky/commit/b8f696b1f23c680c1f79d7d72b019eb0c2625e6c))
