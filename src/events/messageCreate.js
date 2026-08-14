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
   ---------------------------------------------------------
   CHỈ CHO PHÉP:

   !faq
   !clearuser
   !lyric

   Mọi prefix command khác sẽ bị bỏ qua.
========================================================= */

const ALLOWED_PREFIX_COMMANDS = new Set([
  'faq',
  'clearuser',
  'lyric',
]);


/* =========================================================
   LYRIC CONFIG
   ---------------------------------------------------------
   QUAN TRỌNG:

   Thay ID bên dưới bằng ID channel bạn muốn dùng.

   Hiện tại đang dùng:
   1537723665754357780
========================================================= */

const LYRIC_CHANNEL_ID = '1537723665754357780';


/* =========================================================
   XP CONFIG
========================================================= */

const XP_RATE_LIMIT_ATTEMPTS = 12;
const XP_RATE_LIMIT_WINDOW_MS = 10000;


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
   PROTECTED TIMEOUT
========================================================= */

const PROTECTED_TIMEOUT =
  24 * 60 * 60 * 1000;


/* =========================================================
   MESSAGE CREATE
========================================================= */

export default {
  name: Events.MessageCreate,

  async execute(message, client) {

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

        await handleAutoRole(message);

      } catch (error) {

        logger.error(
          'AutoRole Error:',
          error
        );

      }


      /* =====================================================
         PROTECTED CHANNEL
         -----------------------------------------------------
         Ưu tiên cao nhất.
      ===================================================== */

      if (
        await handleProtectedChannels(message)
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
         -----------------------------------------------------
         !faq
         !clearuser
         !lyric
      ===================================================== */

      const wasPrefixCommand =
        await handlePrefixCommand(
          message,
          client
        );


      /*
       * Nếu đã xử lý prefix command thì dừng.
       *
       * Không để FAQ hoặc Leveling xử lý tiếp.
       */

      if (wasPrefixCommand) {
        return;
      }


      /* =====================================================
         FAQ AUTO RESPONDER
         -----------------------------------------------------
         Chỉ xử lý tin nhắn bình thường.
      ===================================================== */

      try {

        if (
          await handleFaq(message)
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

async function handleProtectedChannels(message) {

  try {

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

  if (logChannel?.isTextBased()) {

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setDescription(
      `Tài khoản ${member} đã bị hạn chế 1 ngày ` +
      `do gửi nội dung vào <#1521007503263928341>`
    );

  await logChannel.send({
    embeds: [embed],
  });

}

    /* =====================================================
       WARNING MESSAGE
    ===================================================== */

    const warn =
      await message.channel.send(
        `🚫 Bạn đã bị hạn chế 1 ngày.`
      );


    setTimeout(
      () =>
        warn
          .delete()
          .catch(() => {}),
      5000
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
   ---------------------------------------------------------
   RETURN:

   true  = đã xử lý prefix command
   false = không phải prefix command
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


    /*
     * Không phải prefix command.
     */

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
       -----------------------------------------------------
       CHỈ CHO:

       !faq
       !clearuser
       !lyric
    ===================================================== */

    if (
      !ALLOWED_PREFIX_COMMANDS.has(
        normalizedCommandName
      )
    ) {

      /*
       * Không báo lỗi.
       * Không chạy command.
       */

      return true;

    }


    /* =====================================================
       LYRIC CHANNEL
       -----------------------------------------------------
       !lyric chỉ được chạy trong channel chỉ định.
    ===================================================== */

    if (
      normalizedCommandName === 'lyric'
    ) {

      /*
       * Không còn kiểm tra:
       *
       * process.env.LYRIC_CHANNEL_ID
       *
       * Không còn báo:
       *
       * "Lyric chưa được cấu hình"
       *
       * ID được cố định trực tiếp ở đầu file.
       */

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
          .catch(() => {});


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
        `[PREFIX] Blocked alias: ${normalizedCommandName} -> ${normalizedResolvedName}`
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
        `[PREFIX] Command "${resolvedName}" chưa được load vào client.commands.`
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
          .catch(() => {});

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
          .catch(() => {});

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
        .catch(() => {});


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
        .catch(() => {});


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
      `[PREFIX] ${message.author.tag} used ${prefix}${resolvedName}`
    );


    return true;


  } catch (error) {

    logger.error(
      'Prefix Command Error:',
      error
    );


    /*
     * Nếu đã nhận diện là prefix command,
     * không cho FAQ responder xử lý lại.
     */

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


  } catch (error) {

    logger.error(
      'Leveling Error:',
      error
    );

  }

}
