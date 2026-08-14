import {
  EmbedBuilder,
  Events,
  PermissionsBitField,
} from 'discord.js';

import { logger } from '../utils/logger.js';

import {
  getLevelingConfig,
  getUserLevelData,
} from '../services/leveling.js';

import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { parsePrefixCommand } from '../utils/prefixParser.js';

import { handleAutoRole } from '../events/autoRole.js';
import { handleFaq } from '../events/faqResponder.js';

import {
  supportsPrefixExecution,
  executePrefixCommand,
  resolvePrefixAccessKey,
} from '../utils/messageAdapter.js';

import {
  resolveCommandAlias,
  resolveSubcommandAlias,
} from '../config/commandAliases.js';

import { getPrefixRestriction } from '../config/prefixRestrictions.js';
import { getGuildConfig } from '../services/guildConfig.js';

import {
  enforceAbuseProtection,
  formatCooldownDuration,
} from '../utils/abuseProtection.js';

import { createEmbed } from '../utils/embeds.js';
import { isCommandEnabled } from '../services/commandAccessService.js';

import {
  getCountingGameConfig,
  saveCountingGameConfig,
  isValidCountingMessage,
  recordCorrectCount,
} from '../services/countingGameService.js';


/* =========================================================
   PREFIX COMMANDS
========================================================= */

const ALLOWED_PREFIX_COMMANDS = new Set([
  'faq',
  'clearuser',
  'lyric',
]);


/* =========================================================
   LYRIC CONFIG
========================================================= */

const LYRIC_CHANNEL_ID =
  '1537723665754357780';


/* =========================================================
   XP CONFIG
========================================================= */

const XP_RATE_LIMIT_ATTEMPTS =
  12;

const XP_RATE_LIMIT_WINDOW_MS =
  10000;


/* =========================================================
   PROTECTED CHANNELS
========================================================= */

const PROTECTED_CHANNELS = [
  '1521007503263928341',
];


/* =========================================================
   LOG CHANNEL
   ---------------------------------------------------------
   Channel nhận thông báo khi user bị timeout.
========================================================= */

const PROTECTED_LOG_CHANNEL_ID =
  '1510871300132835368';


/* =========================================================
   EXEMPT ROLES
========================================================= */

const EXEMPT_ROLE_IDS = [
  '1510657849112399928',
  '1514302887419842590',
];


/* =========================================================
   PROTECTED TIMEOUT
========================================================= */

const PROTECTED_TIMEOUT =
  24 * 60 * 60 * 1000;


/* =========================================================
   MESSAGE CREATE
========================================================= */

export default {

  name:
    Events.MessageCreate,


  async execute(
    message,
    client
  ) {

    try {

      /* =====================================================
         BASIC CHECK
      ===================================================== */

      if (!message) {
        return;
      }


      if (!message.guild) {
        return;
      }


      if (message.author?.bot) {
        return;
      }


      /* =====================================================
         AUTO ROLE
      ===================================================== */

      try {

        await handleAutoRole(
          message
        );

      } catch (error) {

        logger.error(
          'AutoRole Error:',
          error
        );

      }


      /* =====================================================
         PROTECTED CHANNEL
      ===================================================== */

      if (
        await handleProtectedChannels(
          message
        )
      ) {

        return;
      }


      /* =====================================================
         COUNTING GAME
      ===================================================== */

      if (
        await handleCountingGame(
          message,
          client
        )
      ) {

        return;
      }


      /* =====================================================
         PREFIX COMMAND
      ===================================================== */

      const wasPrefixCommand =
        await handlePrefixCommand(
          message,
          client
        );


      if (wasPrefixCommand) {
        return;
      }


      /* =====================================================
         FAQ AUTO RESPONDER
      ===================================================== */

      try {

        if (
          await handleFaq(
            message
          )
        ) {

          return;
        }

      } catch (error) {

        logger.error(
          'FAQ Responder Error:',
          error
        );

      }


      /* =====================================================
         LEVELING
      ===================================================== */

      await handleLeveling(
        message,
        client
      );


    } catch (error) {

      logger.error(
        'MessageCreate Error:',
        error
      );

    }

  },

};


/* =========================================================
   PROTECTED CHANNELS
========================================================= */

