import {Meteor} from 'meteor/meteor';
import {Tinytest} from 'meteor/tinytest';
import Later from '@breejs/later';
import {SyncedCron} from './synced-cron-server.js';

/**
 * Initialize Later.js to use local time.
 */
Later.date.localTime(); // corresponds to SyncedCron.options.utc: false

const TestEntry = {
  name: 'Test Job',
  schedule(parser) {
    return parser.cron('15 10 * * ? *'); // Not required
  },
  job() {
    return 'ran';
  },
};

Tinytest.addAsync('Syncing works', async function (test) {
  await SyncedCron._reset();
  const count = await SyncedCron._collection.find().countAsync();
  test.equal(count, 0);

  // Add the entry
  SyncedCron.add(TestEntry);
  test.equal(Object.keys(SyncedCron._entries).length, 1);

  const entry = SyncedCron._entries[TestEntry.name];
  const intendedAt = new Date();

  // First run
  await SyncedCron._entryWrapper(entry)(intendedAt);
  const countAfterFirstRun = await SyncedCron._collection.find().countAsync();
  test.equal(countAfterFirstRun, 1);

  const jobHistory1 = await SyncedCron._collection.findOneAsync();
  test.equal(jobHistory1.result, 'ran');

  // Second run
  await SyncedCron._entryWrapper(entry)(intendedAt);
  const countAfterSecondRun = await SyncedCron._collection.find().countAsync();
  test.equal(countAfterSecondRun, 1); // Should still be 1

  const jobHistory2 = await SyncedCron._collection.findOneAsync();
  test.equal(jobHistory1._id, jobHistory2._id);
});

Tinytest.addAsync('Exceptions work', async function (test) {
  await SyncedCron._reset();
  SyncedCron.add({
    ...TestEntry,
    job() {
      throw new Meteor.Error('Haha, gotcha!');
    },
  });

  const entry = SyncedCron._entries[TestEntry.name];
  const intendedAt = new Date();

  // Error without result
  await SyncedCron._entryWrapper(entry)(intendedAt);
  const count = await SyncedCron._collection.find().countAsync();
  test.equal(count, 1);

  const jobHistory1 = await SyncedCron._collection.findOneAsync();
  test.equal(jobHistory1.result, undefined);
  test.matches(jobHistory1.error, /Haha, gotcha/);
});

Tinytest.addAsync('SyncedCron.nextScheduledAtDate works', async function (test) {
  await SyncedCron._reset();
  const count = await SyncedCron._collection.find().countAsync();
  test.equal(count, 0);

  // Add entries
  SyncedCron.add(TestEntry);

  const entry2 = {
    ...TestEntry,
    name: 'Test Job2',
    schedule(parser) {
      return parser.cron('30 11 * * ? *');
    },
  };
  SyncedCron.add(entry2);

  test.equal(Object.keys(SyncedCron._entries).length, 2);

  SyncedCron.start();

  const date = SyncedCron.nextScheduledAtDate(entry2.name);
  const correctDate = Later.schedule(entry2.schedule(Later.parse)).next(1);

  test.equal(date.getTime(), correctDate.getTime());
});

// Tests SyncedCron.remove in the process
Tinytest.addAsync('SyncedCron.stop works', async function (test) {
  await SyncedCron._reset();
  const count = await SyncedCron._collection.find().countAsync();
  test.equal(count, 0);

  // Add entries
  SyncedCron.add(TestEntry);

  const entry2 = {
    ...TestEntry,
    name: 'Test Job2',
    schedule(parser) {
      return parser.cron('30 11 * * ? *');
    },
  };
  SyncedCron.add(entry2);

  SyncedCron.start();

  test.equal(Object.keys(SyncedCron._entries).length, 2);

  SyncedCron.stop();

  test.equal(Object.keys(SyncedCron._entries).length, 0);
});

Tinytest.addAsync('SyncedCron.pause works', async function (test) {
  await SyncedCron._reset();
  const count = await SyncedCron._collection.find().countAsync();
  test.equal(count, 0);

  // Add entries
  SyncedCron.add(TestEntry);

  const entry2 = {
    ...TestEntry,
    name: 'Test Job2',
    schedule(parser) {
      return parser.cron('30 11 * * ? *');
    },
  };
  SyncedCron.add(entry2);

  SyncedCron.start();

  test.equal(Object.keys(SyncedCron._entries).length, 2);

  SyncedCron.pause();

  test.equal(Object.keys(SyncedCron._entries).length, 2);
  test.isFalse(SyncedCron.running);

  SyncedCron.start();

  test.equal(Object.keys(SyncedCron._entries).length, 2);
  test.isTrue(SyncedCron.running);
});

// Tests SyncedCron.remove in the process
Tinytest.addAsync('SyncedCron.add starts by itself when running', async function (test) {
  await SyncedCron._reset();

  const count = await SyncedCron._collection.find().countAsync();
  test.equal(count, 0);
  test.equal(SyncedCron.running, false);

  SyncedCron.start();

  test.equal(SyncedCron.running, true);

  // Add an entry
  SyncedCron.add(TestEntry);

  test.equal(Object.keys(SyncedCron._entries).length, 1);

  SyncedCron.stop();

  test.equal(SyncedCron.running, false);
  test.equal(Object.keys(SyncedCron._entries).length, 0);
});

Tinytest.addAsync('SyncedCron.config can customize the options object', async function (test) {
  await SyncedCron._reset();

  SyncedCron.config({
    log: false,
    collectionName: 'foo',
    utc: true,
    collectionTTL: 0,
  });

  test.equal(SyncedCron.options.log, false);
  test.equal(SyncedCron.options.collectionName, 'foo');
  test.equal(SyncedCron.options.utc, true);
  test.equal(SyncedCron.options.collectionTTL, 0);
});

Tinytest.addAsync('SyncedCron can log to injected logger', async function (test, onComplete) {
  await SyncedCron._reset();

  const logger = function () {
    test.isTrue(true);

    SyncedCron.stop();
    onComplete();
  };

  SyncedCron.options.logger = logger;

  SyncedCron.add(TestEntry);
  SyncedCron.start();

  SyncedCron.options.logger = null;
});

Tinytest.addAsync('SyncedCron should pass correct arguments to logger', async function (test, onComplete) {
  await SyncedCron._reset();

  const logger = function (opts) {
    test.include(opts, 'level');
    test.include(opts, 'message');
    test.include(opts, 'tag');
    test.equal(opts.tag, 'SyncedCron');

    SyncedCron.stop();
    onComplete();
  };

  SyncedCron.options.logger = logger;

  SyncedCron.add(TestEntry);
  SyncedCron.start();

  SyncedCron.options.logger = null;
});

Tinytest.addAsync('Single time schedules do not break', async function (test) {
  // Create a one-off date 1 second in the future
  const date = new Date(Date.now() + 1000);
  const schedule = Later.parse.recur().on(date).fullDate();

  // This would throw without the patch for issue #41
  await SyncedCron._laterSetTimeout(() => {}, schedule);
  test.isTrue(true);
});

Tinytest.addAsync('Do not persist when flag is set to false', async function (test) {
  await SyncedCron._reset();

  const testEntryNoPersist = {...TestEntry, persist: false};

  SyncedCron.add(testEntryNoPersist);

  const now = new Date();
  await SyncedCron._entryWrapper(testEntryNoPersist)(now);
  const count = await SyncedCron._collection.find().countAsync();
  test.equal(count, 0);
});
