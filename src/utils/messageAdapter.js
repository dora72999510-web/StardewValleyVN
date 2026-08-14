import { logger } from './logger.js';

/* =========================================================
   MESSAGE ADAPTER
   ---------------------------------------------------------
   Dùng cho PREFIX COMMANDS

   Ví dụ:

   !lyric Ed Sheeran Shape of You

   sẽ được truyền vào command:

   execute(message, ['Ed', 'Sheeran', 'Shape', 'of', 'You'], client)

   Không truyền object args làm argument thứ 2.
========================================================= */


/* =========================================================
   PREFIX EXECUTION SUPPORT
========================================================= */

/**
 * Kiểm tra command có thể chạy bằng prefix hay không.
 *
 * Mặc định:
 * - Nếu command có execute() => cho phép.
 * - Nếu command có prefix: false => không cho phép.
 * - Nếu command có prefixOnly / prefixEnabled => tôn trọng cấu hình.
 *
 * Có thể dùng:
 *
 * export default {
 *   name: 'lyric',
 *   prefix: true,
 *   execute() {}
 * }
 *
 * hoặc đơn giản:
 *
 * export default {
 *   name: 'lyric',
 *   execute() {}
 * }
 */
export function supportsPrefixExecution(command) {
  if (!command || typeof command !== 'object') {
    return false;
  }

  if (typeof command.execute !== 'function') {
    return false;
  }

  /*
   * Cho phép command chủ động tắt prefix.
   */
  if (command.prefix === false) {
    return false;
  }

  if (command.prefixEnabled === false) {
    return false;
  }

  if (command.allowPrefix === false) {
    return false;
  }

  /*
   * prefixOnly === true nghĩa là command chắc chắn
   * hỗ trợ prefix.
   */
  if (command.prefixOnly === true) {
    return true;
  }

  /*
   * Mặc định command có execute() sẽ được phép.
   */
  return true;
}


/* =========================================================
   NORMALIZE PREFIX ARGS
   ---------------------------------------------------------
   Đây là phần QUAN TRỌNG nhất.

   Đảm bảo mọi command nhận:

   args = ['Ed', 'Sheeran', 'Shape', 'of', 'You']

   thay vì:

   args = {
      ...
   }

   hoặc:

   args = '[object Object]'
========================================================= */

export function normalizePrefixArgs(args) {
  if (
    args === undefined ||
    args === null
  ) {
    return [];
  }


  /* -----------------------------------------
     Array
  ----------------------------------------- */

  if (Array.isArray(args)) {
    return args
      .flatMap(value => normalizeSingleArg(value))
      .filter(Boolean);
  }


  /* -----------------------------------------
     String
  ----------------------------------------- */

  if (typeof args === 'string') {
    return splitArgumentString(args);
  }


  /* -----------------------------------------
     Object
  ----------------------------------------- */

  if (typeof args === 'object') {

    /*
     * Một số parser có thể truyền:
     *
     * {
     *   args: ['Ed', 'Sheeran', 'Shape', 'of', 'You']
     * }
     */

    const possibleArrayKeys = [
      'args',
      'arguments',
      'params',
      'parameters',
    ];

    for (const key of possibleArrayKeys) {
      if (Array.isArray(args[key])) {
        return normalizePrefixArgs(args[key]);
      }
    }


    /*
     * Object có query/text/content/value.
     */

    const possibleStringKeys = [
      'query',
      'text',
      'content',
      'input',
      'value',
      'search',
      'song',
      'songName',
      'title',
    ];

    for (const key of possibleStringKeys) {
      if (
        typeof args[key] === 'string' &&
        args[key].trim()
      ) {
        return splitArgumentString(args[key]);
      }
    }


    /*
     * Một số parser có:
     *
     * {
     *   name: 'lyric',
     *   args: [...]
     * }
     */

    if (
      args.args !== undefined &&
      args.args !== args
    ) {
      return normalizePrefixArgs(args.args);
    }


    /*
     * Không bao giờ:
     *
     * String(args)
     *
     * vì sẽ tạo:
     *
     * [object Object]
     */

    return [];
  }


  /* -----------------------------------------
     Primitive
  ----------------------------------------- */

  return [
    String(args).trim()
  ].filter(Boolean);
}


/* =========================================================
   NORMALIZE ONE ARG
========================================================= */

function normalizeSingleArg(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return [];
  }


  if (typeof value === 'string') {
    return [value.trim()].filter(Boolean);
  }


  if (typeof value === 'number') {
    return [String(value)];
  }


  if (typeof value === 'boolean') {
    return [String(value)];
  }


  if (typeof value === 'object') {

    const keys = [
      'value',
      'name',
      'text',
      'content',
      'query',
      'input',
    ];

    for (const key of keys) {

      if (
        typeof value[key] === 'string' &&
        value[key].trim()
      ) {
        return [value[key].trim()];
      }
    }

    return [];
  }


  return [
    String(value).trim()
  ].filter(Boolean);
}


/* =========================================================
   SPLIT ARGUMENT STRING
========================================================= */

function splitArgumentString(text) {
  if (
    typeof text !== 'string' ||
    !text.trim()
  ) {
    return [];
  }

  /*
   * Prefix command đã được parser tách command name
   * trước khi gọi adapter.
   *
   * Vì vậy ở đây chỉ cần tách phần arguments.
   *
   * Ví dụ:
   *
   * "Ed Sheeran Shape of You"
   *
   * =>
   *
   * [
   *   "Ed",
   *   "Sheeran",
   *   "Shape",
   *   "of",
   *   "You"
   * ]
   */

  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}


