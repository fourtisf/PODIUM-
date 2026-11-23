// PM2 template for Podium, Phase 1. Start with: pm2 start deploy/ecosystem.config.js && pm2 save
// Secrets come from the environment or a .env file loaded by each app, never from this file.
module.exports = {
  apps: [
    {
      name: 'podium-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
    },
    {
      name: 'podium-api',
      cwd: './apps/api',
      script: 'dist/server.js',
      instances: 1, // one instance: it owns the WebSocket runs and the weekly close job lock
      env: { NODE_ENV: 'production', PORT: 4000 },
      max_memory_restart: '500M',
    },
  ],
};
