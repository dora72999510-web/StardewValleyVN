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

/* ================= CONFIG ================= */
const XP_RATE_LIMIT_ATTEMPTS = 12;
const XP_RATE_LIMIT_WINDOW_MS = 10000;

const PROTECTED_CHANNELS = ['1521007503263928341'];
const EXEMPT_ROLE_IDS = ['1510657849112399928', '1514302887419842590'];
const PROTECTED_TIMEOUT = 24 * 60 * 60 * 1000;

/* ================= AUTO ROLE CONFIG ================= */
const TARGET_CHANNEL_ID = '1510183614535569448';
const TARGET_ROLE_ID = '1516035792256892959';
const KEYWORD = 'nhận role bear';

const grantedCache = new Set();

/* ================= EVENT ================= */
export default {
  name: Events.MessageCreate,

  async execute(message, client) {
    try {
      if (!message.guild || message.author.bot) return;

      logger.debug(`[MSG] ${message.author.tag}: ${message.content}`);

      /* 0. AUTO ROLE (THÊM Ở ĐẦU, KHÔNG ẢNH HƯỞNG TIMEOUT) */
      await handleAutoRole(message);

      /* 1. PROTECTED CHANNELS (GIỮ NGUYÊN 100%) */
      if (await handleProtectedChannels(message)) return;

      /* 2. COUNTING GAME */
      if (await handleCountingGame(message, client)) return;

      /* 3. PREFIX COMMAND */
      await handlePrefixCommand(message, client);

      /* 4. LEVELING */
      await handleLeveling(message, client);

    } catch (err) {
      logger.error('MessageCreate Error:', err);
    }
  },
};

/* ================= PROTECTED CHANNELS (KHÔNG ĐỤNG LOGIC) ================= */
async function handleProtectedChannels(message) {
  try {
    if (!PROTECTED_CHANNELS.includes(message.channel.id)) {
      return false;
    }

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return true;

    if (
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
      member.roles.cache.some(r => EXEMPT_ROLE_IDS.includes(r.id))
    ) {
      return true;
    }

    await message.delete().catch(() => {});

    if (!member.moderatable) {
      logger.warn(`Cannot timeout ${member.user.tag}`);
      return true;
    }

    await member.timeout(PROTECTED_TIMEOUT, 'Message in protected channel');

    logger.warn(`Timeout applied to ${member.user.tag}`);

    await member.send({
      embeds: [
        createEmbed({
          title: '🚫 Bạn đã bị timeout',
          description:
            `Bạn đã gửi tin trong kênh cảnh báo.\nHình phạt: **1 ngày timeout**.`,
          color: 'error',
        }),
      ],
    }).catch(() => {});

    const logChannel = await message.guild.channels.fetch('1510183155762597990').catch(() => null);

    if (logChannel?.isTextBased()) {
      await logChannel.send(
        `🚫 ${member} bị timeout vì gửi tin nhắn vào <#1521007503263928341>`
      );
    }

    const warn = await message.channel.send(`🚫 ${member} đã bị timeout 1 ngày.`);
    setTimeout(() => warn.delete().catch(() => {}), 5000);

    return true;

  } catch (err) {
    logger.error('Protected Channel Error:', err);
    return true;
  }
}

/* ================= AUTO ROLE (FIXED) ================= */
async function handleAutoRole(message) {
  try {
    if (!message.guild || message.author.bot) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const content = message.content.trim().toLowerCase();
    if (content !== KEYWORD.toLowerCase()) return;

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    if (grantedCache.has(member.id)) return;
    if (member.roles.cache.has(TARGET_ROLE_ID)) {
      grantedCache.add(member.id);
      return;
    }

    const botMember = await message.guild.members.fetchMe();

    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      logger.warn('Bot thiếu quyền Manage Roles');
      return;
    }

    const role = message.guild.roles.cache.get(TARGET_ROLE_ID);
    if (!role) return;

    if (role.position >= botMember.roles.highest.position) {
      logger.warn('Role bot thấp hơn role target');
      return;
    }

    await member.roles.add(role);
    grantedCache.add(member.id);

    await member.send({
      embeds: [
        createEmbed({
          title: '🎉 Bạn đã được cấp role!',
          description: `Bạn đã nhập đúng từ khóa và được cấp **${role.name}**`,
          color: 'success',
        }),
      ],
    }).catch(() => {});

    const msg = await message.channel.send(`✅ ${member} đã được cấp role`);
    setTimeout(() => msg.delete().catch(() => {}), 5000);

  } catch (err) {
    logger.error('AutoRole Error:', err);
  }
}

