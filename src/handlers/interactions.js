import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import { Collection } from 'discord.js';

import { logger } from '../utils/logger.js';

/* =========================================================
   PATH
========================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* =========================================================
   INTERACTION TYPES
   ---------------------------------------------------------
   File này CHỈ load:

   - buttons
   - selectMenus
   - modals

   KHÔNG đăng ký Slash Commands.
========================================================= */

const interactionTypes = [
    'buttons',
    'selectMenus',
    'modals',
];

/* =========================================================
   MAIN LOADER
========================================================= */

export default async function loadInteractions(client) {
    try {
        if (!client) {
            throw new Error(
                'Discord client is not available.'
            );
        }

        /*
         * Đảm bảo Collection tồn tại.
         */

        for (const type of interactionTypes) {
            if (
                !client[type] ||
                typeof client[type].set !== 'function'
            ) {
                client[type] = new Collection();
            }
        }

        const interactionsPath = join(
            __dirname,
            '../interactions'
        );

        logger.info(
            'Loading Discord interactions...'
        );

        /*
         * Load từng loại interaction.
         */

        for (const type of interactionTypes) {
            await loadInteractionType(
                client,
                interactionsPath,
                type
            );
        }

        logger.info(
            `Interactions loaded: ${client.buttons.size} buttons, ${client.selectMenus.size} select menus, ${client.modals.size} modals`
        );

    } catch (error) {
        logger.error(
            'Error loading interactions:',
            error
        );

        /*
         * Không làm bot crash nếu interaction loader lỗi.
         */

        return false;
    }

    return true;
}

/* =========================================================
   LOAD ONE TYPE
========================================================= */

async function loadInteractionType(
    client,
    interactionsPath,
    type
) {
    const typePath = join(
        interactionsPath,
        type
    );

    /*
     * Xóa handler cũ trước khi load lại.
     *
     * Điều này tránh trường hợp reload làm
     * interaction cũ vẫn còn trong Collection.
     */

    client[type].clear();

    let entries;

    try {
        entries = await readdir(
            typePath,
            {
                withFileTypes: true,
            }
        );

    } catch (error) {

        if (error?.code === 'ENOENT') {
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

    /*
     * Chỉ lấy file .js
     *
     * Bỏ qua:
     * _example.js
     * _test.js
     * ...
     */

    const files = entries
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

    if (files.length === 0) {
        logger.debug(
            `No ${type} files found.`
        );

        return;
    }

    let loadedCount = 0;

    /* =====================================================
       LOAD FILES
    ===================================================== */

    for (const file of files) {

        const filePath = join(
            typePath,
            file
        );

        try {

            /*
             * ESM import.
             */

            const moduleUrl =
                pathToFileURL(
                    filePath
                ).href;

            const importedModule =
                await import(
                    moduleUrl
                );

            const moduleExport =
                importedModule.default;

            if (!moduleExport) {
                logger.warn(
                    `Interaction ${file} in ${type} has no default export.`
                );

                continue;
            }

            /*
             * Cho phép:

             * export default {
             *   name: '...',
             *   execute() {}
             * }

             * hoặc:

             * export default [
             *   {...},
             *   {...}
             * ];
             */

            const interactions =
                Array.isArray(moduleExport)
                    ? moduleExport
                    : [moduleExport];

            /* =================================================
               REGISTER
            ================================================= */

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

                const name =
                    typeof interaction.name === 'string'
                        ? interaction.name.trim()
                        : '';

                if (!name) {
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
                        `Interaction "${name}" in ${type} is missing an execute() function.`
                    );

                    continue;
                }

                /*
                 * Nếu trùng name thì ghi đè.
                 */

                if (
                    client[type].has(name)
                ) {
                    logger.warn(
                        `Duplicate ${type} interaction "${name}". Overwriting previous handler.`
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

    logger.info(
        `Loaded ${loadedCount} ${type}.`
    );
}