async function handleProtectedChannels(
  message
) {

  try {

    /* =====================================================
       CHECK PROTECTED CHANNEL
    ===================================================== */

    if (
      !PROTECTED_CHANNELS.includes(
        message.channel.id
      )
    ) {

      return false;
    }


    /* =====================================================
       FETCH MEMBER
    ===================================================== */

    const member =
      await message.guild.members
        .fetch(
          message.author.id
        )
        .catch(
          error => {

            logger.error(
              `[PROTECTED] Không thể fetch member ${message.author.id}:`,
              error
            );

            return null;
          }
        );


    if (!member) {

      logger.warn(
        `[PROTECTED] Không tìm thấy member ${message.author.id}.`
      );

      return true;
    }


    /* =====================================================
       BYPASS
    ===================================================== */

    if (

      member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )

      ||

      member.permissions.has(
        PermissionsBitField.Flags.ManageMessages
      )

      ||

      member.roles.cache.some(
        role =>
          EXEMPT_ROLE_IDS.includes(
            role.id
          )
      )

    ) {

      logger.info(
        `[PROTECTED] ${member.user.tag} được bypass.`
      );

      return true;
    }


    /* =====================================================
       DELETE MESSAGE
    ===================================================== */

    try {

      await message.delete();

      logger.info(
        `[PROTECTED] Deleted message from ${member.user.tag}.`
      );

    } catch (error) {

      logger.warn(
        `[PROTECTED] Không thể xóa message của ${member.user.tag}:`,
        error?.message ||
        error
      );

    }


    /* =====================================================
       CHECK MODERATABLE
    ===================================================== */

    if (
      !member.moderatable
    ) {

      logger.warn(
        `[PROTECTED] Không thể timeout ${member.user.tag}. ` +
        `Có thể bot thiếu quyền Moderate Members hoặc role bot thấp hơn member.`
      );


      /*
       * Vẫn gửi thông báo nếu không timeout được.
       */

      await sendProtectedWarning(
        message,
        member,
        false
      );


      return true;
    }


    /* =====================================================
       TIMEOUT
    ===================================================== */

    let timeoutSuccess =
      false;


    try {

      await member.timeout(
        PROTECTED_TIMEOUT,
        'Message in protected channel'
      );


      timeoutSuccess =
        true;


      logger.warn(
        `[PROTECTED] Timeout applied to ${member.user.tag} for 24 hours.`
      );


    } catch (error) {

      logger.error(
        `[PROTECTED] Timeout FAILED for ${member.user.tag}:`,
        error
      );

    }


    /* =====================================================
       DM USER
    ===================================================== */

    await sendProtectedDM(
      member,
      timeoutSuccess
    );


    /* =====================================================
       LOG CHANNEL
    ===================================================== */

    await sendProtectedLog(
      message,
      member,
      timeoutSuccess
    );


    /* =====================================================
       WARNING MESSAGE
    ===================================================== */

    await sendProtectedWarning(
      message,
      member,
      timeoutSuccess
    );


    return true;


  } catch (error) {

    logger.error(
      'Protected Channel Error:',
      error
    );


    return true;

  }

}


/* =========================================================
   SEND PROTECTED LOG
========================================================= */

