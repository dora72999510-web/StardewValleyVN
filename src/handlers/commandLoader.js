import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Collection, Routes } from 'discord.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================
   CONFIG
========================================================= */

const MAX_COMMANDS = 100;
const COMMAND_COUNT_WARN_THRESHOLD = 90;

/*
 * =========================================================
 * CHỈ HIỂN THỊ SLASH COMMAND NÀY
 *
 * Kết quả khi người dùng gõ "/":
 *
 * /nha-phat-trien
 * honganhrose
 *
 * Không sử dụng tiếng Việt có dấu trong command name.
 * Discord yêu cầu command name phải hợp lệ theo chuẩn
 * application command.
 * =========================================================
 */

const DEVELOPER_COMMAND = {
    name: 'nha phat trien',

    description: 'honganhrose',

    type: 1,

    dm_permission: false,

    options: [],
};


/* =========================================================
   SUBCOMMAND INFO
========================================================= */

function getSubcommandInfo(commandData) {
    const subcommands = [];

    if (!commandData?.options) {
        return subcommands;
    }

    for (const option of commandData.options) {

        if (option.type === 1) {
            subcommands.push(option.name);

        } else if (option.type === 2) {

            if (!option.options) {
                continue;
            }

            for (const subOption of option.options) {

                if (subOption.type === 1) {
                    subcommands.push(
                        `${option.name}/${subOption.name}`
                    );
                }
            }
        }
    }

    return subcommands;
}


/* =========================================================
   GET ALL COMMAND FILES
========================================================= */

async function getAllFiles(directory, fileList = []) {

    const files = await fs.readdir(
        directory,
        {
            withFileTypes: true
        }
    );

    for (const file of files) {

        const filePath = path.join(
            directory,
            file.name
        );

        if (file.isDirectory()) {

            /*
             * Không load modules phụ.
             */
            if (file.name === 'modules') {
                continue;
            }

            await getAllFiles(
                filePath,
                fileList
            );

        } else if (
            file.name.endsWith('.js')
        ) {

            fileList.push(filePath);
        }
    }

    return fileList;
}


/* =========================================================
   LOAD PREFIX COMMANDS
   =========================================================
   
   QUAN TRỌNG:

   Hàm này KHÔNG đăng ký Slash Command.

   Nó chỉ load command vào:

       client.commands

   để hệ thống prefix của bạn vẫn hoạt động:

       !ban
       !warn
       !clearuser
       !...
========================================================= */

export async function loadCommands(client) {

    client.commands = new Collection();

    const commandsPath = path.join(
        __dirname,
        '../commands'
    );

    let commandFiles = [];

    try {

        commandFiles =
            await getAllFiles(
                commandsPath
            );

    } catch (error) {

        if (error.code === 'ENOENT') {

            logger.warn(
                `[COMMANDS] Không tìm thấy thư mục commands: ${commandsPath}`
            );

            return client.commands;
        }

        throw error;
    }

    logger.info(
        `[COMMANDS] Found ${commandFiles.length} command files`
    );

    const uniqueCommandNames =
        new Set();

    for (
        const filePath
        of commandFiles
    ) {

        try {

            const normalizedPath =
                filePath.replace(
                    /\\/g,
                    '/'
                );

            const commandDir =
                path.dirname(
                    filePath
                );

            const category =
                path.basename(
                    commandDir
                );

            /*
             * Dùng pathToFileURL để tương thích
             * Windows/Linux.
             */
            const moduleUrl =
                pathToFileURL(
                    filePath
                ).href;

            const commandModule =
                await import(
                    moduleUrl
                );

            const command =
                commandModule.default ||
                commandModule;

            if (
                !command ||
                !command.data ||
                typeof command.execute !==
                    'function'
            ) {

                logger.warn(
                    `[COMMANDS] Bỏ qua ${filePath}: thiếu data hoặc execute()`
                );

                continue;
            }

            command.category =
                category;

            command.filePath =
                normalizedPath;

            const primaryCommandName =
                command.data.name;

            if (!primaryCommandName) {

                logger.warn(
                    `[COMMANDS] ${filePath} không có command name`
                );

                continue;
            }

            /*
             * Chỉ thêm command đầu tiên nếu trùng tên.
             */
            if (
                !uniqueCommandNames.has(
                    primaryCommandName
                )
            ) {

                uniqueCommandNames.add(
                    primaryCommandName
                );

                client.commands.set(
                    primaryCommandName,
                    command
                );

            } else {

                logger.warn(
                    `[COMMANDS] Duplicate command ignored: ${primaryCommandName}`
                );
            }

            let subcommands = [];

            try {

                if (
                    typeof command.data.toJSON ===
                    'function'
                ) {

                    subcommands =
                        getSubcommandInfo(
                            command.data.toJSON()
                        );
                }

            } catch (error) {

                logger.warn(
                    `[COMMANDS] Không thể đọc subcommands của ${primaryCommandName}: ${error.message}`
                );
            }

            logger.info(
                `[COMMANDS] Loaded: ${primaryCommandName} (${category})`
            );

            if (
                subcommands.length > 0
            ) {

                logger.info(
                    `[COMMANDS] Subcommands: ${subcommands.join(', ')}`
                );
            }

        } catch (error) {

            logger.error(
                `[COMMANDS] Error loading command ${filePath}:`,
                error
            );
        }
    }

    logger.info(
        `[COMMANDS] Total prefix commands loaded: ${client.commands.size}`
    );

    return client.commands;
}


