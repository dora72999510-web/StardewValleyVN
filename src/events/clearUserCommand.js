import { Events, PermissionsBitField } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig } from '../services/guildConfig.js';

const FETCH_LIMIT = 100;
const DELETE_DELAY = 200;
const MAX_RETRIES = 5;

// ======================================================
// CẤU HÌNH
// ======================================================

// Tên title của Embed cần xóa.
// Nếu bot thay đổi title, sửa dòng này.
const TARGET_EMBED_TITLE = 'Ảnh gái xinh';

export default {
  name: Events.MessageCreate,

  async execute(message, client) {
    try {
      // ==================================================
      // BASIC CHECK
      // ==================================================

      // Không xử lý DM
      if (!message.guild) {
        return;
      }

      // Không cho bot khác kích hoạt command
      if (message.author.bot) {
        return;
      }

      // ==================================================
      // PREFIX
      // ==================================================

      let guildConfig = null;

      try {
        guildConfig = await getGuildConfig(
          client,
          message.guild.id
        );
      } catch (error) {
        logger.warn(
          '[CLEARUSER] Không lấy được guild config, dùng prefix !'
        );
      }

      const prefix =
        guildConfig?.prefix ||
        client.config?.bot?.prefix ||
        '!';

      const content = message.content.trim();

      if (!content.startsWith(prefix)) {
        return;
      }

      // ==================================================
      // COMMAND CHECK
      // ==================================================

      const commandContent = content
        .slice(prefix.length)
        .trim();

      const commandMatch =
        commandContent.match(/^clearuser(?:\s|$)/i);

      if (!commandMatch) {
        return;
      }

      // ==================================================
      // TARGET
      // ==================================================

      const targetBot =
        message.mentions.users.first();

      if (!targetBot) {
        await message.reply(
          [
            '❌ Bạn chưa mention bot cần dọn.',
            '',
            `Cú pháp: \`${prefix}clearuser @bot\``,
            `Hoặc: \`${prefix}clearuser @bot 100\``
          ].join('\n')
        ).catch(() => {});

        return;
      }

      // Chỉ cho phép target là BOT
      if (!targetBot.bot) {
        await message.reply(
          '❌ Lệnh này chỉ dùng để dọn phản hồi của **bot**.'
        ).catch(() => {});

        return;
      }

      // ==================================================
      // PERMISSION NGƯỜI DÙNG
      // ==================================================

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
          '❌ Bạn cần quyền **Administrator** hoặc **Manage Messages** để sử dụng lệnh này.'
        ).catch(() => {});

        return;
      }

      // ==================================================
      // BOT PERMISSION
      // ==================================================

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

      // ==================================================
      // PARSE LIMIT
      // ==================================================

      /*
       * Ví dụ:
       *
       * !clearuser @Yubabe
       * !clearuser @Yubabe 100
       */

      let remaining =
        commandContent
          .replace(/^clearuser/i, '')
          .trim();

      // Xóa mention đầu tiên khỏi chuỗi.
      remaining = remaining
        .replace(/^<@!?\d+>/, '')
        .trim();

      let limit = Infinity;

      if (remaining.length > 0) {
        // Chỉ cho phép một số nguyên.
        const match =
          remaining.match(/^(\d+)$/);

        if (!match) {
          await message.reply(
            [
              '❌ Cú pháp không đúng.',
              '',
              `\`${prefix}clearuser @bot\``,
              `\`${prefix}clearuser @bot 100\``
            ].join('\n')
          ).catch(() => {});

          return;
        }

        limit = Number(match[1]);

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

      // ==================================================
      // STATUS
      // ==================================================

      const status =
        await message.reply(
          [
            `🔎 Đang tìm phản hồi **"${TARGET_EMBED_TITLE}"**`,
            `của **${targetBot.tag}**...`
          ].join('\n')
        ).catch(() => null);

      if (!status) {
        return;
      }

      // ==================================================
      // SCAN
      // ==================================================

      let deletedCount = 0;
      let scannedCount = 0;
      let before = undefined;
      let reachedEnd = false;

      while (deletedCount < limit) {
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

        // Không còn message
        if (messages.size === 0) {
          reachedEnd = true;
          break;
        }

        scannedCount += messages.size;

        // ==================================================
        // LỌC MESSAGE
        // ==================================================

        const targetMessages =
          messages.filter((msg) => {

            // 1. Phải do đúng bot được mention gửi
            if (
              msg.author?.id !== targetBot.id
            ) {
              return false;
            }

            // 2. Phải là bot
            if (!msg.author?.bot) {
              return false;
            }

            // 3. Phải có Embed
            if (!msg.embeds?.length) {
              return false;
            }

            // 4. Phải có Embed title "Ảnh gái xinh"
            const hasTargetEmbed =
              msg.embeds.some(
                (embed) =>
                  embed.title ===
                  TARGET_EMBED_TITLE
              );

            if (!hasTargetEmbed) {
              return false;
            }

            return true;
          });

        // ==================================================
        // DELETE
        // ==================================================

        for (
          const targetMessage
          of targetMessages.values()
        ) {
          if (deletedCount >= limit) {
            break;
          }

          // Kiểm tra lần cuối
          if (
            targetMessage.author?.id !==
            targetBot.id
          ) {
            continue;
          }

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

        if (deletedCount >= limit) {
          break;
        }

        // ==================================================
        // PAGINATION
        // ==================================================

        const oldestMessage =
          messages.last();

        if (!oldestMessage) {
          reachedEnd = true;
          break;
        }

        before = oldestMessage.id;

        // Đã đến cuối lịch sử
        if (
          messages.size < FETCH_LIMIT
        ) {
          reachedEnd = true;
          break;
        }
      }

      // ==================================================
      // RESULT
      // ==================================================

      let result =
        `✅ Đã xóa **${deletedCount}** phản hồi của **${targetBot.tag}**.\n` +
        `🎯 Chỉ xóa Embed: **${TARGET_EMBED_TITLE}**\n` +
        `🔎 Đã quét **${scannedCount}** message.`;

      if (limit !== Infinity) {
        result +=
          `\n📌 Giới hạn: **${limit}**`;
      }

      if (reachedEnd) {
        result +=
          '\n📚 Đã quét hết lịch sử channel.';
      }

      await status.edit({
        content: result
      }).catch(() => {});

      // ==================================================
      // LOG
      // ==================================================

      logger.info(
        [
          '[CLEARUSER]',
          `moderator=${message.author.tag}`,
          `target=${targetBot.tag}`,
          `targetId=${targetBot.id}`,
          `deleted=${deletedCount}`,
          `scanned=${scannedCount}`,
          `channel=${message.channel.id}`,
          `title="${TARGET_EMBED_TITLE}"`
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
// DELETE MESSAGE
// ======================================================

async function deleteMessageWithRetry(
  message,
  attempt = 0
) {
  try {
    await message.delete();

    return true;

  } catch (error) {

    // ----------------------------------------------
    // Message đã bị xóa
    // ----------------------------------------------

    if (
      error?.code === 10008 ||
      error?.status === 404
    ) {
      return false;
    }

    // ----------------------------------------------
    // Không có quyền
    // ----------------------------------------------

    if (
      error?.code === 50013 ||
      error?.status === 403
    ) {
      logger.error(
        `[CLEARUSER] Bot không có quyền xóa message ${message.id}.`
      );

      return false;
    }

    // ----------------------------------------------
    // Rate limit
    // ----------------------------------------------

    if (
      error?.status === 429 ||
      error?.code === 429
    ) {
      if (
        attempt >= MAX_RETRIES
      ) {
        logger.error(
          `[CLEARUSER] Quá số lần retry rate limit: ${message.id}`
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
        `[CLEARUSER] Rate limit. Chờ ${retryAfter}ms...`
      );

      await sleep(
        retryAfter + 500
      );

      return deleteMessageWithRetry(
        message,
        attempt + 1
      );
    }

    // ----------------------------------------------
    // Error khác
    // ----------------------------------------------

    logger.error(
      `[CLEARUSER] Không thể xóa message ${message.id}:`,
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