/* ================= COUNTING GAME ================= */
async function handleCountingGame(message, client) {
  try {
    const config = await getCountingGameConfig(client, message.guild.id);

    if (!config?.enabled || message.channel.id !== config.channelId) return false;

    const valid = isValidCountingMessage(message.content.trim(), config);

    const invalid = !valid || message.author.id === config.lastUserId;

    if (invalid) {
      await message.delete().catch(() => {});

      await saveCountingGameConfig(client, message.guild.id, {
        ...config,
        nextNumber: 1,
        lastUserId: null,
        currentStreak: 0,
      });

      const msg = await message.channel.send(`❌ Sai rồi <@${message.author.id}> reset về 1`);
      setTimeout(() => msg.delete().catch(() => {}), 10000);

      return true;
    }

    await recordCorrectCount(client, message.guild.id, message.author.id);
    return true;

  } catch (err) {
    logger.error('Counting Game Error:', err);
    return false;
  }
}

/* ================= PREFIX ================= */
async function handlePrefixCommand(message, client) {
  try {
    const guildConfig = await getGuildConfig(client, message.guild.id);

    const prefix = guildConfig?.prefix || client.config?.bot?.prefix || '!';

    const parsed = parsePrefixCommand(message.content, prefix);
    if (!parsed) return;

    const { commandName, args } = parsed;

    const resolved = resolveCommandAlias(commandName);
    const command = client.commands.get(resolved);
    if (!command) return;

    const restriction = getPrefixRestriction(command, args, resolveSubcommandAlias);

    if (!supportsPrefixExecution(command) || restriction.blocked) return;

    const enabled = await isCommandEnabled(
      client,
      message.guild.id,
      resolvePrefixAccessKey(command.data, args),
      command.category
    );

    if (!enabled) return;

    const abuse = await enforceAbuseProtection(
      { guildId: message.guild.id, user: message.author },
      command,
      resolved
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

    await executePrefixCommand(command, message, args, client, prefix, guildConfig);

  } catch (err) {
    logger.error('Prefix Error:', err);
  }
}

/* ================= LEVELING ================= */
async function handleLeveling(message, client) {
  try {
    const key = `xp:${message.guild.id}:${message.author.id}`;

    const allowed = await checkRateLimit(key, XP_RATE_LIMIT_ATTEMPTS, XP_RATE_LIMIT_WINDOW_MS);
    if (!allowed) return;

    const config = await getLevelingConfig(client, message.guild.id);
    if (!config?.enabled) return;

    const member = message.member;

    if (config.ignoredChannels?.includes(message.channel.id)) return;
    if (config.blacklistedUsers?.includes(message.author.id)) return;
    if (member?.roles.cache.some(r => config.ignoredRoles?.includes(r.id))) return;

    const userData = await getUserLevelData(client, message.guild.id, message.author.id);
    const last = userData?.lastMessage || 0;

    if (Date.now() - last < (config.xpCooldown || 60) * 1000) return;

    const min = config.xpRange?.min ?? 15;
    const max = config.xpRange?.max ?? 25;

    const xp = Math.floor(Math.random() * (max - min + 1)) + min;

    const result = await addXp(client, message.guild, message.member, xp);

    if (result?.leveledUp) {
      logger.info(`${message.author.tag} leveled up to ${result.level}`);
    }

  } catch (err) {
    logger.error('Leveling Error:', err);
  }
}
