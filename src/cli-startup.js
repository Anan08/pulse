const {
  enableStartup,
  disableStartup,
  getStartupStatus,
  ensureLaunchScripts,
} = require('./core/startup');

const action = (process.argv[2] || 'status').toLowerCase();

ensureLaunchScripts();

if (action === 'enable') {
  const status = enableStartup();
  console.log('Windows Startup enabled:', JSON.stringify(status, null, 2));
} else if (action === 'disable') {
  const status = disableStartup();
  console.log('Windows Startup disabled:', JSON.stringify(status, null, 2));
} else {
  const status = getStartupStatus();
  console.log('Windows Startup status:', JSON.stringify(status, null, 2));
}
