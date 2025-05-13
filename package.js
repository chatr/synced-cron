Package.describe({
  name: 'chatra:synced-cron',
  version: '1.0.1',
  summary: 'Define and run scheduled jobs across multiple servers.',
  git: 'https://github.com/chatr/synced-cron.git',
});

Npm.depends({
  '@breejs/later': '4.2.0',
});

Package.onUse((api) => {
  api.versionsFrom('3.0');
  api.use(['ecmascript', 'check', 'mongo'], 'server');
  api.mainModule('synced-cron-server.js', 'server');
  api.export('SyncedCron', 'server');
});

Package.onTest((api) => {
  api.use('chatra:synced-cron');
  api.use(['ecmascript', 'check', 'mongo', 'tinytest'], 'server');
  api.mainModule('synced-cron-tests.js', 'server');
});
