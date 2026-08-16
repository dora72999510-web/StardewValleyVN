import { Events, PermissionsBitField } from 'discord.js';
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
   EXEMPT ROLES
========================================================= */

const EXEMPT_ROLE_IDS = [
  '1510657849112399928',
  '1514302887419842590',
];


/* =========================================================
   PROTECTED CONFIG
========================================================= */

const PROTECTED_TIMEOUT =
  24 * 60 * 60 * 1000;

const PROTECTED_MESSAGE_LOOKBACK_MS =
  60 * 60 * 1000;

const PROTECTED_LOG_CHANNEL_ID =
  '1510871300132835368';


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
   ---------------------------------------------------------
   Mỗi message trong protected channel sẽ chạy lại function
   này. Không lưu trạng thái user đã bị phạt trước đó.
========================================================= */

async function handleProtectedChannels(
  message
) {

  try {

    /* =====================================================
       CHECK CHANNEL
    ===================================================== */

    if (
      !PROTECTED_CHANNELS.includes(
        message.channel.id
      )
    ) {

      return false;
    }


    /* =====================================================
       FETCH MEMBER MỚI NHẤT
       -----------------------------------------------------
       Không dùng message.member để tránh trạng thái cache
       cũ sau khi timeout được gỡ.
    ===================================================== */

    const member =
      await message.guild.members
        .fetch({
          user:
            message.author.id,

          force:
            true,
        })
        .catch(
          error => {

            logger.error(
              `[Protected] Không thể fetch member ` +
              `${message.author.id}:`,
              error
            );

            return null;
          }
        );


    if (!member) {

      logger.warn(
        `[Protected] Member không tồn tại: ` +
        `${message.author.id}`
      );

      return true;
    }


    /* =====================================================
       BYPASS
       -----------------------------------------------------
       Giữ nguyên logic cũ:
       - Administrator
       - ManageMessages
       - Exempt roles
    ===================================================== */

    const isAdministrator =
      member.permissions.has(
        PermissionsBitField.Flags.Administrator
      );


    const canManageMessages =
      member.permissions.has(
        PermissionsBitField.Flags.ManageMessages
      );


    const hasExemptRole =
      member.roles.cache.some(
        role =>
          EXEMPT_ROLE_IDS.includes(
            role.id
          )
      );


    if (
      isAdministrator
      ||
      canManageMessages
      ||
      hasExemptRole
    ) {

      logger.info(
        `[Protected] Bypass user ` +
        `${member.user.tag} ` +
        `(${member.id})`
      );

      return true;
    }


    /* =====================================================
       LOG VIOLATION
    ===================================================== */

    logger.warn(
      `[Protected] Violation detected: ` +
      `${member.user.tag} (${member.id}) ` +
      `in #${message.channel.name} (${message.channel.id})`
    );


    /* =====================================================
       DELETE CURRENT MESSAGE
    ===================================================== */

    await message
      .delete()
      .catch(
        error => {

          logger.warn(
            `[Protected] Không thể xóa message ` +
            `${message.id}:`,
            error
          );

        }
      );


    /* =====================================================
       DELETE USER MESSAGES - LAST 1 HOUR
    ===================================================== */

    await deleteRecentUserMessages(
      message.guild,
      message.author.id
    );


    /* =====================================================
       CHECK MODERATABLE
    ===================================================== */

    if (
      !member.moderatable
    ) {

      logger.warn(
        `[Protected] Không thể timeout ${member.user.tag} ` +
        `(role hierarchy issue)`
      );

      return true;
    }


    /* =====================================================
       TIMEOUT
       -----------------------------------------------------
       Mỗi lần vi phạm mới đều timeout lại 24 giờ.
    ===================================================== */

    try {

      await member.timeout(
        PROTECTED_TIMEOUT,
        'Message in protected channel'
      );


      logger.warn(
        `[Protected] Timeout applied to ` +
        `${member.user.tag} (${member.id})`
      );


    } catch (error) {

      logger.error(
        `[Protected] Timeout failed for ` +
        `${member.user.tag}:`,
        error
      );

      /*
       * Không return ở đây.
       * Vẫn tiếp tục log và warning để biết violation
       * đã được phát hiện.
       */

    }


    /* =====================================================
       DM USER
    ===================================================== */

    await member
      .send({

        embeds: [

          createEmbed({

            title:
              '🚫 Bạn đã bị hạn chế',

            description:
              'Bạn đã gửi tin trong kênh cảnh báo.\n' +
              'Hình phạt: **hạn chế 1 ngày**.',

            color:
              'error',

          }),

        ],

      })
      .catch(
        error => {

          logger.warn(
            `[Protected] Không thể DM ` +
            `${member.user.tag}:`,
            error
          );

        }
      );


    /* =====================================================
       LOG CHANNEL
    ===================================================== */

    const logChannel =
      await message.guild.channels
        .fetch(
          PROTECTED_LOG_CHANNEL_ID
        )
        .catch(
          error => {

            logger.warn(
              `[Protected] Không thể fetch log channel:`,
              error
            );

            return null;
          }
        );


    if (
      logChannel?.isTextBased()
    ) {

      await logChannel
        .send(

          `🚫 Tài khoản ${member} đã bị hạn chế 1 ngày ` +
          `do gửi nội dung vào <#${message.channel.id}>`

        )
        .catch(
          error => {

            logger.warn(
              `[Protected] Không thể gửi log:`,
              error
            );

          }
        );

    }


    /* =====================================================
       WARNING MESSAGE
    ===================================================== */

    const warn =
      await message.channel
        .send(
          `🚫 ${member} đã bị hạn chế 1 ngày.`
        )
        .catch(
          () => null
        );


    if (warn) {

      setTimeout(
        () =>
          warn
            .delete()
            .catch(
              () => {}
            ),
        5000
      );

    }


    return true;


  } catch (error) {

    logger.error(
      'Protected Channel Error:',
      error
    );


    /*
     * Nếu đang ở protected channel mà xảy ra lỗi,
     * return true để không chạy tiếp counting/prefix/
     * leveling cho message này.
     */

    return true;

  }

}


