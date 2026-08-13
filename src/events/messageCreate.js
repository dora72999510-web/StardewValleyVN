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
   CONFIG
========================================================= */

/*
 * CHỈ cho phép 2 PREFIX COMMAND:
 *
 * !faq
 * !clearuser
 *
 * Tất cả prefix command khác sẽ bị bỏ qua.
 */
const ALLOWED_PREFIX_COMMANDS = new Set([
  'faq',
  'clearuser',
]);


const XP_RATE_LIMIT_ATTEMPTS = 12;
const XP_RATE_LIMIT_WINDOW_MS = 10000;


/*
 * Protected channels
 */
const PROTECTED_CHANNELS = [
  '1521007503263928341',
];


/*
 * Role được miễn protected channel
 */
const EXEMPT_ROLE_IDS = [
  '1510657849112399928',
  '1514302887419842590',
];


/*
 * Timeout protected channel
 */
const PROTECTED_TIMEOUT =
  24 * 60 * 60 * 1000;


/* =========================================================
   MESSAGE CREATE
========================================================= */

export default {
  name: Events.MessageCreate,

  async execute(message, client) {

    try {

      /*
       * Bỏ qua DM
       * Bỏ qua bot
       */

      if (
        !message.guild ||
        message.author.bot
      ) {
        return;
      }


      /* ===================================================
         AUTO ROLE
      =================================================== */

      await handleAutoRole(message);


      /* ===================================================
         FAQ
         ---------------------------------------------------
         FAQ được xử lý trước prefix.
      =================================================== */

      if (
        await handleFaq(message)
      ) {
        return;
      }


      /* ===================================================
         PROTECTED CHANNELS
      =================================================== */

      if (
        await handleProtectedChannels(message)
      ) {
        return;
      }


      /* ===================================================
         COUNTING GAME
      =================================================== */

      if (
        await handleCountingGame(
          message,
          client
        )
      ) {
        return;
      }


      /* ===================================================
         PREFIX COMMANDS
         ---------------------------------------------------
         CHỈ:

         !faq
         !clearuser

         Các lệnh prefix khác sẽ bị bỏ qua.
      =================================================== */

      await handlePrefixCommand(
        message,
        client
      );


      /* ===================================================
         LEVELING
      =================================================== */

      await handleLeveling(
        message,
        client
      );

    } catch (err) {

      logger.error(
        'MessageCreate Error:',
        err
      );

    }

  },
};


/* =========================================================
   PROTECTED CHANNELS
========================================================= */

