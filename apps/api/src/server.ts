import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { getPrismaClient } from './db/prisma.js';

const config = loadConfig();
const prisma = getPrismaClient();
const app = createApp({ config, prisma });

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
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
