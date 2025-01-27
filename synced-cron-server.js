import {Meteor} from 'meteor/meteor';
import {Mongo} from 'meteor/mongo';
import {check, Match} from 'meteor/check';
import Later from '@breejs/later';

/**
 * SyncedCron object for managing scheduled jobs.
 */
const SyncedCron = {
  _entries: {},
  running: false,
  options: {
    // Log job run details to console
    log: true,

    logger: null,

    // Name of collection to use for synchronization and logging
    collectionName: 'cronHistory',

    // Default to using localTime
    utc: false,

    // TTL in seconds for history records in collection to expire
    // NOTE: Unset to remove expiry but ensure you remove the index from MongoDB manually
    collectionTTL: 172800,
  },

  /**
   * Configures SyncedCron options.
   * @param {Object} opts - Options to configure.
   */
  config(opts) {
    this.options = Object.assign({}, this.options, opts);
  },
};

export {SyncedCron};

/**
 * Logger factory function.
 * @param {string} prefix - Prefix for log messages.
 * @return {Function} Logger function.
 */
function createLogger(prefix) {
  check(prefix, String);

  // Return noop if logging is disabled.
  if (SyncedCron.options.log === false) {
    return function () {};
  }

  return function (level, message) {
    check(level, Match.OneOf('info', 'error', 'warn', 'debug'));
    check(message, String);

    const logger = SyncedCron.options && SyncedCron.options.logger;

    if (logger && typeof logger === 'function') {
      logger({
        level,
        message,
        tag: prefix,
      });
    } else {
      console[level](`${prefix}: ${message}`);
    }
  };
}

let log;

Meteor.startup(() => {
  const options = SyncedCron.options;

  log = createLogger('SyncedCron');

  ['info', 'warn', 'error', 'debug'].forEach((level) => {
    log[level] = (message) => log(level, message);
  });

  // Don't allow TTL less than 5 minutes to avoid breaking synchronization
  const minTTL = 300;

  // Use UTC or localTime for evaluating schedules
  if (options.utc) {
    Later.date.UTC();
  } else {
    Later.date.localTime();
  }

  // Collection holding the job history records
  SyncedCron._collection = new Mongo.Collection(options.collectionName);

  // Create indexes asynchronously
  (async () => {
    try {
      await SyncedCron._collection.createIndexAsync(
          {intendedAt: 1, name: 1},
          {unique: true}
      );

      if (options.collectionTTL) {
        if (options.collectionTTL > minTTL) {
          await SyncedCron._collection.createIndexAsync(
              {startedAt: 1},
              {expireAfterSeconds: options.collectionTTL}
          );
        } else {
          log.warn(`Not going to use a TTL that is shorter than: ${minTTL}`);
        }
      }
    } catch (error) {
      log.error(`Error creating indexes: ${error.message}`);
    }
  })();
});

/**
 * Schedules a job entry.
 * @param {Object} entry - The job entry to schedule.
 */
function scheduleEntry(entry) {
  const schedule = entry.schedule(Later.parse);
  entry._timer = SyncedCron._laterSetInterval(SyncedCron._entryWrapper(entry), schedule);

  log.info(
      `Scheduled "${entry.name}" next run @ ${Later.schedule(schedule).next(1)}`
  );
}

/**
 * Adds a scheduled job.
 * @param {Object} entry - The job entry to add.
 */
SyncedCron.add = function (entry) {
  check(entry.name, String);
  check(entry.schedule, Function);
  check(entry.job, Function);
  check(entry.persist, Match.Optional(Boolean));

  if (entry.persist === undefined) {
    entry.persist = true;
  }

  if (!this._entries[entry.name]) {
    this._entries[entry.name] = entry;

    // If cron is already running, start directly.
    if (this.running) {
      scheduleEntry(entry);
    }
  }
};

/**
 * Starts processing added jobs.
 */
SyncedCron.start = function () {
  const self = this;

  Meteor.startup(() => {
    // Schedule each job with Later.js
    Object.values(self._entries).forEach((entry) => {
      scheduleEntry(entry);
    });
    self.running = true;
  });
};

/**
 * Returns the next scheduled date of the specified job.
 * @param {string} jobName - The name of the job.
 * @return {Date} The next scheduled date.
 */
SyncedCron.nextScheduledAtDate = function (jobName) {
  const entry = this._entries[jobName];

  if (entry) {
    return Later.schedule(entry.schedule(Later.parse)).next(1);
  }
};

/**
 * Removes and stops the job entry.
 * @param {string} jobName - The name of the job to remove.
 */
SyncedCron.remove = function (jobName) {
  const entry = this._entries[jobName];

  if (entry) {
    if (entry._timer) {
      entry._timer.clear();
    }

    delete this._entries[jobName];
    log.info(`Removed "${entry.name}"`);
  }
};

