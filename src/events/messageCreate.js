import { Events, PermissionsBitField } from 'discord.js';
import { logger } from '../utils/logger.js';

import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { parsePrefixCommand } from '../utils/prefixParser.js';
import { handleAutoRole } from '../events/autoRole.js';
import { handleFaq } from '../events/faqResponder.js';
console.log('AUTO ROLE TYPE:', typeof handleAutoRole);

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

/* =========================
   CONFIG
========================= */
const XP_RATE_LIMIT_ATTEMPTS = 12;
const XP_RATE_LIMIT_WINDOW_MS = 10000;

const PROTECTED_CHANNELS = ['1521007503263928341'];
const EXEMPT_ROLE_IDS = ['1510657849112399928', '1514302887419842590'];

const PROTECTED_TIMEOUT = 24 * 60 * 60 * 1000;

/* =========================
   EVENT
========================= */
export default {
  name: Events.MessageCreate,

  async execute(message, client) {
    try {
      if (!message.guild || message.author.bot) return;

      await handleAutoRole(message); // 👈 đặt ở đây

      // FAQ
      if (await handleFaq(message)) return;

      /* 1. Protected Channels (HIGHEST PRIORITY) */
      if (await handleProtectedChannels(message)) return;

      /* 2. Counting Game */
      if (await handleCountingGame(message, client)) return;

     /* 3. Clear User Command */
      const clearUserHandled =
        await handleClearUserCommand(message, client);
    
      if (clearUserHandled) return;
    
    /* 4. Prefix Commands */
      await handlePrefixCommand(message, client);
    
    /* 5. Leveling System */
      await handleLeveling(message, client);

    } catch (err) {
      logger.error('MessageCreate Error:', err);
    }
  },
};

/* =========================
   PROTECTED CHANNELS
========================= */
async function handleProtectedChannels(message) {
  try {
    if (!PROTECTED_CHANNELS.includes(message.channel.id)) {
      return false;
    }

    const member = await message.guild.members
      .fetch(message.author.id)
      .catch(() => null);

    if (!member) return true;

    // Bypass permissions
    if (
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
      member.roles.cache.some(r => EXEMPT_ROLE_IDS.includes(r.id))
    ) {
      return true;
    }

    // Delete message
    await message.delete().catch(() => {});

    // CHECK moderatable (QUAN TRỌNG)
    if (!member.moderatable) {
      logger.warn(`Cannot timeout ${member.user.tag} (role hierarchy issue)`);
      return true;
    }

    // Timeout
    await member.timeout(
      PROTECTED_TIMEOUT,
      'Message in protected channel'
    );

    logger.warn(`Timeout applied to ${member.user.tag}`);

    // DM user
    await member.send({
      embeds: [
        createEmbed({
          title: '🚫 Bạn đã bị hạn chế',
          description:
            `Bạn đã gửi tin trong kênh cảnh báo.\n` +
            `Hình phạt: **hạn chế 1 ngày**.`,
          color: 'error',
        }),
      ],
    }).catch(() => {});

    // Log channel
    const logChannel = await message.guild.channels
      .fetch('1510183155762597990')
      .catch(() => null);

    if (logChannel?.isTextBased()) {
      await logChannel.send(
        `🚫 Tài khoản ${member} đã bị hạn chế 1 ngày do gửi nội dung vào <#1521007503263928341>`
      );
    }

    // Warning message
    const warn = await message.channel.send(
      `🚫 ${member} đã bị hạn chế 1 ngày.`
    );

    setTimeout(() => warn.delete().catch(() => {}), 5000);

    return true;

  } catch (err) {
    logger.error('Protected Channel Error:', err);
    return true;
  }
}

/* =========================
   COUNTING GAME
========================= */
async function handleCountingGame(message, client) {
  try {
    const config = await getCountingGameConfig(client, message.guild.id);

    if (!config?.enabled || message.channel.id !== config.channelId) {
      return false;
    }

    const valid = isValidCountingMessage(
      message.content.trim(),
      config
    );

    const invalid =
      !valid || message.author.id === config.lastUserId;

    if (invalid) {
      await message.delete().catch(() => {});

      await saveCountingGameConfig(client, message.guild.id, {
        ...config,
        nextNumber: 1,
        lastUserId: null,
        currentStreak: 0,
      });

      const msg = await message.channel.send(
        `❌ Sai rồi <@${message.author.id}>. Reset về **1**.`
      );

      setTimeout(() => msg.delete().catch(() => {}), 10000);

      return true;
    }

    await recordCorrectCount(
      client,
      message.guild.id,
      message.author.id
    );

    return true;

  } catch (err) {
    logger.error('Counting Game Error:', err);
    return false;
  }
}