async function handleProtectedChannels(message) {

  try {

    /*
     * Không phải protected channel
     */

    if (
      !PROTECTED_CHANNELS.includes(
        message.channel.id
      )
    ) {
      return false;
    }


    /*
     * Fetch member
     */

    const member =
      await message.guild.members
        .fetch(message.author.id)
        .catch(() => null);


    if (!member) {
      return true;
    }


    /* =====================================================
       BYPASS
    ===================================================== */

    if (

      member.permissions.has(
        PermissionsBitField.Flags.Administrator
      ) ||

      member.permissions.has(
        PermissionsBitField.Flags.ManageMessages
      ) ||

      member.roles.cache.some(
        role =>
          EXEMPT_ROLE_IDS.includes(
            role.id
          )
      )

    ) {

      return true;

    }


    /* =====================================================
       DELETE MESSAGE
    ===================================================== */

    await message
      .delete()
      .catch(() => {});


    /* =====================================================
       CHECK MODERATABLE
    ===================================================== */

    if (!member.moderatable) {

      logger.warn(
        `Cannot timeout ${member.user.tag} (role hierarchy issue)`
      );

      return true;

    }


    /* =====================================================
       TIMEOUT
    ===================================================== */

    await member.timeout(
      PROTECTED_TIMEOUT,
      'Message in protected channel'
    );


    logger.warn(
      `Timeout applied to ${member.user.tag}`
    );


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
      .catch(() => {});


    /* =====================================================
       LOG CHANNEL
    ===================================================== */

    const logChannel =
      await message.guild.channels
        .fetch(
          '1510871300132835368'
        )
        .catch(() => null);


    if (
      logChannel?.isTextBased()
    ) {

      await logChannel.send(

        `🚫 Tài khoản ${member} đã bị hạn chế 1 ngày ` +
        `do gửi nội dung vào <#1521007503263928341>`

      );

    }


    /* =====================================================
       WARNING MESSAGE
    ===================================================== */

    const warn =
      await message.channel.send(

        `🚫 ${member} đã bị hạn chế 1 ngày.`

      );


    setTimeout(
      () =>
        warn
          .delete()
          .catch(() => {}),

      5000
    );


    return true;

  } catch (err) {

    logger.error(
      'Protected Channel Error:',
      err
    );

    return true;

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


    /*
     * Counting không bật
     */

    if (
      !config?.enabled ||
      message.channel.id !==
        config.channelId
    ) {

      return false;

    }


    /* =====================================================
       VALIDATE
    ===================================================== */

    const valid =
      isValidCountingMessage(
        message.content.trim(),
        config
      );


    const invalid =
      !valid ||
      message.author.id ===
        config.lastUserId;


    /* =====================================================
       INVALID
    ===================================================== */

    if (invalid) {

      await message
        .delete()
        .catch(() => {});


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
            .catch(() => {}),

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

  } catch (err) {

    logger.error(
      'Counting Game Error:',
      err
    );

    return false;

  }

}


/* =========================================================
   PREFIX COMMANDS
   ---------------------------------------------------------
   CHỈ CÒN:

   !faq
   !clearuser

   Mọi prefix command khác đều bị chặn.
========================================================= */

async function handlePrefixCommand(
  message,
  client
) {

  try {

    /* =====================================================
       GUILD CONFIG
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
       PARSE
    ===================================================== */

    const parsed =
      parsePrefixCommand(
        message.content,
        prefix
      );


    /*
     * Không phải prefix command
     */

    if (!parsed) {
      return;
    }


    const {
      commandName,
      args,
    } = parsed;


    /*
     * Normalize command name.
     *
     * Ví dụ:
     *
     * FAQ
     * Faq
     * faq
     *
     * đều thành faq.
     */

    const normalizedCommandName =
      String(
        commandName
      )
        .trim()
        .toLowerCase();


    /* =====================================================
       HARD WHITELIST
       -----------------------------------------------------
       Đây là phần quan trọng nhất.

       Nếu không nằm trong:

       faq
       clearuser

       => DỪNG NGAY.
    ===================================================== */

    if (
      !ALLOWED_PREFIX_COMMANDS.has(
        normalizedCommandName
      )
    ) {

      return;

    }


    /* =====================================================
       ALIAS
    ===================================================== */

    const resolvedName =
      resolveCommandAlias(
        normalizedCommandName
      );


    /*
     * Kiểm tra alias sau khi resolve.
     *
     * Nếu alias trỏ tới command khác ngoài
     * faq / clearuser thì cũng chặn.
     */

    const normalizedResolvedName =
      String(
        resolvedName
      )
        .trim()
        .toLowerCase();


    if (
      !ALLOWED_PREFIX_COMMANDS.has(
        normalizedResolvedName
      )
    ) {

      return;

    }


    /* =====================================================
       FIND COMMAND
    ===================================================== */

    const command =
      client.commands.get(
        resolvedName
      );


    if (!command) {

      logger.debug(
        `Allowed prefix command "${resolvedName}" is not loaded.`
      );

      return;

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
      !supportsPrefixExecution(command) ||
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
          .catch(() => {});

      }


      return;

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
        .catch(() => {});


      return;

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
        .catch(() => {});


      return;

    }


    /* =====================================================
       EXECUTE
    ===================================================== */

    await executePrefixCommand(

      command,

      message,

      args,

      client,

      prefix,

      guildConfig

    );


  } catch (err) {

    logger.error(
      'Prefix Command Error:',
      err
    );

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
      `xp:${message.guild.id}:${message.author.id}`;


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

  } catch (err) {

    logger.error(
      'Leveling Error:',
      err
    );

  }

}
