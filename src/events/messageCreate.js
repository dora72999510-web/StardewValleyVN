import { Events, PermissionsBitField } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { parsePrefixCommand } from '../utils/prefixParser.js';
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

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

/**
 * ==============================
 * Protected Channels
 * ==============================
 */

const PROTECTED_CHANNELS = [
  '1521007503263928341',
];

const EXEMPT_ROLE_IDS = [
  '1510657849112399928',
  '1514302887419842590',
];

const PROTECTED_TIMEOUT = 24 * 60 * 60 * 1000; // 1 ngày

export default {
  name: Events.MessageCreate,

  async execute(message, client) {
    try {
      if (message.author.bot || !message.guild) return;

      logger.debug(
        `Message received from ${message.author.tag}: ${message.content}`
      );

      /**
       * Protected Channels
       */
      const protectedHandled = await handleProtectedChannels(message);

      if (protectedHandled) {
        return;
      }

      /**
       * Counting Game
       */
      const countingProcessed = await handleCountingGame(message, client);

      if (countingProcessed) {
        return;
      }

      /**
       * Prefix Commands
       */
      await handlePrefixCommand(message, client);

      /**
       * Leveling
       */
      await handleLeveling(message, client);
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  },
};
async function handlePrefixCommand(message, client) {
  try {
    const guildConfig = await getGuildConfig(client, message.guild.id);

    const prefix =
      guildConfig?.prefix ||
      client.config.bot.prefix ||
      '!';

    const parsed = parsePrefixCommand(message.content, prefix);

    if (!parsed) {
      return;
    }

    const { commandName, args } = parsed;

    logger.info(
      `Prefix command detected: ${commandName}, args: ${args.join(', ')}`
    );

    const resolvedCommandName = resolveCommandAlias(commandName);

    const command = client.commands.get(resolvedCommandName);

    if (!command) {
      logger.warn(`Command not found: ${resolvedCommandName}`);
      return;
    }

    const restriction = getPrefixRestriction(
      command,
      args,
      resolveSubcommandAlias,
    );

    if (
      !supportsPrefixExecution(command) ||
      restriction.blocked
    ) {
      if (restriction.blocked && restriction.reason) {
        const embed = createEmbed({
          title: 'Slash Command Only',
          description:
            `${restriction.reason}\nUse \`/${resolvedCommandName}\` instead.`,
          color: 'info',
        });

        await message.channel
          .send({
            embeds: [embed],
          })
          .catch(() => {});
      }

      return;
    }

    const enabled = await isCommandEnabled(
      client,
      message.guild.id,
      resolvePrefixAccessKey(command.data, args),
      command.category,
    );

    if (!enabled) {
      const embed = createEmbed({
        title: 'Command Disabled',
        description:
          'This command has been disabled for this server.',
        color: 'error',
      });

      await message.channel
        .send({
          embeds: [embed],
        })
        .catch(() => {});

      return;
    }

    const abuseProtection =
      await enforceAbuseProtection(
        {
          guildId: message.guild.id,
          user: message.author,
        },
        command,
        resolvedCommandName,
      );

    if (!abuseProtection.allowed) {
      const formattedCooldown =
        formatCooldownDuration(
          abuseProtection.remainingMs,
        );

      const embed = createEmbed({
        title: 'Command Cooldown',
        description:
          `This command is on cooldown.\nPlease wait **${formattedCooldown}** before trying again.`,
        color: 'error',
      });

      await message.channel
        .send({
          embeds: [embed],
        })
        .catch(() => {});

      return;
    }

    logger.info(
      `Executing prefix command ${prefix}${commandName} by ${message.author.tag}`
    );

    await executePrefixCommand(
      command,
      message,
      args,
      client,
      prefix,
      guildConfig,
    );
  } catch (error) {
    logger.error(
      'Error handling prefix command:',
      error,
    );
  }
}
async function handleCountingGame(message, client) {
  try {
    const config = await getCountingGameConfig(
      client,
      message.guild.id,
    );

    if (
      !config.enabled ||
      !config.channelId ||
      message.channel.id !== config.channelId
    ) {
      return false;
    }

    const content = message.content.trim();

    const validCount = isValidCountingMessage(
      content,
      config,
    );

    const invalidAttempt =
      !validCount ||
      message.author.id === config.lastUserId;

    if (invalidAttempt) {
      await message.delete().catch(() => {});

      await saveCountingGameConfig(
        client,
        message.guild.id,
        {
          ...config,
          nextNumber: 1,
          lastUserId: null,
          currentStreak: 0,
        },
      );

      const failureMessage =
        await message.channel.send(
          `❌ Count broken by <@${message.author.id}>.\nThe sequence has been reset to **1**.`,
        );

      setTimeout(() => {
        failureMessage.delete().catch(() => {});
      }, 10000);

      logger.info(
        `Counting game reset in ${message.guild.name} by ${message.author.tag}`,
      );

      return true;
    }

    await recordCorrectCount(
      client,
      message.guild.id,
      message.author.id,
    );

    return true;
  } catch (error) {
    logger.error(
      'Error handling counting game:',
      error,
    );

    return false;
  }
}
async function handleLeveling(message, client) {
  try {
    const rateLimitKey = `xp-event:${message.guild.id}:${message.author.id}`;

    const canProcess = await checkRateLimit(
      rateLimitKey,
      MESSAGE_XP_RATE_LIMIT_ATTEMPTS,
      MESSAGE_XP_RATE_LIMIT_WINDOW_MS,
    );

    if (!canProcess) {
      return;
    }

    const levelingConfig = await getLevelingConfig(
      client,
      message.guild.id,
    );

    if (!levelingConfig?.enabled) {
      return;
    }

    // Ignore channel
    if (
      levelingConfig.ignoredChannels?.includes(
        message.channel.id,
      )
    ) {
      return;
    }

    // Ignore role
    if (
      levelingConfig.ignoredRoles &&
      levelingConfig.ignoredRoles.length > 0
    ) {
      const member =
        await message.guild.members
          .fetch(message.author.id)
          .catch(() => null);

      if (
        member &&
        member.roles.cache.some(role =>
          levelingConfig.ignoredRoles.includes(
            role.id,
          ),
        )
      ) {
        return;
      }
    }

    // Ignore user
    if (
      levelingConfig.blacklistedUsers?.includes(
        message.author.id,
      )
    ) {
      return;
    }

    // Empty message
    if (
      !message.content ||
      message.content.trim().length === 0
    ) {
      return;
    }

    const userData = await getUserLevelData(
      client,
      message.guild.id,
      message.author.id,
    );

    const cooldown =
      levelingConfig.xpCooldown || 60;

    const now = Date.now();

    const lastMessage =
      userData.lastMessage || 0;

    if (
      now - lastMessage <
      cooldown * 1000
    ) {
      return;
    }

    const minXP =
      levelingConfig.xpRange?.min ??
      levelingConfig.xpPerMessage?.min ??
      15;

    const maxXP =
      levelingConfig.xpRange?.max ??
      levelingConfig.xpPerMessage?.max ??
      25;

    const xp =
      Math.floor(
        Math.random() *
          (Math.max(minXP, maxXP) -
            minXP +
            1),
      ) + minXP;

    let finalXP = xp;

    if (
      levelingConfig.xpMultiplier &&
      levelingConfig.xpMultiplier > 1
    ) {
      finalXP = Math.floor(
        xp * levelingConfig.xpMultiplier,
      );
    }

    const result = await addXp(
      client,
      message.guild,
      message.member,
      finalXP,
    );

    if (
      result.success &&
      result.leveledUp
    ) {
      logger.info(
        `${message.author.tag} reached level ${result.level} in ${message.guild.name}`,
      );
    }
  } catch (error) {
    logger.error(
      'Error handling leveling:',
      error,
    );
  }
}
async function handleProtectedChannels(message) {
  try {
    // Không nằm trong danh sách kênh bảo vệ
    if (
      !PROTECTED_CHANNELS.includes(
        message.channel.id,
      )
    ) {
      return false;
    }

    const member = message.member;

    if (!member) {
      return true;
    }

    /**
     * Administrator được bỏ qua
     */
    if (
      member.permissions.has(
        PermissionsBitField.Flags.Administrator,
      )
    ) {
      return true;
    }

    /**
     * Moderator được bỏ qua
     */
    if (
      member.permissions.has(
        PermissionsBitField.Flags.ManageMessages,
      )
    ) {
      return true;
    }

    /**
     * Role whitelist
     */
    if (
      EXEMPT_ROLE_IDS.length > 0 &&
      member.roles.cache.some(role =>
        EXEMPT_ROLE_IDS.includes(role.id),
      )
    ) {
      return true;
    }

    /**
     * Xóa tin nhắn vi phạm
     */
    await message.delete().catch(error => {
      logger.warn(
        `Unable to delete protected-channel message: ${error.message}`,
      );
    });

    /**
     * Đã timeout trước đó
     */
    if (
      member.communicationDisabledUntilTimestamp &&
      member.communicationDisabledUntilTimestamp >
        Date.now()
    ) {
      logger.warn(
        `${member.user.tag} attempted to send a message while already timed out.`,
      );

      return true;
    }

    /**
     * Timeout
     */
    await member.timeout(
      PROTECTED_TIMEOUT,
      `Sent a message in protected channel (${message.channel.name})`,
    );

    logger.warn(
      `${member.user.tag} has been timed out for sending a message in #${message.channel.name}`,
    );

    /**
     * Thông báo
     */
    const embed = createEmbed({
      title: '🚫 Protected Channel',
      description:
        `${member} đã bị **timeout 7 ngày** vì gửi tin nhắn trong kênh này.`,
      color: 'error',
    });

    const warningMessage =
      await message.channel
        .send({
          embeds: [embed],
        })
        .catch(() => null);

    if (warningMessage) {
      setTimeout(() => {
        warningMessage.delete().catch(() => {});
      }, 5000);
    }

    return true;
  } catch (error) {
    logger.error(
      'Error handling protected channel:',
      error,
    );

    return true;
  }
}