/* =========================
   PREFIX COMMANDS
========================= */
async function handlePrefixCommand(message, client) {
  try {
    const guildConfig = await getGuildConfig(client, message.guild.id);

    const prefix =
      guildConfig?.prefix ||
      client.config?.bot?.prefix ||
      '!';

    const parsed = parsePrefixCommand(message.content, prefix);
    if (!parsed) return;

    const { commandName, args } = parsed;

    const resolvedName = resolveCommandAlias(commandName);
    const command = client.commands.get(resolvedName);

    if (!command) return;

    const restriction = getPrefixRestriction(
      command,
      args,
      resolveSubcommandAlias
    );

    if (!supportsPrefixExecution(command) || restriction.blocked) {
      if (restriction.reason) {
        await message.channel.send({
          embeds: [
            createEmbed({
              title: 'Slash Only',
              description: `${restriction.reason}\nUse \`/${resolvedName}\``,
              color: 'info',
            }),
          ],
        }).catch(() => {});
      }
      return;
    }

    const enabled = await isCommandEnabled(
      client,
      message.guild.id,
      resolvePrefixAccessKey(command.data, args),
      command.category
    );

    if (!enabled) {
      await message.channel.send({
        embeds: [
          createEmbed({
            title: 'Disabled',
            description: 'Command is disabled on this server.',
            color: 'error',
          }),
        ],
      }).catch(() => {});
      return;
    }

    const abuse = await enforceAbuseProtection(
      { guildId: message.guild.id, user: message.author },
      command,
      resolvedName
    );

    if (!abuse.allowed) {
      await message.channel.send({
        embeds: [
          createEmbed({
            title: 'Cooldown',
            description: `Wait **${formatCooldownDuration(abuse.remainingMs)}**`,
            color: 'error',
          }),
        ],
      }).catch(() => {});
      return;
    }

    await executePrefixCommand(
      command,
      message,
      args,
      client,
      prefix,
      guildConfig
    );

  } catch (err) {
    logger.error('Prefix Command Error:', err);
  }
}