/* =========================================================
   COLLECT COMMAND PAYLOADS
   =========================================================
   
   Giữ lại để tương thích code cũ.
========================================================= */

function collectCommandPayloads(client) {

    const commands = [];

    let totalSubcommands = 0;

    const registeredNames =
        new Set();

    if (!client?.commands) {

        return {
            commands,
            totalSubcommands
        };
    }

    for (
        const command
        of client.commands.values()
    ) {

        if (
            !command?.data ||
            typeof command.data.toJSON !==
                'function'
        ) {

            logger.warn(
                '[COMMANDS] Command thiếu data/toJSON, bỏ qua.'
            );

            continue;
        }

        const commandName =
            command.data.name;

        if (
            !commandName ||
            registeredNames.has(
                commandName
            )
        ) {

            continue;
        }

        registeredNames.add(
            commandName
        );

        const commandJson =
            command.data.toJSON();

        commands.push(
            commandJson
        );

        totalSubcommands +=
            getSubcommandInfo(
                commandJson
            ).length;
    }

    return {
        commands,
        totalSubcommands
    };
}


/* =========================================================
   VALIDATE COMMANDS
   ========================================================= */

function validateCommands(commands) {

    const validationErrors = [];

    for (
        const cmd
        of commands
    ) {

        if (
            !cmd?.name
        ) {

            validationErrors.push(
                'Command không có name.'
            );

            continue;
        }

        if (
            cmd.name.length > 32
        ) {

            validationErrors.push(
                `Command ${cmd.name} có tên dài hơn 32 ký tự.`
            );
        }

        if (
            cmd.description &&
            cmd.description.length > 110
        ) {

            validationErrors.push(
                `Command ${cmd.name} có description dài hơn 110 ký tự.`
            );
        }

        if (
            !cmd.options
        ) {

            continue;
        }

        for (
            const option
            of cmd.options
        ) {

            if (
                option.name &&
                option.name.length > 32
            ) {

                validationErrors.push(
                    `Command ${cmd.name}: option ${option.name} quá dài.`
                );
            }

            if (
                option.description &&
                option.description.length > 110
            ) {

                validationErrors.push(
                    `Command ${cmd.name}: description của option ${option.name} quá dài.`
                );
            }

            if (
                option.choices
            ) {

                for (
                    const choice
                    of option.choices
                ) {

                    if (
                        choice.name &&
                        choice.name.length > 100
                    ) {

                        validationErrors.push(
                            `Command ${cmd.name}: choice ${choice.name} quá dài.`
                        );
                    }

                    if (
                        typeof choice.value ===
                            'string' &&
                        choice.value.length > 100
                    ) {

                        validationErrors.push(
                            `Command ${cmd.name}: value của choice ${choice.name} quá dài.`
                        );
                    }
                }
            }

            if (
                !option.options
            ) {

                continue;
            }

            for (
                const subOption
                of option.options
            ) {

                if (
                    subOption.name &&
                    subOption.name.length > 32
                ) {

                    validationErrors.push(
                        `Command ${cmd.name}: subcommand ${subOption.name} quá dài.`
                    );
                }

                if (
                    subOption.description &&
                    subOption.description.length > 110
                ) {

                    validationErrors.push(
                        `Command ${cmd.name}: description subcommand ${subOption.name} quá dài.`
                    );
                }
            }
        }
    }

    if (
        validationErrors.length > 0
    ) {

        logger.error(
            '[COMMANDS] Command validation failed:'
        );

        for (
            const error
            of validationErrors
        ) {

            logger.error(
                `  - ${error}`
            );
        }

        throw new Error(
            `Command validation failed with ${validationErrors.length} errors`
        );
    }
}


