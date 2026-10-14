// `npm run dev`: the API server (auto-restart on change, data in ./data) plus
// the Vite dev server (hot reload, proxies /api to the API). Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('server/node_modules')) {
  console.error('Server dependencies are missing — run `npm run setup` first.');
  process.exit(1);
}

const apiPort = process.env.PORT || '8080';
const children = [
  spawn(process.execPath, ['--watch', 'server/src/index.ts'], {
    stdio: 'inherit',
    // STATIC_DIR="" → API only; Vite serves the app in development.
    env: { ...process.env, PORT: apiPort, STATIC_DIR: '' },
  }),
  spawn('npx', ['vite'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, TOMURIZED_API: process.env.TOMURIZED_API || `http://localhost:${apiPort}` },
  }),
];

let exiting = false;
const stopAll = (code = 0) => {
  if (exiting) return;
  exiting = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exitCode = code;
};
for (const c of children) c.on('exit', (code) => stopAll(code ?? 0));
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