async function sendProtectedLog(
  message,
  member,
  timeoutSuccess
) {

  try {

    /* =====================================================
       FETCH LOG CHANNEL
    ===================================================== */

    const logChannel =
      await message.guild.channels
        .fetch(
          PROTECTED_LOG_CHANNEL_ID
        )
        .catch(
          error => {

            logger.error(
              `[PROTECTED] Không thể fetch log channel ${PROTECTED_LOG_CHANNEL_ID}:`,
              error
            );

            return null;
          }
        );


    if (!logChannel) {

      logger.warn(
        `[PROTECTED] Log channel ${PROTECTED_LOG_CHANNEL_ID} không tồn tại hoặc bot không thể fetch.`
      );

      return false;
    }


    /* =====================================================
       CHECK TEXT CHANNEL
    ===================================================== */

    if (
      !logChannel.isTextBased()
    ) {

      logger.warn(
        `[PROTECTED] Log channel ${PROTECTED_LOG_CHANNEL_ID} không phải text-based channel.`
      );

      return false;
    }


    /* =====================================================
       CHECK SEND PERMISSION
    ===================================================== */

    if (
      message.guild.members.me
    ) {

      const permissions =
        logChannel.permissionsFor(
          message.guild.members.me
        );


      if (
        permissions &&
        !permissions.has(
          PermissionsBitField.Flags.SendMessages
        )
      ) {

        logger.error(
          `[PROTECTED] Bot không có quyền SendMessages tại log channel ${PROTECTED_LOG_CHANNEL_ID}.`
        );

        return false;
      }


      if (
        permissions &&
        !permissions.has(
          PermissionsBitField.Flags.EmbedLinks
        )
      ) {

        logger.warn(
          `[PROTECTED] Bot không có quyền EmbedLinks tại log channel. Sẽ thử gửi text.`
        );


        try {

          await logChannel.send(
            `🚫 Tài khoản ${member} đã bị hạn chế 1 ngày ` +
            `do gửi nội dung vào <#${message.channel.id}>.`
          );


          logger.info(
            '[PROTECTED] Đã gửi log dạng text.'
          );


          return true;

        } catch (error) {

          logger.error(
            '[PROTECTED] Không thể gửi log dạng text:',
            error
          );

          return false;
        }

      }

    }


    /* =====================================================
       CREATE EMBED
    ===================================================== */

    const embed =
      new EmbedBuilder()
        .setColor(
          timeoutSuccess
            ? 0xf1c40f
            : 0xed4245
        )
        .setDescription(
          timeoutSuccess

            ?

            `<:emoji_134:1523413261574471701> ` +
            `Tài khoản ${member} đã bị hạn chế 1 ngày ` +
            `do gửi nội dung vào <#${message.channel.id}>.`

            :

            `⚠️ Tài khoản ${member} đã gửi nội dung ` +
            `vào <#${message.channel.id}> nhưng bot ` +
            `không thể áp dụng timeout.`
        )
        .setTimestamp();


    /* =====================================================
       SEND EMBED
    ===================================================== */

    try {

      await logChannel.send({

        embeds: [
          embed,
        ],

      });


      logger.info(
        `[PROTECTED] Đã gửi log embed cho ${member.user.tag}.`
      );


      return true;

    } catch (error) {

      logger.error(
        '[PROTECTED] Không thể gửi log embed:',
        error
      );


      /* ===================================================
         FALLBACK TEXT
      =================================================== */

      try {

        await logChannel.send(
          timeoutSuccess

            ?

            `🚫 Tài khoản ${member} đã bị hạn chế 1 ngày ` +
            `do gửi nội dung vào <#${message.channel.id}>.`

            :

            `⚠️ Tài khoản ${member} đã gửi nội dung ` +
            `vào <#${message.channel.id}> nhưng bot ` +
            `không thể áp dụng timeout.`
        );


        logger.info(
          '[PROTECTED] Đã gửi log fallback dạng text.'
        );


        return true;

      } catch (fallbackError) {

        logger.error(
          '[PROTECTED] Fallback log cũng thất bại:',
          fallbackError
        );


        return false;
      }

    }

  } catch (error) {

    logger.error(
      '[PROTECTED] Protected log error:',
      error
    );


    return false;
  }

}


/* =========================================================
   SEND PROTECTED WARNING
========================================================= */

