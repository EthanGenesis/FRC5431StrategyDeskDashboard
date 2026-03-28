import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const root = process.cwd();
const buildIdPath = path.join(root, '.next', 'BUILD_ID');
function npmInvocation(scriptArgs) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', ['npm', ...scriptArgs].join(' ')],
    };
  }

  return {
    command: 'npm',
    args: scriptArgs,
  };
}

function runOrExit(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(buildIdPath)) {
  console.log('No production build found for Playwright. Running npm run build first...');
  const buildInvocation = npmInvocation(['run', 'build']);
  runOrExit(buildInvocation.command, buildInvocation.args);
}

console.log('Starting Playwright web server on http://127.0.0.1:3001');

const startInvocation = npmInvocation([
  'run',
  'start',
  '--',
  '--hostname',
  '127.0.0.1',
  '--port',
  '3001',
]);
const child = spawn(startInvocation.command, startInvocation.args, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const eventName of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(eventName, () => {
    if (!child.killed) {
      child.kill(eventName);
    }
  });
}
