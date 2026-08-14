import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async function loadEvents(client) {
  if (!client) throw new Error('loadEvents(): Discord client is not available.');

  const eventsPath = join(__dirname, '../events');
  let entries;
  try {
    entries = await readdir(eventsPath, { withFileTypes: true });
  } catch (error) {
    logger.error('Cannot read events directory:', error);
    throw error;
  }

  const eventFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('_'))
    .map(entry => entry.name);

  logger.info(`[EVENTS] Found ${eventFiles.length} event file(s).`);

  let loadedCount = 0;
  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    try {
      const module = await import(pathToFileURL(filePath).href);
      const event = module.default;

      if (!event || typeof event !== 'object' || !event.name || typeof event.execute !== 'function') {
        logger.warn(`[EVENTS] Skipping ${file}: invalid event export.`);
        continue;
      }

      const safeExecute = async (...args) => {
        try {
          await event.execute(...args, client);
        } catch (error) {
          logger.error(`Error executing event ${event.name} (${file}):`, error);
        }
      };

      if (event.once) client.once(event.name, safeExecute);
      else client.on(event.name, safeExecute);

      loadedCount++;
      logger.info(`[EVENTS] Registered ${event.once ? 'once ' : ''}event: ${event.name} (${file})`);
    } catch (error) {
      logger.error(`[EVENTS] Error loading event ${file}:`, error);
    }
  }

  const messageCreateListeners = client.listenerCount('messageCreate');
  logger.info(`[EVENTS] Registered ${loadedCount} event(s). MessageCreate listeners: ${messageCreateListeners}`);

  if (messageCreateListeners === 0) {
    throw new Error('No messageCreate listener is registered. Check events/messageCreate.js.');
  }
}