/* =========================================================
   PREPARE COMMANDS
   ========================================================= */

function prepareCommandsForRegistration(
    commands,
    {
        multiGuild = false
    } = {}
) {

    if (
        commands.length >=
        COMMAND_COUNT_WARN_THRESHOLD
    ) {

        logger.warn(
            `Command count (${commands.length}) is near Discord's ${MAX_COMMANDS} limit` +
            (
                multiGuild
                    ? ' for global registration'
                    : ' for guild registration'
            )
        );
    }

    if (
        commands.length <=
        MAX_COMMANDS
    ) {

        return commands;
    }

    logger.warn(
        `[COMMANDS] Command count vượt quá ${MAX_COMMANDS}. Cắt danh sách.`
    );

    return commands.slice(
        0,
        MAX_COMMANDS
    );
}


/* =========================================================
   REGISTER ONLY DEVELOPER COMMAND
   =========================================================
   
   Đây là phần QUAN TRỌNG NHẤT.

   Discord sẽ chỉ nhận:

       /nha-phat-trien

   Không nhận các command trong client.commands.
========================================================= */

export async function registerCommands(
    client,
    options = {}
) {

    try {

        if (!client) {

            throw new Error(
                'Client không tồn tại.'
            );
        }

        const clientId =
            options.clientId ||
            client.application?.id ||
            client.user?.id;

        if (!clientId) {

            logger.error(
                '[COMMANDS] Không tìm thấy Application ID.'
            );

            return false;
        }

        if (!client.rest) {

            throw new Error(
                'Discord REST client chưa được khởi tạo.'
            );
        }

        /*
         * Validate developer command.
         */
        validateCommands([
            DEVELOPER_COMMAND
        ]);

        /*
         * =================================================
         * GLOBAL
         * =================================================
         *
         * Ghi đè toàn bộ Global Slash Commands.
         *
         * Kết quả:
         *
         * Chỉ còn /nha-phat-trien
         */
        logger.info(
            '[COMMANDS] Đang cấu hình Global Slash Commands...'
        );

        await client.rest.put(
            Routes.applicationCommands(
                clientId
            ),
            {
                body: [
                    DEVELOPER_COMMAND
                ]
            }
        );

        logger.info(
            '[COMMANDS] ✅ Global Slash Command: /nha-phat-trien'
        );


        /*
         * =================================================
         * GUILD
         * =================================================
         *
         * Guild command cập nhật nhanh hơn global command.
         */
        const guilds =
            client.guilds?.cache;

        if (
            !guilds ||
            guilds.size === 0
        ) {

            logger.info(
                '[COMMANDS] Bot chưa ở guild nào hoặc guild cache trống.'
            );

            return true;
        }

        let successCount = 0;

        let failedCount = 0;

        for (
            const guild
            of guilds.values()
        ) {

            try {

                /*
                 * Ghi đè toàn bộ guild commands.
                 */
                await guild.commands.set([
                    DEVELOPER_COMMAND
                ]);

                successCount++;

                logger.info(
                    `[COMMANDS] ✅ ${guild.name}: /nha-phat-trien`
                );

            } catch (error) {

                failedCount++;

                logger.error(
                    `[COMMANDS] ❌ Không thể đăng ký command tại ${guild.name}:`,
                    error
                );
            }
        }

        logger.info(
            `[COMMANDS] Hoàn tất. Guild thành công: ${successCount}, thất bại: ${failedCount}`
        );

        return true;

    } catch (error) {

        logger.error(
            '[COMMANDS] Lỗi registerCommands:',
            error
        );

        return false;
    }
}


