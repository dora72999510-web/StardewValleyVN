import { Events, PermissionsBitField } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig } from '../services/guildConfig.js';

const FETCH_LIMIT = 100;
const DELETE_DELAY = 150;
const MAX_RETRIES = 5;

export default {
  name: Events.MessageCreate,

  async execute(message, client) {
    try {
      // ==========================================
      // BASIC CHECK
      // ==========================================

      if (!message.guild) return;
      if (message.author.bot) return;

      // ==========================================
      // PREFIX
      // ==========================================

      let guildConfig = null;

      try {
        guildConfig = await getGuildConfig(
          client,
          message.guild.id
        );
      } catch {
        // Fallback về !
      }

      const prefix =
        guildConfig?.prefix ||
        client.config?.bot?.prefix ||
        '!';

      const content = message.content.trim();

      if (!content.startsWith(prefix)) {
        return;
      }

      // ==========================================
      // PARSE COMMAND
      // ==========================================

      const commandText = content
        .slice(prefix.length)
        .trim();

      const commandMatch =
        commandText.match(/^clearuser(?:\s|$)/i);

      if (!commandMatch) {
        return;
      }

      // ==========================================
      // PERMISSION
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
      // TARGET USER
      // ==========================================

      const targetUser =
        message.mentions.users.first();

      if (!targetUser) {
        await message.reply(
          [
            '❌ Bạn chưa mention người dùng.',
            '',
            `Cú pháp: \`${prefix}clearuser @user "nội dung"\``,
            `Ví dụ: \`${prefix}clearuser @Yubabe "cá"\``
          ].join('\n')
        ).catch(() => {});

        return;
      }

      // ==========================================
      // GET TEXT TO DELETE
      // ==========================================

      /*
       * Lấy phần sau mention.
       *
       * Ví dụ:
       *
       * !clearuser @Yubabe "cá"
       *
       * targetUser = Yubabe
       * searchText = cá
       */

      const mentionRegex =
        new RegExp(
          `^clearuser\\s+<@!?${targetUser.id}>\\s+(.+)$`,
          'i'
        );

      const match =
        commandText.match(mentionRegex);

      if (!match) {
        await message.reply(
          [
            '❌ Bạn chưa nhập nội dung cần xóa.',
            '',
            `Ví dụ: \`${prefix}clearuser @Yubabe "cá"\``
          ].join('\n')
        ).catch(() => {});

        return;
      }

      let searchText =
        match[1].trim();

      // ==========================================
      // REMOVE QUOTES
      // ==========================================

      /*
       * Cho phép:
       *
       * "cá"
       * 'cá'
       * cá
       */

      if (
        (
          searchText.startsWith('"') &&
          searchText.endsWith('"')
        ) ||
        (
          searchText.startsWith("'") &&
          searchText.endsWith("'")
        )
      ) {
        searchText =
          searchText.slice(
            1,
            -1
          );
      }

      searchText = searchText.trim();

      if (!searchText) {
        await message.reply(
          '❌ Nội dung cần xóa không được để trống.'
        ).catch(() => {});

        return;
      }

      // ==========================================
      // STATUS
      // ==========================================

      const status =
        await message.reply(
          `🔎 Đang tìm message chính xác **"${searchText}"** của **${targetUser.tag}**...`
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
      let reachedEnd = false;

      while (true) {
        const fetchOptions = {
          limit: FETCH_LIMIT
        };

        if (before) {
          fetchOptions.before = before;
        }

        const messages =
          await message.channel.messages.fetch(
            fetchOptions
          );

        if (messages.size === 0) {
          reachedEnd = true;
          break;
        }

        scannedCount += messages.size;

        // ========================================
        // EXACT MATCH
        // ========================================

        const matchingMessages =
          messages.filter((msg) => {

            // Phải đúng user
            if (
              msg.author?.id !==
              targetUser.id
            ) {
              return false;
            }

            // Phải là message text
            if (
              typeof msg.content !== 'string'
            ) {
              return false;
            }

            /*
             * EXACT MATCH
             *
             * toLocaleLowerCase() giúp:
             *
             * "cá"
             * "Cá"
             * "CÁ"
             *
             * được coi là giống nhau.
             *
             * Không dùng includes(),
             * nên "con cá" sẽ KHÔNG match.
             */

            return (
              msg.content
                .trim()
                .toLocaleLowerCase() ===
              searchText
                .trim()
                .toLocaleLowerCase()
            );
          });

        // ========================================
        // DELETE MATCHING MESSAGES
        // ========================================

        for (
          const targetMessage
          of matchingMessages.values()
        ) {
          const deleted =
            await deleteMessageWithRetry(
              targetMessage
            );

          if (deleted) {
            deletedCount++;
          }

          await sleep(
            DELETE_DELAY
          );
        }

        // ========================================
        // PAGINATION
        // ========================================

        const oldestMessage =
          messages.last();

        if (!oldestMessage) {
          reachedEnd = true;
          break;
        }

        before =
          oldestMessage.id;

        if (
          messages.size < FETCH_LIMIT
        ) {
          reachedEnd = true;
          break;
        }
      }

      // ==========================================
      // RESULT
      // ==========================================

      let result;

      if (deletedCount === 0) {
        result =
          `⚠️ Không tìm thấy message chính xác **"${searchText}"** ` +
          `của **${targetUser.tag}** trong channel này.\n` +
          `🔎 Đã quét **${scannedCount}** message.`;
      } else {
        result =
          `✅ Đã xóa **${deletedCount}** message của **${targetUser.tag}**.\n` +
          `🎯 Nội dung chính xác: **${searchText}**\n` +
          `🔎 Đã quét **${scannedCount}** message.`;
      }

      if (reachedEnd) {
        result +=
          '\n📚 Đã quét hết lịch sử channel.';
      }

      await status.edit({
        content: result
      }).catch(() => {});

      // ==========================================
      // LOG
      // ==========================================

      logger.info(
        [
          '[CLEARUSER]',
          `moderator=${message.author.tag}`,
          `target=${targetUser.tag}`,
          `targetId=${targetUser.id}`,
          `search="${searchText}"`,
          `deleted=${deletedCount}`,
          `scanned=${scannedCount}`,
          `channel=${message.channel.id}`
        ].join(' | ')
      );

    } catch (error) {
      logger.error(
        '[CLEARUSER] Unexpected error:',
        error
      );
    }
  }
};


// ======================================================
// DELETE MESSAGE WITH RETRY
// ======================================================

async function deleteMessageWithRetry(
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
        `[CLEARUSER] Không có quyền xóa ${message.id}.`
      );

      return false;
    }

    // Rate limit
    if (
      error?.status === 429 ||
      error?.code === 429
    ) {
      if (
        attempt >= MAX_RETRIES
      ) {
        logger.error(
          `[CLEARUSER] Rate limit retry thất bại: ${message.id}`
        );

        return false;
      }

      const retryAfter =
        Number(
          error?.rawError?.retry_after ??
          error?.retryAfter ??
          1000
        );

      logger.warn(
        `[CLEARUSER] Rate limit. Chờ ${retryAfter}ms.`
      );

      await sleep(
        retryAfter + 500
      );

      return deleteMessageWithRetry(
        message,
        attempt + 1
      );
    }

    logger.error(
      `[CLEARUSER] Không thể xóa ${message.id}:`,
      error
    );

    return false;
  }
}


// ======================================================
// SLEEP
// ======================================================

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}
