import { Events, PermissionsBitField } from 'discord.js';
import { logger } from '../utils/logger.js';

const DELETE_DELAY = 5;
const MAX_FETCH = 300;
const MAX_RETRIES = 5;

export default {
  name: Events.MessageCreate,

  async execute(message, client) {
    try {
      // Bỏ qua DM và bot
      if (!message.guild || message.author.bot) {
        return;
      }

      // Prefix của server
      const guildConfig =
        await getGuildConfigSafe(client, message.guild.id);

      const prefix =
        guildConfig?.prefix ||
        client.config?.bot?.prefix ||
        '!';

      // Không phải prefix command
      if (!message.content.startsWith(prefix)) {
        return;
      }

      const parts = message.content
        .slice(prefix.length)
        .trim()
        .split(/\s+/);

      const commandName = parts.shift()?.toLowerCase();

      if (commandName !== 'clearuser') {
        return;
      }

      // =========================
      // USER PERMISSION
      // =========================

      const member = message.member;

      const isAdmin = member?.permissions.has(
        PermissionsBitField.Flags.Administrator
      );

      const isModerator = member?.permissions.has(
        PermissionsBitField.Flags.ManageMessages
      );

      if (!isAdmin && !isModerator) {
        await message.reply(
          '❌ Bạn cần quyền **Administrator** hoặc **Manage Messages** để sử dụng lệnh này.'
        ).catch(() => {});

        return;
      }

      // =========================
      // BOT PERMISSION
      // =========================

      const botMember = message.guild.members.me;

      if (!botMember) {
        await message.reply(
          '❌ Không thể xác định bot trong server.'
        ).catch(() => {});

        return;
      }

      const requiredPermissions = [
        [
          PermissionsBitField.Flags.ViewChannel,
          'View Channel'
        ],
        [
          PermissionsBitField.Flags.ReadMessageHistory,
          'Read Message History'
        ],
        [
          PermissionsBitField.Flags.ManageMessages,
          'Manage Messages'
        ]
      ];

      for (const [permission, name] of requiredPermissions) {
        if (!botMember.permissions.has(permission)) {
          await message.reply(
            `❌ Bot thiếu quyền **${name}**.`
          ).catch(() => {});

          return;
        }
      }

      // =========================
      // TARGET
      // =========================

      const targetUser =
        message.mentions.users.first();

      if (!targetUser) {
        await message.reply(
          `❌ Cú pháp:\n` +
          `\`${prefix}clearuser @user\`\n` +
          `\`${prefix}clearuser @user 100\``
        ).catch(() => {});

        return;
      }

      /*
       * CỐ Ý KHÔNG CÓ:
       *
       * if (targetUser.bot) return;
       *
       * Vì bạn yêu cầu có thể xóa message của BOT.
       */

      // =========================
      // LIMIT
      // =========================

      let limit = Infinity;

      if (parts[0]) {
        const parsedLimit = Number(parts[0]);

        if (
          !Number.isSafeInteger(parsedLimit) ||
          parsedLimit <= 0
        ) {
          await message.reply(
            '❌ Số lượng phải là số nguyên lớn hơn 0.'
          ).catch(() => {});

          return;
        }

        limit = parsedLimit;
      }

      // =========================
      // STATUS
      // =========================

      const status = await message.reply(
        `🔎 Đang tìm tin nhắn của **${targetUser.tag}**...`
      ).catch(() => null);

      if (!status) {
        return;
      }

      // =========================
      // SCAN
      // =========================

      let deletedCount = 0;
      let scannedCount = 0;
      let lastMessageId = null;

      while (deletedCount < limit) {
        const options = {
          limit: MAX_FETCH
        };

        if (lastMessageId) {
          options.before = lastMessageId;
        }

        const messages =
          await message.channel.messages.fetch(options);

        if (messages.size === 0) {
          break;
        }

        scannedCount += messages.size;

        // Chỉ lấy message của target.
        // Target có thể là USER hoặc BOT.
        const targetMessages = messages.filter(
          msg => msg.author?.id === targetUser.id
        );

        for (const targetMessage of targetMessages.values()) {
          if (deletedCount >= limit) {
            break;
          }

          // Double-check ID
          if (
            targetMessage.author?.id !== targetUser.id
          ) {
            continue;
          }

          const deleted =
            await deleteMessage(targetMessage);

          if (deleted) {
            deletedCount++;
          }

          await sleep(DELETE_DELAY);
        }

        if (deletedCount >= limit) {
          break;
        }

        // Message cũ nhất trong batch
        const oldestMessage = messages.last();

        if (!oldestMessage) {
          break;
        }

        lastMessageId = oldestMessage.id;

        // Đã đến cuối lịch sử
        if (messages.size < MAX_FETCH) {
          break;
        }
      }

      // =========================
      // RESULT
      // =========================

      let result =
        `✅ Đã xóa **${deletedCount}** tin nhắn của **${targetUser.tag}**.\n` +
        `🔎 Đã quét **${scannedCount}** tin nhắn.`;

      if (limit !== Infinity) {
        result +=
          `\n📌 Giới hạn: **${limit}** tin nhắn.`;
      } else {
        result +=
          `\n📚 Đã quét toàn bộ lịch sử hiện có của channel.`;
      }

      await status.edit({
        content: result
      }).catch(() => {});

      logger.info(
        `[CLEARUSER] ${message.author.tag} -> ${targetUser.tag} | ` +
        `deleted=${deletedCount} | scanned=${scannedCount} | ` +
        `channel=${message.channel.id}`
      );

    } catch (error) {
      logger.error(
        '[CLEARUSER EVENT ERROR]',
        error
      );
    }
  }
};


// ========================================
// DELETE MESSAGE + RATE LIMIT RETRY
// ========================================

async function deleteMessage(message, attempt = 0) {
  try {
    await message.delete();

    return true;

  } catch (error) {

    // Message không còn tồn tại
    if (
      error?.code === 10008 ||
      error?.status === 404
    ) {
      return false;
    }

    // Không có quyền
    if (
      error?.code === 50013 ||
      error?.status === 403
    ) {
      logger.warn(
        `[CLEARUSER] Không có quyền xóa ${message.id}`
      );

      return false;
    }

    // Rate limit
    if (
      error?.status === 429 ||
      error?.code === 429
    ) {
      if (attempt >= MAX_RETRIES) {
        logger.error(
          `[CLEARUSER] Retry rate limit thất bại: ${message.id}`
        );

        return false;
      }

      const retryAfter = Number(
        error?.rawError?.retry_after ??
        error?.retryAfter ??
        1000
      );

      logger.warn(
        `[CLEARUSER] Rate limit, chờ ${retryAfter}ms`
      );

      await sleep(retryAfter + 500);

      return deleteMessage(
        message,
        attempt + 1
      );
    }

    logger.error(
      `[CLEARUSER] Delete error ${message.id}:`,
      error
    );

    return false;
  }
}


// ========================================
// GET GUILD CONFIG
// ========================================

async function getGuildConfigSafe(client, guildId) {
  try {
    /*
     * Import động để event này hoàn toàn độc lập.
     * Nếu service không tồn tại, tự fallback về "!".
     */
    const module =
      await import('../services/guildConfig.js');

    if (
      typeof module.getGuildConfig !== 'function'
    ) {
      return null;
    }

    return await module.getGuildConfig(
      client,
      guildId
    );

  } catch (error) {
    logger.warn(
      '[CLEARUSER] Không thể đọc guild prefix, dùng !'
    );

    return null;
  }
}


// ========================================
// SLEEP
// ========================================

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}
