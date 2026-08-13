import { Events, PermissionsBitField } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig } from '../services/guildConfig.js';

const FETCH_SIZE = 100;
const DELETE_DELAY = 150;
const MAX_RETRIES = 5;

export default {
  name: Events.MessageCreate,

  async execute(message, client) {
    try {
      // Không xử lý DM
      if (!message.guild) return;

      // Không cho bot khác kích hoạt command
      if (message.author.bot) return;

      const guildConfig = await getGuildConfig(
        client,
        message.guild.id
      ).catch(() => null);

      const prefix =
        guildConfig?.prefix ||
        client.config?.bot?.prefix ||
        '!';

      const content = message.content.trim();

      // Không đúng prefix
      if (!content.startsWith(prefix)) {
        return;
      }

      // ==========================================
      // PARSE COMMAND
      // ==========================================

      const withoutPrefix = content
        .slice(prefix.length)
        .trim();

      const commandMatch = withoutPrefix.match(
        /^clearuser(?:\s|$)/i
      );

      if (!commandMatch) {
        return;
      }

      // ==========================================
      // TARGET USER
      // ==========================================

      const targetUser =
        message.mentions.users.first();

      if (!targetUser) {
        await message.reply(
          `❌ Cú pháp đúng:\n` +
          `\`${prefix}clearuser @user\`\n` +
          `\`${prefix}clearuser @user 100\``
        ).catch(() => {});

        return;
      }

      // ==========================================
      // PERMISSION USER
      // ==========================================

      const member = message.member;

      const isAdmin =
        member?.permissions.has(
          PermissionsBitField.Flags.Administrator
        );

      const isModerator =
        member?.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        );

      if (!isAdmin && !isModerator) {
        await message.reply(
          '❌ Bạn cần quyền **Administrator** hoặc **Manage Messages**.'
        ).catch(() => {});

        return;
      }

      // ==========================================
      // BOT PERMISSION
      // ==========================================

      const botMember =
        message.guild.members.me;

      if (!botMember) {
        await message.reply(
          '❌ Không thể xác định bot trong server.'
        ).catch(() => {});

        return;
      }

      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ViewChannel
        )
      ) {
        await message.reply(
          '❌ Bot thiếu quyền **View Channel**.'
        ).catch(() => {});

        return;
      }

      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ReadMessageHistory
        )
      ) {
        await message.reply(
          '❌ Bot thiếu quyền **Read Message History**.'
        ).catch(() => {});

        return;
      }

      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ManageMessages
        )
      ) {
        await message.reply(
          '❌ Bot thiếu quyền **Manage Messages**.'
        ).catch(() => {});

        return;
      }

      // ==========================================
      // PARSE LIMIT
      // ==========================================

      /*
       * Ví dụ:
       *
       * !clearuser @User
       * !clearuser @User 100
       *
       * Ta lấy toàn bộ nội dung sau "clearuser",
       * sau đó loại mention bằng regex.
       */

      let remaining = withoutPrefix
        .replace(/^clearuser/i, '')
        .trim();

      // Xóa mention khỏi chuỗi.
      //
      // Discord mention có dạng:
      // <@123456789>
      // hoặc
      // <@!123456789>
      //
      remaining = remaining
        .replace(
          /^<@!?\d+>/,
          ''
        )
        .trim();

      let limit = Infinity;

      if (remaining.length > 0) {
        const limitMatch =
          remaining.match(/^(\d+)$/);

        if (!limitMatch) {
          await message.reply(
            `❌ Cú pháp đúng:\n` +
            `\`${prefix}clearuser @user\`\n` +
            `\`${prefix}clearuser @user 100\``
          ).catch(() => {});

          return;
        }

        limit = Number(limitMatch[1]);

        if (
          !Number.isSafeInteger(limit) ||
          limit <= 0
        ) {
          await message.reply(
            '❌ Số lượng phải là số nguyên lớn hơn 0.'
          ).catch(() => {});

          return;
        }
      }

      // ==========================================
      // STATUS
      // ==========================================

      const status =
        await message.reply(
          `🔎 Đang quét tin nhắn của **${targetUser.tag}**...`
        ).catch(() => null);

      if (!status) {
        return;
      }

      // ==========================================
      // SCAN HISTORY
      // ==========================================

      let deletedCount = 0;
      let scannedCount = 0;
      let before = undefined;

      while (deletedCount < limit) {
        const options = {
          limit: FETCH_SIZE
        };

        if (before) {
          options.before = before;
        }

        const messages =
          await message.channel.messages.fetch(
            options
          );

        if (messages.size === 0) {
          break;
        }

        scannedCount += messages.size;

        // ========================================
        // TARGET MESSAGES
        // ========================================

        const targetMessages =
          messages.filter(
            msg =>
              msg.author &&
              msg.author.id === targetUser.id
          );

        // ========================================
        // DELETE
        // ========================================

        for (
          const targetMessage
          of targetMessages.values()
        ) {
          if (deletedCount >= limit) {
            break;
          }

          // Double-check
          if (
            targetMessage.author?.id !==
            targetUser.id
          ) {
            continue;
          }

          const deleted =
            await deleteMessage(
              targetMessage
            );

          if (deleted) {
            deletedCount++;
          }

          await sleep(DELETE_DELAY);
        }

        // Đã đủ số lượng
        if (deletedCount >= limit) {
          break;
        }

        // Lấy message cũ nhất
        const oldest =
          messages.last();

        if (!oldest) {
          break;
        }

        before = oldest.id;

        // Ít hơn 100 nghĩa là hết lịch sử
        if (messages.size < FETCH_SIZE) {
          break;
        }
      }

      // ==========================================
      // RESULT
      // ==========================================

      let result =
        `✅ Đã xóa **${deletedCount}** tin nhắn của **${targetUser.tag}**.\n` +
        `🔎 Đã quét **${scannedCount}** tin nhắn.`;

      if (limit !== Infinity) {
        result +=
          `\n📌 Giới hạn: **${limit}**`;
      } else {
        result +=
          `\n📚 Đã quét toàn bộ lịch sử channel.`;
      }

      await status.edit({
        content: result
      }).catch(() => {});

      logger.info(
        `[CLEARUSER] ${message.author.tag} ` +
        `-> ${targetUser.tag} ` +
        `deleted=${deletedCount} ` +
        `scanned=${scannedCount} ` +
        `channel=${message.channel.id}`
      );

    } catch (error) {
      logger.error(
        '[CLEARUSER] Error:',
        error
      );
    }
  }
};


// =================================================
// DELETE MESSAGE
// =================================================

async function deleteMessage(
  message,
  attempt = 0
) {
  try {
    await message.delete();

    return true;

  } catch (error) {

    // Message đã bị xóa
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
      logger.error(
        `[CLEARUSER] Bot không có quyền xóa message ${message.id}`
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
          `[CLEARUSER] Rate limit retry failed: ${message.id}`
        );

        return false;
      }

      const retryAfter = Number(
        error?.rawError?.retry_after ??
        error?.retryAfter ??
        1000
      );

      logger.warn(
        `[CLEARUSER] Rate limit. Retry after ${retryAfter}ms`
      );

      await sleep(
        retryAfter + 500
      );

      return deleteMessage(
        message,
        attempt + 1
      );
    }

    logger.error(
      `[CLEARUSER] Failed deleting ${message.id}:`,
      error
    );

    return false;
  }
}


// =================================================
// SLEEP
// =================================================

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}