/**
 * Pauses processing but does not remove jobs.
 */
SyncedCron.pause = function () {
  if (this.running) {
    Object.values(this._entries).forEach((entry) => {
      entry._timer.clear();
    });
    this.running = false;
  }
};

/**
 * Stops processing and removes all jobs.
 */
SyncedCron.stop = function () {
  Object.keys(this._entries).forEach((name) => {
    SyncedCron.remove(name);
  });
  this.running = false;
};

/**
 * Wraps a job entry for execution.
 * @param {Object} entry - The job entry.
 * @return {Function} The wrapped job function.
 */
SyncedCron._entryWrapper = function (entry) {
  const self = this;

  return async function (intendedAt) {
    intendedAt = new Date(intendedAt.getTime());
    intendedAt.setMilliseconds(0);

    let jobHistory;

    if (entry.persist) {
      jobHistory = {
        intendedAt,
        name: entry.name,
        startedAt: new Date(),
      };

      // If we have a dup key error, another instance has already tried to run this job.
      try {
        jobHistory._id = await self._collection.insertAsync(jobHistory);
      } catch (e) {
        // Duplicate key error
        if (e.code === 11000) {
          log.info(`Not running "${entry.name}" again.`);
          return;
        }
        throw e;
      }
    }

    // Run and record the job
    try {
      log.info(`Starting "${entry.name}".`);
      const output = await entry.job(intendedAt, entry.name); // Run the actual job

      log.info(`Finished "${entry.name}".`);
      if (entry.persist) {
        await self._collection.updateAsync(
            {_id: jobHistory._id},
            {
              $set: {
                finishedAt: new Date(),
                result: output,
              },
            }
        );
      }
    } catch (e) {
      log.error(`Exception "${entry.name}" ${e && e.stack ? e.stack : e}`);
      if (entry.persist) {
        await self._collection.updateAsync(
            {_id: jobHistory._id},
            {
              $set: {
                finishedAt: new Date(),
                error: e && e.stack ? e.stack : e,
              },
            }
        );
      }
    }
  };
};

/**
 * Resets SyncedCron for testing purposes.
 */
SyncedCron._reset = async function () {
  this._entries = {};
  await this._collection.removeAsync({});
  this.running = false;
};

// ---------------------------------------------------------------------------
// The following functions are modified versions of those from the Later.js package.
// Adjusted to work with asynchronous functions and Meteor 3.
// ---------------------------------------------------------------------------

/**
 * Schedules a function to run at specified intervals.
 * @param {Function} fn - The function to schedule.
 * @param {Object} sched - The schedule object.
 * @return {Object} An object with a clear method to stop the interval.
 */
SyncedCron._laterSetInterval = function (fn, sched) {
  let t = SyncedCron._laterSetTimeout(scheduleTimeout, sched);
  let done = false;

  /**
   * Executes the specified function and then sets the timeout for the next interval.
   * @param {Date} intendedAt - The intended execution time.
   */
  async function scheduleTimeout(intendedAt) {
    if (!done) {
      try {
        await fn(intendedAt);
      } catch (e) {
        log.error(`Exception running scheduled job ${e && e.stack ? e.stack : e}`);
      }

      t = SyncedCron._laterSetTimeout(scheduleTimeout, sched);
    }
  }

  return {
    /**
     * Clears the interval.
     */
    clear() {
      done = true;
      t.clear();
    },
  };
};

/**
 * Schedules a function to run after a specified timeout.
 * @param {Function} fn - The function to schedule.
 * @param {Object} sched - The schedule object.
 * @return {Object} An object with a clear method to stop the timeout.
 */
SyncedCron._laterSetTimeout = function (fn, sched) {
  const s = Later.schedule(sched);
  let t;
  scheduleTimeout();

  /**
   * Schedules the timeout to occur.
   */
  function scheduleTimeout() {
    const now = Date.now();
    const next = s.next(2, now);

    // Don't schedule another occurrence if no more exist
    if (!next[0]) return;

    let diff = next[0].getTime() - now;
    let intendedAt = next[0];

    // Minimum time to fire is one second; use next occurrence instead
    if (diff < 1000) {
      diff = next[1].getTime() - now;
      intendedAt = next[1];
    }

    if (diff < 2147483647) {
      t = setTimeout(async () => {
        await fn(intendedAt);
      }, diff);
    } else {
      t = setTimeout(scheduleTimeout, 2147483647);
    }
  }

  return {
    /**
     * Clears the timeout.
     */
    clear() {
      clearTimeout(t);
    },
  };
};

// ---------------------------------------------------------------------------