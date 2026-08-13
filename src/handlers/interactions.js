import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
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
   INTERACTION TYPES
   ---------------------------------------------------------
   Chỉ load:

   - buttons
   - selectMenus
   - modals

   KHÔNG load Slash Commands ở đây.
========================================================= */

const interactionTypes = [
  'buttons',
  'selectMenus',
  'modals'
];


/* =========================================================
   LOAD INTERACTIONS
========================================================= */

export default async function loadInteractions(client) {

  try {

    if (!client) {

      throw new Error(
        'Discord client is not available.'
      );

    }


    /*
     * Đảm bảo các Collection tồn tại.
     */

    if (!client.buttons) {

      client.buttons = new Map();

    }


    if (!client.selectMenus) {

      client.selectMenus = new Map();

    }


    if (!client.modals) {

      client.modals = new Map();

    }


    const interactionsPath =
      join(
        __dirname,
        '../interactions'
      );


    logger.info(
      'Loading Discord interactions...'
    );


    /* =====================================================
       LOAD TỪNG LOẠI
    ===================================================== */

    for (
      const type
      of interactionTypes
    ) {

      await loadInteractionType(
        client,
        interactionsPath,
        type
      );

    }


    logger.info(
      'Discord interactions loaded successfully.'
    );


  } catch (error) {

    logger.error(
      'Error loading interactions:',
      error
    );

    /*
     * Không crash bot chỉ vì một interaction
     * bị lỗi.
     */

  }

}


/* =========================================================
   LOAD ONE INTERACTION TYPE
========================================================= */

async function loadInteractionType(
  client,
  interactionsPath,
  type
) {

  const typePath =
    join(
      interactionsPath,
      type
    );


  /* =======================================================
     KIỂM TRA COLLECTION
  ======================================================= */

  if (
    !client[type] ||
    typeof client[type].set !== 'function'
  ) {

    logger.error(
      `Client collection "${type}" is not available.`
    );

    return;

  }


  /* =======================================================
     ĐỌC THƯ MỤC
  ======================================================= */

  let interactionFiles;


  try {

    interactionFiles =
      await readdir(
        typePath,
        {
          withFileTypes: true
        }
      );

  } catch (error) {

    if (
      error.code ===
      'ENOENT'
    ) {

      logger.debug(
        `No ${type} directory found, skipping...`
      );

      return;

    }


    logger.error(
      `Error reading ${type} directory:`,
      error
    );

    return;

  }


  /* =======================================================
     CHỈ LẤY FILE .JS
  ======================================================= */

  const files =
    interactionFiles
      .filter(
        entry =>
          entry.isFile() &&
          entry.name.endsWith('.js') &&
          !entry.name.startsWith('_')
      )
      .map(
        entry =>
          entry.name
      );


  if (
    files.length === 0
  ) {

    logger.debug(
      `No ${type} files found.`
    );

    return;

  }


  let loadedCount = 0;


  /* =======================================================
     LOAD FILE
  ======================================================= */

  for (
    const file
    of files
  ) {

    const filePath =
      join(
        typePath,
        file
      );


    try {

      /*
       * Dùng file URL để tương thích ESM.
       */

      const moduleUrl =
        pathToFileURL(
          filePath
        ).href;


      const module =
        await import(
          moduleUrl
        );


      const moduleExport =
        module.default;


      if (
        !moduleExport
      ) {

        logger.warn(
          `Interaction ${file} in ${type} has no default export.`
        );

        continue;

      }


      /*
       * Cho phép một file export:

       export default {
         name: '...',
         execute() {}
       }

       hoặc:

       export default [
         {...},
         {...}
       ];
      */

      const interactions =
        Array.isArray(
          moduleExport
        )
          ? moduleExport
          : [moduleExport];


      /* =====================================================
         REGISTER INTERACTIONS
      ===================================================== */

      for (
        const interaction
        of interactions
      ) {

        if (
          !interaction ||
          typeof interaction !== 'object'
        ) {

          logger.warn(
            `Invalid interaction export in ${file} (${type}).`
          );

          continue;

        }


        if (
          typeof interaction.name !==
          'string' ||
          interaction.name.trim() === ''
        ) {

          logger.warn(
            `Interaction ${file} in ${type} is missing a valid "name".`
          );

          continue;

        }


        if (
          typeof interaction.execute !==
          'function'
        ) {

          logger.warn(
            `Interaction ${interaction.name} in ${type} is missing "execute".`
          );

          continue;

        }


        const name =
          interaction.name.trim();


        /*
         * Nếu interaction trùng tên,
         * ghi đè interaction cũ và cảnh báo.
         */

        if (
          client[type].has(name)
        ) {

          logger.warn(
            `Duplicate ${type} interaction "${name}" detected. Overwriting previous handler.`
          );

        }


        client[type].set(
          name,
          interaction
        );


        loadedCount++;


        logger.info(
          `Loaded ${type.slice(0, -1)}: ${name}`
        );

      }


    } catch (error) {

      logger.error(
        `Error loading interaction ${file} in ${type}:`,
        error
      );

    }

  }


  /* =======================================================
     SUMMARY
  ======================================================= */

  logger.info(
    `Loaded ${loadedCount} ${type}.`
  );

}


/* =========================================================
   IMPORTANT
   ---------------------------------------------------------
   FILE NÀY KHÔNG:

   ❌ register Slash Commands
   ❌ guild.commands.set(...)
   ❌ client.application.commands.set(...)
   ❌ REST.put(...)
   ❌ REST.post(...)
   ❌ đăng ký command lên Discord

   Nó CHỈ load:

   ✅ Buttons
   ✅ Select Menus
   ✅ Modals
========================================================= */