/* =========================
   LEVELING
========================= */
async function handleLeveling(message, client) {
  try {
    const key = `xp:${message.guild.id}:${message.author.id}`;

    const allowed = await checkRateLimit(
      key,
      XP_RATE_LIMIT_ATTEMPTS,
      XP_RATE_LIMIT_WINDOW_MS
    );

    if (!allowed) return;

    const config = await getLevelingConfig(client, message.guild.id);
    if (!config?.enabled) return;

    if (config.ignoredChannels?.includes(message.channel.id)) return;
    if (config.blacklistedUsers?.includes(message.author.id)) return;

    const member = message.member;
    if (member?.roles.cache.some(r => config.ignoredRoles?.includes(r.id))) return;

    const userData = await getUserLevelData(
      client,
      message.guild.id,
      message.author.id
    );

    const last = userData?.lastMessage || 0;
    const cooldown = (config.xpCooldown || 60) * 1000;

    if (Date.now() - last < cooldown) return;

    const min = config.xpRange?.min ?? 15;
    const max = config.xpRange?.max ?? 25;

    const xp =
      Math.floor(Math.random() * (max - min + 1)) + min;

    const result = await addXp(
      client,
      message.guild,
      message.member,
      xp
    );

    if (result?.leveledUp) {
      logger.info(
        `${message.author.tag} leveled up to ${result.level}`
      );
    }

  } catch (err) {
    logger.error('Leveling Error:', err);
  }
}
/* =========================
   CLEAR USER COMMAND
========================= */
async function handleClearUserCommand(message, client) {
  try {
    // Lấy prefix hiện tại của server
    const guildConfig = await getGuildConfig(
      client,
      message.guild.id
    );

    const prefix =
      guildConfig?.prefix ||
      client.config?.bot?.prefix ||
      '!';

    // Không phải command
    if (!message.content.startsWith(prefix)) {
      return false;
    }

    const args = message.content
      .slice(prefix.length)
      .trim()
      .split(/\s+/);

    const commandName = args.shift()?.toLowerCase();

    // Chỉ xử lý clearuser
    if (commandName !== 'clearuser') {
      return false;
    }

    // =========================
    // CHECK PERMISSION USER
    // =========================

    const isAdmin = message.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    );

    const isModerator = message.member.permissions.has(
      PermissionsBitField.Flags.ManageMessages
    );

    if (!isAdmin && !isModerator) {
      await message.reply(
        '❌ Bạn cần quyền **Administrator** hoặc **Manage Messages** để sử dụng lệnh này.'
      );

      return true;
    }

    // =========================
    // CHECK BOT PERMISSION
    // =========================

    const botMember = message.guild.members.me;

    if (!botMember?.permissions.has(
      PermissionsBitField.Flags.ManageMessages
    )) {
      await message.reply(
        '❌ Bot cần quyền **Manage Messages** để xóa tin nhắn.'
      );

      return true;
    }

    // =========================
    // GET TARGET
    // =========================

    const targetUser = message.mentions.users.first();

    if (!targetUser) {
      await message.reply(
        `❌ Cú pháp:\n` +
        `\`${prefix}clearuser @user\`\n` +
        `\`${prefix}clearuser @user 100\``
      );

      return true;
    }

    // =========================
    // KHÔNG XÓA BOT
    // =========================

    if (targetUser.bot) {
      await message.reply(
        '❌ Không thể xóa tin nhắn của bot.'
      );

      return true;
    }

    // =========================
    // LIMIT
    // =========================

    let limit = Infinity;

    if (args[0]) {
      const parsed = Number(args[0]);

      if (
        !Number.isInteger(parsed) ||
        parsed <= 0
      ) {
        await message.reply(
          '❌ Số lượng phải là số nguyên lớn hơn 0.'
        );

        return true;
      }

      limit = parsed;
    }

    // =========================
    // STATUS
    // =========================

    const status = await message.reply(
      `🔎 Đang quét tin nhắn của **${targetUser.tag}**...`
    );

    let deletedCount = 0;
    let scannedCount = 0;
    let lastMessageId = null;

    // =========================
    // SCAN CHANNEL
    // =========================

    while (deletedCount < limit) {

      const fetchOptions = {
        limit: 100
      };

      if (lastMessageId) {
        fetchOptions.before = lastMessageId;
      }

      const messages =
        await message.channel.messages.fetch(
          fetchOptions
        );

      if (messages.size === 0) {
        break;
      }

      scannedCount += messages.size;

      // =========================
      // FILTER TARGET
      // =========================

      const targetMessages = messages.filter(
        msg =>
          msg.author?.id === targetUser.id &&
          !msg.author?.bot
      );

      // =========================
      // DELETE
      // =========================

      for (const msg of targetMessages.values()) {

        if (deletedCount >= limit) {
          break;
        }

        // Kiểm tra lại ID trước khi xóa
        if (msg.author?.id !== targetUser.id) {
          continue;
        }

        try {

          await msg.delete();

          deletedCount++;

          // Delay nhỏ để giảm áp lực rate limit
          await sleep(150);

        } catch (error) {

          // Message đã bị xóa trước đó
          if (
            error.code === 10008 ||
            error.code === '10008'
          ) {
            continue;
          }

          // Không có quyền
          if (
            error.code === 50013 ||
            error.code === '50013'
          ) {
            logger.error(
              `Bot không có quyền xóa message ${msg.id}`
            );

            continue;
          }

          // Rate limit
          if (
            error.status === 429 ||
            error.code === 429
          ) {
            const retryAfter =
              error.rawError?.retry_after ??
              error.retryAfter ??
              1000;

            logger.warn(
              `Rate limit. Chờ ${retryAfter}ms...`
            );

            await sleep(
              Number(retryAfter) + 500
            );

            // Thử lại message này
            try {
              await msg.delete();
              deletedCount++;
            } catch (retryError) {
              logger.error(
                `Không thể xóa lại message ${msg.id}:`,
                retryError
              );
            }

            continue;
          }

          logger.error(
            `Không thể xóa message ${msg.id}:`,
            error
          );
        }
      }

      // Đã đủ giới hạn
      if (deletedCount >= limit) {
        break;
      }

      // Lấy ID message cũ nhất
      const oldestMessage = messages.last();

      if (!oldestMessage) {
        break;
      }

      lastMessageId = oldestMessage.id;

      // Nếu ít hơn 100 thì đã đến cuối lịch sử
      if (messages.size < 100) {
        break;
      }
    }

    // =========================
    // RESULT
    // =========================

    let result;

    if (limit !== Infinity && deletedCount >= limit) {
      result =
        `✅ Đã xóa **${deletedCount}** tin nhắn của ${targetUser}.\n` +
        `📌 Đã đạt giới hạn **${limit}** tin nhắn.`;
    } else {
      result =
        `✅ Đã xóa **${deletedCount}** tin nhắn của ${targetUser}.\n` +
        `🔎 Đã quét khoảng **${scannedCount}** tin nhắn trong channel.`;
    }

    await status.edit({
      content: result
    });

    return true;

  } catch (error) {

    logger.error(
      'ClearUser Command Error:',
      error
    );

    return true;
  }
}


/* =========================
   SLEEP
========================= */
function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}
