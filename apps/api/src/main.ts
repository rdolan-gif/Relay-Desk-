import { createApp } from './app.factory';
import { loadConfig } from './config/config';

async function main() {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT);
  console.log(`Relay Desk API listening on :${config.PORT}`);
}

void main();
