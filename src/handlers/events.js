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


    let entries;

    try {

        entries =
            await readdir(
                eventsPath,
                {
                    withFileTypes: true
                }
            );

    } catch (error) {

        logger.error(
            '❌ Cannot read events directory:',
            error
        );

        throw error;
    }


    /*
     * Chỉ lấy file JS trực tiếp trong /events
     *
     * Không lấy thư mục con.
     */

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
            );


    logger.info(
        `Found ${eventFiles.length} event files to load`
    );


    let loadedCount = 0;


    /* =====================================================
       LOAD EACH EVENT
    ===================================================== */

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


            /* =================================================
               VALIDATE EVENT
            ================================================= */

            if (
                !event ||
                typeof event !== 'object'
            ) {

                logger.debug(
                    `Skipping ${file}: default export is not an event object.`
                );

                continue;
            }


            if (
                !event.name
            ) {

                logger.debug(
                    `Skipping ${file}: no event name.`
                );

                continue;
            }


            if (
                typeof event.execute !==
                'function'
            ) {

                logger.debug(
                    `Skipping ${file}: no execute() function.`
                );

                continue;
            }


            /* =================================================
               PROTECT AGAINST DUPLICATE EVENT LISTENERS
            ================================================= */

            const eventName =
                event.name;


            /*
             * Wrapper này luôn truyền client vào cuối.
             *
             * Ví dụ MessageCreate:
             *
             * Discord:
             *   message
             *
             * Event:
             *   execute(message, client)
             */

            const safeExecute =
                async (...args) => {

                    try {

                        await event.execute(
                            ...args,
                            client
                        );

                    } catch (error) {

                        logger.error(
                            `❌ Error executing event ${eventName} (${file}):`,
                            error
                        );

                    }

                };


            /* =================================================
               REGISTER EVENT
            ================================================= */

            if (event.once) {

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
                `❌ Error loading event ${file}:`,
                error
            );

        }

    }


    /* =====================================================
       SUMMARY
    ===================================================== */

    logger.info(
        `✅ Successfully registered ${loadedCount} event(s).`
    );


    /*
     * DEBUG QUAN TRỌNG:
     *
     * Kiểm tra MessageCreate đã thực sự được đăng ký chưa.
     */

    const messageCreateListeners =
        client.listenerCount(
            'messageCreate'
        );


    logger.info(
        `📨 MessageCreate listeners: ${messageCreateListeners}`
    );


    if (
        messageCreateListeners === 0
    ) {

        logger.warn(
            '⚠️ WARNING: No messageCreate listener is registered!'
        );

    }

}