async function sendProtectedWarning(
  message,
  member,
  timeoutSuccess
) {

  try {

    if (
      !message.channel ||
      typeof message.channel.send !==
        'function'
    ) {

      return false;
    }


    /* =====================================================
       CREATE EMBED
    ===================================================== */

    const embed =
      new EmbedBuilder()
        .setColor(
          timeoutSuccess
            ? 0xf1c40f
            : 0xed4245
        )
        .setDescription(
          timeoutSuccess

            ?

            `🚫 ${member} đã bị hạn chế **1 ngày**.`

            :

            `⚠️ ${member} đã gửi nội dung vào ` +
            `kênh cảnh báo nhưng bot không thể áp dụng timeout.`
        )
        .setTimestamp();


    let warningMessage;


    /* =====================================================
       TRY EMBED
    ===================================================== */

    try {

      warningMessage =
        await message.channel.send({

          embeds: [
            embed,
          ],

        });


    } catch (error) {

      logger.error(
        '[PROTECTED] Không thể gửi warning embed:',
        error
      );


      /* ===================================================
         FALLBACK TEXT
      =================================================== */

      try {

        warningMessage =
          await message.channel.send(

            timeoutSuccess

              ?

              `🚫 ${member} đã bị hạn chế 1 ngày.`

              :

              `⚠️ ${member} đã bị phát hiện gửi nội dung trong kênh cảnh báo.`

          );

      } catch (fallbackError) {

        logger.error(
          '[PROTECTED] Không thể gửi warning text:',
          fallbackError
        );


        return false;
      }

    }


    /* =====================================================
       DELETE WARNING AFTER 5 SECONDS
    ===================================================== */

    if (
      warningMessage
    ) {

      setTimeout(
        () => {

          warningMessage
            .delete()
            .catch(
              error => {

                logger.debug(
                  '[PROTECTED] Không thể xóa warning:',
                  error?.message ||
                  error
                );

              }
            );

        },
        5000
      );

    }


    return true;


  } catch (error) {

    logger.error(
      '[PROTECTED] Warning message error:',
      error
    );


    return false;
  }

}


/* =========================================================
   SEND PROTECTED DM
========================================================= */

async function sendProtectedDM(
  member,
  timeoutSuccess
) {

  try {

    if (
      !member
    ) {

      return false;
    }


    const embed =
      new EmbedBuilder()
        .setColor(
          timeoutSuccess
            ? 0xed4245
            : 0xf1c40f
        )
        .setDescription(
          timeoutSuccess

            ?

            '🚫 Bạn đã bị hạn chế sử dụng các tính năng tương tác trong server trong **1 ngày**.\n\n' +
            'Lý do: gửi nội dung vào kênh cảnh báo.'

            :

            '⚠️ Bạn đã gửi nội dung vào kênh cảnh báo.\n\n' +
            'Bot chưa thể áp dụng hình phạt tự động.'
        )
        .setTimestamp();


    /* =====================================================
       SEND DM
    ===================================================== */

    try {

      await member.send({

        embeds: [
          embed,
        ],

      });


      logger.info(
        `[PROTECTED] Đã gửi DM cho ${member.user.tag}.`
      );


      return true;

    } catch (error) {

      /*
       * User có thể tắt DM.
       * Đây không phải lỗi nghiêm trọng.
       */

      logger.warn(
        `[PROTECTED] Không thể gửi DM cho ${member.user.tag}:`,
        error?.message ||
        error
      );


      return false;
    }

  } catch (error) {

    logger.error(
      '[PROTECTED] DM error:',
      error
    );


    return false;
  }

}


/* =========================================================
   COUNTING GAME
========================================================= */

async function handleCountingGame(
  message,
  client
) {

  try {

    const config =
      await getCountingGameConfig(
        client,
        message.guild.id
      );


    if (
      !config?.enabled
      ||
      message.channel.id !==
        config.channelId
    ) {

      return false;
    }


    /* =====================================================
       VALIDATE MESSAGE
    ===================================================== */

    const valid =
      isValidCountingMessage(
        message.content.trim(),
        config
      );


    const invalid =
      !valid
      ||
      message.author.id ===
        config.lastUserId;


    /* =====================================================
       INVALID
    ===================================================== */

    if (invalid) {

      await message
        .delete()
        .catch(
          () => {}
        );


      await saveCountingGameConfig(

        client,

        message.guild.id,

        {

          ...config,

          nextNumber:
            1,

          lastUserId:
            null,

          currentStreak:
            0,

        }

      );


      let msg;


      try {

        msg =
          await message.channel.send(

            `❌ Sai rồi <@${message.author.id}>. ` +
            `Reset về **1**.`

          );

      } catch (error) {

        logger.error(
          'Counting warning send error:',
          error
        );

      }


      if (msg) {

        setTimeout(
          () =>
            msg
              .delete()
              .catch(
                () => {}
              ),
          10000
        );

      }


      return true;

    }


    /* =====================================================
       CORRECT
    ===================================================== */

    await recordCorrectCount(

      client,

      message.guild.id,

      message.author.id

    );


    return true;


  } catch (error) {

    logger.error(
      'Counting Game Error:',
      error
    );


    return false;

  }

}


