# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