/* =========================================================
   DELETE RECENT USER MESSAGES
   ---------------------------------------------------------
   Xóa tất cả message của đúng user trong 1 giờ trở lại.

   Không dùng bulkDelete cho message cũ hơn 14 ngày vì
   Discord không cho bulk delete message quá cũ.

   Vì window chỉ có 1 giờ nên các message hợp lệ đều
   nằm trong giới hạn bulk delete.
========================================================= */

async function deleteRecentUserMessages(
  guild,
  userId
) {

  try {

    const cutoff =
      Date.now() -
      PROTECTED_MESSAGE_LOOKBACK_MS;


    logger.info(
      `[Protected Cleanup] Bắt đầu quét message ` +
      `của ${userId} từ ${new Date(cutoff).toISOString()}`
    );


    const channels =
      await guild.channels
        .fetch()
        .catch(
          error => {

            logger.error(
              `[Protected Cleanup] Không thể fetch channels:`,
              error
            );

            return null;
          }
        );


    if (!channels) {
      return;
    }


    /* =====================================================
       LOOP CHANNELS
    ===================================================== */

    for (
      const channel of channels.values()
    ) {

      try {

        /* =================================================
           CHỈ TEXT-BASED CHANNEL
        ================================================= */

        if (
          !channel?.isTextBased?.()
        ) {
          continue;
        }


        if (
          !channel.messages
        ) {
          continue;
        }


        /* =================================================
           CHECK PERMISSION
        ================================================= */

        const botMember =
          guild.members.me;


        if (!botMember) {

          logger.warn(
            `[Protected Cleanup] Không tìm thấy bot member.`
          );

          break;
        }


        const permissions =
          channel.permissionsFor(
            botMember
          );


        if (!permissions) {
          continue;
        }


        if (
          !permissions.has(
            PermissionsBitField.Flags.ViewChannel
          )
        ) {
          continue;
        }


        if (
          !permissions.has(
            PermissionsBitField.Flags.ReadMessageHistory
          )
        ) {
          continue;
        }


        if (
          !permissions.has(
            PermissionsBitField.Flags.ManageMessages
          )
        ) {
          continue;
        }


        /* =================================================
           FETCH MESSAGE TỪ MỚI → CŨ
        ================================================= */

        let before =
          undefined;


        while (true) {

          const options = {
            limit: 100,
          };


          if (before) {
            options.before =
              before;
          }


          const fetched =
            await channel.messages
              .fetch(
                options
              )
              .catch(
                error => {

                  logger.warn(
                    `[Protected Cleanup] Fetch message ` +
                    `failed in channel ${channel.id}:`,
                    error
                  );

                  return null;
                }
              );


          if (
            !fetched ||
            fetched.size === 0
          ) {
            break;
          }


          /* =================================================
             MESSAGE CỦA USER TRONG 1 GIỜ
          ================================================= */

          const targets =
            fetched.filter(
              msg => {

                if (
                  msg.author?.id !==
                  userId
                ) {
                  return false;
                }


                return (
                  msg.createdTimestamp >=
                  cutoff
                );

              }
            );


          /* =================================================
             DELETE
          ================================================= */

          if (
            targets.size > 0
          ) {

            logger.info(
              `[Protected Cleanup] Channel ` +
              `${channel.id}: tìm thấy ` +
              `${targets.size} message của ${userId}`
            );


            try {

              await channel.bulkDelete(
                targets,
                true
              );


            } catch (bulkError) {

              logger.warn(
                `[Protected Cleanup] bulkDelete failed ` +
                `in ${channel.id}, fallback từng message:`,
                bulkError
              );


              for (
                const msg of targets.values()
              ) {

                await msg
                  .delete()
                  .catch(
                    error => {

                      logger.warn(
                        `[Protected Cleanup] Không thể xóa ` +
                        `message ${msg.id}:`,
                        error
                      );

                    }
                  );

              }

            }

          }


          /* =================================================
             KIỂM TRA MESSAGE CŨ NHẤT
          ================================================= */

          const oldest =
            fetched.last();


          if (!oldest) {
            break;
          }


          /*
           * Nếu message cũ nhất trong batch đã cũ hơn
           * cutoff thì không cần fetch tiếp.
           */

          if (
            oldest.createdTimestamp <
            cutoff
          ) {
            break;
          }


          /*
           * Nếu chưa đủ 100 message thì đã tới cuối
           * lịch sử channel.
           */

          if (
            fetched.size < 100
          ) {
            break;
          }


          /*
           * Tiếp tục lấy batch kế tiếp.
           */

          before =
            oldest.id;

        }


      } catch (channelError) {

        logger.warn(
          `[Protected Cleanup] Lỗi xử lý channel ` +
          `${channel?.id || 'unknown'}:`,
          channelError
        );

      }

    }


    logger.info(
      `[Protected Cleanup] Hoàn tất quét message ` +
      `của ${userId}.`
    );


  } catch (error) {

    logger.error(
      '[Protected Cleanup] Unexpected Error:',
      error
    );

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


      const msg =
        await message.channel.send(

          `❌ Sai rồi <@${message.author.id}>. ` +
          `Reset về **1**.`

        );


      setTimeout(
        () =>
          msg
            .delete()
            .catch(
              () => {}
            ),
        10000
      );


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

          })
          .catch(
            () => {}
          );


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

          })
          .catch(
            () => {}
          );

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

          })
          .catch(
            () => {}
          );

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

        })
        .catch(
          () => {}
        );


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

        })
        .catch(
          () => {}
        );


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