/* =========================================================
   PREFIX COMMANDS
========================================================= */

async function handlePrefixCommand(
  message,
  client
) {

  try {

    /* =====================================================
       GET GUILD CONFIG
    ===================================================== */

    const guildConfig =
      await getGuildConfig(
        client,
        message.guild.id
      );


    /* =====================================================
       PREFIX
    ===================================================== */

    const prefix =
      guildConfig?.prefix ||
      client.config?.bot?.prefix ||
      '!';


    /* =====================================================
       PARSE PREFIX
    ===================================================== */

    const parsed =
      parsePrefixCommand(
        message.content,
        prefix
      );


    if (!parsed) {
      return false;
    }


    const {
      commandName,
      args,
    } = parsed;


    /* =====================================================
       NORMALIZE COMMAND NAME
    ===================================================== */

    const normalizedCommandName =
      String(commandName)
        .trim()
        .toLowerCase();


    /* =====================================================
       HARD WHITELIST
    ===================================================== */

    if (
      !ALLOWED_PREFIX_COMMANDS.has(
        normalizedCommandName
      )
    ) {

      return true;
    }


    /* =====================================================
       LYRIC CHANNEL
    ===================================================== */

    if (
      normalizedCommandName ===
      'lyric'
    ) {

      if (
        message.channel.id !==
        LYRIC_CHANNEL_ID
      ) {

        try {

          await message.channel
            .send({

              embeds: [

                createEmbed({

                  title:
                    '🎵 Lệnh Lyric',

                  description:
                    `Bạn chỉ có thể sử dụng \`!lyric\` tại <#${LYRIC_CHANNEL_ID}>.`,

                  color:
                    'info',

                }),

              ],

            });

        } catch (error) {

          logger.error(
            '[PREFIX] Không thể gửi Lyric restriction message:',
            error
          );

        }


        return true;
      }

    }


    /* =====================================================
       ALIAS
    ===================================================== */

    const resolvedName =
      resolveCommandAlias(
        normalizedCommandName
      );


    const normalizedResolvedName =
      String(resolvedName)
        .trim()
        .toLowerCase();


    /* =====================================================
       KHÔNG CHO ALIAS VƯỢT WHITELIST
    ===================================================== */

    if (
      !ALLOWED_PREFIX_COMMANDS.has(
        normalizedResolvedName
      )
    ) {

      logger.warn(
        `[PREFIX] Blocked alias: ` +
        `${normalizedCommandName} -> ` +
        `${normalizedResolvedName}`
      );


      return true;
    }


    /* =====================================================
       FIND COMMAND
    ===================================================== */

    const command =
      client.commands.get(
        resolvedName
      );


    if (!command) {

      logger.warn(
        `[PREFIX] Command "${resolvedName}" ` +
        `chưa được load vào client.commands.`
      );


      if (
        normalizedResolvedName ===
        'lyric'
      ) {

        try {

          await message.channel
            .send({

              embeds: [

                createEmbed({

                  title:
                    '❌ Lyric chưa được load',

                  description:
                    'Bot không tìm thấy command `lyric` trong `client.commands`.\n\n' +
                    'Hãy kiểm tra file:\n' +
                    '`commands/lyric.js`\n\n' +
                    'Đồng thời kiểm tra log lúc bot khởi động.',

                  color:
                    'error',

                }),

              ],

            });

        } catch (error) {

          logger.error(
            '[PREFIX] Không thể gửi Lyric load error:',
            error
          );

        }

      }


      return true;
    }


    /* =====================================================
       PREFIX RESTRICTION
    ===================================================== */

    const restriction =
      getPrefixRestriction(

        command,

        args,

        resolveSubcommandAlias

      );


    if (

      !supportsPrefixExecution(
        command
      )

      ||

      restriction.blocked

    ) {

      if (
        restriction.reason
      ) {

        try {

          await message.channel
            .send({

              embeds: [

                createEmbed({

                  title:
                    'Slash Only',

                  description:
                    `${restriction.reason}\n` +
                    `Use \`/${resolvedName}\``,

                  color:
                    'info',

                }),

              ],

            });

        } catch (error) {

          logger.error(
            '[PREFIX] Không thể gửi restriction message:',
            error
          );

        }

      }


      return true;
    }


    /* =====================================================
       COMMAND ACCESS
    ===================================================== */

    const enabled =
      await isCommandEnabled(

        client,

        message.guild.id,

        resolvePrefixAccessKey(
          command.data,
          args
        ),

        command.category

      );


    if (!enabled) {

      try {

        await message.channel
          .send({

            embeds: [

              createEmbed({

                title:
                  'Disabled',

                description:
                  'Command is disabled on this server.',

                color:
                  'error',

              }),

            ],

          });

      } catch (error) {

        logger.error(
          '[PREFIX] Không thể gửi Disabled message:',
          error
        );

      }


      return true;
    }


    /* =====================================================
       ABUSE PROTECTION
    ===================================================== */

    const abuse =
      await enforceAbuseProtection(

        {
          guildId:
            message.guild.id,

          user:
            message.author,
        },

        command,

        resolvedName

      );


    if (!abuse.allowed) {

      try {

        await message.channel
          .send({

            embeds: [

              createEmbed({

                title:
                  'Cooldown',

                description:
                  `Wait **${formatCooldownDuration(
                    abuse.remainingMs
                  )}**`,

                color:
                  'error',

              }),

            ],

          });

      } catch (error) {

        logger.error(
          '[PREFIX] Không thể gửi cooldown message:',
          error
        );

      }


      return true;
    }


    /* =====================================================
       EXECUTE COMMAND
    ===================================================== */

    await executePrefixCommand(

      command,

      message,

      args,

      client,

      prefix,

      guildConfig

    );


    logger.info(
      `[PREFIX] ${message.author.tag} ` +
      `used ${prefix}${resolvedName}`
    );


    return true;


  } catch (error) {

    logger.error(
      'Prefix Command Error:',
      error
    );


    return true;

  }

}


