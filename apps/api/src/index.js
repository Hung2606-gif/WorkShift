import { getConfig } from './lib/config.js';
import { createApp } from './app.js';

const config = getConfig();
const app = createApp();
app.listen(config.port, () => console.log(`WorkShift API listening on :${config.port}`));
