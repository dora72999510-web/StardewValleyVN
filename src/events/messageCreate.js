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

      logger.debug(
        `[MSG] ${message.author.tag}: ${message.content}`
      );

      /* 1. Protected Channels (HIGHEST PRIORITY) */
      if (await handleProtectedChannels(message)) return;

      /* 2. Counting Game */
      if (await handleCountingGame(message, client)) return;

      /* 3. Prefix Commands */
      await handlePrefixCommand(message, client);

      /* 4. Leveling System */
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
          title: '🚫 Bạn đã bị timeout',
          description:
            `Bạn đã gửi tin trong kênh cảnh báo.\n` +
            `Hình phạt: **1 ngày timeout**.`,
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
        `🚫 ${member} bị timeout vì đã gửi tin nhắn vào <#1521007503263928341>`
      );
    }

    // Warning message
    const warn = await message.channel.send(
      `🚫 ${member} đã bị timeout 1 ngày.`
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
