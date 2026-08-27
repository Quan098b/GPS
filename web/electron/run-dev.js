const { spawn } = require('child_process');
const electronPath = require('electron');

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], {
  cwd: require('path').join(__dirname, '..'),
  env: environment,
  stdio: 'inherit',
  windowsHide: false
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => { console.error(error); process.exit(1); });
