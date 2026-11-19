import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp({ config });

const server = app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      event: 'server_started',
      port: config.port,
      nodeEnv: config.nodeEnv,
      interpreterMode: config.payInterpreterMode,
    }),
  );
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ event: 'server_stopping', signal }));
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
