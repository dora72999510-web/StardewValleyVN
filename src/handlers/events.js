import { readdir } from 'fs/promises';
import { join } from 'path';
import {
  fileURLToPath,
  pathToFileURL,
} from 'url';
import { dirname } from 'path';

import { logger } from '../utils/logger.js';


/* =========================================================
   PATH
========================================================= */

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  dirname(__filename);


/* =========================================================
   LOAD EVENTS
========================================================= */

export default async function loadEvents(client) {

  if (!client) {
    throw new Error(
      'loadEvents(): Discord client is not available.'
    );
  }


  const eventsPath =
    join(
      __dirname,
      '../events'
    );


  /* =======================================================
     READ EVENTS DIRECTORY
  ======================================================= */

  let entries;

  try {

    entries =
      await readdir(
        eventsPath,
        {
          withFileTypes: true,
        }
      );

  } catch (error) {

    logger.error(
      '❌ Cannot read events directory:',
      error
    );

    throw error;
  }


  /* =======================================================
     FIND EVENT FILES
  ======================================================= */

  const eventFiles =
    entries
      .filter(
        entry =>
          entry.isFile() &&
          entry.name.endsWith('.js') &&
          !entry.name.startsWith('_')
      )
      .map(
        entry =>
          entry.name
      )
      .sort();


  logger.info(
    `📂 Found ${eventFiles.length} event file(s).`
  );


  let loadedCount = 0;


  /* =======================================================
     LOAD EACH EVENT
  ======================================================= */

  for (
    const file
    of eventFiles
  ) {

    const filePath =
      join(
        eventsPath,
        file
      );


    try {

      const moduleUrl =
        pathToFileURL(
          filePath
        ).href;


      const module =
        await import(
          moduleUrl
        );


      const event =
        module.default;


      /* =====================================================
         VALIDATE
      ===================================================== */

      if (
        !event ||
        typeof event !== 'object'
      ) {

        logger.warn(
          `⚠️ Skipping ${file}: default export is not an object.`
        );

        continue;
      }


      if (
        typeof event.name !== 'string' ||
        !event.name.trim()
      ) {

        logger.warn(
          `⚠️ Skipping ${file}: missing event name.`
        );

        continue;
      }


      if (
        typeof event.execute !== 'function'
      ) {

        logger.warn(
          `⚠️ Skipping ${file}: missing execute().`
        );

        continue;
      }


      const eventName =
        event.name.trim();


      /* =====================================================
         DUPLICATE PROTECTION
      ===================================================== */

      /*
       * Không đăng ký cùng một event listener
       * nhiều lần nếu loader bị gọi lại.
       */

      if (
        client.listenerCount(
          eventName
        ) > 0
      ) {

        logger.warn(
          `⚠️ Event "${eventName}" already has ` +
          `${client.listenerCount(eventName)} listener(s). ` +
          `Registering ${file} anyway.`
        );

      }


      /* =====================================================
         EVENT WRAPPER
      ===================================================== */

      const safeExecute =
        async (...args) => {

          try {

            /*
             * Discord event:
             *
             * messageCreate:
             *   execute(message, client)
             *
             * ready:
             *   execute(client)
             *
             * Vì loader truyền client cuối cùng,
             * event file phải nhận client ở cuối.
             */

            await event.execute(
              ...args,
              client
            );

          } catch (error) {

            logger.error(
              `❌ Error executing event "${eventName}" (${file}):`,
              error
            );

          }

        };


      /* =====================================================
         REGISTER
      ===================================================== */

      if (event.once === true) {

        client.once(
          eventName,
          safeExecute
        );


        logger.info(
          `✅ Registered once event: ${eventName} (${file})`
        );

      } else {

        client.on(
          eventName,
          safeExecute
        );


        logger.info(
          `✅ Registered event: ${eventName} (${file})`
        );

      }


      loadedCount++;


    } catch (error) {

      logger.error(
        `❌ Failed to load event "${file}":`,
        error
      );

    }

  }


  /* =======================================================
     SUMMARY
  ======================================================= */

  logger.info(
    `✅ Successfully registered ${loadedCount}/${eventFiles.length} event(s).`
  );


  /* =======================================================
     MESSAGE CREATE CHECK
  ======================================================= */

  const messageCreateListeners =
    client.listenerCount(
      'messageCreate'
    );


  logger.info(
    `📨 messageCreate listeners: ${messageCreateListeners}`
  );


  if (
    messageCreateListeners === 0
  ) {

    logger.error(
      '❌ CRITICAL: No messageCreate listener is registered.'
    );

    logger.error(
      '❌ Prefix commands such as !lyric will NOT work.'
    );

  } else {

    logger.info(
      '✅ messageCreate listener is active. Prefix commands can be processed.'
    );

  }


  return {
    loaded:
      loadedCount,

    total:
      eventFiles.length,

    messageCreateListeners,
  };

}
