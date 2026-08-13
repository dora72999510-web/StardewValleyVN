import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Collection, Routes } from 'discord.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_COMMANDS = 100;
const COMMAND_COUNT_WARN_THRESHOLD = 90;

/* =========================================================
   SUBCOMMAND INFO
========================================================= */

function getSubcommandInfo(commandData) {
    const subcommands = [];

    if (commandData.options) {
        for (const option of commandData.options) {
            if (option.type === 1) {
                subcommands.push(option.name);
            } else if (option.type === 2) {
                if (option.options) {
                    for (const subOption of option.options) {
                        if (subOption.type === 1) {
                            subcommands.push(
                                `${option.name}/${subOption.name}`
                            );
                        }
                    }
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
    const files = await fs.readdir(directory, {
        withFileTypes: true
    });

    for (const file of files) {
        const filePath = path.join(
            directory,
            file.name
        );

        if (file.isDirectory()) {
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
   LOAD COMMANDS
   ---------------------------------------------------------
   QUAN TRỌNG:
   Hàm này VẪN được giữ lại vì hệ thống prefix
   !ban, !clearuser, !warn... của bạn sử dụng
   client.commands.
========================================================= */

export async function loadCommands(client) {
    client.commands = new Collection();

    const commandsPath = path.join(
        __dirname,
        '../commands'
    );

    const commandFiles =
        await getAllFiles(commandsPath);

    logger.info(
        `Found ${commandFiles.length} command files to load`
    );

    const uniqueCommandNames = new Set();

    for (const filePath of commandFiles) {
        try {
            const normalizedPath =
                filePath.replace(/\\/g, '/');

            const commandName =
                path.basename(
                    filePath,
                    '.js'
                );

            const commandDir =
                path.dirname(filePath);

            const category =
                path.basename(commandDir);

            const commandModule =
                await import(
                    `file://${filePath}`
                );

            const command =
                commandModule.default ||
                commandModule;

            if (
                !command.data ||
                !command.execute
            ) {
                logger.warn(
                    `Command at ${filePath} is missing required "data" or "execute" property.`
                );

                continue;
            }

            command.category =
                category;

            command.filePath =
                normalizedPath;

            const primaryCommandName =
                command.data.name;

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
            }

            const subcommands =
                getSubcommandInfo(
                    command.data.toJSON()
                );

            logger.info(
                `Loaded command: ${primaryCommandName} from ${normalizedPath} (category: ${category})`
            );

            if (
                subcommands.length > 0
            ) {
                logger.info(
                    `  - Subcommands: ${subcommands.join(', ')}`
                );
            }

        } catch (error) {
            logger.error(
                `Error loading command from ${filePath}:`,
                error
            );
        }
    }

    const commandsWithSubcommands =
        Array.from(
            client.commands.values()
        ).filter((cmd) => {
            const subcommands =
                getSubcommandInfo(
                    cmd.data.toJSON()
                );

            return (
                subcommands.length > 0
            );
        });

    const totalSubcommands =
        commandsWithSubcommands.reduce(
            (total, cmd) => {
                return (
                    total +
                    getSubcommandInfo(
                        cmd.data.toJSON()
                    ).length
                );
            },
            0
        );

    const uniqueCommands =
        new Set();

    for (
        const [
            name,
            command
        ] of client.commands.entries()
    ) {
        if (
            command.data &&
            command.data.name
        ) {
            uniqueCommands.add(
                command.data.name
            );
        }
    }

    logger.info(
        `Loaded ${uniqueCommands.size} commands`
    );

    return client.commands;
}

/* =========================================================
   LEGACY COMMAND PAYLOAD
   ---------------------------------------------------------
   Giữ lại để không phá các phần code khác nếu có import.
   KHÔNG được sử dụng để đăng ký Slash Commands.
========================================================= */

function collectCommandPayloads(client) {
    const commands = [];

    let totalSubcommands = 0;

    const registeredNames =
        new Set();

    for (
        const command
        of client.commands.values()
    ) {
        if (
            !command.data ||
            typeof command.data.toJSON !==
                'function'
        ) {
            logger.warn(
                `Command missing data or toJSON method: ${command}`
            );

            continue;
        }

        const commandName =
            command.data.name;

        if (
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

    for (const cmd of commands) {
        if (
            cmd.name &&
            cmd.name.length > 32
        ) {
            validationErrors.push(
                `Command ${cmd.name} has name longer than 32 chars: "${cmd.name}" (${cmd.name.length} chars)`
            );
        }

        if (
            cmd.description &&
            cmd.description.length > 110
        ) {
            validationErrors.push(
                `Command ${cmd.name} has description longer than 110 chars: "${cmd.description}" (${cmd.description.length} chars)`
            );
        }

        if (!cmd.options) {
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
                    `Command ${cmd.name} option ${option.name} has name longer than 32 chars`
                );
            }

            if (
                option.description &&
                option.description.length > 110
            ) {
                validationErrors.push(
                    `Command ${cmd.name} option ${option.name} has description longer than 110 chars`
                );
            }

            if (option.choices) {
                for (
                    const choice
                    of option.choices
                ) {
                    if (
                        choice.name &&
                        choice.name.length > 110
                    ) {
                        validationErrors.push(
                            `Command ${cmd.name} option ${option.name} choice ${choice.name} has name longer than 110 chars`
                        );
                    }

                    if (
                        choice.value &&
                        typeof choice.value ===
                            'string' &&
                        choice.value.length > 100
                    ) {
                        validationErrors.push(
                            `Command ${cmd.name} option ${option.name} choice ${choice.name} has value longer than 100 chars`
                        );
                    }
                }
            }

            if (!option.options) {
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
                        `Command ${cmd.name} subcommand ${option.name} option ${subOption.name} has name longer than 32 chars`
                    );
                }

                if (
                    subOption.description &&
                    subOption.description.length > 110
                ) {
                    validationErrors.push(
                        `Command ${cmd.name} subcommand ${option.name} option ${subOption.name} has description longer than 110 chars`
                    );
                }
            }
        }
    }

    if (
        validationErrors.length > 0
    ) {
        logger.error(
            'Command validation failed:'
        );

        validationErrors.forEach(
            error =>
                logger.error(
                    `  - ${error}`
                )
        );

        throw new Error(
            `Command validation failed with ${validationErrors.length} errors`
        );
    }
}

/* =========================================================
   PREPARE COMMANDS
   ---------------------------------------------------------
   Chỉ giữ để tương thích với code cũ.
   Không còn được dùng để register Slash Commands.
========================================================= */

function prepareCommandsForRegistration(
    commands,
    { multiGuild = false } = {}
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
        `Command count (${commands.length}) exceeds Discord limit (${MAX_COMMANDS}), truncating...`
    );

    return commands.slice(
        0,
        MAX_COMMANDS
    );
}

/* =========================================================
   REGISTER COMMANDS
   =========================================================
   !!! ĐÃ TẮT HOÀN TOÀN !!!

   App.js của bạn vẫn có thể gọi:

       await this.();

   nhưng hàm này KHÔNG đăng ký command.

   Nó chỉ:
   1. Xóa Global Slash Commands.
   2. Xóa Guild Slash Commands.
   3. Không đăng ký lại.
========================================================= */

export async function registerCommands(client, options = {}) {
    try {
        const clientId =
            options.clientId ||
            client.user?.id;

        if (!clientId) {
            logger.error(
                '[COMMANDS] Không tìm thấy Client ID.'
            );
            return;
        }

        const developerCommand = {
            name: 'phát triển bởi (developed by)',
            description: 'honganhrose',
            type: 1,
            dm_permission: false,
            options: [],
        };

        logger.info(
            '[COMMANDS] Đang đăng ký /nha-phat-trien...'
        );

        /*
         * GLOBAL
         */
        await client.rest.put(
            `/applications/${clientId}/commands`,
            {
                body: [
                    developerCommand,
                ],
            }
        );

        logger.info(
            '[COMMANDS] Đã đăng ký Global /nha-phat-trien.'
        );

        /*
         * GUILD
         *
         * Dùng guild command để Discord cập nhật gần như
         * ngay lập tức trong server.
         */
        const guilds =
            client.guilds.cache;

        for (const guild of guilds.values()) {

            try {

                await guild.commands.set([
                    developerCommand,
                ]);

                logger.info(
                    `[COMMANDS] Đã đăng ký /nha-phat-trien tại ${guild.name}`
                );

            } catch (error) {

                logger.error(
                    `[COMMANDS] Không thể đăng ký command tại ${guild.name}:`,
                    error
                );

            }
        }

    } catch (error) {

        logger.error(
            '[COMMANDS] Lỗi đăng ký Slash Commands:',
            error
        );

    }
}

/* =========================================================
   RELOAD COMMAND
   ---------------------------------------------------------
   Giữ nguyên để hệ thống prefix có thể reload command.
========================================================= */

export async function reloadCommand(
    client,
    commandName
) {
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

    try {
        const commandPath =
            path.resolve(
                command.filePath
            );

        const moduleUrl =
            pathToFileURL(
                commandPath
            );

        moduleUrl.searchParams.set(
            't',
            Date.now().toString()
        );

        const newCommand =
            (
                await import(
                    moduleUrl.href
                )
            ).default;

        client.commands.set(
            commandName,
            newCommand
        );

        logger.info(
            `Reloaded command: ${commandName}`
        );

        return {
            success: true,
            message:
                `Successfully reloaded command "${commandName}"`
        };

    } catch (error) {
        logger.error(
            `Error reloading command "${commandName}":`,
            error
        );

        return {
            success: false,
            message:
                `Error reloading command: ${error.message}`
        };
    }
}
