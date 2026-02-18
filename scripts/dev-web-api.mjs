import { spawn } from 'node:child_process';

const children = [];

function start(name, cmd, args) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32'
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[${name}] exited by signal: ${signal}`);
    } else {
      console.log(`[${name}] exited with code: ${code}`);
    }

    if (code && code !== 0) {
      shutdown(1);
    }
  });

  children.push(child);
}

function shutdown(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(exitCode), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('api', 'npm', ['run', 'api:dev']);
start('web', 'npm', ['run', 'web:dev']);