/* =========================================================
   LEVELING
========================================================= */

async function handleLeveling(
  message,
  client
) {

  try {

    const key =
      `xp:${message.guild.id}:` +
      `${message.author.id}`;


    /* =====================================================
       XP RATE LIMIT
    ===================================================== */

    const allowed =
      await checkRateLimit(

        key,

        XP_RATE_LIMIT_ATTEMPTS,

        XP_RATE_LIMIT_WINDOW_MS

      );


    if (!allowed) {
      return;
    }


    /* =====================================================
       LEVELING CONFIG
    ===================================================== */

    const config =
      await getLevelingConfig(
        client,
        message.guild.id
      );


    if (
      !config?.enabled
    ) {

      return;
    }


    /* =====================================================
       IGNORED CHANNEL
    ===================================================== */

    if (
      config.ignoredChannels?.includes(
        message.channel.id
      )
    ) {

      return;
    }


    /* =====================================================
       BLACKLIST USER
    ===================================================== */

    if (
      config.blacklistedUsers?.includes(
        message.author.id
      )
    ) {

      return;
    }


    /* =====================================================
       IGNORED ROLE
    ===================================================== */

    const member =
      message.member;


    if (
      member?.roles.cache.some(
        role =>
          config.ignoredRoles?.includes(
            role.id
          )
      )
    ) {

      return;
    }


    /* =====================================================
       USER DATA
    ===================================================== */

    const userData =
      await getUserLevelData(

        client,

        message.guild.id,

        message.author.id

      );


    const last =
      userData?.lastMessage ||
      0;


    const cooldown =
      (
        config.xpCooldown ||
        60
      ) * 1000;


    if (
      Date.now() - last <
      cooldown
    ) {

      return;
    }


    /* =====================================================
       XP RANGE
    ===================================================== */

    const min =
      config.xpRange?.min ??
      15;


    const max =
      config.xpRange?.max ??
      25;


    const xp =
      Math.floor(
        Math.random() *
        (max - min + 1)
      ) + min;


    /* =====================================================
       ADD XP
    ===================================================== */

    const result =
      await addXp(

        client,

        message.guild,

        message.member,

        xp

      );


    /* =====================================================
       LEVEL UP
    ===================================================== */

    if (
      result?.leveledUp
    ) {

      logger.info(

        `${message.author.tag} ` +
        `leveled up to ${result.level}`

      );

    }


  } catch (error) {

    logger.error(
      'Leveling Error:',
      error
    );

  }

}
