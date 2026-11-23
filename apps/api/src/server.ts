// Entry point: listens, runs the stream watchdog and the background jobs. One instance only.
import { buildApp } from './app';
import { startJobs } from './services/jobs';

async function main(): Promise<void> {
  const app = await buildApp();
  const { cfg } = app.ctx;
  await app.listen({ port: cfg.port, host: cfg.host });
  app.ctx.stream.start();
  const stopJobs = startJobs(app.ctx);
  const shutdown = (): void => {
    stopJobs();
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