/* =========================================================
   REMOVE ALL SLASH COMMANDS
   =========================================================
   
   Hàm này để dùng nếu sau này bạn muốn tắt hoàn toàn
   Slash Command.
========================================================= */

export async function clearAllSlashCommands(
    client
) {

    try {

        const clientId =
            client.application?.id ||
            client.user?.id;

        if (!clientId) {

            throw new Error(
                'Không tìm thấy Application ID.'
            );
        }

        /*
         * Xóa Global Commands.
         */
        await client.rest.put(
            Routes.applicationCommands(
                clientId
            ),
            {
                body: []
            }
        );

        logger.info(
            '[COMMANDS] ✅ Đã xóa toàn bộ Global Slash Commands.'
        );


        /*
         * Xóa Guild Commands.
         */
        for (
            const guild
            of client.guilds.cache.values()
        ) {

            try {

                await guild.commands.set([]);

                logger.info(
                    `[COMMANDS] ✅ Đã xóa Slash Commands tại ${guild.name}`
                );

            } catch (error) {

                logger.error(
                    `[COMMANDS] ❌ Không thể xóa command tại ${guild.name}:`,
                    error
                );
            }
        }

        return true;

    } catch (error) {

        logger.error(
            '[COMMANDS] Lỗi khi xóa Slash Commands:',
            error
        );

        return false;
    }
}


/* =========================================================
   RELOAD PREFIX COMMAND
   =========================================================
   
   Dùng cho:
   
       !reload ...
   
   hoặc hệ thống reload command hiện tại của bot.
========================================================= */

export async function reloadCommand(
    client,
    commandName
) {

    if (
        !client?.commands
    ) {

        return {
            success: false,
            message:
                'client.commands chưa được khởi tạo.'
        };
    }

    const command =
        client.commands.get(
            commandName
        );

    if (!command) {

        return {
            success: false,
            message:
                `Command "${commandName}" not found`
        };
    }

    if (
        !command.filePath
    ) {

        return {
            success: false,
            message:
                `Command "${commandName}" không có filePath`
        };
    }

    try {

        const commandPath =
            path.resolve(
                command.filePath
            );

        const moduleUrl =
            pathToFileURL(
                commandPath
            );

        /*
         * Cache busting.
         */
        moduleUrl.searchParams.set(
            't',
            Date.now().toString()
        );

        const imported =
            await import(
                moduleUrl.href
            );

        const newCommand =
            imported.default ||
            imported;

        if (
            !newCommand?.data ||
            typeof newCommand.execute !==
                'function'
        ) {

            throw new Error(
                'Command mới không có data hoặc execute().'
            );
        }

        newCommand.category =
            command.category;

        newCommand.filePath =
            command.filePath;

        client.commands.set(
            commandName,
            newCommand
        );

        logger.info(
            `[COMMANDS] Reloaded command: ${commandName}`
        );

        return {
            success: true,
            message:
                `Successfully reloaded command "${commandName}"`
        };

    } catch (error) {

        logger.error(
            `[COMMANDS] Error reloading command "${commandName}":`,
            error
        );

        return {
            success: false,
            message:
                `Error reloading command: ${error.message}`
        };
    }
}


/* =========================================================
   EXPORT DEVELOPER COMMAND
   =========================================================
   
   Có thể import nếu app.js cần dùng.
========================================================= */

export {
    DEVELOPER_COMMAND
};
