# chatra:synced-cron

This package is a fork of [littledata:synced-cron](https://github.com/percolatestudio/meteor-synced-cron), maintained under the name `chatra:synced-cron`.

[![Version](https://img.shields.io/badge/meteor-3.x-brightgreen?logo=meteor&logoColor=white)](https://github.com/chatr/synced-cron)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Define and run scheduled jobs across multiple servers in a synchronized manner using Meteor and MongoDB.

## Table of Contents

- [Introduction](#introduction)
- [Installation](#installation)
- [Usage](#usage)
  - [Adding Jobs](#adding-jobs)
  - [Starting the Scheduler](#starting-the-scheduler)
  - [Pausing and Stopping](#pausing-and-stopping)
  - [Removing Jobs](#removing-jobs)
  - [Configuration](#configuration)
- [Examples](#examples)
- [Logging](#logging)
- [Tests](#tests)
- [License](#license)

---

## Introduction

The `chatra:synced-cron` package allows you to schedule and run cron-like jobs in a Meteor application, synchronized across multiple server instances. It uses MongoDB to store job history and ensures that jobs are not executed multiple times across different servers.

---

## Installation

Install the package using Meteor's package manager:

```shell
meteor add chatra:synced-cron
```

---

## Usage

### Adding Jobs

Define a job by providing a unique name, a schedule, and a job function:

```javascript
import { SyncedCron } from 'meteor/chatra:synced-cron';

SyncedCron.add({
  name: 'My Job',
  schedule(parser) {
    // Parser is Later.js parser
    return parser.cron('0 * * * *'); // Runs every hour at minute 0
  },
  job(intendedAt) {
    // Your job logic here
    console.log('Running my job at', intendedAt);
    // Return a result if needed
    return 'Job completed';
  },
});
```

- **Parameters**:
    - `name` (string): Unique name for the job.
    - `schedule` (function): Function that returns a Later.js schedule.
    - `job` (function): The function to execute at scheduled times.
    - `persist` (boolean, optional): Whether to persist job history. Defaults to `true`.

### Starting the Scheduler

Start processing the added jobs:

```javascript
SyncedCron.start();
```

This should typically be called on the server during startup.

### Pausing and Stopping

- **Pause**: Temporarily stop processing jobs without removing them.

  ```javascript
  SyncedCron.pause();
  ```

- **Stop**: Stop processing and remove all jobs.

  ```javascript
  SyncedCron.stop();
  ```

### Removing Jobs

Remove a specific job by its name:

```javascript
SyncedCron.remove('My Job');
```

### Configuration

Configure `SyncedCron` by setting options:

```javascript
SyncedCron.config({
  log: true, // Enable or disable logging
  logger: null, // Provide a custom logger function
  collectionName: 'cronHistory', // Name of the MongoDB collection
  utc: false, // Use UTC time or local time
  collectionTTL: 172800, // Time in seconds for history records to expire (e.g., 48 hours)
});
```

- **Options**:
    - `log` (boolean): Enable or disable logging. Defaults to `true`.
    - `logger` (function): Custom logger function. Defaults to `console`.
    - `collectionName` (string): Name of the MongoDB collection for job history.
    - `utc` (boolean): Use UTC time for scheduling. Defaults to `false` (local time).
    - `collectionTTL` (number): Time-to-live in seconds for job history records. Set to `null` to disable expiration.

---

## Examples

### Scheduling a Job Every Day at Midnight

```javascript
SyncedCron.add({
  name: 'Midnight Job',
  schedule(parser) {
    return parser.cron('0 0 * * *'); // Every day at midnight
  },
  job() {
    // Job logic
    console.log('Running midnight job');
  },
});
```

### Using a Custom Logger

```javascript
SyncedCron.config({
  logger(opts) {
    // opts: { level, message, tag }
    console.log(`[${opts.level}] ${opts.tag}: ${opts.message}`);
  },
});
```

### Disabling Job Persistence

```javascript
SyncedCron.add({
  name: 'Transient Job',
  persist: false, // Do not store job history
  schedule(parser) {
    return parser.cron('*/5 * * * *'); // Every 5 minutes
  },
  job() {
    console.log('Running transient job');
  },
});
```

---

## Logging

By default, `SyncedCron` logs job start, completion, and errors to the console. You can customize logging behavior:

- **Disable Logging**:

  ```javascript
  SyncedCron.config({
    log: false,
  });
  ```

- **Custom Logger Function**:

  Provide a function to handle log messages:

  ```javascript
  SyncedCron.config({
    logger({ level, message, tag }) {
      // Handle log messages
      myCustomLogger.log(level, `${tag}: ${message}`);
    },
  });
  ```

    - **Parameters**:
        - `level` (string): Log level (`info`, `warn`, `error`, `debug`).
        - `message` (string): Log message.
        - `tag` (string): Tag identifying the source (`'SyncedCron'`).

---

## Tests

The package includes a comprehensive test suite. To run the tests:

```shell
meteor test-packages ./
```

---

## License

This package is licensed under the MIT License