/* =========================================================
   EXECUTE PREFIX COMMAND
   ========================================================= */

/**
 * Chạy command bằng prefix.
 *
 * Chuẩn signature:
 *
 * command.execute(
 *   message,
 *   args,
 *   client
 * )
 *
 * Trong đó:
 *
 * args luôn là Array.
 */
export async function executePrefixCommand(
  command,
  message,
  args,
  client,
  prefix = '!',
  guildConfig = null
) {
  if (!command) {
    throw new Error(
      'Prefix command does not exist.'
    );
  }


  if (!message) {
    throw new Error(
      'Discord message is missing.'
    );
  }


  if (
    typeof command.execute !== 'function'
  ) {
    throw new Error(
      `Command "${command.name || command.data?.name || 'unknown'}" does not have execute().`
    );
  }


  /*
   * NORMALIZE ARGS
   *
   * Đây là fix chính cho !lyric.
   */

  const normalizedArgs =
    normalizePrefixArgs(args);


  const commandName =
    command.name ||
    command.data?.name ||
    'unknown';


  logger.debug?.(
    `[PREFIX] Executing "${commandName}" with args: ${JSON.stringify(normalizedArgs)}`
  );


  /*
   * -------------------------------------------------------
   * QUAN TRỌNG
   *
   * Không truyền:
   *
   * {
   *   args,
   *   prefix,
   *   guildConfig
   * }
   *
   * vào vị trí args.
   *
   * lyric.js cần:
   *
   * execute(message, args, client)
   * -------------------------------------------------------
   */


  try {

    const result =
      await command.execute(
        message,
        normalizedArgs,
        client
      );


    return result;

  } catch (error) {

    logger.error(
      `[PREFIX] Error executing "${commandName}":`,
      error
    );

    throw error;
  }
}


/* =========================================================
   PREFIX ACCESS KEY
========================================================= */

/**
 * Tạo key dùng cho commandAccessService.
 *
 * Ví dụ:
 *
 * lyric
 * clearuser
 * faq
 *
 * Với subcommand:
 *
 * !music play
 *
 * có thể trở thành:
 *
 * music.play
 */
export function resolvePrefixAccessKey(
  commandData,
  args = []
) {
  if (!commandData) {
    return '';
  }


  const commandName =
    typeof commandData === 'string'
      ? commandData
      : commandData.name;


  if (!commandName) {
    return '';
  }


  const normalizedArgs =
    normalizePrefixArgs(args);


  /*
   * Không có subcommand.
   */

  if (
    normalizedArgs.length === 0
  ) {
    return commandName;
  }


  /*
   * Tìm option subcommand nếu commandData
   * là SlashCommandBuilder JSON.
   */

  const options =
    Array.isArray(commandData.options)
      ? commandData.options
      : [];


  const firstArg =
    normalizedArgs[0];


  const subcommand =
    options.find(
      option =>
        option &&
        option.type === 1 &&
        option.name === firstArg
    );


  if (subcommand) {
    return `${commandName}.${firstArg}`;
  }


  return commandName;
}


/* =========================================================
   PARSE PREFIX MESSAGE
   ---------------------------------------------------------
   Adapter độc lập với prefixParser.
========================================================= */

export function parsePrefixMessage(
  content,
  prefix = '!'
) {
  if (
    typeof content !== 'string' ||
    !content.trim()
  ) {
    return null;
  }


  if (
    typeof prefix !== 'string' ||
    !prefix
  ) {
    prefix = '!';
  }


  if (
    !content.startsWith(prefix)
  ) {
    return null;
  }


  const body =
    content
      .slice(prefix.length)
      .trim();


  if (!body) {
    return null;
  }


  const parts =
    body.split(/\s+/);


  const commandName =
    parts.shift()?.toLowerCase();


  if (!commandName) {
    return null;
  }


  return {
    commandName,
    args: parts,
    rawArgs: parts.join(' '),
  };
}


/* =========================================================
   GET COMMAND NAME
========================================================= */

export function getCommandName(command) {
  if (!command) {
    return '';
  }


  if (
    typeof command === 'string'
  ) {
    return command;
  }


  return (
    command.name ||
    command.data?.name ||
    ''
  );
}


/* =========================================================
   GET COMMAND ARGS AS TEXT
========================================================= */

export function getPrefixArgsText(args) {
  return normalizePrefixArgs(args).join(' ');
}


/* =========================================================
   CREATE PREFIX CONTEXT
   ---------------------------------------------------------
   Hữu ích nếu command nào đó cần thông tin bổ sung.
========================================================= */

export function createPrefixContext({
  message,
  args = [],
  client,
  prefix = '!',
  guildConfig = null,
} = {}) {
  const normalizedArgs =
    normalizePrefixArgs(args);

  return {
    message,
    args: normalizedArgs,
    client,
    prefix,
    guildConfig,
    commandName:
      message?.content
        ?.slice(prefix.length)
        ?.trim()
        ?.split(/\s+/)[0]
        ?.toLowerCase() || '',
    rawArgs:
      normalizedArgs.join(' '),
  };
}


/* =========================================================
   DEFAULT EXPORT
========================================================= */

export default {
  supportsPrefixExecution,
  executePrefixCommand,
  resolvePrefixAccessKey,
  normalizePrefixArgs,
  parsePrefixMessage,
  getCommandName,
  getPrefixArgsText,
  createPrefixContext,
};
