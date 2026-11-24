// PM2 config for Climb Games. deploy/phase1.sh loads .env first, so the ports and process names
// below follow it (defaults: web 3000, API 4000). Start with: pm2 start deploy/ecosystem.config.js && pm2 save
// Secrets come from the environment or the .env file the API loads itself, never from this file.
const web = Number(process.env.WEB_PORT || 3000);
const api = Number(process.env.PORT || 4000);
const prefix = process.env.PM2_PREFIX || 'climbgames';

module.exports = {
  apps: [
    {
      name: `${prefix}-web`,
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: `start -p ${web} -H 127.0.0.1`,
      instances: 1,
      env: { NODE_ENV: 'production', API_INTERNAL_URL: process.env.API_INTERNAL_URL || `http://127.0.0.1:${api}` },
      max_memory_restart: '600M',
    },
    {
      name: `${prefix}-api`,
      cwd: './apps/api',
      script: 'dist/server.js',
      instances: 1, // one instance: it owns the WebSocket runs and the weekly close job lock
      env: { NODE_ENV: 'production', PORT: api, HOST: '127.0.0.1' },
      max_memory_restart: '500M',
    },
  ],
};
