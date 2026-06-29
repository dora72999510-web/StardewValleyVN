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

const PROTECTED_CHANNELS = ['1521007503263928341'];

const EXEMPT_ROLE_IDS = ['1510657849112399928', '1514302887419842590'];

const PROTECTED_TIMEOUT = 24 * 60 * 60 * 1000;

export default {
  name: Events.MessageCreate,

  async execute(message, client) {
    try {
      if (message.author.bot || !message.guild) return;

      logger.debug(
        `Message received from ${message.author.tag}: ${message.content}`
      );

      if (await handleProtectedChannels(message)) return;
      if (await handleCountingGame(message, client)) return;

      await handlePrefixCommand(message, client);
      await handleLeveling(message, client);

    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  },
};

/* =========================
   PREFIX COMMAND
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

    const resolvedCommandName = resolveCommandAlias(commandName);
    const command = client.commands.get(resolvedCommandName);

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
              title: 'Slash Command Only',
              description: `${restriction.reason}\nUse \`/${resolvedCommandName}\` instead.`,
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
            title: 'Command Disabled',
            description: 'This command has been disabled for this server.',
            color: 'error',
          }),
        ],
      }).catch(() => {});
      return;
    }

    const abuse = await enforceAbuseProtection(
      { guildId: message.guild.id, user: message.author },
      command,
      resolvedCommandName
    );

    if (!abuse.allowed) {
      await message.channel.send({
        embeds: [
          createEmbed({
            title: 'Command Cooldown',
            description: `Please wait **${formatCooldownDuration(abuse.remainingMs)}**`,
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
    logger.error('Prefix command error:', err);
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

    const valid = isValidCountingMessage(message.content.trim(), config);

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
    logger.error('Counting game error:', err);
    return false;
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
      MESSAGE_XP_RATE_LIMIT_ATTEMPTS,
      MESSAGE_XP_RATE_LIMIT_WINDOW_MS
    );

    if (!allowed) return;

    const config = await getLevelingConfig(client, message.guild.id);
    if (!config?.enabled) return;

    if (config.ignoredChannels?.includes(message.channel.id)) return;
    if (config.blacklistedUsers?.includes(message.author.id)) return;

    const member = message.member;
    if (member?.roles.cache.some(r => config.ignoredRoles?.includes(r.id))) return;

    const last = (await getUserLevelData(client, message.guild.id, message.author.id))
      ?.lastMessage || 0;

    if (Date.now() - last < (config.xpCooldown || 60) * 1000) return;

    const min = config.xpRange?.min ?? 15;
    const max = config.xpRange?.max ?? 25;

    let xp = Math.floor(Math.random() * (max - min + 1)) + min;

    if (config.xpMultiplier > 1) {
      xp = Math.floor(xp * config.xpMultiplier);
    }

    const result = await addXp(client, message.guild, message.member, xp);

    if (result?.leveledUp) {
      logger.info(`${message.author.tag} leveled up to ${result.level}`);
    }

  } catch (err) {
    logger.error('Leveling error:', err);
  }
}

/* =========================
   PROTECTED CHANNELS
========================= */
async function handleProtectedChannels(message) {
  try {
    if (!PROTECTED_CHANNELS.includes(message.channel.id)) {
      return true;
    }

    const member = message.member;
    if (!member) return true;

    if (
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
      member.roles.cache.some(r => EXEMPT_ROLE_IDS.includes(r.id))
    ) {
      return true;
    }

    await message.delete().catch(() => {});

    if (
      member.communicationDisabledUntilTimestamp &&
      member.communicationDisabledUntilTimestamp > Date.now()
    ) {
      return true;
    }

    await member.timeout(
      PROTECTED_TIMEOUT,
      'Message in protected channel'
    );

    const embed = createEmbed({
      title: '🚫 Bạn đã bị timeout',
      description:
        `Bạn đã gửi tin trong kênh cảnh báo.\n` +
        `Hình phạt: 1 ngày timeout.`,
      color: '#ec1515',
    });

    await member.send({ embeds: [embed] }).catch(() => {});

    const logChannel = await message.guild.channels
      .fetch('1510183155762597990')
      .catch(() => null);

    if (logChannel?.isTextBased()) {
      logChannel.send(
        `🚫 ${member.user.tag} bị timeout trong ${message.channel.name}`
      ).catch(() => {});
    }

    const warn = await message.channel.send(
      `🚫 ${member} đã bị xử lý.`
    );

    setTimeout(() => warn.delete().catch(() => {}), 5000);

    return true;

  } catch (err) {
    logger.error('Protected channel error:', err);
    return true;
  }
}
